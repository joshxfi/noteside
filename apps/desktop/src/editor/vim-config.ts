// CM-free bridge for vim preferences (insert-escape seq, ~/.notesiderc keymaps).
// App sets them here without importing the editor chunk (which is lazy-loaded);
// ex-commands.ts registers the real Vim appliers when that chunk evaluates, and
// any state set before then is applied at registration.
export interface VimApplier {
  escMap(seq: string): void;
  keymaps(lines: string[]): void;
}

let escMap = "";
let keymaps: string[] = [];
let applier: VimApplier | null = null;

export function setInsertEscape(seq: string): void {
  escMap = seq;
  applier?.escMap(seq);
}

export function setUserKeymaps(lines: string[]): void {
  keymaps = lines;
  applier?.keymaps(lines);
}

export function registerVimApplier(a: VimApplier): void {
  applier = a;
  a.escMap(escMap);
  a.keymaps(keymaps);
}
