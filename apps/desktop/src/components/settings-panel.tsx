// settings-panel.tsx — in-app Settings panel (writes to the live config).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { byIdHelper as byId, type Config, EDITOR_FONTS, ESC_PRESETS } from "../settings";
import { previewGradient, themeById } from "../themes";
import { DOWNLOAD_PAGE, type UpdateCheck } from "../check-update";
import { openExternal } from "../open-external";
import { useAppVersion } from "../use-app-version";

function Pill({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className={"set-pill" + (active ? " is-on" : "")}
      onClick={onClick}
      style={style}
      tabIndex={-1}
    >
      {children}
    </button>
  );
}

function Row({
  idx,
  focus,
  setFocus,
  label,
  hint,
  children,
}: {
  idx: number;
  focus: number;
  setFocus: (n: number) => void;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={"set-row" + (focus === idx ? " is-focus" : "")}
      onMouseEnter={() => setFocus(idx)}
    >
      <div className="set-rowlabel">
        {label}
        {hint && <span className="set-rowhint">{hint}</span>}
      </div>
      <div className="set-rowctl">{children}</div>
    </div>
  );
}

export interface SettingsPanelProps {
  cfg: Config;
  setCfg: (patch: Partial<Config>) => void;
  /** Latest update-check result, owned by App (the boot check runs there). */
  update: UpdateCheck | null;
  /** Force an on-demand re-check; resolves to the fresh result. */
  onCheckUpdate: () => Promise<UpdateCheck>;
  onClose: () => void;
  onEditFile: () => void;
  onShortcuts: () => void;
  onPickTheme: () => void;
}

