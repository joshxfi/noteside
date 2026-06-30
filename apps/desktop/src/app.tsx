// app.tsx — window chrome, notebook sidebar, editor + finder + settings orchestration.
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { backend, type NoteMeta } from "./backend";
import { Editor } from "./editor/editor";
import { type AppCommand, setInsertEscape, setUserKeymaps } from "./editor/ex-commands";
import { Finder } from "./components/finder";
import { SettingsPanel } from "./components/settings-panel";
import { CommandPalette, type PaletteAction } from "./components/command-palette";
import { Backlinks } from "./components/backlinks";
import { CommandSearch } from "./components/command-search";
import { Cheatsheet } from "./components/cheatsheet";
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
  accentValue,
  CONFIG_DEFAULTS,
  type Config,
  fontStack,
  isFirstLaunch,
  parseConfig,
  serializeConfig,
} from "./settings";
import { openExternal } from "./open-external";
import { useEditingSession } from "./use-editing-session";
import { useGlobalChords } from "./use-global-chords";
import { isTauri, windowControl } from "./use-window-controls";

const AUTOSAVE_MS = 800;

type Status = "boot" | "no-notebook" | "ready";
type FinderMode = "all" | "files" | "content";

function relTime(ms: number): string {
  const diff = Date.now() - ms;
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

function TrafficLights({ onCloseNote }: { onCloseNote: () => void }) {
  const tauri = isTauri();
  const onRed = () => (tauri ? void windowControl("close") : onCloseNote());
  return (
    <div className="av-lights">
      <button className="av-dot red" onClick={onRed} aria-label="close" />
      {tauri ? (
        <>
          <button
            className="av-dot amber"
            onClick={() => void windowControl("minimize")}
            aria-label="minimize"
          />
          <button
            className="av-dot green"
            onClick={() => void windowControl("toggleMaximize")}
            aria-label="zoom"
          />
        </>
      ) : (
        <>
          <span className="av-dot amber" />
          <span className="av-dot green" />
        </>
      )}
    </div>
  );
}

// Past this many notes the list is virtualized (only visible rows mount); below
// it the plain flex list renders verbatim, so typical notebooks are untouched.
const VIRTUAL_THRESHOLD = 100;

function NoteRow({
  note,
  active,
  dirty,
  onPick,
  style,
  index,
  measureRef,
}: {
  note: NoteMeta;
  active: boolean;
  dirty: boolean;
  onPick: (id: string) => void;
  style?: CSSProperties;
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
      style={style}
    >
      <span className="av-item-bar" />
      <span className="av-item-main">
        <span className="av-item-title">
          <span className="av-item-titletext">{note.title}</span>
          {active && dirty && <span className="av-item-dot" />}
        </span>
        <span className="av-item-meta">
          {note.tags[0] ? `${note.tags[0]} · ` : ""}
          {relTime(note.updated)}
        </span>
      </span>
    </button>
  );
}

// Windowed note list for large notebooks — measures real row heights (titles
// may wrap), so the scrollbar stays accurate without assuming a fixed row size.
function VirtualNoteList({
  notes,
  activeId,
  activeDirty,
  onPick,
}: {
  notes: NoteMeta[];
  activeId: string | null;
  activeDirty: boolean;
  onPick: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });
  const activeIndex = activeId ? notes.findIndex((n) => n.id === activeId) : -1;
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
              dirty={activeDirty}
              onPick={onPick}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            />
          );
        })}
      </div>
    </nav>
  );
}

