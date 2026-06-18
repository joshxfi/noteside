// SettingsPanel.tsx — in-app Settings panel (writes to the live config).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ACCENTS,
  byIdHelper as byId,
  type Config,
  EDITOR_FONTS,
  ESC_PRESETS,
  UI_FONTS,
} from "../settings";

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
  onClose: () => void;
  onEditFile: () => void;
  onShortcuts: () => void;
}

export function SettingsPanel({
  cfg,
  setCfg,
  onClose,
  onEditFile,
  onShortcuts,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const [customEsc, setCustomEsc] = useState(
    ESC_PRESETS.some((p) => p.value === cfg.escMap) ? "" : cfg.escMap,
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

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
    { cycle: () => setCfg({ theme: cfg.theme === "light" ? "dark" : "light" }) },
    { cycle: (d) => cycleList(ACCENTS, cfg.accent, "accent", d) },
    { cycle: (d) => cycleList(EDITOR_FONTS, cfg.editorFont, "editorFont", d) },
    { cycle: (d) => cycleList(UI_FONTS, cfg.uiFont, "uiFont", d) },
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
    { cycle: () => onShortcuts() }, // idx 12 — opens the keymap editor (cheatsheet)
  ];

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") panelRef.current?.focus();
      return;
    }
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
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
          <Row idx={0} focus={focus} setFocus={setFocus} label="Theme">
            {(
              [
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([v, l]) => (
              <Pill key={v} active={cfg.theme === v} onClick={() => setCfg({ theme: v })}>
                {l}
              </Pill>
            ))}
          </Row>
          <Row idx={1} focus={focus} setFocus={setFocus} label="Accent">
            <div className="set-swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  tabIndex={-1}
                  className={"set-swatch" + (cfg.accent === a.id ? " is-on" : "")}
                  style={{ background: a.value }}
                  title={a.label}
                  onClick={() => setCfg({ accent: a.id })}
                />
              ))}
            </div>
          </Row>

          <div className="set-sec">Typography</div>
          <Row idx={2} focus={focus} setFocus={setFocus} label="Editor font">
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
          <Row idx={3} focus={focus} setFocus={setFocus} label="Interface font">
            <span className="set-selectwrap">
              <select
                className="set-select"
                tabIndex={-1}
                value={cfg.uiFont}
                style={{ fontFamily: byId(UI_FONTS, cfg.uiFont).stack }}
                onChange={(e) => setCfg({ uiFont: e.target.value })}
              >
                {UI_FONTS.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                    {f.label}
                  </option>
                ))}
              </select>
              <span className="set-selectarrow">▾</span>
            </span>
          </Row>
          <Row idx={4} focus={focus} setFocus={setFocus} label="Font size">
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
            idx={5}
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
          <Row idx={6} focus={focus} setFocus={setFocus} label="Line height">
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
          <Row idx={7} focus={focus} setFocus={setFocus} label="Relative line numbers">
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
          <Row idx={8} focus={focus} setFocus={setFocus} label="Style">
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
          <Row idx={9} focus={focus} setFocus={setFocus} label="Blink">
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
            idx={10}
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
            idx={11}
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
            idx={12}
            focus={focus}
            setFocus={setFocus}
            label="Keyboard shortcuts"
            hint="rebind any chord"
          >
            <button type="button" tabIndex={-1} className="set-editfile" onClick={onShortcuts}>
              Edit keys&nbsp;→
            </button>
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
