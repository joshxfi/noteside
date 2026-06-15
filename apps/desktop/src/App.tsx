// App.tsx — window chrome, sidebar, settings + config orchestration.
import { useEffect, useMemo, useState } from "react";
import { Editor, type EditorNote } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { Finder } from "./components/Finder";
import { NOTES } from "./data";
import {
  accentValue,
  CONFIG_DEFAULTS,
  type Config,
  fontStack,
  parseConfig,
  serializeConfig,
} from "./settings";
import type { Note } from "./types";
import { isTauri, windowControl } from "./useWindowControls";

// These were live "tweaks" in the design tool; in the app they're sensible
// defaults (could later move into Settings).
const TWEAKS = { relNumbers: true, hud: "auto" as const };

type FinderMode = "files" | "content";

function TrafficLights({ onCloseNote }: { onCloseNote: () => void }) {
  const tauri = isTauri();
  const onRed = () => {
    if (tauri) void windowControl("close");
    else onCloseNote();
  };
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
  dirtyOf,
  onPick,
  onSettings,
}: {
  open: boolean;
  notes: Note[];
  activeId: string | null;
  dirtyOf: (id: string) => boolean;
  onPick: (id: string) => void;
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
                  {dirtyOf(n.id) && <span className="av-item-dot" />}
                </span>
                <span className="av-item-meta">
                  {n.tag} · {n.updated}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="av-sidefoot">
          <button className="av-config" onClick={onSettings}>
            <span className="av-cfg-glyph">⚙</span> Settings
          </button>
        </div>
      </div>
    </aside>
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
  const t = TWEAKS;
  const [cfg, setCfg] = useState<Config>(CONFIG_DEFAULTS);
  const [notes, setNotes] = useState<Note[]>(NOTES);
  const [working, setWorking] = useState<Record<string, string>>(() =>
    Object.fromEntries(NOTES.map((n) => [n.id, n.body])),
  );
  const [saved, setSaved] = useState<Record<string, string>>(() =>
    Object.fromEntries(NOTES.map((n) => [n.id, n.body])),
  );
  const [activeId, setActiveId] = useState<string | null>(NOTES[0].id);
  const [lastId, setLastId] = useState<string | null>(NOTES[0].id);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [refocus, setRefocus] = useState(0);
  const [finder, setFinder] = useState<{ mode: FinderMode } | null>(null);
  const [gotoRow, setGotoRow] = useState(0);
  const [configText, setConfigText] = useState("");
  const [configSaved, setConfigSaved] = useState("");
  const [configKey, setConfigKey] = useState(0);

  // apply config -> design tokens
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", cfg.theme);
    r.style.setProperty("--accent-base", accentValue(cfg.accent));
    r.style.setProperty("--editor-font", fontStack(cfg.editorFont, "editor"));
    r.style.setProperty("--mono", fontStack(cfg.uiFont, "ui"));
    r.style.setProperty("--editor-size", cfg.fontSize + "px");
    r.style.setProperty("--editor-lh", String(cfg.lineHeight));
  }, [cfg]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 1600);
  };

  const reseedConfig = (c: Config) => {
    const txt = serializeConfig(c);
    setConfigText(txt);
    setConfigSaved(txt);
    setConfigKey((k) => k + 1);
  };
  const setCfgPatch = (patch: Partial<Config>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (activeId === "config") reseedConfig(next);
  };

  const dirtyOf = (id: string) => (working[id] ?? "") !== (saved[id] ?? "");
  const isConfig = activeId === "config";
  const activeNote = useMemo<EditorNote | null>(() => {
    if (isConfig) return { id: "config", title: "~/.notesiderc", tag: "config", body: configText };
    const n = notes.find((x) => x.id === activeId);
    return n ? { id: n.id, title: n.title, tag: n.tag, body: working[n.id] ?? n.body } : null;
  }, [notes, activeId, working, isConfig, configText]);

  const onText = (id: string, text: string) => {
    if (id === "config") setConfigText(text);
    else setWorking((w) => (w[id] === text ? w : { ...w, [id]: text }));
  };
  const onSaveText = (id: string, text: string) => {
    if (id === "config") {
      const next = parseConfig(text, cfg);
      setCfg(next);
      setConfigSaved(text);
      setConfigText(text);
      flash("config applied");
      return;
    }
    setSaved((s) => ({ ...s, [id]: text }));
    setWorking((w) => ({ ...w, [id]: text }));
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, updated: "just now" } : n)));
    const wc = (text.match(/\S+/g) || []).length;
    flash(`written · ${text.split("\n").length}L, ${wc}W`);
  };
  const onQuit = (id: string) => {
    if (id === "config") {
      setActiveId(lastId || NOTES[0].id);
    } else {
      setLastId(id);
      setActiveId(null);
    }
  };
  const pick = (id: string) => {
    setActiveId(id);
    setLastId(id);
    setGotoRow(0);
  };

  const openFinder = (mode: FinderMode) => setFinder({ mode });
  const closeFinder = () => {
    setFinder(null);
    setRefocus((r) => r + 1);
  };
  const openFromFinder = (id: string, line: number) => {
    setActiveId(id);
    setLastId(id);
    setGotoRow(line && line > 0 ? line - 1 : 0);
    setFinder(null);
    setRefocus((r) => r + 1);
  };

  const openConfig = () => {
    reseedConfig(cfg);
    setSettingsOpen(false);
    setActiveId("config");
  };
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => {
    setSettingsOpen(false);
    setRefocus((r) => r + 1);
  };
  const toggleNav = () => {
    setNavOpen((v) => !v);
    setRefocus((r) => r + 1);
  };

  return (
    <div className="av-desktop">
      <div className="av-window">
        <div className="av-titlebar" data-tauri-drag-region>
          <TrafficLights onCloseNote={() => activeId && onQuit(activeId)} />
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
            {activeNote ? (
              <>
                Noteside — {activeNote.title}
                {!isConfig && <span className="av-ext">.md</span>}
              </>
            ) : (
              "Noteside"
            )}
          </div>
        </div>
        <div className="av-body">
          <Sidebar
            open={navOpen}
            notes={notes}
            activeId={activeId}
            dirtyOf={dirtyOf}
            onPick={pick}
            onSettings={openSettings}
          />
          <main className="av-main">
            {activeNote ? (
              <Editor
                key={isConfig ? "config-" + configKey : activeNote.id + ":" + gotoRow}
                note={activeNote}
                savedText={isConfig ? configSaved : (saved[activeNote.id] ?? activeNote.body)}
                ext={isConfig ? "" : ".md"}
                initialRow={isConfig ? 0 : gotoRow}
                relativeNumbers={t.relNumbers}
                hud={t.hud}
                escMap={cfg.escMap}
                vimMode={cfg.vimMode}
                cursorStyle={cfg.cursor}
                cursorBlink={cfg.cursorBlink}
                refocusToken={refocus}
                onText={onText}
                onSaveText={onSaveText}
                onQuit={onQuit}
                onOpenSettings={openSettings}
                onOpenConfig={openConfig}
                onToggleNav={toggleNav}
                onOpenFinder={openFinder}
              />
            ) : (
              <EmptyState hasClosed={!!lastId} onReopen={() => setActiveId(lastId)} />
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
          <Finder
            notes={notes}
            initialMode={finder.mode}
            onClose={closeFinder}
            onOpen={openFromFinder}
          />
        )}
      </div>
    </div>
  );
}
