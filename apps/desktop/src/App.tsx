// App.tsx — window chrome, vault sidebar, editor + finder + settings orchestration.
import { useEffect, useRef, useState } from "react";
import { backend, type NoteDoc, type NoteMeta } from "./backend";
import { Editor } from "./editor/Editor";
import type { AppCommand } from "./editor/exCommands";
import { Finder } from "./components/Finder";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  accentValue,
  CONFIG_DEFAULTS,
  type Config,
  fontStack,
  parseConfig,
  serializeConfig,
} from "./settings";
import { isTauri, windowControl } from "./useWindowControls";

const RELATIVE_NUMBERS = true;
const CONFIG_ID = "config";
const AUTOSAVE_MS = 800;

type Status = "boot" | "no-vault" | "ready";
type FinderMode = "files" | "content";

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
          <div className="av-brandmark">Noteside</div>
          <div className="av-brandsub">notes for keyboard people</div>
        </div>
        <nav className="av-list">
          {notes.map((n) => (
            <button
              key={n.id}
              className={"av-item" + (n.id === activeId ? " is-active" : "")}
              onClick={() => onPick(n.id)}
            >
              <span className="av-item-bar" />
              <span className="av-item-main">
                <span className="av-item-title">
                  {n.title}
                  {n.id === activeId && activeDirty && <span className="av-item-dot" />}
                </span>
                <span className="av-item-meta">
                  {n.tags[0] ? `${n.tags[0]} · ` : ""}
                  {relTime(n.updated)}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="av-sidefoot">
          <button className="av-config" onClick={onNew}>
            <span className="av-cfg-glyph">＋</span> New note
          </button>
          <button className="av-config" onClick={onSettings}>
            <span className="av-cfg-glyph">⚙</span> Settings
          </button>
        </div>
      </div>
    </aside>
  );
}

function VaultPicker({ onPick }: { onPick: () => void }) {
  return (
    <div className="av-empty">
      <div className="av-empty-glyph">▌</div>
      <div className="av-empty-title">Open a vault</div>
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
    </div>
  );
}

export function App() {
  const [cfg, setCfg] = useState<Config>(CONFIG_DEFAULTS);
  const [status, setStatus] = useState<Status>("boot");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<NoteDoc | null>(null);
  const [savedText, setSavedText] = useState("");
  const [activeDirty, setActiveDirty] = useState(false);
  const [gotoLine, setGotoLine] = useState(0);
  const [configText, setConfigText] = useState("");
  const [configSaved, setConfigSaved] = useState("");
  const [configKey, setConfigKey] = useState(0);
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finder, setFinder] = useState<{ mode: FinderMode } | null>(null);
  const [refocus, setRefocus] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const latest = useRef("");
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configLoaded = useRef(false);

  const isConfig = activeId === CONFIG_ID;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 1600);
  };

  // apply config -> design tokens (always); persist only after initial load
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", cfg.theme);
    r.style.setProperty("--accent-base", accentValue(cfg.accent));
    r.style.setProperty("--editor-font", fontStack(cfg.editorFont, "editor"));
    r.style.setProperty("--mono", fontStack(cfg.uiFont, "ui"));
    r.style.setProperty("--editor-size", cfg.fontSize + "px");
    r.style.setProperty("--editor-lh", String(cfg.lineHeight));
    if (configLoaded.current) void backend.setConfig(cfg);
  }, [cfg]);

  const openVault = async (path: string) => {
    const metas = await backend.openVault(path);
    setNotes(metas);
    void backend.setLastVault(path);
    setStatus("ready");
    if (metas.length) await openNote(metas[0].id);
    else {
      setActiveId(null);
      setOpenDoc(null);
    }
  };

  // boot: load config, then last vault
  useEffect(() => {
    (async () => {
      try {
        const stored = await backend.getConfig();
        if (stored) setCfg((c) => ({ ...c, ...stored }));
      } catch {
        /* defaults */
      }
      configLoaded.current = true;
      try {
        const last = await backend.getLastVault();
        if (last) await openVault(last);
        else setStatus("no-vault");
      } catch {
        setStatus("no-vault");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // react to external vault changes (other editors, git, sync)
  const onVaultChanged = async () => {
    let list: NoteMeta[];
    try {
      list = await backend.listNotes();
    } catch {
      return;
    }
    setNotes(list);
    if (!activeId || activeId === CONFIG_ID) return;
    if (!list.some((n) => n.id === activeId)) {
      setActiveId(null);
      setOpenDoc(null);
      return;
    }
    if (activeDirty) return; // don't clobber unsaved edits
    try {
      const doc = await backend.readNote(activeId);
      if (doc.body !== savedText) {
        setOpenDoc(doc);
        setSavedText(doc.body);
        setReloadNonce((n) => n + 1);
        flash("reloaded from disk");
      }
    } catch {
      /* ignore */
    }
  };
  const changedRef = useRef(onVaultChanged);
  changedRef.current = onVaultChanged;
  useEffect(() => {
    let un: (() => void) | null = null;
    let cancelled = false;
    void backend
      .watchVault(() => void changedRef.current())
      .then((u) => {
        if (cancelled) u();
        else un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  const pickVault = async () => {
    const path = await backend.pickVault();
    if (path) {
      setStatus("boot");
      try {
        await openVault(path);
      } catch {
        setStatus("no-vault");
      }
    }
  };

  const openNote = async (path: string, line = 0) => {
    const doc = await backend.readNote(path);
    setOpenDoc(doc);
    setSavedText(doc.body);
    setActiveDirty(false);
    setActiveId(path);
    setLastId(path);
    setGotoLine(line);
  };

  const doSaveNote = async (text: string) => {
    if (!activeId || activeId === CONFIG_ID) return;
    try {
      const meta = await backend.saveNote(activeId, text);
      setSavedText(text);
      setActiveDirty(false);
      // update in place (don't reorder — avoids the active note jumping on autosave)
      setNotes((ns) => ns.map((n) => (n.id === meta.id ? meta : n)));
    } catch (e) {
      flash(`save failed: ${e}`);
    }
  };

  const onConfigSave = (text: string) => {
    const next = parseConfig(text, cfg);
    setCfg(next);
    setConfigSaved(text);
    flash("config applied");
  };

  const onEditorChange = (text: string) => {
    if (isConfig) return;
    latest.current = text;
    setActiveDirty(text !== savedText);
    if (autosave.current) clearTimeout(autosave.current);
    autosave.current = setTimeout(() => void doSaveNote(latest.current), AUTOSAVE_MS);
  };
  const onEditorSave = (text: string) => {
    if (autosave.current) clearTimeout(autosave.current);
    if (isConfig) onConfigSave(text);
    else void doSaveNote(text);
  };
  const onEditorQuit = () => {
    if (isConfig) {
      setActiveId(lastId && lastId !== CONFIG_ID ? lastId : null);
    } else {
      setActiveId(null);
      setOpenDoc(null);
    }
  };

  const openFinder = (mode: FinderMode) => setFinder({ mode });
  const closeFinder = () => {
    setFinder(null);
    setRefocus((r) => r + 1);
  };
  const openFromFinder = async (path: string, line: number) => {
    setFinder(null);
    await openNote(path, line && line > 0 ? line : 0);
    setRefocus((r) => r + 1);
  };

  const openConfig = () => {
    const txt = serializeConfig(cfg);
    setConfigText(txt);
    setConfigSaved(txt);
    setConfigKey((k) => k + 1);
    setSettingsOpen(false);
    setActiveId(CONFIG_ID);
  };
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => {
    setSettingsOpen(false);
    setRefocus((r) => r + 1);
  };
  const setCfgPatch = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));
  const toggleNav = () => {
    setNavOpen((v) => !v);
    setRefocus((r) => r + 1);
  };

  const createNote = async () => {
    try {
      const meta = await backend.createNote();
      setNotes(await backend.listNotes());
      await openNote(meta.id);
    } catch (e) {
      flash(`couldn't create note: ${e}`);
    }
  };

  const onCommand = (c: AppCommand) => {
    if (c === "find") openFinder("files");
    else if (c === "grep") openFinder("content");
    else if (c === "nav") toggleNav();
    else if (c === "settings") openSettings();
    else if (c === "config") openConfig();
  };

  const titleText = isConfig ? "~/.notesiderc" : (openDoc?.title ?? null);
  const showEditor = isConfig || (!!activeId && !!openDoc && openDoc.path === activeId);
  const vimSuffix = cfg.vimMode ? "v" : "t";

  return (
    <div className="av-desktop">
      <div className="av-window">
        <div className="av-titlebar" data-tauri-drag-region>
          <TrafficLights onCloseNote={() => activeId && onEditorQuit()} />
          <button
            className="av-iconbtn av-navtoggle"
            onClick={toggleNav}
            title="toggle sidebar (:nav)"
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
            onClick={() => openFinder("files")}
            title="find files (:find)"
            aria-label="find files"
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
                {!isConfig && <span className="av-ext">.md</span>}
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
              activeId={activeId}
              activeDirty={activeDirty}
              onPick={(id) => void openNote(id)}
              onNew={() => void createNote()}
              onSettings={openSettings}
            />
          )}
          <main className="av-main">
            {status === "boot" ? (
              <div className="av-empty">
                <div className="av-empty-glyph">▌</div>
              </div>
            ) : status === "no-vault" ? (
              <VaultPicker onPick={() => void pickVault()} />
            ) : showEditor ? (
              <Editor
                key={
                  (isConfig ? `config-${configKey}` : `${activeId}:${gotoLine}:${reloadNonce}`) +
                  `:${vimSuffix}`
                }
                notePath={isConfig ? CONFIG_ID : (activeId as string)}
                fileLabel={isConfig ? "~/.notesiderc" : (openDoc?.title ?? "")}
                initialText={isConfig ? configText : (openDoc?.body ?? "")}
                savedText={isConfig ? configSaved : savedText}
                vimMode={cfg.vimMode}
                cursorBlink={cfg.cursorBlink}
                relativeNumbers={RELATIVE_NUMBERS}
                gotoLine={isConfig ? 0 : gotoLine}
                refocusToken={refocus}
                onChange={onEditorChange}
                onSave={onEditorSave}
                onQuit={onEditorQuit}
                onCommand={onCommand}
              />
            ) : (
              <EmptyState hasClosed={!!lastId} onReopen={() => lastId && void openNote(lastId)} />
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
          />
        )}
        {finder && (
          <Finder initialMode={finder.mode} onClose={closeFinder} onOpen={openFromFinder} />
        )}
      </div>
    </div>
  );
}
