// Shared domain types for the seed/mock notebook (see data.ts). The live backend
// uses the richer shapes in backend/types.ts.

export type GitStatus = "modified" | "untracked" | "staged" | "deleted" | "renamed" | null;

export interface Note {
  id: string;
  title: string;
  path: string;
  tag: string;
  updated: string;
  git: GitStatus;
  frecency: number;
  body: string;
}
