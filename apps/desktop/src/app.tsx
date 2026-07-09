// app.tsx — window chrome, notebook sidebar, editor + finder + settings orchestration.
import {
  Component,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  FileText,
  Library,
  PanelLeft,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { backend, type NoteMeta } from "./backend";
import type { AppCommand } from "./editor/ex-commands";
import { setInsertEscape, setUserKeymaps } from "./editor/vim-config";
import { Finder } from "./components/finder";
import { SettingsPanel } from "./components/settings-panel";
import { CommandPalette } from "./components/command-palette";
import { Backlinks } from "./components/backlinks";
import { CommandSearch } from "./components/command-search";
import { Cheatsheet } from "./components/cheatsheet";
import { type NoteMenuItem, NoteContextMenu } from "./components/note-context-menu";
import { NotebookSwitcher } from "./components/notebook-switcher";
import { Onboarding } from "./components/onboarding";
import {
  cheatsheetCommands,
  chordLabel,
  type Command,
  leaderCommands,
  paletteCommands,
  withChordOverrides,
} from "./editor/commands";
import { type Backlink, resolveLink } from "./links";
import {
  CONFIG_DEFAULTS,
  type Config,
  fontStack,
  isFirstLaunch,
  parseConfig,
  serializeConfig,
} from "./settings";
import { applyThemeVars, resolveThemeId, resolveThemeVars, themeById } from "./themes";
import { ThemePicker } from "./components/theme-picker";
import { openExternal } from "./open-external";
import { useEditingSession } from "./use-editing-session";
import { useGlobalChords } from "./use-global-chords";
import { isTauri } from "./use-window-controls";

// The editor chunk (~700KB: CM6 + vim) is the parse-heavy part of the bundle.
// Loading it lazily keeps it off the first-paint path; kicking the import at
// module scope starts the (local, fast) fetch immediately, so it's ready by the
// time a note opens.
const editorChunk = import("./editor/editor");
editorChunk.catch(() => {}); // rejection surfaces via EditorBoundary at render, not as an unhandled event
const Editor = lazy(() => editorChunk.then((m) => ({ default: m.Editor })));

// Suspense catches loading, not failure — without this, a chunk-load error
// (corrupt/partial install) would unmount the whole app to a blank window.
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="av-empty">
        <div className="av-empty-title">The editor failed to load</div>
        <div className="av-empty-sub">
          This usually means a damaged install.{" "}
          <button className="av-link" onClick={() => location.reload()}>
            Reload
          </button>{" "}
          or reinstall Noteside.
        </div>
      </div>
    );
  }
}

const AUTOSAVE_MS = 800;

// The theme mirror the index.html boot script paints from before the config
// store loads (kills the light-flash for dark/base16 users). Written by the
// config-apply effect; read here to seed the initial cfg so the first React
// render agrees with the boot script instead of undoing it.
const BOOT_THEME_KEY = "noteside:boot-theme";

function bootConfig(): Config {
  try {
    const raw = localStorage.getItem(BOOT_THEME_KEY);
    const t = raw ? (JSON.parse(raw) as { id?: unknown }) : null;
    const id = typeof t?.id === "string" ? resolveThemeId(t.id) : null;
    if (id) return { ...CONFIG_DEFAULTS, theme: id };
  } catch {
    /* corrupt mirror — defaults */
  }
  return CONFIG_DEFAULTS;
}

type Status = "boot" | "no-notebook" | "ready";
type FinderMode = "all" | "files" | "content";

