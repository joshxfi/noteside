// Keyboard shortcuts — the cheatsheet IS the keymap editor. A grouped, keyboard-
// navigable reference of every command's chord that you can also rebind in place:
// focus a row (j/k), press Enter to record a new chord, Del to unbind, r to reset.
// Edits write cfg.chords (via onSetOverrides), which App persists + serializes to
// ~/.notesiderc as `bind` lines — so there is no separate data model here.
//
// Scope: the conventional Mod- chord layer only. Vim nmap/imap mappings live in
// ~/.notesiderc and are out of scope (noted in the footer).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ChordOverrides,
  chordConflict,
  chordLabel,
  type Command,
  effectiveChord,
  eventChord,
} from "../editor/commands";

const GROUP_ORDER: Command["group"][] = ["Find", "Note", "View", "Settings", "Help"];
// Lone modifier keydowns are ignored while recording so the user can hold them.
const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "CapsLock", "OS"]);

interface CheatsheetProps {
  commands: Command[];
  overrides: ChordOverrides;
  onSetOverrides: (next: ChordOverrides) => void;
  onClose: () => void;
}

type Slot = { kind: "bound" | "unbound" | "none"; label: string };
function slotFor(c: Command, overrides: ChordOverrides): Slot {
  const eff = effectiveChord(c, overrides);
  if (eff) return { kind: "bound", label: chordLabel(eff) };
  if (overrides[c.id] === "") return { kind: "unbound", label: "unbound" };
  return { kind: "none", label: "add chord" };
}

