// Keyboard cheatsheet overlay (Mod-/ or :help). A grouped reference of every
// command and how to reach it — chord if it has one, else its `:ex` command, else
// the `<Space>` leader key. Rendered from the command table, so it can never drift.
import { useEffect, useMemo, useRef } from "react";
import { chordLabel, type Command } from "../editor/commands";

function keysFor(c: Command): string {
  if (c.chord) return chordLabel(c.chord);
  if (c.ex && c.ex.length) return `:${c.ex[0]}`;
  if (c.leader) return `␣ ${c.leader}`;
  return "";
}

const GROUP_ORDER: Command["group"][] = ["Find", "Note", "View", "Settings", "Help"];

export function Cheatsheet({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const groups = useMemo(() => {
    const by = new Map<string, Command[]>();
    for (const c of commands) {
      const arr = by.get(c.group) ?? [];
      arr.push(c);
      by.set(c.group, arr);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => [g, by.get(g) as Command[]] as const);
  }, [commands]);

  return (
    <div className="pal-scrim" onMouseDown={onClose}>
      <div
        className="pal-panel cheat-panel"
        ref={ref}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-head">Keyboard shortcuts</div>
        <div className="cheat-cols">
          {groups.map(([name, cmds]) => (
            <div key={name} className="cheat-group">
              <div className="cheat-grouphead">{name}</div>
              {cmds.map((c) => (
                <div key={c.id} className="cheat-row">
                  <span className="cheat-title">{c.title}</span>
                  <kbd className="cheat-key">{keysFor(c)}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="pal-foot">
          <span>
            <b>⎋</b> close
          </span>
        </div>
      </div>
    </div>
  );
}
