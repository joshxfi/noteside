// chords.ts — the always-on app chord layer (Mod- combos + F-keys), derived
// from the command table. Replaces the CM6 keymap Compartment: rebinds apply
// live because the handler reads the overrides through `getOverrides()` on
// every match attempt (the map itself is identity-memoized in commands.ts), so
// a cfg.chords change needs no plugin reconfigure and no remount — and no
// focus theft from the open cheatsheet.
//
// Priority 2000: chords outrank the vim layer (1500) and every content keymap.
// Bare printable keys bail before any map lookup, so typing never pays for this.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { type ChordOverrides, type Command, editorChordMap, eventChord } from "./commands";

export interface ChordsOptions {
  getOverrides: () => ChordOverrides | undefined;
  dispatch: (cmd: Command) => void;
}

const FKEY = /^F\d{1,2}$/;

export const Chords = Extension.create<ChordsOptions>({
  name: "nsChords",
  priority: 2000,

  addOptions() {
    return { getOverrides: () => undefined, dispatch: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("nsChords"),
        props: {
          handleKeyDown(_view, e) {
            // isSafeChord guarantees every mapped chord carries Mod/Alt or an
            // F-key, so anything else can't match — cheapest bail first.
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !FKEY.test(e.key)) return false;
            const cmd = editorChordMap(options.getOverrides()).get(eventChord(e));
            if (!cmd) return false;
            e.preventDefault();
            options.dispatch(cmd);
            return true;
          },
        },
      }),
    ];
  },
});