function relTime(ms: number, now: number): string {
  const diff = now - ms;
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// Landing-demo-only chrome (the native app shows the OS traffic lights instead
// and never renders this — see the !isTauri() gate at the render site). Red
// stands in for "close" by closing the note buffer; amber/green are inert.
function TrafficLights({ onCloseNote }: { onCloseNote: () => void }) {
  return (
    <div className="av-lights">
      <button className="av-dot red" onClick={onCloseNote} aria-label="close" />
      <span className="av-dot amber" />
      <span className="av-dot green" />
    </div>
  );
}

// Past this many notes the list is virtualized (only visible rows mount); below
// it the plain flex list renders verbatim, so typical notebooks are untouched.
const VIRTUAL_THRESHOLD = 100;

// Memoized so an autosave landing (which replaces one meta in the list) or a
// toast re-renders 1 row, not all of them. `top` is a primitive (the virtual
// offset) so the memo compare stays shallow; `now` ticks once a minute to keep
// the relative timestamps honest.
const NoteRow = memo(function NoteRow({
  note,
  active,
  onPick,
  onContext,
  now,
  top,
  index,
  measureRef,
}: {
  note: NoteMeta;
  active: boolean;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, x: number, y: number) => void;
  now: number;
  top?: number;
  index?: number;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={measureRef}
      data-index={index}
      className={"av-item" + (active ? " is-active" : "")}
      aria-current={active ? "page" : undefined}
      onClick={() => onPick(note.id)}
      onContextMenu={(e) => {
        e.preventDefault(); // suppress the WebView's native menu
        onContext(note.id, note.title, e.clientX, e.clientY);
      }}
      style={
        top === undefined
          ? undefined
          : {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
    >
      <span className="av-item-bar" />
      <span className="av-item-main">
        <span className="av-item-title">
          <span className="av-item-titletext">{note.title}</span>
        </span>
        <span className="av-item-meta">
          {note.tags[0] ? `${note.tags[0]} · ` : ""}
          {relTime(note.updated, now)}
        </span>
      </span>
    </button>
  );
});

// Windowed note list for large notebooks — measures real row heights (titles
// may wrap), so the scrollbar stays accurate without assuming a fixed row size.
function VirtualNoteList({
  notes,
  activeId,
  onPick,
  onContext,
  now,
}: {
  notes: NoteMeta[];
  activeId: string | null;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, x: number, y: number) => void;
  now: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });
  const activeIndex = useMemo(
    () => (activeId ? notes.findIndex((n) => n.id === activeId) : -1),
    [notes, activeId],
  );
  useEffect(() => {
    if (activeIndex >= 0) virt.scrollToIndex(activeIndex, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <nav className="av-list" ref={scrollRef} aria-label="Notes">
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((item) => {
          const n = notes[item.index];
          return (
            <NoteRow
              key={n.id}
              note={n}
              index={item.index}
              measureRef={virt.measureElement}
              active={n.id === activeId}
              onPick={onPick}
              onContext={onContext}
              now={now}
              top={item.start}
            />
          );
        })}
      </div>
    </nav>
  );
}

const Sidebar = memo(function Sidebar({
  open,
  notes,
  activeId,
  onPick,
  onContext,
  onNew,
  onSettings,
}: {
  open: boolean;
  notes: NoteMeta[];
  activeId: string | null;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, x: number, y: number) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  // Minute tick so memoized rows still refresh their "5m ago" labels (they used
  // to piggyback on unrelated App re-renders).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <aside className={"av-sidebar" + (open ? "" : " is-collapsed")}>
      <div className="av-sidebar-inner">
        <div className="av-brand">
          <div className="av-brandmark">
            Noteside
            <span className="av-brandcur" />
          </div>
          <div className="av-brandsub">notes for keyboard people</div>
        </div>
        {notes.length <= VIRTUAL_THRESHOLD ? (
          <nav className="av-list" aria-label="Notes">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                active={n.id === activeId}
                onPick={onPick}
                onContext={onContext}
                now={now}
              />
            ))}
          </nav>
        ) : (
          <VirtualNoteList
            notes={notes}
            activeId={activeId}
            onPick={onPick}
            onContext={onContext}
            now={now}
          />
        )}
        <div className="av-sidefoot">
          <button className="av-config" onClick={onNew}>
            <Plus className="av-cfg-glyph" size={15} aria-hidden="true" />
            New note
          </button>
          <button className="av-config" onClick={onSettings}>
            <SlidersHorizontal className="av-cfg-glyph" size={15} aria-hidden="true" />
            Settings
          </button>
        </div>
      </div>
    </aside>
  );
});

// Sidebar list order (matches the backend: pinned desc, then updated desc) — so
// create/delete can patch the list locally instead of refetching it over IPC.
function metaOrder(a: NoteMeta, b: NoteMeta): number {
  return Number(b.pinned) - Number(a.pinned) || b.updated - a.updated;
}
function insertMeta(list: NoteMeta[], meta: NoteMeta): NoteMeta[] {
  // Stable re-sort of the whole list, not just an insert: the old code refetched
  // listNotes here, which also re-slotted any note whose `updated` bumped since
  // (autosaves patch metas in place without re-sorting) — keep that behavior.
  return [...list, meta].sort(metaOrder);
}

