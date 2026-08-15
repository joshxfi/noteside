// vim/registers.ts — the single unnamed register. Module-level on purpose
// (yank in one note, paste in another — the old vim global behaved the same).
import type { Fragment } from "@tiptap/pm/model";

export type RegisterContent =
  | { type: "nodes"; fragment: Fragment } // linewise block units (dd/yy/visual)
  | { type: "lines"; text: string } // linewise code-block lines
  | { type: "text"; text: string }; // charwise (x)

let register: RegisterContent | null = null;

export const setRegister = (r: RegisterContent): void => {
  register = r;
};
export const getRegister = (): RegisterContent | null => register;