function Sidebar({
  open,
  notes,
  activeId,
  activeDirty,
  onPick,
  onNew,
  onSettings,
}: {
  open: boolean;
  notes: NoteMeta[];
  activeId: string | null;
  activeDirty: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
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
                dirty={activeDirty}
                onPick={onPick}
              />
            ))}
          </nav>
        ) : (
          <VirtualNoteList
            notes={notes}
            activeId={activeId}
            activeDirty={activeDirty}
            onPick={onPick}
          />
        )}
        <div className="av-sidefoot">
          <button className="av-config" onClick={onNew}>
            <svg
              className="av-cfg-glyph"
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7.5 3v9M3 7.5h9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            New note
          </button>
          <button className="av-config" onClick={onSettings}>
            <svg
              className="av-cfg-glyph"
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 5h10M2.5 10h10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <circle
                cx="5.5"
                cy="5"
                r="1.7"
                fill="var(--paper-2)"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle
                cx="9.5"
                cy="10"
                r="1.7"
                fill="var(--paper-2)"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            Settings
          </button>
        </div>
      </div>
    </aside>
  );
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
  const [cfg, setCfg] = useState<Config>(CONFIG_DEFAULTS);
  const [status, setStatus] = useState<Status>("boot");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finder, setFinder] = useState<{ mode: FinderMode } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cmdSearchOpen, setCmdSearchOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [refocus, setRefocus] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<{ title: string; refs: Backlink[] } | null>(null);
  // first-launch vim / plain-keyboard choice; cleared (and persisted) once picked
  const [onboarding, setOnboarding] = useState(false);

  const configLoaded = useRef(false);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 1600);
  };

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
    onNotesChanged: setNotes,
  });

  // apply config -> design tokens (always); persist only after initial load
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", cfg.theme);
    r.style.setProperty("--accent-base", accentValue(cfg.accent));
    r.style.setProperty("--editor-font", fontStack(cfg.editorFont, "editor"));
    r.style.setProperty("--mono", fontStack(cfg.uiFont, "ui"));
    r.style.setProperty("--editor-size", cfg.fontSize + "px");
    r.style.setProperty("--editor-lh", String(cfg.lineHeight));
    r.style.setProperty("--ui-scale", String(cfg.uiScale));
    if (configLoaded.current) void backend.setConfig(cfg);
  }, [cfg]);

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
    setStatus("ready");
    if (metas.length) await session.open(metas[0].id);
    else session.close();
  };

  // boot: load config, then last notebook
  useEffect(() => {
    (async () => {
      let stored: Partial<Config> | null = null;
      try {
        stored = await backend.getConfig();
        if (stored) setCfg((c) => ({ ...c, ...stored }));
      } catch {
        /* defaults */
      }
      configLoaded.current = true;
      let last: string | null = null;
      try {
        last = await backend.getLastNotebook();
      } catch {
        /* no remembered notebook */
      }
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
  const openSettings = () => setSettingsOpen(true);
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

  const createNote = async () => {
    try {
      const meta = await backend.createNote();
      setNotes(await backend.listNotes());
      await session.open(meta.id);
    } catch (e) {
      flash(`couldn't create note: ${e}`);
    }
  };

  const deleteActive = async () => {
    if (s.status !== "note" || !s.activeId) return;
    const path = s.activeId;
    session.cancelAutosave(); // drop any queued save so it can't resurrect the file
    try {
      await backend.deleteNote(path);
      const list = await backend.listNotes();
      setNotes(list);
      const next = list[0]?.id ?? null;
      if (next) await session.open(next);
      else session.close();
      flash("note deleted");
    } catch (e) {
      flash(`delete failed: ${e}`);
    }
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

  // Step to the adjacent note in the sidebar list (Mod-j / Mod-k). Clamps at the
  // ends; opening flushes any pending save of the outgoing buffer.
  const stepNote = (delta: number) => {
    if (notes.length === 0) return;
    const i = s.activeId ? notes.findIndex((n) => n.id === s.activeId) : -1;
    const next = notes[Math.max(0, Math.min(notes.length - 1, i + delta))];
    if (next && next.id !== s.activeId) void session.open(next.id);
  };

  const onCommand = (c: AppCommand) => {
    if (c === "find") openFinder("all");
    else if (c === "grep") openFinder("content");
    else if (c === "nav") toggleNav();
    else if (c === "settings") openSettings();
    else if (c === "config") openConfig();
    else if (c === "palette") setPaletteOpen(true);
    else if (c === "commands") setCmdSearchOpen(true);
    else if (c === "cheatsheet") setCheatsheetOpen(true);
    else if (c === "new") void createNote();
    else if (c === "delete") void deleteActive();
    else if (c === "togglePreview") togglePreview();
    else if (c === "backlinks") void openBacklinks();
    else if (c === "reopen") session.reopenLast();
    else if (c === "nextNote") stepNote(1);
    else if (c === "prevNote") stepNote(-1);
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
      backlinks
    ),
    overrides: cfg.chords,
    run: onCommand,
  });

  // The which-key leader palette is derived from the command table (single source).
  const paletteActions: PaletteAction[] = leaderCommands.map((c) => ({
    key: c.leader as string,
    label: c.title,
    hint: c.id === "togglePreview" ? (cfg.livePreview ? "on" : "off") : c.paletteHint,
    danger: c.danger,
    run: () => runPaletteCommand(c),
  }));

  const titleText = s.title;
  const showEditor = s.status !== "empty";
  const vimSuffix = cfg.vimMode ? "v" : "t";
  const previewOn = s.status === "note" && cfg.livePreview;

  return (
    <div className="av-desktop">
      <div className="av-window">
        <div className="av-titlebar" data-tauri-drag-region>
          <TrafficLights onCloseNote={() => s.activeId && session.quit()} />
          <button
            className="av-iconbtn av-navtoggle"
            onClick={toggleNav}
            title={`toggle sidebar (${chordLabel("Mod-b")})`}
            aria-label="toggle sidebar"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <rect
                x="1"
                y="2.5"
                width="13"
                height="10"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <line x1="5.6" y1="2.5" x2="5.6" y2="12.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            className="av-iconbtn"
            onClick={() => openFinder("all")}
            title={`search (${chordLabel("Mod-p")})`}
            aria-label="search"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <circle
                cx="6.4"
                cy="6.4"
                r="4.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <line
                x1="9.5"
                y1="9.5"
                x2="13"
                y2="13"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
        </div>

        <div className="av-body">
          {status === "ready" && (
            <Sidebar
              open={navOpen}
              notes={notes}
              activeId={s.activeId}
              activeDirty={s.dirty}
              onPick={(id) => void session.open(id)}
              onNew={() => void createNote()}
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
              <Editor
                key={
                  s.editorKey +
                  ":" +
                  vimSuffix +
                  ":" +
                  (previewOn ? "p" : "s") +
                  (cfg.relativeNumbers ? ":rn" : "")
                }
                notePath={s.activeId as string}
                fileLabel={s.title ?? ""}
                initialText={s.initialText}
                savedText={s.savedText}
                vimMode={cfg.vimMode}
                cursorBlink={cfg.cursorBlink}
                relativeNumbers={cfg.relativeNumbers}
                chordOverrides={cfg.chords}
                preview={previewOn}
                linkTargets={[...new Set(notes.map((n) => n.title))]}
                gotoLine={s.gotoLine}
                refocusToken={refocus}
                onChange={(text, dirty) => session.change(text, dirty)}
                onSave={(text) => session.save(text)}
                onQuit={() => session.quit()}
                onCommand={onCommand}
                onFollowLink={onFollowLink}
                onOpenUrl={onOpenUrl}
              />
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
          />
        )}
        {finder && (
          <Finder initialMode={finder.mode} onClose={closeFinder} onOpen={openFromFinder} />
        )}
        {paletteOpen && <CommandPalette actions={paletteActions} onClose={closePalette} />}
        {cmdSearchOpen && (
          <CommandSearch
            commands={withChordOverrides(
              paletteCommands.filter((c) => !c.needsNote || s.status === "note"),
              cfg.chords,
            )}
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
      </div>
    </div>
  );
}