export function SettingsPanel({
  cfg,
  setCfg,
  update,
  onCheckUpdate,
  onClose,
  onEditFile,
  onShortcuts,
  onPickTheme,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const [customEsc, setCustomEsc] = useState(
    ESC_PRESETS.some((p) => p.value === cfg.escMap) ? "" : cfg.escMap,
  );
  const version = useAppVersion();
  // Seed from App's boot-check result (an auto-check may already have found an
  // update while Settings was closed); the manual button re-checks through App.
  const [about, setAbout] = useState<{ kind: "idle" | "checking" } | UpdateCheck>(
    update ?? { kind: "idle" },
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // If App's boot/auto check resolves while the panel is already open, reflect it
  // in the About row too (not just the sidebar dot) — unless a manual check is
  // mid-flight, which owns the row until it settles.
  useEffect(() => {
    if (update) setAbout((a) => (a.kind === "checking" ? a : update));
  }, [update]);

  const runCheck = async () => {
    setAbout({ kind: "checking" });
    setAbout(await onCheckUpdate());
  };
  // The About row's keyboard/click action: once an update is found (or the check
  // failed) it opens the landing's OS-aware download section; otherwise it
  // (re-)runs the check.
  const onAboutAction = () => {
    if (about.kind === "available" || about.kind === "error") void openExternal(DOWNLOAD_PAGE);
    else void runCheck();
  };
  const aboutControl = () => {
    switch (about.kind) {
      case "checking":
        return <span className="set-updnote">Checking…</span>;
      case "current":
        return <span className="set-updnote">You're up to date</span>;
      case "available":
        return (
          <button
            type="button"
            tabIndex={-1}
            className="set-editfile set-update"
            onClick={onAboutAction}
          >
            v{about.latest} available — download&nbsp;→
          </button>
        );
      case "error":
        return (
          <button type="button" tabIndex={-1} className="set-editfile" onClick={onAboutAction}>
            Couldn't check — open downloads&nbsp;→
          </button>
        );
      default:
        return (
          <button type="button" tabIndex={-1} className="set-editfile" onClick={onAboutAction}>
            Check for updates&nbsp;→
          </button>
        );
    }
  };

  // each row knows how to cycle its value with the keyboard
  const cycleList = (
    list: ReadonlyArray<{ id?: string; value?: string }>,
    cur: string,
    key: keyof Config,
    dir: number,
  ) => {
    const i = Math.max(
      0,
      list.findIndex((x) => (x.id ?? x.value) === cur),
    );
    const next = list[(i + dir + list.length) % list.length];
    setCfg({ [key]: next.id ?? next.value } as Partial<Config>);
  };

  // Order matches the rendered rows below (idx 0..12) so keyboard nav lines up.
  const rows: { cycle: (d: number) => void }[] = [
    { cycle: () => onPickTheme() }, // idx 0 — Theme: opens the live-preview picker
    { cycle: (d) => cycleList(EDITOR_FONTS, cfg.editorFont, "editorFont", d) },
    { cycle: (d) => setCfg({ fontSize: Math.max(16, Math.min(28, cfg.fontSize + d)) }) },
    {
      cycle: (d) =>
        setCfg({
          uiScale: Math.max(0.9, Math.min(1.3, Math.round((cfg.uiScale + d * 0.05) * 20) / 20)),
        }),
    },
    {
      cycle: (d) =>
        setCfg({
          lineHeight: Math.max(
            1.4,
            Math.min(2.1, Math.round((cfg.lineHeight + d * 0.05) * 100) / 100),
          ),
        }),
    },
    { cycle: () => setCfg({ relativeNumbers: !cfg.relativeNumbers }) },
    {
      cycle: (d) =>
        cycleList([{ id: "block" }, { id: "bar" }, { id: "underline" }], cfg.cursor, "cursor", d),
    },
    { cycle: () => setCfg({ cursorBlink: !cfg.cursorBlink }) },
    { cycle: () => setCfg({ vimMode: !cfg.vimMode }) },
    { cycle: () => setCfg({ escMap: cfg.escMap ? "" : customEsc || "jj" }) },
    { cycle: () => onShortcuts() }, // idx 10 — opens the keymap editor (cheatsheet)
    { cycle: () => setCfg({ autoUpdateCheck: !cfg.autoUpdateCheck }) }, // idx 11 — Automatic updates
    { cycle: onAboutAction }, // idx 12 — About: check for updates / open releases
  ];

  const currentTheme = themeById(cfg.theme);
  const themeChip = previewGradient(currentTheme);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") {
        e.preventDefault();
        panelRef.current?.focus();
      }
      return;
    }
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Buttons/selects keep their native Enter/Space behavior. Only the panel
    // itself owns j/k/h/l/arrows and row activation.
    if (e.target !== e.currentTarget) return;
    if (k === "j" || k === "ArrowDown") {
      e.preventDefault();
      setFocus((f) => (f + 1) % rows.length);
    } else if (k === "k" || k === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => (f - 1 + rows.length) % rows.length);
    } else if (k === "l" || k === "ArrowRight" || k === "Enter" || k === " ") {
      e.preventDefault();
      rows[focus].cycle(1);
    } else if (k === "h" || k === "ArrowLeft") {
      e.preventDefault();
      rows[focus].cycle(-1);
    }
  };

  return (
    <div className="set-scrim" onMouseDown={onClose}>
      <div
        className="set-panel"
        ref={panelRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="set-head">
          <div>
            <h2>Settings</h2>
            <p>j/k to move · ←/→ to change · esc to close — applied live and saved</p>
          </div>
          <button className="set-x" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>

        <div className="set-scroll">
          <div className="set-sec">Appearance</div>
          <Row
            idx={0}
            focus={focus}
            setFocus={setFocus}
            label="Theme"
            hint="preview & pick a palette"
          >
            <button
              type="button"
              tabIndex={-1}
              className="set-editfile"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
              onClick={onPickTheme}
            >
              <span className="thm-chip" aria-hidden="true" style={{ background: themeChip }} />
              {currentTheme.label}&nbsp;→
            </button>
          </Row>

          <div className="set-sec">Typography</div>
          <Row idx={1} focus={focus} setFocus={setFocus} label="Editor font">
            <span className="set-selectwrap">
              <select
                className="set-select"
                tabIndex={-1}
                value={cfg.editorFont}
                style={{ fontFamily: byId(EDITOR_FONTS, cfg.editorFont).stack }}
                onChange={(e) => setCfg({ editorFont: e.target.value })}
              >
                {EDITOR_FONTS.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                    {f.label}
                  </option>
                ))}
              </select>
              <span className="set-selectarrow">▾</span>
            </span>
          </Row>
          <Row idx={2} focus={focus} setFocus={setFocus} label="Font size">
            <div className="set-stepper">
              <button
                tabIndex={-1}
                onClick={() => setCfg({ fontSize: Math.max(16, cfg.fontSize - 1) })}
              >
                −
              </button>
              <span>{cfg.fontSize}px</span>
              <button
                tabIndex={-1}
                onClick={() => setCfg({ fontSize: Math.min(28, cfg.fontSize + 1) })}
              >
                +
              </button>
            </div>
          </Row>
          <Row
            idx={3}
            focus={focus}
            setFocus={setFocus}
            label="Interface size"
            hint="scales the app, not the editor"
          >
            <div className="set-stepper">
              <button
                tabIndex={-1}
                onClick={() =>
                  setCfg({
                    uiScale: Math.max(
                      0.9,
                      Math.min(1.3, Math.round((cfg.uiScale - 0.05) * 20) / 20),
                    ),
                  })
                }
              >
                −
              </button>
              <span>{Math.round(cfg.uiScale * 100)}%</span>
              <button
                tabIndex={-1}
                onClick={() =>
                  setCfg({
                    uiScale: Math.max(
                      0.9,
                      Math.min(1.3, Math.round((cfg.uiScale + 0.05) * 20) / 20),
                    ),
                  })
                }
              >
                +
              </button>
            </div>
          </Row>
          <Row idx={4} focus={focus} setFocus={setFocus} label="Line height">
            <div className="set-stepper">
              <button
                tabIndex={-1}
                onClick={() =>
                  setCfg({
                    lineHeight: Math.max(1.4, Math.round((cfg.lineHeight - 0.05) * 100) / 100),
                  })
                }
              >
                −
              </button>
              <span>{cfg.lineHeight.toFixed(2)}</span>
              <button
                tabIndex={-1}
                onClick={() =>
                  setCfg({
                    lineHeight: Math.min(2.1, Math.round((cfg.lineHeight + 0.05) * 100) / 100),
                  })
                }
              >
                +
              </button>
            </div>
          </Row>
          <Row idx={5} focus={focus} setFocus={setFocus} label="Relative line numbers">
            <button
              type="button"
              tabIndex={-1}
              className={"set-switch" + (cfg.relativeNumbers ? " is-on" : "")}
              onClick={() => setCfg({ relativeNumbers: !cfg.relativeNumbers })}
            >
              <span className="set-knob" />
            </button>
          </Row>

          <div className="set-sec">Cursor</div>
          <Row idx={6} focus={focus} setFocus={setFocus} label="Style">
            {(
              [
                ["block", "Block"],
                ["bar", "Bar"],
                ["underline", "Underline"],
              ] as const
            ).map(([v, l]) => (
              <Pill key={v} active={cfg.cursor === v} onClick={() => setCfg({ cursor: v })}>
                {l}
              </Pill>
            ))}
          </Row>
          <Row idx={7} focus={focus} setFocus={setFocus} label="Blink">
            <button
              type="button"
              tabIndex={-1}
              className={"set-switch" + (cfg.cursorBlink ? " is-on" : "")}
              onClick={() => setCfg({ cursorBlink: !cfg.cursorBlink })}
            >
              <span className="set-knob" />
            </button>
          </Row>

          <div className="set-sec">Keys</div>
          <Row
            idx={8}
            focus={focus}
            setFocus={setFocus}
            label="Vim mode"
            hint="off = type like a normal editor"
          >
            <button
              type="button"
              tabIndex={-1}
              className={"set-switch" + (cfg.vimMode ? " is-on" : "")}
              onClick={() => setCfg({ vimMode: !cfg.vimMode })}
            >
              <span className="set-knob" />
            </button>
          </Row>
          <Row
            idx={9}
            focus={focus}
            setFocus={setFocus}
            label="Leave insert with"
            hint={"like  inoremap jj <Esc>"}
          >
            <div className="set-escwrap">
              <Pill
                active={!cfg.escMap}
                onClick={() => {
                  setCustomEsc("");
                  setCfg({ escMap: "" });
                }}
              >
                Esc
              </Pill>
              <input
                className={"set-custom" + (cfg.escMap ? " is-on" : "")}
                value={customEsc}
                placeholder="custom…"
                maxLength={3}
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value.replace(/\s/g, "");
                  setCustomEsc(v);
                  setCfg({ escMap: v });
                }}
              />
            </div>
          </Row>
          <p className="set-note">
            Type the sequence in insert mode to drop back to normal — the keys are removed as you
            go, just like a real <code>jj</code> mapping.
          </p>
          <Row
            idx={10}
            focus={focus}
            setFocus={setFocus}
            label="Keyboard shortcuts"
            hint="rebind any chord"
          >
            <button type="button" tabIndex={-1} className="set-editfile" onClick={onShortcuts}>
              Edit keys&nbsp;→
            </button>
          </Row>

          <div className="set-sec">About</div>
          <Row
            idx={11}
            focus={focus}
            setFocus={setFocus}
            label="Automatic updates"
            hint="check on launch"
          >
            <button
              type="button"
              tabIndex={-1}
              className={"set-switch" + (cfg.autoUpdateCheck ? " is-on" : "")}
              onClick={() => setCfg({ autoUpdateCheck: !cfg.autoUpdateCheck })}
            >
              <span className="set-knob" />
            </button>
          </Row>
          <Row idx={12} focus={focus} setFocus={setFocus} label="Noteside" hint={`v${version}`}>
            {aboutControl()}
          </Row>
        </div>

        <footer className="set-foot">
          <button className="set-editfile" onClick={onEditFile}>
            Edit&nbsp;<code>~/.notesiderc</code>&nbsp;→
          </button>
          <button className="set-done" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