// Watcher events often rescan to an identical list — keep the old array identity
// so the memoized sidebar doesn't re-render for nothing.
function sameMetaList(a: NoteMeta[], b: NoteMeta[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.updated !== y.updated ||
      x.pinned !== y.pinned ||
      x.tags[0] !== y.tags[0]
    ) {
      return false;
    }
  }
  return true;
}

function NotebookPicker({ onPick }: { onPick: () => void }) {
  return (
    <div className="av-empty">
      <div className="av-mark" aria-label="Noteside">
        <span className="n">N</span>
        <span className="cur" />
      </div>
      <div className="av-empty-title">Open a notebook</div>
      <div className="av-empty-sub">
        Choose a folder of Markdown files — your notes stay as plain files on your disk.
      </div>
      <button className="set-done" style={{ marginTop: 8 }} onClick={onPick}>
        Open folder…
      </button>
    </div>
  );
}

function EmptyState({ onReopen, hasClosed }: { onReopen: () => void; hasClosed: boolean }) {
  return (
    <div className="av-empty">
      <div className="av-empty-glyph">▌</div>
      <div className="av-empty-title">No note open</div>
      <div className="av-empty-sub">
        {hasClosed ? "You closed the buffer with :q." : "Pick a note to begin."} Choose one from the
        sidebar
        {hasClosed && (
          <>
            {" "}
            — or{" "}
            <button className="av-link" onClick={onReopen}>
              reopen the last one
            </button>
          </>
        )}
        .
      </div>
      <div className="av-empty-keys">
        <kbd>{chordLabel("Mod-p")}</kbd> find a note · <kbd>{chordLabel("Mod-n")}</kbd> new note ·{" "}
        <kbd>{chordLabel("Mod-/")}</kbd> all shortcuts
      </div>
    </div>
  );
}