export function Cheatsheet({ commands, overrides, onSetOverrides, onClose }: CheatsheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<{
    chord: string;
    otherId: string;
    otherTitle: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Flat, group-ordered command list; the flat index drives j/k focus.
  const { groups, flat } = useMemo(() => {
    let i = 0;
    const gs = GROUP_ORDER.map((g) => ({
      g,
      rows: commands.filter((c) => c.group === g).map((c) => ({ c, i: i++ })),
    })).filter((grp) => grp.rows.length);
    return { groups: gs, flat: gs.flatMap((grp) => grp.rows.map((r) => r.c)) };
  }, [commands]);

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  // Apply one chord into a base overrides object. Reset (null), capturing the
  // command's own table default, or unbinding a command that has no default all
  // collapse to "no override" — so ~/.notesiderc stays free of redundant lines.
  // ("" on a command that HAS a default is a genuine unbind → `bind none <id>`.)
  const applyChord = (id: string, chord: string | null, base: ChordOverrides): ChordOverrides => {
    const def = commands.find((c) => c.id === id)?.chord;
    const next = { ...base };
    if (chord === null || chord === def || (chord === "" && def === undefined)) delete next[id];
    else next[id] = chord;
    return next;
  };
  const setChord = (id: string, chord: string | null) =>
    onSetOverrides(applyChord(id, chord, overrides));

  const commitCapture = (id: string, chord: string) => {
    const other = chordConflict(overrides, chord, id);
    setRecording(false);
    if (other) setConflict({ chord, otherId: other.id, otherTitle: other.title });
    else setChord(id, chord);
  };

  const replaceConflict = () => {
    if (!conflict) return;
    // Atomic: the displaced command becomes unbound, this one takes the chord.
    const next = applyChord(
      flat[focus].id,
      conflict.chord,
      applyChord(conflict.otherId, "", overrides),
    );
    onSetOverrides(next);
    setConflict(null);
  };

  const resetAll = () => {
    onSetOverrides({});
    setConfirmReset(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (conflict) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConflict(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        replaceConflict();
      }
      return;
    }
    if (confirmReset) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmReset(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resetAll();
      }
      return;
    }
    const cur = flat[focus];
    if (recording) {
      e.preventDefault();
      if (e.key === "Escape") {
        setRecording(false);
      } else if (MODIFIERS.has(e.key)) {
        /* wait for a real key */
      } else if (e.key === "Backspace" || e.key === "Delete") {
        setChord(cur.id, "");
        setRecording(false);
      } else {
        commitCapture(cur.id, eventChord(e));
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "j":
      case "ArrowDown":
        e.preventDefault();
        setFocus((f) => Math.min(flat.length - 1, f + 1));
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        setRecording(true);
        break;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        setChord(cur.id, "");
        break;
      case "r":
        e.preventDefault();
        setChord(cur.id, null);
        break;
    }
  };

  return (
    <div className="pal-scrim" onMouseDown={onClose}>
      <div
        className="pal-panel cheat-panel"
        ref={ref}
        tabIndex={0}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-head">Keyboard shortcuts</div>
        <div className="cheat-subhead">
          j/k move · enter rebind · del unbind · r reset · esc close
        </div>
        <div className="cheat-list" role="list">
          {groups.map(({ g, rows }) => (
            <div key={g} className="cheat-group">
              <div className="cheat-grouphead">{g}</div>
              {rows.map(({ c, i }) => {
                const recordingThisRow = recording && i === focus;
                const slot = recordingThisRow ? null : slotFor(c, overrides);
                const overridden = c.id in overrides;
                const rowConflict = conflict && i === focus ? conflict : null;
                const ariaLabel = rowConflict
                  ? `${c.title}: ${chordLabel(rowConflict.chord)} is used by ${rowConflict.otherTitle}. Enter to replace, Esc to cancel.`
                  : recordingThisRow
                    ? `${c.title}, recording — press a key combination`
                    : `${c.title}, ${slot && slot.kind === "bound" ? "bound to " + slot.label : "no chord"}. Enter to rebind.`;
                return (
                  <div
                    key={c.id}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                  >
                    <div
                      role="listitem"
                      aria-label={ariaLabel}
                      className={"cheat-row" + (i === focus ? " is-focus" : "")}
                      onMouseMove={() => i !== focus && !recording && setFocus(i)}
                      onClick={() => {
                        setFocus(i);
                        setRecording(true);
                      }}
                    >
                      <span className="cheat-title">
                        {c.title}
                        {c.ex?.[0] && <span className="cheat-ex">:{c.ex[0]}</span>}
                      </span>
                      {slot === null ? (
                        <kbd className="cheat-key is-recording" aria-live="polite">
                          press keys…
                        </kbd>
                      ) : (
                        <kbd
                          className={
                            "cheat-key" + (slot.kind === "bound" ? "" : " is-" + slot.kind)
                          }
                        >
                          {slot.label}
                        </kbd>
                      )}
                      {i === focus && !recording && overridden && (
                        <button
                          type="button"
                          tabIndex={-1}
                          className="cheat-reset"
                          aria-label="reset to default"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChord(c.id, null);
                          }}
                        >
                          ⟲
                        </button>
                      )}
                    </div>
                    {rowConflict && (
                      <div className="cheat-conflict" role="alert">
                        <span>
                          ⚠ {chordLabel(rowConflict.chord)} is used by{" "}
                          <b>{rowConflict.otherTitle}</b>
                        </span>
                        <button
                          type="button"
                          tabIndex={-1}
                          className="cheat-cbtn"
                          onClick={replaceConflict}
                        >
                          <b>Enter</b> replace
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          className="cheat-cbtn"
                          onClick={() => setConflict(null)}
                        >
                          <b>Esc</b> cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pal-foot cheat-foot">
          {confirmReset ? (
            <span className="cheat-confirm">
              Reset all keys to defaults?{" "}
              <span className="cheat-note">(vim maps in ~/.notesiderc unaffected)</span>{" "}
              <button type="button" tabIndex={-1} className="pal-foot-close" onClick={resetAll}>
                <b>Enter</b> reset
              </button>{" "}
              ·{" "}
              <button
                type="button"
                tabIndex={-1}
                className="pal-foot-close"
                onClick={() => setConfirmReset(false)}
              >
                <b>Esc</b> cancel
              </button>
            </span>
          ) : (
            <>
              <button type="button" tabIndex={-1} className="pal-foot-close" onClick={onClose}>
                <b>Esc</b> close
              </button>
              <button
                type="button"
                className="pal-foot-close cheat-resetall"
                onClick={() => setConfirmReset(true)}
              >
                Reset all keys
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
