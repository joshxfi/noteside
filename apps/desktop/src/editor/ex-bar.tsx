// ex-bar.tsx — the vim `:` command line, bottom-docked above the status bar.
// Every command-table ex name keeps working (`:w`, `:q`, `:wq`, `:dup`,
// `:pin`, `:theme`, …) — the bar exact-matches against COMMANDS and dispatches
// through the same handler the chords use. Extras handled locally: `:N` jumps
// to block N and `:noh` clears search highlights.
import { useEffect, useRef, useState } from "react";
import { type Command, COMMANDS } from "./commands";

/** ex name → command, built once from the table. */
const EX_MAP: Map<string, Command> = new Map(
  COMMANDS.flatMap((c) => (c.ex ?? []).map((name) => [name, c] as const)),
);

export function ExBar(props: {
  onRun: (cmd: Command) => void;
  onGotoBlock: (n: number) => void;
  onClearHighlights: () => void;
  onNotify: (msg: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = () => {
    const name = value.trim();
    props.onClose();
    if (!name) return;
    if (/^\d+$/.test(name)) {
      props.onGotoBlock(Number(name));
      return;
    }
    if (name === "noh" || name === "nohlsearch") {
      props.onClearHighlights();
      return;
    }
    const cmd = EX_MAP.get(name);
    if (cmd) props.onRun(cmd);
    else props.onNotify(`not an editor command: ${name}`);
  };

  return (
    <div className="av-exbar">
      <span className="av-exbar-prompt">:</span>
      <input
        ref={inputRef}
        className="av-exbar-input"
        type="text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            run();
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          } else if (e.key === "Backspace" && value === "") {
            e.preventDefault();
            props.onClose();
          }
        }}
        onBlur={() => props.onClose()}
      />
    </div>
  );
}
