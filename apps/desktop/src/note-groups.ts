// Pure sidebar-grouping helpers — no React, no backend (node-testable).
//
// Folders render as FLAT COLLAPSIBLE GROUPS: root notes first (no header),
// then one section per directory in lexicographic order. A nested dir like
// "work/projects" is ONE group labeled with its full relative path, not a
// tree. Empty folders are first-class: they render as a header plus a blank
// drop-target row. The row model is exhaustive on purpose — both sidebar list
// variants render rows as direct children in row order, which is what keeps
// scrollRowIntoView's child-index mapping and the virtualizer's count exact.
import type { NoteMeta } from "./backend/types";

export type SidebarRow =
  | { kind: "note"; note: NoteMeta; dir: string }
  | { kind: "folder"; dir: string; count: number; collapsed: boolean }
  | { kind: "blank"; dir: string }; // an expanded empty group's drop target

/** The directory a note path lives in ("" for a root note). */
export function noteDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Union of the backend's folder list and the dirs derived from note paths
 *  (self-healing if a targeted watcher upsert outran the folder list), sorted.
 *  Ancestor chains are always completed — a nested note path or a locally
 *  patched folder entry like "a/b" also yields "a". */
export function allDirs(notes: NoteMeta[], folders: string[]): string[] {
  const dirs = new Set<string>();
  const addChain = (dir: string) => {
    while (dir && !dirs.has(dir)) {
      dirs.add(dir);
      dir = noteDir(dir);
    }
  };
  for (const f of folders) addChain(f);
  for (const n of notes) addChain(noteDir(n.path));
  return [...dirs].sort();
}

/** Flatten notes + folders into the sidebar's row model. `notes` must already
 *  be in display order (pinned desc, updated desc — the backend sort); the
 *  grouping is a stable partition of it, so pinned-first-then-updated holds
 *  within each group for free. A collapsed group keeps its header row and
 *  hides its members. */
export function buildSidebarRows(
  notes: NoteMeta[],
  folders: string[],
  collapsed: ReadonlySet<string>,
): SidebarRow[] {
  const byDir = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const dir = noteDir(n.path);
    const list = byDir.get(dir);
    if (list) list.push(n);
    else byDir.set(dir, [n]);
  }
  const rows: SidebarRow[] = [];
  for (const n of byDir.get("") ?? []) rows.push({ kind: "note", note: n, dir: "" });
  for (const dir of allDirs(notes, folders)) {
    const members = byDir.get(dir) ?? [];
    const isCollapsed = collapsed.has(dir);
    rows.push({ kind: "folder", dir, count: members.length, collapsed: isCollapsed });
    if (isCollapsed) continue;
    if (members.length === 0) rows.push({ kind: "blank", dir });
    for (const n of members) rows.push({ kind: "note", note: n, dir });
  }
  return rows;
}

/** The ids Mod-j/k step through: visible notes in visual order (headers and
 *  the members of collapsed groups are skipped). */
export function visibleNoteIds(rows: SidebarRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.kind === "note") ids.push(r.note.id);
  return ids;
}

/** The note Mod-j/k (`delta` ±1) lands on from `activeId`: the adjacent VISIBLE
 *  note in visual order, clamped at the ends. When the active note is hidden
 *  inside a collapsed group (its header was collapsed under it), stepping
 *  resumes from that group's position — down lands on the first visible note
 *  after the header, up on the last one before it — instead of teleporting to
 *  the top of the list. Null when there is nothing to move to. */
export function stepVisibleNote(
  rows: SidebarRow[],
  activeId: string | null,
  delta: number,
): string | null {
  const ids: string[] = [];
  let at = -1; // the active note's index in `ids`
  let hiddenAfter = -1; // visible notes preceding the collapsed header hiding it
  const activeDir = activeId ? noteDir(activeId) : null;
  for (const r of rows) {
    if (r.kind === "note") {
      if (r.note.id === activeId) at = ids.length;
      ids.push(r.note.id);
    } else if (r.kind === "folder" && r.collapsed && r.dir === activeDir) {
      hiddenAfter = ids.length;
    }
  }
  if (ids.length === 0) return null;
  let target: number;
  if (at >= 0) target = at + delta;
  else if (hiddenAfter >= 0) target = delta > 0 ? hiddenAfter : hiddenAfter - 1;
  else target = 0; // no note open (config buffer, empty state): start at the top
  const next = ids[Math.max(0, Math.min(ids.length - 1, target))];
  return next === activeId ? null : next;
}

/** Rewrite `path` for a folder rename: "work/a.md" with work→archive becomes
 *  "archive/a.md". Paths outside the renamed dir come back unchanged. */
export function rewritePrefix(path: string, oldDir: string, newDir: string): string {
  if (path === oldDir) return newDir;
  return path.startsWith(oldDir + "/") ? newDir + path.slice(oldDir.length) : path;
}