export function App() {
  const [cfg, setCfg] = useState<Config>(bootConfig);
  const [status, setStatus] = useState<Status>("boot");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [notebookSwitcherOpen, setNotebookSwitcherOpen] = useState(false);
  // The open notebook's path — drives the switcher's "current" marker + no-op guard.
  const [notebookPath, setNotebookPath] = useState<string | null>(null);
  const [finder, setFinder] = useState<{ mode: FinderMode } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cmdSearchOpen, setCmdSearchOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [refocus, setRefocus] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [backlinks, setBacklinks] = useState<{ title: string; refs: Backlink[] } | null>(null);
  // right-click note menu; null when closed. x/y are viewport coords (position:fixed).
  const [menu, setMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(
    null,
  );
  // first-launch vim / plain-keyboard choice; cleared (and persisted) once picked
  const [onboarding, setOnboarding] = useState(false);

  const configLoaded = useRef(false);

  const flash = useCallback((msg: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 1600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // The editing session owns the whole per-buffer loop: working/saved/dirty,
  // autosave, open/save/quit, the config buffer kind, external reconcile, and the
  // editor remount key. App keeps the sidebar list, config *semantics*, and chrome.
  const { session, snapshot: s } = useEditingSession({
    backend,
    autosaveMs: AUTOSAVE_MS,
    notify: flash,
    onConfigApply: (text) => {
      setCfg(parseConfig(text, cfg));
      flash("config applied");
    },
    onNoteSaved: (meta) => setNotes((ns) => ns.map((n) => (n.id === meta.id ? meta : n))),
    onNoteRenamed: (oldId, meta) => setNotes((ns) => ns.map((n) => (n.id === oldId ? meta : n))),
    onNotesChanged: (list) => setNotes((prev) => (sameMetaList(prev, list) ? prev : list)),
  });

  // Apply the theme: data-theme + inline palette vars + the boot-theme mirror.
  // Keyed on cfg.theme ONLY, so font/scale key-repeat doesn't recompute the
  // palette or re-write localStorage (see the debounced persist below).
  useEffect(() => {
    const r = document.documentElement;
    const theme = themeById(cfg.theme);
    if (r.getAttribute("data-theme") !== theme.mode) r.setAttribute("data-theme", theme.mode);
    applyThemeVars(r, theme);
    try {
      localStorage.setItem(
        BOOT_THEME_KEY,
        JSON.stringify({ id: theme.id, mode: theme.mode, vars: resolveThemeVars(theme) }),
      );
    } catch {
      /* private mode / quota — cosmetic only */
    }
  }, [cfg.theme]);

  // Apply font/size/scale CSS vars. These change on every zoom key-repeat, so
  // they must NOT drag the palette recompute or the localStorage write along.
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--editor-font", fontStack(cfg.editorFont, "editor"));
    r.style.setProperty("--mono", fontStack(cfg.uiFont, "ui"));
    r.style.setProperty("--editor-size", cfg.fontSize + "px");
    r.style.setProperty("--editor-lh", String(cfg.lineHeight));
    r.style.setProperty("--ui-scale", String(cfg.uiScale));
  }, [cfg.editorFont, cfg.uiFont, cfg.fontSize, cfg.lineHeight, cfg.uiScale]);

  // persist config, debounced: held settings steppers fire per key-repeat, and
  // each store.set is an IPC (a sync localStorage write in the demo). The tail
  // is flushed on unmount/pagehide so a quick quit can't drop the last change.
  const persistTimer = useRef<number | null>(null);
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
    if (!configLoaded.current) return;
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      void backend.setConfig(cfgRef.current);
    }, 300);
  }, [cfg]);
  useEffect(() => {
    const flushConfig = () => {
      if (persistTimer.current === null) return;
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
      void backend.setConfig(cfgRef.current);
    };
    // pagehide covers the browser/demo; WKWebView doesn't reliably fire it on a
    // native close/Cmd-Q, so the Tauri close-requested event is the real flush
    // there (without it, a theme commit + fast quit would silently revert).
    window.addEventListener("pagehide", flushConfig);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) {
      // CAUTION: registering onCloseRequested makes Tauri core intercept the
      // native close and rely on the JS wrapper calling window.destroy() —
      // which needs `core:window:allow-destroy` in capabilities/default.json
      // (missing = the X button silently does nothing; shipped as the v1.3.0
      // bug). tauri-capabilities.test.ts pins that coupling. The handler must
      // also never throw, or destroy() is skipped and close breaks again.
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onCloseRequested(() => {
            try {
              flushConfig();
            } catch {
              /* never block closing over a failed flush */
            }
          }),
        )
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flushConfig);
      unlisten?.();
      flushConfig();
    };
  }, []);

  // keep the vim insert-escape mapping (e.g. "jj" → <Esc>) in sync with settings
  useEffect(() => {
    setInsertEscape(cfg.escMap);
  }, [cfg.escMap]);

  // apply user keymaps from ~/.notesiderc (nmap/imap/vmap lines)
  useEffect(() => {
    setUserKeymaps(cfg.keymaps);
  }, [cfg.keymaps]);

  const openNotebook = async (path: string) => {
    const metas = await backend.openNotebook(path);
    setNotes(metas);
    void backend.setLastNotebook(path);
    void backend.rememberNotebook(path); // feed the switcher's recents (MRU)
    setNotebookPath(path);
    setStatus("ready");
    if (metas.length) await session.open(metas[0].id);
    else session.close();
  };

  // Switch to another notebook (from the switcher). A no-op when it's already open.
  const switchNotebook = async (path: string) => {
    if (path === notebookPath) return;
    // Deactivate the outgoing buffer FIRST, synchronously (before any await): once
    // activeId is null, session.change() no-ops, so a keystroke landing in the
    // async window below — the overlay's onClose refocuses the old editor — can't
    // queue a save that would fire AFTER the index swaps and write the old note's
    // text into the NEW notebook. The pre-switch queued save survives in the
    // autosaver and flush() still lands it in the OLD notebook (the index is
    // unchanged until openNotebook).
    session.close();
    await session.flush();
    try {
      await openNotebook(path);
    } catch (e) {
      void backend.removeRecentNotebook(path); // a folder that's gone shouldn't linger in recents
      flash(`couldn't open notebook: ${e}`);
    }
  };
  // Switcher "Open folder…": native dialog → switch to the chosen folder.
  const pickAndSwitchNotebook = async () => {
    const path = await backend.pickNotebook();
    if (path) await switchNotebook(path);
  };
  // Switcher "New notebook…": create the folder, then open it (empty → empty state).
  const createNotebook = async (parent: string, name: string) => {
    try {
      const path = await backend.createNotebook(parent, name);
      await switchNotebook(path);
    } catch (e) {
      flash(`couldn't create notebook: ${e}`);
    }
  };

  // boot: load config + last notebook in parallel (independent reads)
  useEffect(() => {
    (async () => {
      const [stored, last] = await Promise.all([
        backend.getConfig().catch(() => null),
        backend.getLastNotebook().catch(() => null),
      ]);
      if (stored) {
        // Pre-themes configs stored theme:"light"|"dark" — normalize the alias
        // (or any unknown id) to a canonical theme id so raw comparisons (e.g.
        // the picker's is-current marker) work and the store converges.
        const theme = typeof stored.theme === "string" ? resolveThemeId(stored.theme) : null;
        setCfg((c) => ({ ...c, ...stored, theme: theme ?? c.theme }));
      }
      configLoaded.current = true;
      // A brand-new user (no stored config, no notebook) gets the one-time
      // vim/plain-keyboard choice before anything else. Picking it persists the
      // config, so the gate never fires again.
      if (isFirstLaunch(stored, last)) setOnboarding(true);
      try {
        if (last) await openNotebook(last);
        else setStatus("no-notebook");
      } catch {
        setStatus("no-notebook");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // react to external notebook changes (other editors, git, sync). The session
  // reconciles the active buffer against disk reading its own live id, so the
  // watcher needs no stale-closure indirection.
  useEffect(() => {
    let un: (() => void) | null = null;
    let cancelled = false;
    backend
      .watchNotebook(() => void session.reconcile())
      .then((u) => {
        if (cancelled) u();
        else un = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      un?.();
    };
  }, [session]);

  const pickNotebook = async () => {
    const path = await backend.pickNotebook();
    if (path) {
      setStatus("boot");
      try {
        await openNotebook(path);
      } catch {
        setStatus("no-notebook");
      }
    }
  };

  const openFinder = (mode: FinderMode) => setFinder({ mode });
  const closeFinder = () => {
    setFinder(null);
    setRefocus((r) => r + 1);
  };
  const openFromFinder = async (path: string, line: number) => {
    setFinder(null);
    await session.open(path, line && line > 0 ? line : 0);
    setRefocus((r) => r + 1);
  };

  // follow a [[wikilink]] (gf / :follow): resolve to a note and open it
  const onFollowLink = (target: string) => {
    const hit = resolveLink(target, notes);
    if (hit) void session.open(hit.id);
    else flash(`no note: ${target}`);
  };
  // open an external URL under the cursor (gf / gx / :follow / Mod-click)
  const onOpenUrl = (url: string) => {
    void openExternal(url).then((ok) => {
      if (!ok) flash(`can't open: ${url}`);
    });
  };
  const openBacklinks = async () => {
    if (s.status !== "note" || !s.activeId) {
      flash("open a note first");
      return;
    }
    try {
      const refs = await backend.backlinks(s.activeId);
      setBacklinks({ title: s.title ?? s.activeId, refs });
    } catch (e) {
      flash(`backlinks failed: ${e}`);
    }
  };
  const closeBacklinks = () => {
    setBacklinks(null);
    setRefocus((r) => r + 1);
  };

  const openConfig = () => {
    setSettingsOpen(false);
    session.openConfig(serializeConfig(cfg));
  };
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = () => {
    setSettingsOpen(false);
    setRefocus((r) => r + 1);
  };
  const setCfgPatch = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  // Resolve the first-launch choice: set vim on/off and dismiss the gate. Writing
  // cfg (configLoaded is true by boot's end) persists it, so it never shows again.
  const finishOnboarding = (vim: boolean) => {
    setOnboarding(false);
    setCfg((c) => ({ ...c, vimMode: vim }));
    flash(vim ? "vim mode on" : "plain keyboard mode on");
    setRefocus((r) => r + 1);
  };
  const toggleNav = () => {
    setNavOpen((v) => !v);
    setRefocus((r) => r + 1);
  };
  const togglePreview = () => {
    setCfgPatch({ livePreview: !cfg.livePreview });
    flash(cfg.livePreview ? "live preview off" : "live preview on");
  };

  // Create/delete patch the sidebar list locally — the meta (or the removal) is
  // already known, so refetching all N metas over IPC is wasted; the watcher's
  // reconcile() remains the eventual-consistency backstop.
  const createNote = useCallback(async () => {
    try {
      const meta = await backend.createNote();
      setNotes((ns) => insertMeta(ns, meta));
      await session.open(meta.id);
    } catch (e) {
      flash(`couldn't create note: ${e}`);
    }
  }, [session, flash]);

  // Delete any note by id — the active buffer (via :rm / <Space>d) or a
  // right-clicked sidebar row. Deleting the active note drops its queued save (so
  // it can't resurrect the file) and opens the next note; deleting an inactive
  // note leaves the current buffer untouched.
  const deleteNoteById = async (id: string) => {
    const wasActive = s.status === "note" && s.activeId === id;
    if (wasActive) session.cancelAutosave();
    try {
      await backend.deleteNote(id);
      // Filter + stable re-sort ≙ the old listNotes refetch (see insertMeta).
      const remaining = notes.filter((n) => n.id !== id).sort(metaOrder);
      setNotes(remaining);
      if (wasActive) {
        const next = remaining[0]?.id ?? null;
        if (next) await session.open(next);
        else session.close();
      }
      flash("note deleted");
    } catch (e) {
      flash(`delete failed: ${e}`);
    }
  };

  const deleteActive = () => {
    if (s.status === "note" && s.activeId) void deleteNoteById(s.activeId);
  };

  const closePalette = () => {
    setPaletteOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeCmdSearch = () => {
    setCmdSearchOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeCheatsheet = () => {
    setCheatsheetOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeThemePicker = () => {
    setThemePickerOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeNotebookSwitcher = () => {
    setNotebookSwitcherOpen(false);
    setRefocus((r) => r + 1);
  };

  // Step to the adjacent note in the sidebar list (Mod-j / Mod-k). Clamps at the
  // ends; opening flushes any pending save of the outgoing buffer.
  const stepNote = (delta: number) => {
    if (notes.length === 0) return;
    const i = s.activeId ? notes.findIndex((n) => n.id === s.activeId) : -1;
    const next = notes[Math.max(0, Math.min(notes.length - 1, i + delta))];
    if (next && next.id !== s.activeId) void session.open(next.id);
  };

  // Mod± / Mod-Shift± zoom. Clamps mirror the settings-panel steppers; the CSS
  // vars apply live (no remount) and the debounced persist coalesces key-repeat.
  const bumpFont = (d: number) => {
    const fontSize =
      d === 0 ? CONFIG_DEFAULTS.fontSize : Math.max(16, Math.min(28, cfg.fontSize + d));
    setCfgPatch({ fontSize });
    flash(`font size ${fontSize}px`);
  };
  const bumpUi = (d: number) => {
    const uiScale =
      d === 0
        ? CONFIG_DEFAULTS.uiScale
        : Math.max(0.9, Math.min(1.3, Math.round((cfg.uiScale + d) * 20) / 20));
    setCfgPatch({ uiScale });
    flash(`interface ${Math.round(uiScale * 100)}%`);
  };

  const onCommand = (c: AppCommand) => {
    if (c === "find") openFinder("all");
    else if (c === "grep") openFinder("content");
    else if (c === "notebooks") setNotebookSwitcherOpen(true);
    else if (c === "nav") toggleNav();
    else if (c === "settings") openSettings();
    else if (c === "theme") setThemePickerOpen(true);
    else if (c === "config") openConfig();
    else if (c === "palette") setPaletteOpen(true);
    else if (c === "commands") setCmdSearchOpen(true);
    else if (c === "cheatsheet") setCheatsheetOpen(true);
    else if (c === "new") void createNote();
    else if (c === "delete") deleteActive();
    else if (c === "togglePreview") togglePreview();
    else if (c === "backlinks") void openBacklinks();
    else if (c === "reopen") session.reopenLast();
    else if (c === "nextNote") stepNote(1);
    else if (c === "prevNote") stepNote(-1);
    else if (c === "fontUp") bumpFont(1);
    else if (c === "fontDown") bumpFont(-1);
    else if (c === "fontReset") bumpFont(0);
    else if (c === "uiUp") bumpUi(0.05);
    else if (c === "uiDown") bumpUi(-0.05);
    else if (c === "uiReset") bumpUi(0);
  };

  // Run a command chosen from the searchable palette. App-level: AppCommands via
  // onCommand, plus quit. Editor-context commands (save/follow) aren't listed there.
  const runPaletteCommand = (cmd: Command) => {
    if (cmd.command) onCommand(cmd.command);
    else if (cmd.editor === "quit") session.quit();
  };

  // Chords when no editor is focused (empty state / picker). Disabled while any
  // overlay is open so it never steals keys from a panel that owns its own focus.
  useGlobalChords({
    enabled: !(
      onboarding ||
      finder ||
      paletteOpen ||
      cmdSearchOpen ||
      cheatsheetOpen ||
      settingsOpen ||
      themePickerOpen ||
      notebookSwitcherOpen ||
      backlinks ||
      menu
    ),
    overrides: cfg.chords,
    run: onCommand,
  });

  // Stable handles for the memoized sidebar (so autosaves/toasts re-render rows,
  // not the whole tree).
  const openNote = useCallback((id: string) => void session.open(id), [session]);
  const onNewNote = useCallback(() => void createNote(), [createNote]);
  const openNoteMenu = useCallback(
    (id: string, title: string, x: number, y: number) => setMenu({ id, title, x, y }),
    [],
  );
  const closeNoteMenu = useCallback(() => {
    setMenu(null);
    setRefocus((r) => r + 1);
  }, []);

  // Rebuilt only when the notebook list changes — read lazily by the wikilink
  // autocomplete via the editor's props ref.
  const linkTargets = useMemo(() => [...new Set(notes.map((n) => n.title))], [notes]);

  const searchableCommands = useMemo(
    () =>
      withChordOverrides(
        paletteCommands.filter((c) => !c.needsNote || s.status === "note"),
        cfg.chords,
      ),
    [cfg.chords, s.status],
  );

  const titleText = s.title;
  const showEditor = s.status !== "empty";
  const vimSuffix = cfg.vimMode ? "v" : "t";
  const previewOn = s.status === "note" && cfg.livePreview;

  return (
    <div className="av-desktop">
      <div className="av-window">
        <div className="av-titlebar" data-tauri-drag-region>
          {!isTauri() && <TrafficLights onCloseNote={() => s.activeId && session.quit()} />}
          <button
            className="av-iconbtn av-navtoggle"
            onClick={toggleNav}
            title={`toggle sidebar (${chordLabel("Mod-b")})`}
            aria-label="toggle sidebar"
          >
            <PanelLeft size={15} aria-hidden="true" />
          </button>
          <button
            className="av-iconbtn"
            onClick={() => openFinder("all")}
            title={`search (${chordLabel("Mod-p")})`}
            aria-label="search"
          >
            <Search size={15} aria-hidden="true" />
          </button>
          <button
            className="av-iconbtn"
            onClick={() => setNotebookSwitcherOpen(true)}
            title={`switch notebook (${chordLabel("Mod-o")})`}
            aria-label="switch notebook"
          >
            <Library size={15} aria-hidden="true" />
          </button>
          {!isTauri() && (
            <div className="av-title" data-tauri-drag-region>
              {titleText ? (
                <>
                  Noteside — {titleText}
                  {s.status === "note" && <span className="av-ext">.md</span>}
                </>
              ) : (
                "Noteside"
              )}
            </div>
          )}
        </div>

        <div className="av-body">
          {status === "ready" && (
            <Sidebar
              open={navOpen}
              notes={notes}
              activeId={s.activeId}
              onPick={openNote}
              onContext={openNoteMenu}
              onNew={onNewNote}
              onSettings={openSettings}
            />
          )}
          <main className="av-main">
            {onboarding ? (
              <Onboarding onChoose={finishOnboarding} />
            ) : status === "boot" ? (
              <div className="av-empty">
                <div className="av-empty-glyph">▌</div>
              </div>
            ) : status === "no-notebook" ? (
              <NotebookPicker onPick={() => void pickNotebook()} />
            ) : showEditor ? (
              // Preview/relativeNumbers deliberately NOT in the key: the editor
              // reconfigures them live via compartments (a remount would lose
              // cursor + undo history and reseed from open-time text).
              <EditorBoundary>
                <Suspense fallback={null}>
                  <Editor
                    key={s.editorKey + ":" + vimSuffix}
                    notePath={s.activeId as string}
                    fileLabel={s.title ?? ""}
                    initialText={s.initialText}
                    savedText={s.savedText}
                    dirty={s.status === "note" ? s.dirty : undefined}
                    vimMode={cfg.vimMode}
                    cursorBlink={cfg.cursorBlink}
                    cursor={cfg.cursor}
                    relativeNumbers={cfg.relativeNumbers}
                    chordOverrides={cfg.chords}
                    preview={previewOn}
                    linkTargets={linkTargets}
                    gotoLine={s.gotoLine}
                    refocusToken={refocus}
                    onChange={(text, dirty) => session.change(text, dirty)}
                    onSave={(text) => session.save(text)}
                    onQuit={() => session.quit()}
                    onCommand={onCommand}
                    onFollowLink={onFollowLink}
                    onOpenUrl={onOpenUrl}
                  />
                </Suspense>
              </EditorBoundary>
            ) : (
              <EmptyState hasClosed={!!s.lastNoteId} onReopen={() => session.reopenLast()} />
            )}
            {toast && <div className="av-toast">{toast}</div>}
          </main>
        </div>

        {settingsOpen && (
          <SettingsPanel
            cfg={cfg}
            setCfg={setCfgPatch}
            onClose={closeSettings}
            onEditFile={openConfig}
            onShortcuts={() => {
              setSettingsOpen(false);
              setCheatsheetOpen(true);
            }}
            onPickTheme={() => {
              setSettingsOpen(false);
              setThemePickerOpen(true);
            }}
          />
        )}
        {themePickerOpen && (
          <ThemePicker
            current={cfg.theme}
            onCommit={(id) => setCfgPatch({ theme: id })}
            onClose={closeThemePicker}
          />
        )}
        {notebookSwitcherOpen && (
          <NotebookSwitcher
            current={notebookPath}
            onSwitch={(p) => void switchNotebook(p)}
            onOpenFolder={() => void pickAndSwitchNotebook()}
            onCreate={(parent, name) => void createNotebook(parent, name)}
            onClose={closeNotebookSwitcher}
          />
        )}
        {finder && (
          <Finder initialMode={finder.mode} onClose={closeFinder} onOpen={openFromFinder} />
        )}
        {paletteOpen && (
          <CommandPalette
            // Derived from the command table only while open (single source).
            actions={leaderCommands.map((c) => ({
              key: c.leader as string,
              label: c.title,
              hint: c.id === "togglePreview" ? (cfg.livePreview ? "on" : "off") : c.paletteHint,
              danger: c.danger,
              run: () => runPaletteCommand(c),
            }))}
            onClose={closePalette}
          />
        )}
        {cmdSearchOpen && (
          <CommandSearch
            commands={searchableCommands}
            onRun={runPaletteCommand}
            onClose={closeCmdSearch}
          />
        )}
        {cheatsheetOpen && (
          <Cheatsheet
            commands={cheatsheetCommands}
            overrides={cfg.chords}
            onSetOverrides={(chords) => setCfgPatch({ chords })}
            onClose={closeCheatsheet}
          />
        )}
        {backlinks && (
          <Backlinks
            title={backlinks.title}
            refs={backlinks.refs}
            onOpen={(id, line) => {
              closeBacklinks();
              void session.open(id, line);
            }}
            onClose={closeBacklinks}
          />
        )}
        {menu && (
          <NoteContextMenu
            x={menu.x}
            y={menu.y}
            title={menu.title}
            items={
              [
                {
                  id: "open",
                  label: "Open",
                  icon: <FileText size={15} aria-hidden="true" />,
                  run: () => openNote(menu.id),
                },
                {
                  id: "delete",
                  label: "Delete",
                  icon: <Trash2 size={15} aria-hidden="true" />,
                  danger: true,
                  confirm: { prompt: `Delete “${menu.title}”?`, label: "Delete" },
                  run: () => void deleteNoteById(menu.id),
                },
              ] satisfies NoteMenuItem[]
            }
            onClose={closeNoteMenu}
          />
        )}
      </div>
    </div>
  );
}
