// app.tsx — window chrome, notebook sidebar, editor + finder + settings orchestration.
import {
  Component,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  SlidersHorizontal,
  SquareChevronRight,
} from "lucide-react";
import { backend, type NoteMeta } from "./backend";
import type { AppCommand } from "./editor/commands";
import { Finder } from "./components/finder";
import { SettingsPanel } from "./components/settings-panel";
import { CommandPalette } from "./components/command-palette";
import { CommandSearch } from "./components/command-search";
import { Cheatsheet } from "./components/cheatsheet";
import { ConfirmDialog } from "./components/confirm-dialog";
import { ContextMenu } from "./components/context-menu";
import { PromptDialog } from "./components/prompt-dialog";
import { NotebookSwitcher } from "./components/notebook-switcher";
import { Onboarding } from "./components/onboarding";
import { scrollRowIntoView } from "./components/list-nav";
import {
  cheatsheetCommands,
  chordLabel,
  type Command,
  leaderCommands,
  paletteCommands,
  withChordOverrides,
} from "./editor/commands";
import {
  clampSidebarWidth,
  CONFIG_DEFAULTS,
  type Config,
  fontStack,
  isFirstLaunch,
  parseConfig,
  serializeConfig,
  unrecognizedDirectives,
} from "./settings";
import { applyThemeVars, resolveThemeId, resolveThemeVars, themeById } from "./themes";
import { ThemePicker } from "./components/theme-picker";
import { openExternal } from "./open-external";
import type { NotifyKind } from "./editing-session";
import { useEditingSession } from "./use-editing-session";
import { useGlobalChords } from "./use-global-chords";
import { isTauri } from "./use-window-controls";
import { useAppVersion } from "./use-app-version";
import { checkForUpdate, dueForCheck, isNewer, type UpdateCheck } from "./check-update";
import { disposeNativeMenus, showFolderContextMenu, showNoteContextMenu } from "./native-menu";
import { sanitizeChordOverrides } from "./shortcut";
import {
  allDirs,
  buildSidebarRows,
  noteDir,
  rewritePrefix,
  type SidebarRow,
  stepVisibleNote,
} from "./note-groups";
import { MovePicker } from "./components/move-picker";

// The editor chunk (Tiptap + ProseMirror) is the parse-heavy part of the bundle.
// Loading it lazily keeps it off the first-paint path; kicking the import at
// module scope starts the (local, fast) fetch immediately, so it's ready by the
// time a note opens.
const editorChunk = import("./editor/editor");
editorChunk.catch(() => {}); // rejection surfaces via EditorBoundary at render, not as an unhandled event
const Editor = lazy(() => editorChunk.then((m) => ({ default: m.Editor })));

// Suspense catches loading, not failure — without this, a chunk-load error
// (corrupt/partial install) would unmount the whole app to a blank window.
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="av-empty">
        <div className="av-empty-title">The editor failed to load</div>
        <div className="av-empty-sub">
          This usually means a damaged install.{" "}
          <button className="av-link" onClick={() => location.reload()}>
            Reload
          </button>{" "}
          or reinstall Noteside.
        </div>
      </div>
    );
  }
}

const AUTOSAVE_MS = 800;

// The theme mirror the index.html boot script paints from before the config
// store loads (kills the light-flash for dark/base16 users). Written by the
// config-apply effect; read here to seed the initial cfg so the first React
// render agrees with the boot script instead of undoing it.
const BOOT_THEME_KEY = "noteside:boot-theme";

function bootConfig(): Config {
  try {
    const raw = localStorage.getItem(BOOT_THEME_KEY);
    const t = raw ? (JSON.parse(raw) as { id?: unknown }) : null;
    const id = typeof t?.id === "string" ? resolveThemeId(t.id) : null;
    if (id) return { ...CONFIG_DEFAULTS, theme: id };
  } catch {
    /* corrupt mirror — defaults */
  }
  return CONFIG_DEFAULTS;
}

// The automatic update check throttles to once/24h by remembering the last check
// in localStorage (client-only machine state — the boot-theme mirror precedent,
// not the config file). `latest` is the last-fetched release tag (or the running
// version when up-to-date), re-evaluated against the current version on restore
// so the badge clears itself after the user updates.
const UPDATE_CACHE_KEY = "noteside:update";
interface UpdateCache {
  ts: number;
  latest: string;
}
function readUpdateCache(): UpdateCache | null {
  try {
    const raw = localStorage.getItem(UPDATE_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof c.ts === "number" && typeof c.latest === "string")
      return { ts: c.ts, latest: c.latest };
  } catch {
    /* corrupt / unavailable — treat as never-checked */
  }
  return null;
}
function writeUpdateCache(c: UpdateCache): void {
  try {
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota — the check just re-runs next launch */
  }
}

type Status = "boot" | "no-notebook" | "ready";
type FinderMode = "all" | "files" | "content";

function relTime(ms: number, now: number): string {
  const diff = now - ms;
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// Landing-demo-only chrome (the native app shows the OS traffic lights instead
// and never renders this — see the !isTauri() gate at the render site). Red
// stands in for "close" by closing the note buffer; amber/green are inert.
function TrafficLights({ onCloseNote }: { onCloseNote: () => void }) {
  return (
    <div className="av-lights">
      <button className="av-dot red" onClick={onCloseNote} aria-label="close" />
      <span className="av-dot amber" />
      <span className="av-dot green" />
    </div>
  );
}

// Past this many notes the list is virtualized (only visible rows mount); below
// it the plain flex list renders verbatim, so typical notebooks are untouched.
const VIRTUAL_THRESHOLD = 100;

// Memoized so an autosave landing (which replaces one meta in the list) or a
// toast re-renders 1 row, not all of them. `top` is a primitive (the virtual
// offset) so the memo compare stays shallow; `now` ticks once a minute to keep
// the relative timestamps honest.
const NoteRow = memo(function NoteRow({
  note,
  active,
  onPick,
  onContext,
  onTogglePin,
  onRename,
  now,
  top,
  index,
  measureRef,
}: {
  note: NoteMeta;
  active: boolean;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, pinned: boolean, x: number, y: number) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  now: number;
  top?: number;
  index?: number;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  // A <div>, not a <button>: the hover-revealed action buttons live inside the
  // row, and interactive content is invalid inside a <button>. The reveal is
  // CSS-only (.av-item:hover) so pointer motion never re-renders the memo'd row.
  // tabIndex=0 + the Enter/Space handler reimplement what the old <button> gave
  // for free — rows stay tab- and screen-reader-reachable (inner action buttons
  // are tabIndex=-1 so each note stays ONE tab stop).
  return (
    <div
      ref={measureRef}
      data-index={index}
      data-id={note.id}
      data-dir={noteDir(note.path)}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={
        "av-item" + (active ? " is-active" : "") + (noteDir(note.path) ? " is-nested" : "")
      }
      aria-current={active ? "page" : undefined}
      onClick={() => onPick(note.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(note.id);
        }
      }}
      onDoubleClick={(e) => {
        // a double-click on the hover actions must not read as rename-the-row
        if ((e.target as Element).closest(".av-item-actions")) return;
        onRename(note.id, note.title);
      }}
      onContextMenu={(e) => {
        e.preventDefault(); // suppress the WebView's menu; ours pops instead
        onContext(note.id, note.title, note.pinned, e.clientX, e.clientY);
      }}
      style={
        top === undefined
          ? undefined
          : {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
    >
      <span className="av-item-bar" />
      <span className="av-item-main">
        <span className="av-item-title">
          <span className="av-item-titletext">{note.title}</span>
          {note.pinned && <Pin className="av-item-pin" size={11} aria-label="pinned" />}
        </span>
        <span className="av-item-meta">
          {note.tags[0] ? `${note.tags[0]} · ` : ""}
          {relTime(note.updated, now)}
        </span>
      </span>
      <span className="av-item-actions">
        <button
          type="button"
          tabIndex={-1}
          className="av-item-act"
          title={note.pinned ? "unpin" : "pin"}
          aria-label={note.pinned ? "unpin note" : "pin note"}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(note.id, note.pinned);
          }}
        >
          {note.pinned ? (
            <PinOff size={13} aria-hidden="true" />
          ) : (
            <Pin size={13} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="av-item-act"
          title="note actions"
          aria-label="note actions"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onContext(note.id, note.title, note.pinned, r.left, r.bottom + 4);
          }}
        >
          <Ellipsis size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
});

// A folder group header: chevron · folder icon (open/closed) · name · count.
// The chevron rotation and the hover-revealed kebab are CSS-driven (no per-row
// state — the pointer-affordance perf rule); the whole row toggles collapse,
// Enter/Space mirror the click, right-click (or the kebab) opens the folder
// menu. `here` marks the OPEN note's folder (the name takes the accent — a
// "where am I" cue that survives scrolling the note itself out of view).
// `data-dir` doubles as the drop target for the note drag-and-drop below.
const FolderRow = memo(function FolderRow({
  dir,
  count,
  collapsed,
  here,
  onToggle,
  onContext,
  top,
  index,
  measureRef,
}: {
  dir: string;
  count: number;
  collapsed: boolean;
  here: boolean;
  onToggle: (dir: string) => void;
  onContext: (dir: string, x: number, y: number) => void;
  top?: number;
  index?: number;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={measureRef}
      data-index={index}
      data-dir={dir}
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      className={"av-grouphead" + (collapsed ? "" : " is-open") + (here ? " is-here" : "")}
      onClick={() => onToggle(dir)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(dir);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(dir, e.clientX, e.clientY);
      }}
      style={
        top === undefined
          ? undefined
          : {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
    >
      <ChevronRight className="av-chev" size={12} aria-hidden="true" />
      {collapsed ? (
        <Folder className="av-group-icon" size={14} aria-hidden="true" />
      ) : (
        <FolderOpen className="av-group-icon" size={14} aria-hidden="true" />
      )}
      <span className="av-group-name">{dir}</span>
      <span className="av-group-count">{count}</span>
      <span className="av-item-actions">
        <button
          type="button"
          tabIndex={-1}
          className="av-item-act"
          title="folder actions"
          aria-label="folder actions"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onContext(dir, r.left, r.bottom + 4);
          }}
        >
          <Ellipsis size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
});

// The hairline between the last folder group and the loose root notes. A row
// (not a CSS margin) so the row model stays exhaustive; data-dir="" makes it a
// root drop target like the empty space around it.
function DividerRow({
  top,
  index,
  measureRef,
}: {
  top?: number;
  index?: number;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={measureRef}
      data-index={index}
      data-dir=""
      role="separator"
      className="av-divider"
      style={
        top === undefined
          ? undefined
          : {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
    />
  );
}

// An expanded EMPTY group's body — one muted row that keeps the group visibly
// a place (and, via data-dir, a drop target for the drag below).
function BlankRow({
  dir,
  top,
  index,
  measureRef,
}: {
  dir: string;
  top?: number;
  index?: number;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={measureRef}
      data-index={index}
      data-dir={dir}
      className="av-group-blank"
      style={
        top === undefined
          ? undefined
          : {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${top}px)`,
            }
      }
    >
      no notes — drop one here
    </div>
  );
}

// One bundle for everything a sidebar row needs; the callbacks are stable in
// App (useCallback + latest-refs), so only `now`'s minute tick and `activeId`
// changes re-render the memoized rows.
interface RowHandlers {
  activeId: string | null;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, pinned: boolean, x: number, y: number) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onToggleFolder: (dir: string) => void;
  onFolderContext: (dir: string, x: number, y: number) => void;
  now: number;
}

// Row keys must be unique across kinds (a folder named "x.md" can't collide
// with a note, but a stable prefix keeps the invariant obvious).
function rowKey(r: SidebarRow): string {
  if (r.kind === "divider") return "divider";
  return r.kind === "note" ? r.note.id : (r.kind === "folder" ? "d:" : "b:") + r.dir;
}

function renderRow(
  r: SidebarRow,
  h: RowHandlers,
  v?: { index: number; top: number; measureRef: (el: HTMLElement | null) => void },
) {
  if (r.kind === "folder") {
    return (
      <FolderRow
        key={rowKey(r)}
        dir={r.dir}
        count={r.count}
        collapsed={r.collapsed}
        here={!!h.activeId && noteDir(h.activeId) === r.dir}
        onToggle={h.onToggleFolder}
        onContext={h.onFolderContext}
        top={v?.top}
        index={v?.index}
        measureRef={v?.measureRef}
      />
    );
  }
  if (r.kind === "divider") {
    return <DividerRow key="divider" top={v?.top} index={v?.index} measureRef={v?.measureRef} />;
  }
  if (r.kind === "blank") {
    return (
      <BlankRow
        key={rowKey(r)}
        dir={r.dir}
        top={v?.top}
        index={v?.index}
        measureRef={v?.measureRef}
      />
    );
  }
  return (
    <NoteRow
      key={r.note.id}
      note={r.note}
      active={r.note.id === h.activeId}
      onPick={h.onPick}
      onContext={h.onContext}
      onTogglePin={h.onTogglePin}
      onRename={h.onRename}
      now={h.now}
      top={v?.top}
      index={v?.index}
      measureRef={v?.measureRef}
    />
  );
}

// Delegated HTML5 drag-and-drop over the note list. Every row carries data-dir
// (note rows also data-id), so ONE handler set on the nav resolves any drop
// target. Two gestures: dropping on a FOLDER (its header, its blank row, or
// the root zone / empty space for the notebook root) MOVES the note there;
// dropping on another NOTE GROUPS the two — a new folder beside the target
// note, both notes moved in. Neither runs on the drop itself: the hook only
// reports what was asked (`NoteDrop`) and App confirms — a modal with Enter as
// the go-ahead for a move, a name prompt for a group — because a slip while
// clicking a row must never silently relocate a file. Zero React state and
// zero extra DOM — the affordances are classes toggled imperatively (the root
// zone is a CSS pseudo-element), which protects both the row memoization and
// scrollRowIntoView's child-index mapping.
const DRAG_TYPE = "application/x-noteside-note";

/** What a completed sidebar drag asks for (App confirms before acting). */
export type NoteDrop =
  | { kind: "move"; id: string; dir: string }
  | { kind: "group"; id: string; targetId: string };

type ListDnd = Pick<
  React.DOMAttributes<HTMLElement>,
  "onDragStart" | "onDragOver" | "onDrop" | "onDragLeave" | "onDragEnd"
>;

/** The dragged note while a drag from OUR list is in flight. */
interface DragSource {
  id: string;
  dir: string;
}

/** A resolved drop target, or null for "nothing to do" (no-drop cursor). */
type DropHit =
  | { kind: "move"; dir: string; el: Element | null }
  | { kind: "group"; targetId: string; el: Element };

function resolveDrop(nav: Element, target: Element, from: DragSource): DropHit | null {
  // A note row groups; the row's own kebab/pin buttons resolve to their row.
  const row = target.closest?.(".av-item");
  if (row) {
    const targetId = row.getAttribute("data-id") ?? "";
    return targetId && targetId !== from.id ? { kind: "group", targetId, el: row } : null;
  }
  // A folder header / blank row moves into that folder; anything else = root.
  const dir = target.closest?.("[data-dir]")?.getAttribute("data-dir") ?? "";
  if (dir === from.dir) return null; // its own folder (or the root, for a root note)
  // Ring the group's header (querySelector finds it before the blank row in
  // DOM order); a root target rings the root zone instead (nav class).
  const el = dir ? nav.querySelector(`.av-grouphead[data-dir="${CSS.escape(dir)}"]`) : null;
  return { kind: "move", dir, el };
}

function useListDnd(onDrop: (drop: NoteDrop) => void): ListDnd {
  const marked = useRef<Element | null>(null);
  const from = useRef<DragSource | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);
  return useMemo<ListDnd>(() => {
    const clear = (nav: Element | null) => {
      marked.current?.classList.remove("is-drop");
      marked.current = null;
      from.current = null;
      nav?.classList.remove("is-dragging", "is-drag-nested", "is-drop-root");
    };
    return {
      // dragstart bubbles from the row (which already set the payload).
      onDragStart(e) {
        const row = (e.target as Element).closest?.(".av-item");
        if (!row) return;
        const dir = row.getAttribute("data-dir") ?? "";
        from.current = { id: row.getAttribute("data-id") ?? "", dir };
        e.currentTarget.classList.add("is-dragging");
        // A note leaving a folder needs somewhere to land at the root even when
        // no root note is on screen — reveal the root drop zone (::after).
        if (dir) e.currentTarget.classList.add("is-drag-nested");
      },
      onDragOver(e) {
        if (!e.dataTransfer.types.includes(DRAG_TYPE) || !from.current) return;
        e.preventDefault();
        const nav = e.currentTarget;
        nav.classList.add("is-dragging");
        const hit = resolveDrop(nav, e.target as Element, from.current);
        // "none" shows the no-drop cursor and suppresses the drop event.
        e.dataTransfer.dropEffect = hit ? "move" : "none";
        const el = hit?.el ?? null;
        if (el !== marked.current) {
          marked.current?.classList.remove("is-drop");
          el?.classList.add("is-drop");
          marked.current = el;
        }
        nav.classList.toggle("is-drop-root", hit?.kind === "move" && hit.dir === "");
      },
      onDrop(e) {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        const nav = e.currentTarget;
        // Resolve against the payload, not the dragstart ref — the ref is what
        // dragover used, but the payload is authoritative for the id.
        const hit = resolveDrop(nav, e.target as Element, { id, dir: noteDir(id) });
        clear(nav);
        if (!hit) return; // dropped back where it came from / onto itself
        onDropRef.current(
          hit.kind === "group"
            ? { kind: "group", id, targetId: hit.targetId }
            : { kind: "move", id, dir: hit.dir },
        );
      },
      onDragLeave(e) {
        // Only when actually leaving the nav, not when moving between children.
        // WebKit reports relatedTarget as null on drag events, so fall back to
        // the pointer position against the nav's box (a row-to-row transition
        // would otherwise blink the affordances off and on every frame).
        const nav = e.currentTarget;
        const related = e.relatedTarget as Node | null;
        if (related) {
          if (nav.contains(related)) return;
        } else {
          const r = nav.getBoundingClientRect();
          const inside =
            e.clientX >= r.left &&
            e.clientX < r.right &&
            e.clientY >= r.top &&
            e.clientY < r.bottom;
          if (inside) return;
        }
        clear(nav);
      },
      // dragend bubbles from the dragged row — covers an Esc-cancelled drag.
      onDragEnd(e) {
        clear(e.currentTarget);
      },
    };
  }, []);
}

// The plain list for typical notebooks. Keeps the active row on screen: Mod-j /
// Mod-k step through notes without touching the scroll position, so without this
// the selection walks off the fold (the virtual list below already handles it).
// Rows render as DIRECT children of the nav in row-model order — the invariant
// scrollRowIntoView's container.children[index] mapping depends on.
function PlainNoteList({
  rows,
  handlers,
  dnd,
}: {
  rows: SidebarRow[];
  handlers: RowHandlers;
  dnd: ListDnd;
}) {
  const listRef = useRef<HTMLElement>(null);
  const activeIndex = handlers.activeId
    ? rows.findIndex((r) => r.kind === "note" && r.note.id === handlers.activeId)
    : -1;
  useEffect(() => {
    if (activeIndex >= 0) scrollRowIntoView(listRef.current, activeIndex);
  }, [activeIndex]);

  return (
    <nav className="av-list" ref={listRef} aria-label="Notes" {...dnd}>
      {rows.map((r) => renderRow(r, handlers))}
    </nav>
  );
}

// Windowed note list for large notebooks — measures real row heights (titles
// may wrap), so the scrollbar stays accurate without assuming a fixed row size.
function VirtualNoteList({
  rows,
  handlers,
  dnd,
}: {
  rows: SidebarRow[];
  handlers: RowHandlers;
  dnd: ListDnd;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const k = rows[i].kind;
      return k === "note" ? 52 : k === "divider" ? 15 : 30;
    },
    // Measurements cache by key, so a collapse (which shifts indices) doesn't
    // re-measure every surviving row against the wrong cached height.
    getItemKey: (i) => rowKey(rows[i]),
    overscan: 10,
  });
  const activeIndex = useMemo(
    () =>
      handlers.activeId
        ? rows.findIndex((r) => r.kind === "note" && r.note.id === handlers.activeId)
        : -1,
    [rows, handlers.activeId],
  );
  useEffect(() => {
    if (activeIndex >= 0) virt.scrollToIndex(activeIndex, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <nav className="av-list" ref={scrollRef} aria-label="Notes" {...dnd}>
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((item) =>
          renderRow(rows[item.index], handlers, {
            index: item.index,
            top: item.start,
            measureRef: virt.measureElement,
          }),
        )}
      </div>
    </nav>
  );
}

const Sidebar = memo(function Sidebar({
  open,
  rows,
  activeId,
  onPick,
  onContext,
  onTogglePin,
  onRename,
  onToggleFolder,
  onFolderContext,
  onDropNote,
  onNew,
  onNewFolder,
  onSettings,
  notebookName,
  onSwitchNotebook,
  updateAvailable,
  width,
  onResizeEnd,
}: {
  open: boolean;
  rows: SidebarRow[];
  activeId: string | null;
  /** The open notebook's folder name (null before one loads) — the brand's subline. */
  notebookName: string | null;
  onSwitchNotebook: () => void;
  onPick: (id: string) => void;
  onContext: (id: string, title: string, pinned: boolean, x: number, y: number) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onToggleFolder: (dir: string) => void;
  onFolderContext: (dir: string, x: number, y: number) => void;
  /** A completed row drag (move onto a folder / group onto a note); App confirms. */
  onDropNote: (drop: NoteDrop) => void;
  onNew: () => void;
  onNewFolder: () => void;
  onSettings: () => void;
  /** Show the "update available" dot on the Settings button. */
  updateAvailable: boolean;
  /** Committed width (cfg.sidebarWidth). Live drag writes --sidebar-w directly. */
  width: number;
  onResizeEnd: (width: number) => void;
}) {
  // Minute tick so memoized rows still refresh their "5m ago" labels (they used
  // to piggyback on unrelated App re-renders).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const dnd = useListDnd(onDropNote);
  const handlers: RowHandlers = {
    activeId,
    onPick,
    onContext,
    onTogglePin,
    onRename,
    onToggleFolder,
    onFolderContext,
    now,
  };
  // Drag-to-resize. The live drag writes the --sidebar-w var imperatively (no
  // React re-render per pointer move — the perf rule for pointer affordances);
  // React state only commits once, on pointer-up, through onResizeEnd.
  const [resizing, setResizing] = useState(false);
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    // Pointer capture keeps move/up flowing to the handle even outside the
    // window, and pointercancel (OS gestures, Cmd-Tab) MUST end the drag —
    // orphaned window listeners would leave the sidebar glued to a buttonless
    // pointer until the next click.
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    setResizing(true);
    // steady col-resize cursor while dragging, even when the pointer outruns
    // the 5px handle
    document.documentElement.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      const w = clampSidebarWidth(startW + ev.clientX - startX);
      document.documentElement.style.setProperty("--sidebar-w", w + "px");
    };
    const finish = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      document.documentElement.style.cursor = "";
      setResizing(false);
      onResizeEnd(clampSidebarWidth(startW + ev.clientX - startX));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };
  return (
    <aside
      className={"av-sidebar" + (open ? "" : " is-collapsed") + (resizing ? " is-resizing" : "")}
    >
      <div className="av-sidebar-inner">
        <div className="av-brand">
          <div className="av-brandmark">
            Noteside
            <span className="av-brandcur" />
          </div>
          {/* The subline names the OPEN notebook (a multi-notebook user should
              never wonder which one they're in) and opens the switcher — the
              pointer twin of Mod-o / :notebook beside the titlebar button. */}
          {notebookName ? (
            <button
              type="button"
              className="av-brandsub av-notebook"
              title="switch notebook (⌘O)"
              onClick={onSwitchNotebook}
            >
              <FolderOpen size={11} aria-hidden="true" />
              <span className="av-notebook-name">{notebookName}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
          ) : (
            <div className="av-brandsub">fast, minimalist notes</div>
          )}
        </div>
        {rows.length <= VIRTUAL_THRESHOLD ? (
          <PlainNoteList rows={rows} handlers={handlers} dnd={dnd} />
        ) : (
          <VirtualNoteList rows={rows} handlers={handlers} dnd={dnd} />
        )}
        <div className="av-sidefoot">
          {/* New folder rides beside New note — the one always-visible pointer
              path to a FIRST folder (every other one hangs off an existing
              folder header or a note's menu). */}
          <div className="av-sidefoot-row">
            <button className="av-config" onClick={onNew}>
              <Plus className="av-cfg-glyph" size={15} aria-hidden="true" />
              New note
            </button>
            <button
              className="av-config av-config-icon"
              title="New folder"
              aria-label="New folder"
              onClick={onNewFolder}
            >
              <FolderPlus className="av-cfg-glyph" size={15} aria-hidden="true" />
            </button>
          </div>
          <button className="av-config" onClick={onSettings}>
            <SlidersHorizontal className="av-cfg-glyph" size={15} aria-hidden="true" />
            Settings
            {updateAvailable && (
              <span
                className="av-update-dot"
                title="Update available"
                aria-label="Update available"
              />
            )}
          </button>
        </div>
      </div>
      <div
        className="av-sidebar-resize"
        title="drag to resize — double-click to reset"
        onPointerDown={onHandleDown}
        onDoubleClick={() => onResizeEnd(CONFIG_DEFAULTS.sidebarWidth)}
      />
    </aside>
  );
});

// Sidebar list order (matches the backend: pinned desc, then updated desc) — so
// create/delete can patch the list locally instead of refetching it over IPC.
function metaOrder(a: NoteMeta, b: NoteMeta): number {
  return Number(b.pinned) - Number(a.pinned) || b.updated - a.updated;
}
function insertMeta(list: NoteMeta[], meta: NoteMeta): NoteMeta[] {
  // Stable re-sort of the whole list, not just an insert: the old code refetched
  // listNotes here, which also re-slotted any note whose `updated` bumped since
  // (autosaves patch metas in place without re-sorting) — keep that behavior.
  return [...list, meta].sort(metaOrder);
}

// Watcher events often rescan to an identical list — keep the old array identity
// so the memoized sidebar doesn't re-render for nothing.
function sameMetaList(a: NoteMeta[], b: NoteMeta[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.updated !== y.updated ||
      x.pinned !== y.pinned ||
      x.tags[0] !== y.tags[0]
    ) {
      return false;
    }
  }
  return true;
}

function NotebookPicker({ onPick }: { onPick: () => void }) {
  return (
    <div className="av-empty">
      <div className="av-mark" aria-label="Noteside">
        <span className="n">N</span>
        <span className="cur" />
      </div>
      <div className="av-empty-title">Open a notebook</div>
      <div className="av-empty-sub">
        Choose a folder of Markdown files — your notes stay as plain files on your disk.
      </div>
      <button className="set-done" style={{ marginTop: 8 }} onClick={onPick}>
        Open folder…
      </button>
    </div>
  );
}

function EmptyState({
  onReopen,
  hasClosed,
  onNew,
  onFind,
  onCommands,
}: {
  onReopen: () => void;
  hasClosed: boolean;
  onNew: () => void;
  onFind: () => void;
  onCommands: () => void;
}) {
  return (
    <div className="av-empty">
      <div className="av-mark" aria-label="Noteside">
        <span className="n">N</span>
        <span className="cur" />
      </div>
      <div className="av-empty-title">No note open</div>
      <div className="av-empty-sub">
        {hasClosed ? "You closed the buffer with :q." : "Pick a note to begin."} Choose one from the
        sidebar
        {hasClosed && (
          <>
            {" "}
            — or{" "}
            <button className="av-link" onClick={onReopen}>
              reopen the last one
            </button>
          </>
        )}
        .
      </div>
      <div className="av-empty-actions">
        <button type="button" className="set-done" onClick={onNew}>
          New note
        </button>
        <button type="button" className="av-emptybtn" onClick={onFind}>
          Find a note
        </button>
        <button type="button" className="av-emptybtn" onClick={onCommands}>
          All commands
        </button>
      </div>
      <div className="av-empty-keys">
        <kbd>{chordLabel("Mod-p")}</kbd> find a note · <kbd>{chordLabel("Mod-n")}</kbd> new note ·{" "}
        <kbd>{chordLabel("Mod-/")}</kbd> all shortcuts
      </div>
    </div>
  );
}

export function App() {
  const [cfg, setCfg] = useState<Config>(bootConfig);
  const [status, setStatus] = useState<Status>("boot");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  // Fresh mirror of `notes` for async handlers: an awaited IPC can outlive the
  // closed-over array (an autosave's onNoteSaved patches a row mid-flight), so
  // post-await reads go through the ref, never the stale closure.
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  // The notebook's folders (sorted rel dirs, empties included — first-class
  // data from the backend scan). Mutating ops patch it locally; the watcher's
  // refresh is the eventual-consistency backstop, identity-guarded so an
  // unchanged list never re-renders the memoized sidebar.
  const [folders, setFolders] = useState<string[]>([]);
  const refreshFolders = useCallback(async () => {
    try {
      const dirs = await backend.listFolders();
      setFolders((prev) =>
        prev.length === dirs.length && prev.every((d, i) => d === dirs[i]) ? prev : dirs,
      );
    } catch {
      /* the folder list self-heals from note paths (allDirs) */
    }
  }, []);
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [notebookSwitcherOpen, setNotebookSwitcherOpen] = useState(false);
  // The open notebook's path — drives the switcher's "current" marker + no-op guard.
  const [notebookPath, setNotebookPath] = useState<string | null>(null);
  const notebookPathRef = useRef(notebookPath);
  useEffect(() => {
    notebookPathRef.current = notebookPath;
  }, [notebookPath]);
  // Collapsed folder groups — client MACHINE state in localStorage (the
  // boot-theme / update-cache precedent, never the config file), per notebook.
  // The ref mirror keeps the mutating helpers stable for the memoized rows.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const collapsedRef = useRef(collapsed);
  const setAndPersistCollapsed = useCallback((mutate: (next: Set<string>) => void) => {
    const next = new Set(collapsedRef.current);
    mutate(next);
    collapsedRef.current = next;
    setCollapsed(next);
    const nb = notebookPathRef.current;
    if (!nb) return;
    try {
      localStorage.setItem(`noteside:folders-collapsed:${nb}`, JSON.stringify([...next]));
    } catch {
      /* private mode / quota — collapse just won't persist */
    }
  }, []);
  const toggleFolder = useCallback(
    (dir: string) => {
      setAndPersistCollapsed((next) => {
        if (!next.delete(dir)) next.add(dir);
      });
    },
    [setAndPersistCollapsed],
  );
  const expandFolder = useCallback(
    (dir: string) => {
      if (!collapsedRef.current.has(dir)) return;
      setAndPersistCollapsed((next) => {
        next.delete(dir);
      });
    },
    [setAndPersistCollapsed],
  );
  // Whole-sidebar folds (:foldall / :unfoldall, the folder menu). Stable
  // identities (the memoized header rows receive the menu opener), reading
  // the folder list through a latest-ref written below once `dirs` exists.
  const dirsRef = useRef<string[]>([]);
  const collapseAll = useCallback(() => {
    setAndPersistCollapsed((next) => {
      for (const d of dirsRef.current) next.add(d);
    });
  }, [setAndPersistCollapsed]);
  const expandAll = useCallback(() => {
    setAndPersistCollapsed((next) => next.clear());
  }, [setAndPersistCollapsed]);
  // Restore this notebook's collapse set when it opens/switches.
  useEffect(() => {
    let stored: unknown = [];
    if (notebookPath) {
      try {
        const raw = localStorage.getItem(`noteside:folders-collapsed:${notebookPath}`);
        if (raw) stored = JSON.parse(raw);
      } catch {
        /* corrupt / unavailable — start fully expanded */
      }
    }
    const next = new Set(
      Array.isArray(stored) ? stored.filter((d): d is string => typeof d === "string") : [],
    );
    collapsedRef.current = next;
    setCollapsed(next);
  }, [notebookPath]);
  const [finder, setFinder] = useState<{ mode: FinderMode } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cmdSearchOpen, setCmdSearchOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [refocus, setRefocus] = useState(0);
  // The open editor's command dispatch (registered via onRegisterDispatch) —
  // lets the searchable palette run editor-action commands (table ops).
  const editorDispatchRef = useRef<((cmd: Command) => void) | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: NotifyKind } | null>(null);
  const toastTimer = useRef<number | null>(null);
  // Update-check state lives here (not in SettingsPanel) so the boot check can run
  // with Settings closed and drive the Settings-button badge; the panel reads it.
  const version = useAppVersion();
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  // On-demand re-check (the Settings About row's button); shares the App state so
  // a manual check clears/sets the badge too.
  const runUpdateCheck = useCallback(async (): Promise<UpdateCheck> => {
    const r = await checkForUpdate(version);
    setUpdate(r);
    // Only a completed check arms the 24h throttle — a failed/offline probe must
    // not cache as "checked", or it would suppress the next launch's check and
    // hide a genuinely available update for up to a day.
    if (r.kind !== "error")
      writeUpdateCache({ ts: Date.now(), latest: r.kind === "available" ? r.latest : version });
    return r;
  }, [version]);
  // Note pending deletion (the confirm modal is open); null when closed. Every
  // delete path — the native context menu, :rm, the palette/chord — routes here
  // so a destructive action always confirms, and the modal is reachable (and
  // testable) without the native menu.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  // Note being renamed (the rename input modal is open); null when closed.
  const [pendingRename, setPendingRename] = useState<{ id: string; title: string } | null>(null);
  // Note being moved (the move-to-folder picker is open); null when closed.
  const [pendingMove, setPendingMove] = useState<{ id: string; title: string } | null>(null);
  // Folder-name prompt (New folder / New subfolder); `parent` "" = the root.
  const [pendingNewFolder, setPendingNewFolder] = useState<{ parent: string } | null>(null);
  // Folder being renamed (last segment) / recursively deleted (with note count).
  const [pendingFolderRename, setPendingFolderRename] = useState<{ dir: string } | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{
    dir: string;
    count: number;
  } | null>(null);
  // Open in-app folder context menu (web/demo only — Tauri pops the native one).
  const [folderMenu, setFolderMenu] = useState<{ dir: string; x: number; y: number } | null>(null);
  // Open in-app note context menu (web/demo only — Tauri pops the native one).
  const [noteMenu, setNoteMenu] = useState<{
    id: string;
    title: string;
    pinned: boolean;
    x: number;
    y: number;
  } | null>(null);
  // first-launch vim / plain-keyboard choice; cleared (and persisted) once picked
  const [onboarding, setOnboarding] = useState(false);

  const configLoaded = useRef(false);

  // Errors linger longer than confirmations — they usually carry a reason worth
  // reading, and unlike "note saved" they aren't predictable from what you just did.
  const flash = useCallback((msg: string, kind: NotifyKind = "info") => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = window.setTimeout(
      () => {
        toastTimer.current = null;
        setToast(null);
      },
      kind === "error" ? 3600 : 1600,
    );
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // The editing session owns the whole per-buffer loop: working/saved/dirty,
  // autosave, open/save/quit, the config buffer kind, external reconcile, and the
  // editor remount key. App keeps the sidebar list, config *semantics*, and chrome.
  const { session, snapshot: s } = useEditingSession({
    backend,
    autosaveMs: AUTOSAVE_MS,
    notify: flash,
    onConfigApply: (text) => {
      const next = parseConfig(text, cfg);
      setCfg(next);
      // A partial apply must not report as a clean one. Unrecognized directives
      // are kept in the buffer verbatim, but they did nothing — say so, and name
      // them, or the user is left believing a setting took effect (issue #24).
      const ignored = unrecognizedDirectives(next);
      if (!ignored.length) {
        // vim :map lines still parse + round-trip, but the vim subset doesn't
        // apply them — be honest rather than silently inert.
        if (next.keymaps.length > 0) {
          flash("config applied — vim :map lines aren't applied by this editor", "error");
          return;
        }
        flash("config applied");
        return;
      }
      const keys = ignored.map((l) => l.trim().split(/[\s=]+/)[1] ?? l.trim()).slice(0, 3);
      const more = ignored.length > keys.length ? `, +${ignored.length - keys.length} more` : "";
      flash(`config applied — not recognized: ${keys.join(", ")}${more}`, "error");
    },
    onNoteSaved: (meta) => setNotes((ns) => ns.map((n) => (n.id === meta.id ? meta : n))),
    onNoteRenamed: (oldId, meta) => setNotes((ns) => ns.map((n) => (n.id === oldId ? meta : n))),
    onNotesChanged: (list) => setNotes((prev) => (sameMetaList(prev, list) ? prev : list)),
  });

  // The sidebar's row model — ONE derivation shared by the lists and the
  // Mod-j/k stepper, so what you see is exactly what you step through.
  const rows = useMemo(
    () => buildSidebarRows(notes, folders, collapsed),
    [notes, folders, collapsed],
  );
  const dirs = useMemo(() => allDirs(notes, folders), [notes, folders]);
  useEffect(() => {
    dirsRef.current = dirs;
  }, [dirs]);

  // Opening a note inside a collapsed group expands it — the active note must
  // always be visible (it also keeps Mod-j/k's visual-order stepping defined).
  useEffect(() => {
    if (s.status !== "note" || !s.activeId) return;
    const dir = noteDir(s.activeId);
    if (dir) expandFolder(dir);
  }, [s.status, s.activeId, expandFolder]);

  // Apply the theme: data-theme + inline palette vars + the boot-theme mirror.
  // Keyed on cfg.theme ONLY, so font/scale key-repeat doesn't recompute the
  // palette or re-write localStorage (see the debounced persist below).
  useEffect(() => {
    const r = document.documentElement;
    const theme = themeById(cfg.theme);
    if (r.getAttribute("data-theme") !== theme.mode) r.setAttribute("data-theme", theme.mode);
    applyThemeVars(r, theme);
    try {
      localStorage.setItem(
        BOOT_THEME_KEY,
        JSON.stringify({ id: theme.id, mode: theme.mode, vars: resolveThemeVars(theme) }),
      );
    } catch {
      /* private mode / quota — cosmetic only */
    }
  }, [cfg.theme]);

  // Apply font/size/scale CSS vars. These change on every zoom key-repeat, so
  // they must NOT drag the palette recompute or the localStorage write along.
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--editor-font", fontStack(cfg.editorFont));
    r.style.setProperty("--editor-size", cfg.fontSize + "px");
    r.style.setProperty("--editor-lh", String(cfg.lineHeight));
    r.style.setProperty("--ui-scale", String(cfg.uiScale));
    r.style.setProperty("--sidebar-w", cfg.sidebarWidth + "px");
  }, [cfg.editorFont, cfg.fontSize, cfg.lineHeight, cfg.uiScale, cfg.sidebarWidth]);

  // persist config, debounced: held settings steppers fire per key-repeat, and
  // each store.set is an IPC (a sync localStorage write in the demo). The tail
  // is flushed on unmount/pagehide so a quick quit can't drop the last change.
  const persistTimer = useRef<number | null>(null);
  const cfgRef = useRef(cfg);
  const configWriteTail = useRef<Promise<void>>(Promise.resolve());
  const persistConfig = useCallback((next: Config): Promise<void> => {
    const write = configWriteTail.current.catch(() => {}).then(() => backend.setConfig(next));
    configWriteTail.current = write;
    return write;
  }, []);
  useEffect(() => {
    cfgRef.current = cfg;
    if (!configLoaded.current) return;
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      void persistConfig(cfgRef.current).catch(() => {});
    }, 300);
  }, [cfg, persistConfig]);
  const flushConfig = useCallback(async (): Promise<void> => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
      await persistConfig(cfgRef.current);
    }
    await configWriteTail.current;
  }, [persistConfig]);
  useEffect(() => {
    const flushAll = async () => {
      // allSettled keeps a failed config write from preventing note durability
      // (and vice versa), while guaranteeing the native close handler never throws.
      await Promise.allSettled([flushConfig(), session.flush()]);
    };
    // pagehide covers the browser/demo; WKWebView doesn't reliably fire it on a
    // native close/Cmd-Q, so the Tauri close-requested event is the real flush
    // there (without it, a theme commit + fast quit would silently revert).
    const onPageHide = () => void flushAll();
    window.addEventListener("pagehide", onPageHide);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) {
      // CAUTION: registering onCloseRequested makes Tauri core intercept the
      // native close and rely on the JS wrapper calling window.destroy() —
      // which needs `core:window:allow-destroy` in capabilities/default.json
      // (missing = the X button silently does nothing; shipped as the v1.3.0
      // bug). tauri-capabilities.test.ts pins that coupling. The handler must
      // also never throw, or destroy() is skipped and close breaks again.
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(async () => flushAll()))
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      unlisten?.();
      void disposeNativeMenus();
      void flushAll();
    };
  }, [flushConfig, session]);

  // Monotonic notebook-load token: overlapping opens/switches resolve to the
  // LATEST user pick (mirrors the Rust side's own latest-request-wins fence), so
  // a slow older open can't land its notes/path/state after a newer one.
  const notebookLoad = useRef(0);
  // Every mutating op captures the generation before its IPC and drops its UI
  // patches if a notebook switch landed meanwhile — the new notebook's scan is
  // authoritative, and patching it with the old notebook's result would plant
  // phantom rows/folders (Rust's ensure_context already fails a mid-switch
  // COMMIT; this covers a commit that landed just before the swap).
  const notebookChangedSince = (gen: number) => gen !== notebookLoad.current;
  const openNotebook = async (path: string, token = ++notebookLoad.current) => {
    let metas: NoteMeta[];
    try {
      metas = await backend.openNotebook(path);
    } catch (e) {
      // Superseded opens fail quietly (the newer open owns the UI — a late
      // rejection must not knock boot/switch recovery into the wrong state).
      if (token !== notebookLoad.current) return;
      throw e;
    }
    // Folders ride along with the open (empty folders aren't derivable from
    // note paths); a failure here degrades to the note-derived groups.
    const folderList = await backend.listFolders().catch(() => []);
    if (token !== notebookLoad.current) return; // a newer open owns the UI
    setNotes(metas);
    setFolders(folderList);
    void backend.setLastNotebook(path);
    void backend.rememberNotebook(path); // feed the switcher's recents (MRU)
    setNotebookPath(path);
    setStatus("ready");
    if (metas.length) await session.open(metas[0].id);
    else session.close();
  };

  // Switch to another notebook (from the switcher). A no-op when it's already open.
  const switchNotebook = async (path: string) => {
    if (path === notebookPath) return;
    // Claim the token at user-action time, not at openNotebook time — two
    // overlapping switches must resolve to the later PICK even if the earlier
    // one's flush finishes last.
    const token = ++notebookLoad.current;
    // Deactivate the outgoing buffer FIRST, synchronously (before any await): once
    // activeId is null, session.change() no-ops, so a keystroke landing in the
    // async window below — the overlay's onClose refocuses the old editor — can't
    // queue a save that would fire AFTER the index swaps and write the old note's
    // text into the NEW notebook. The pre-switch queued save survives in the
    // autosaver and flush() still lands it in the OLD notebook (the index is
    // unchanged until openNotebook).
    session.close();
    await session.flush();
    if (token !== notebookLoad.current) return; // a newer switch superseded us
    try {
      await openNotebook(path, token);
    } catch (e) {
      // Superseded (incl. the Rust side rejecting an out-of-date open): the
      // newer switch owns the UI and the folder isn't at fault — do nothing.
      if (token !== notebookLoad.current) return;
      void backend.removeRecentNotebook(path); // a folder that's gone shouldn't linger in recents
      session.reopenLast(); // the old backend context remains authoritative when open fails
      flash(`couldn't open notebook: ${e}`, "error");
    }
  };
  // Switcher "Open folder…": native dialog → switch to the chosen folder.
  const pickAndSwitchNotebook = async () => {
    const path = await backend.pickNotebook();
    if (path) await switchNotebook(path);
  };
  // Switcher "New notebook…": create the folder, then open it (empty → empty state).
  const createNotebook = async (parent: string, name: string) => {
    try {
      const path = await backend.createNotebook(parent, name);
      await switchNotebook(path);
    } catch (e) {
      flash(`couldn't create notebook: ${e}`, "error");
    }
  };

  // boot: load config + last notebook in parallel (independent reads)
  useEffect(() => {
    (async () => {
      const [stored, last] = await Promise.all([
        backend.getConfig().catch(() => null),
        backend.getLastNotebook().catch(() => null),
      ]);
      if (stored) {
        // Pre-themes configs stored theme:"light"|"dark" — normalize the alias
        // (or any unknown id) to a canonical theme id so raw comparisons (e.g.
        // the picker's is-current marker) work and the store converges.
        const theme = typeof stored.theme === "string" ? resolveThemeId(stored.theme) : null;
        setCfg((c) => ({
          ...c,
          ...stored,
          theme: theme ?? c.theme,
          chords: sanitizeChordOverrides(stored.chords),
        }));
      } else if (last) {
        // A notebook but no stored config = a pre-onboarding install that never
        // touched Settings. Those users lived on the old vim-on default — keep
        // them there instead of silently de-vimming on upgrade (the vim-off
        // default is for NEW users; this write persists on their next change).
        setCfg((c) => ({ ...c, vimMode: true }));
      }
      configLoaded.current = true;
      // Automatic update check — native only (the web/demo never phones home) and
      // only when the setting is on (default). Fire-and-forget so it never blocks
      // first paint; throttled to once/24h, restoring the cached result otherwise.
      if (isTauri() && (stored?.autoUpdateCheck ?? CONFIG_DEFAULTS.autoUpdateCheck)) {
        const cache = readUpdateCache();
        if (cache && !dueForCheck(Date.now(), cache.ts)) {
          if (cache.latest && isNewer(cache.latest, version)) {
            setUpdate({ kind: "available", latest: cache.latest });
          }
        } else {
          void checkForUpdate(version).then((r) => {
            setUpdate(r);
            // don't arm the throttle on a failed probe (see runUpdateCheck).
            if (r.kind !== "error")
              writeUpdateCache({
                ts: Date.now(),
                latest: r.kind === "available" ? r.latest : version,
              });
          });
        }
      }
      // A brand-new user (no stored config, no notebook) gets the one-time
      // vim/plain-keyboard choice before anything else. Picking it persists the
      // config, so the gate never fires again.
      if (isFirstLaunch(stored, last)) setOnboarding(true);
      try {
        if (last) await openNotebook(last);
        else setStatus("no-notebook");
      } catch {
        setStatus("no-notebook");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // react to external notebook changes (other editors, git, sync). The session
  // reconciles the active buffer against disk reading its own live id, so the
  // watcher needs no stale-closure indirection.
  useEffect(() => {
    let un: (() => void) | null = null;
    let cancelled = false;
    backend
      .watchNotebook(() => {
        void session.reconcile();
        void refreshFolders(); // external mkdir/rmdir/mv-dir refreshes the groups too
      })
      .then((u) => {
        if (cancelled) u();
        else un = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      un?.();
    };
  }, [session, refreshFolders]);

  const pickNotebook = async () => {
    const path = await backend.pickNotebook();
    if (path) {
      setStatus("boot");
      try {
        await openNotebook(path);
      } catch {
        setStatus("no-notebook");
      }
    }
  };

  const openFinder = (mode: FinderMode) => setFinder({ mode });
  // Stable identities: the Finder derives its memo'd rows' onPick from onOpen,
  // so a fresh closure here would re-render every visible result row whenever
  // App re-renders with the finder open (e.g. a toast landing).
  const closeFinder = useCallback(() => {
    setFinder(null);
    setRefocus((r) => r + 1);
  }, []);
  const openFromFinder = useCallback(
    async (path: string, line: number) => {
      setFinder(null);
      await session.open(path, line && line > 0 ? line : 0);
      setRefocus((r) => r + 1);
    },
    [session],
  );

  // open an external URL under the cursor (gx / :follow / Mod-click)
  const onOpenUrl = (url: string) => {
    void openExternal(url).then((ok) => {
      if (!ok) flash(`can't open: ${url}`, "error");
    });
  };

  const openConfig = () => {
    setSettingsOpen(false);
    session.openConfig(serializeConfig(cfg));
  };
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openNotebookSwitcher = useCallback(() => setNotebookSwitcherOpen(true), []);
  const closeSettings = () => {
    setSettingsOpen(false);
    setRefocus((r) => r + 1);
  };
  const setCfgPatch = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  // Resolve the first-launch choice: set vim on/off and dismiss the gate. Writing
  // cfg (configLoaded is true by boot's end) persists it, so it never shows again.
  const finishOnboarding = (vim: boolean) => {
    setOnboarding(false);
    setCfg((c) => ({ ...c, vimMode: vim }));
    flash(vim ? "vim mode on" : "plain keyboard mode on");
    setRefocus((r) => r + 1);
  };
  const toggleNav = () => {
    setNavOpen((v) => !v);
    setRefocus((r) => r + 1);
  };
  // Create/delete patch the sidebar list locally — the meta (or the removal) is
  // already known, so refetching all N metas over IPC is wasted; the watcher's
  // reconcile() remains the eventual-consistency backstop. (Create lives in the
  // folders block below — a new note lands in the open note's folder.)

  // Delete any note by id — the active buffer (via :rm / <Space>d) or a
  // right-clicked sidebar row. Deleting the active note drops its queued save (so
  // it can't resurrect the file) and opens the next note; deleting an inactive
  // note leaves the current buffer untouched.
  const deleteNoteById = async (id: string) => {
    const wasActive = s.status === "note" && s.activeId === id;
    const gen = notebookLoad.current;
    try {
      if (wasActive) await session.cancelAutosave();
      await backend.deleteNote(id);
      if (notebookChangedSince(gen)) return;
      // Filter + stable re-sort ≙ the old listNotes refetch (see insertMeta).
      // Functional + ref-based: a row patched during the delete IPC (autosave
      // meta, rename swap) must not be reverted by a pre-await snapshot.
      setNotes((ns) => ns.filter((n) => n.id !== id).sort(metaOrder));
      if (wasActive) {
        const remaining = notesRef.current.filter((n) => n.id !== id).sort(metaOrder);
        const next = remaining[0]?.id ?? null;
        if (next) await session.open(next);
        else session.close();
      }
      flash("note deleted");
    } catch (e) {
      if (wasActive) session.resumeAutosave();
      flash(`delete failed: ${e}`, "error");
    }
  };

  // Open the confirm modal for a note; the modal's confirm runs the delete.
  const requestDelete = useCallback(
    (id: string, title: string) => setPendingDelete({ id, title }),
    [],
  );

  const deleteActive = () => {
    if (s.status === "note" && s.activeId) requestDelete(s.activeId, s.title ?? "this note");
  };

  // Duplicate a note → a "<title> copy" sibling; open the copy so it's ready to edit.
  const duplicateNote = async (id: string) => {
    const gen = notebookLoad.current;
    try {
      if (s.status === "note" && s.activeId === id) await session.flush();
      const meta = await backend.duplicateNote(id);
      if (notebookChangedSince(gen)) return;
      setNotes((ns) => insertMeta(ns, meta));
      await session.open(meta.id);
      flash("note duplicated");
    } catch (e) {
      flash(`duplicate failed: ${e}`, "error");
    }
  };

  const revealNote = (id: string) => {
    void backend.revealNote(id).catch((e) => flash(`couldn't reveal: ${e}`, "error"));
  };

  // Open the rename input modal for a note; the modal's confirm runs the rename.
  const requestRename = useCallback(
    (id: string, title: string) => setPendingRename({ id, title }),
    [],
  );

  // Set a note's title (rewrites the body + renames the file). If it's the open
  // buffer, flush pending edits first (the retitle rewrites the file), then reopen
  // at the new id so the editor reflects the new title.
  const renameNote = async (id: string, newTitle: string) => {
    const wasActive = s.status === "note" && s.activeId === id;
    const gen = notebookLoad.current;
    try {
      if (wasActive) {
        await session.flush();
        // Pause autosave across the rewrite (same machinery as delete): a
        // keystroke landing during the retitle IPC would queue a save pinned to
        // the OLD path, which would fire after the reopen and resurrect the
        // renamed-away file on disk.
        await session.cancelAutosave();
      }
      const meta = await backend.retitleNote(id, newTitle);
      if (notebookChangedSince(gen)) return;
      setNotes((ns) => ns.map((n) => (n.id === id ? meta : n)).sort(metaOrder));
      if (wasActive) await session.open(meta.id);
      flash("note renamed");
    } catch (e) {
      if (wasActive) session.resumeAutosave();
      flash(`rename failed: ${e}`, "error");
    }
  };

  // Set a note's pinned flag. The backend rewrites the note's frontmatter, so
  // this is a body-changing operation: flush the open buffer first (or the flush
  // would race the rewrite), and reopen afterwards so the editor picks up the new
  // frontmatter. Without the reopen the buffer would still hold the pre-pin text
  // and the next autosave would quietly unpin the note.
  const setNotePinned = async (id: string, pinned: boolean) => {
    // Already in the requested state (`:pin` on a pinned note): the backend
    // writes nothing, so skip the flush + reopen too — a remount here would
    // throw the cursor back to the top of the note for no reason at all.
    if (notes.find((n) => n.id === id)?.pinned === pinned) {
      flash(pinned ? "note pinned" : "note unpinned");
      return;
    }
    const wasActive = s.status === "note" && s.activeId === id;
    const gen = notebookLoad.current;
    try {
      if (wasActive) {
        await session.flush();
        // Pause autosave across the rewrite (same machinery as delete): a
        // keystroke landing during the setPinned IPC would queue pre-pin text
        // that fires after the reopen and silently unpins the file on disk
        // while the sidebar still shows it pinned.
        await session.cancelAutosave();
      }
      const meta = await backend.setPinned(id, pinned);
      if (notebookChangedSince(gen)) return;
      setNotes((ns) => ns.map((n) => (n.id === id ? meta : n)).sort(metaOrder));
      if (wasActive) await session.open(meta.id);
      flash(pinned ? "note pinned" : "note unpinned");
    } catch (e) {
      if (wasActive) session.resumeAutosave();
      flash(`${pinned ? "pin" : "unpin"} failed: ${e}`, "error");
    }
  };

  const setActivePinned = (pinned: boolean) => {
    if (s.status === "note" && s.activeId) void setNotePinned(s.activeId, pinned);
  };

  // ── folders ────────────────────────────────────────────────────────
  // Sorted-insert a folder locally (allDirs completes any missing ancestors at
  // render time; the backend registered them too).
  const addFolderLocal = (dir: string) => {
    if (!dir) return;
    setFolders((prev) => (prev.includes(dir) ? prev : [...prev, dir].sort()));
  };

  // The note whose buffer an id-changing op must protect: the OPEN note, or the
  // note parked under the config overlay / closed by :q — its queued autosave
  // and the "reopen" target still point at the old id. (session.migrateId is
  // a no-op for unrelated ids, so it always runs on success.)
  const heldNoteId = (): string | null => (s.status === "note" ? s.activeId : s.lastNoteId);

  // Move a note into another folder ("" = root). Moving the OPEN note migrates
  // the buffer's id in place — a move never rewrites body bytes and editorKey
  // excludes activeId, so there is NO remount and the cursor survives; autosave
  // pauses across the IPC so a keystroke can't resurrect the old path.
  // Resolves to the folder the note landed in (the disk's spelling), or null
  // on failure (already toasted). Toasts nothing on success — the callers say
  // what happened (one move, or a group of them).
  const moveNoteTo = async (id: string, dir: string): Promise<string | null> => {
    const gen = notebookLoad.current;
    const held = heldNoteId() === id;
    try {
      if (held) {
        await session.flush();
        await session.cancelAutosave();
      }
      const meta = await backend.moveNote(id, dir);
      if (notebookChangedSince(gen)) return null;
      // Always the RETURNED meta — a destination collision may have -N'd the
      // stem, and the folder comes back spelled the way the disk has it.
      const landed = noteDir(meta.path);
      setNotes((ns) => ns.map((n) => (n.id === id ? meta : n)).sort(metaOrder));
      if (landed) {
        addFolderLocal(landed);
        expandFolder(landed); // the note must land somewhere visible
      }
      session.migrateId(id, meta);
      if (held) session.resumeAutosave();
      return landed;
    } catch (e) {
      if (held && !notebookChangedSince(gen)) session.resumeAutosave();
      flash(`move failed: ${e}`, "error");
      return null;
    }
  };
  const moveNote = async (id: string, dir: string) => {
    if (noteDir(id) === dir) {
      flash(`already in ${dir || "the notebook root"}`);
      return;
    }
    const landed = await moveNoteTo(id, dir);
    if (landed !== null) flash(`moved to ${landed || "notebook root"}`);
  };

  // Drop-on-note: a NEW folder (`folder` is the full rel, parent included)
  // and every listed note moved into it — sequentially, since one of them may
  // be the open buffer (moveNoteTo pauses its autosave across the IPC). The
  // folder is created first so a failed move still leaves the place the user
  // named; createFolder is idempotent, so naming an EXISTING folder just
  // gathers the notes there.
  const groupNotes = async (ids: string[], folder: string) => {
    const rel = await createFolder(folder);
    if (rel === null) return;
    let moved = 0;
    for (const id of ids) if ((await moveNoteTo(id, rel)) !== null) moved++;
    if (moved === ids.length) flash(`${moved} notes moved to ${rel}`);
    else if (moved) flash(`${moved} of ${ids.length} notes moved to ${rel}`, "error");
  };

  // A completed sidebar drag — ONE stable identity (the memo'd Sidebar). The
  // drop itself only ASKS: a move confirms in a modal (Enter is the
  // go-ahead), a group prompts for the new folder's name. Titles come from
  // the live list, so the dialogs can name both notes.
  const [pendingDrop, setPendingDrop] = useState<
    | { kind: "move"; id: string; title: string; dir: string }
    | { kind: "group"; id: string; title: string; targetId: string; targetTitle: string }
    | null
  >(null);
  const onDropNote = useCallback((drop: NoteDrop) => {
    const titleOf = (id: string) => notesRef.current.find((n) => n.id === id)?.title ?? id;
    if (drop.kind === "move") {
      setPendingDrop({ kind: "move", id: drop.id, title: titleOf(drop.id), dir: drop.dir });
    } else {
      setPendingDrop({
        kind: "group",
        id: drop.id,
        title: titleOf(drop.id),
        targetId: drop.targetId,
        targetTitle: titleOf(drop.targetId),
      });
    }
  }, []);

  const requestMove = useCallback((id: string, title: string) => setPendingMove({ id, title }), []);
  const moveActive = () => {
    if (s.status === "note" && s.activeId) requestMove(s.activeId, s.title ?? "");
  };

  // Create a folder; resolves to its canonical rel dir, null on failure (the
  // move picker's create-and-move keys off that).
  const createFolder = async (dir: string): Promise<string | null> => {
    const gen = notebookLoad.current;
    try {
      const rel = await backend.createFolder(dir);
      if (notebookChangedSince(gen)) return null;
      addFolderLocal(rel);
      return rel;
    } catch (e) {
      flash(`couldn't create folder: ${e}`, "error");
      return null;
    }
  };
  const createFolderRef = useRef(createFolder);
  useEffect(() => {
    createFolderRef.current = createFolder;
  });
  const onCreateFolder = useCallback((dir: string) => createFolderRef.current(dir), []);

  // Create a note. `dir` names the folder ("" = root); omitted = the OPEN note's
  // folder — a note started while working inside `journal/` belongs beside its
  // siblings, not at the root (New note button, Mod-n, :new). The folder
  // header's "New note here" passes its dir explicitly.
  const createNoteIn = async (dir?: string) => {
    const target = dir ?? (s.status === "note" && s.activeId ? noteDir(s.activeId) : "");
    const gen = notebookLoad.current;
    try {
      const meta = await backend.createNote(undefined, target || undefined);
      if (notebookChangedSince(gen)) return;
      const landed = noteDir(meta.path); // the disk's spelling of the folder
      setNotes((ns) => insertMeta(ns, meta));
      if (landed) {
        addFolderLocal(landed);
        expandFolder(landed);
      }
      await session.open(meta.id);
      if (landed) flash(`new note in ${landed}`);
    } catch (e) {
      flash(`couldn't create note: ${e}`, "error");
    }
  };
  const createNote = () => createNoteIn();

  // Rename a folder's last segment. Every contained note's id changes; the
  // whole subtree is patched locally with rewritePrefix (collision-free by
  // construction — the directory moved atomically), and the open buffer inside
  // it migrates its id exactly like a move.
  const renameFolder = async (dir: string, name: string) => {
    const heldId = heldNoteId();
    const held = !!heldId && heldId.startsWith(dir + "/");
    const gen = notebookLoad.current;
    try {
      if (held) {
        await session.flush();
        await session.cancelAutosave();
      }
      const newDir = await backend.renameFolder(dir, name);
      if (notebookChangedSince(gen)) return;
      if (newDir !== dir) {
        setNotes((ns) =>
          ns.map((n) => {
            const np = rewritePrefix(n.path, dir, newDir);
            return np === n.path ? n : { ...n, id: np, path: np };
          }),
        ); // order untouched: a folder rename changes no updated/pinned
        setFolders((prev) => [...new Set(prev.map((f) => rewritePrefix(f, dir, newDir)))].sort());
        setAndPersistCollapsed((next) => {
          for (const d of [...next]) {
            const nd = rewritePrefix(d, dir, newDir);
            if (nd !== d) {
              next.delete(d);
              next.add(nd);
            }
          }
        });
        if (held && heldId) {
          const newId = rewritePrefix(heldId, dir, newDir);
          // migrateId needs the id (plus the title for the on-screen buffer);
          // a meta missing from the list (a watcher reload racing us) must not
          // strand the buffer on a dead id, so synthesize one in that case.
          const old = notesRef.current.find((n) => n.id === heldId) ?? {
            id: heldId,
            path: heldId,
            title: s.title ?? "",
            tags: [],
            created: null,
            updated: 0,
            pinned: false,
          };
          session.migrateId(heldId, { ...old, id: newId, path: newId });
        }
      }
      if (held) session.resumeAutosave();
      flash(`folder renamed to ${newDir}`);
    } catch (e) {
      if (held && !notebookChangedSince(gen)) session.resumeAutosave();
      flash(`rename failed: ${e}`, "error");
    }
  };

  // Recursive folder delete, behind a ConfirmDialog stating the note count.
  const requestFolderDelete = useCallback((dir: string) => {
    const count = notesRef.current.filter((n) => n.path.startsWith(dir + "/")).length;
    setPendingFolderDelete({ dir, count });
  }, []);

  const deleteFolder = async (dir: string) => {
    const prefix = dir + "/";
    const wasActiveInside = s.status === "note" && !!s.activeId && s.activeId.startsWith(prefix);
    const gen = notebookLoad.current;
    try {
      if (wasActiveInside) await session.cancelAutosave();
      await backend.deleteFolder(dir);
      if (notebookChangedSince(gen)) return;
      setNotes((ns) => ns.filter((n) => !n.path.startsWith(prefix)).sort(metaOrder));
      setFolders((prev) => prev.filter((f) => f !== dir && !f.startsWith(prefix)));
      setAndPersistCollapsed((next) => {
        for (const d of [...next]) if (d === dir || d.startsWith(prefix)) next.delete(d);
      });
      if (wasActiveInside) {
        // Mirror deleteNoteById: navigate to the next surviving note (which
        // discards the paused edits) or close to the empty state.
        const remaining = notesRef.current
          .filter((n) => !n.path.startsWith(prefix))
          .sort(metaOrder);
        const next = remaining[0]?.id ?? null;
        if (next) await session.open(next);
        else session.close();
      }
      flash("folder deleted");
    } catch (e) {
      if (wasActiveInside && !notebookChangedSince(gen)) session.resumeAutosave();
      flash(`delete failed: ${e}`, "error");
    }
  };

  // Right-click a folder header (or its ⋯ kebab) → the folder menu. Native OS
  // menu in Tauri, the themed in-app ContextMenu in the web/demo build — thin
  // dispatchers over the same handlers, like the note menu.
  const createNoteInRef = useRef(createNoteIn);
  useEffect(() => {
    createNoteInRef.current = createNoteIn;
  });
  const openFolderMenu = useCallback(
    (dir: string, x: number, y: number) => {
      if (!isTauri()) {
        setFolderMenu({ dir, x, y });
        return;
      }
      void showFolderContextMenu(dir, {
        onNewNote: (d) => void createNoteInRef.current(d),
        onNewSubfolder: (d) => setPendingNewFolder({ parent: d }),
        onRename: (d) => setPendingFolderRename({ dir: d }),
        onDelete: requestFolderDelete,
        onCollapseAll: collapseAll,
        onExpandAll: expandAll,
      });
    },
    [requestFolderDelete, collapseAll, expandAll],
  );
  const closeFolderMenu = useCallback(() => {
    setFolderMenu(null);
    setRefocus((r) => r + 1);
  }, []);

  const renameActive = () => {
    if (s.status === "note" && s.activeId) requestRename(s.activeId, s.title ?? "");
  };
  const duplicateActive = () => {
    if (s.status === "note" && s.activeId) void duplicateNote(s.activeId);
  };
  const revealActive = () => {
    if (s.status === "note" && s.activeId) revealNote(s.activeId);
  };

  const closePalette = () => {
    setPaletteOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeCmdSearch = () => {
    setCmdSearchOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeCheatsheet = () => {
    setCheatsheetOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeThemePicker = () => {
    setThemePickerOpen(false);
    setRefocus((r) => r + 1);
  };
  const closeNotebookSwitcher = () => {
    setNotebookSwitcherOpen(false);
    setRefocus((r) => r + 1);
  };

  // Step to the adjacent note in the sidebar (Mod-j / Mod-k) — VISUAL order:
  // the flattened row model, skipping folder headers and notes hidden inside
  // collapsed groups; if the open note's own group was collapsed under it, the
  // step resumes from that group's position. Clamps at the ends; opening
  // flushes any pending save of the outgoing buffer.
  const stepNote = (delta: number) => {
    const next = stepVisibleNote(rows, s.activeId, delta);
    if (next) void session.open(next);
  };

  // The folder-scoped commands act on the OPEN note's folder.
  const withActiveFolder = (run: (dir: string) => void) => {
    const dir = s.status === "note" && s.activeId ? noteDir(s.activeId) : "";
    if (dir) run(dir);
    else flash("the open note isn't in a folder", "error");
  };

  // Mod± / Mod-Shift± zoom. Clamps mirror the settings-panel steppers; the CSS
  // vars apply live (no remount) and the debounced persist coalesces key-repeat.
  const bumpFont = (d: number) => {
    const fontSize =
      d === 0 ? CONFIG_DEFAULTS.fontSize : Math.max(16, Math.min(28, cfg.fontSize + d));
    setCfgPatch({ fontSize });
    flash(`font size ${fontSize}px`);
  };
  const bumpUi = (d: number) => {
    const uiScale =
      d === 0
        ? CONFIG_DEFAULTS.uiScale
        : Math.max(0.9, Math.min(1.3, Math.round((cfg.uiScale + d) * 20) / 20));
    setCfgPatch({ uiScale });
    flash(`interface ${Math.round(uiScale * 100)}%`);
  };

  const onCommand = (c: AppCommand) => {
    if (c === "find") openFinder("all");
    else if (c === "grep") openFinder("content");
    else if (c === "notebooks") setNotebookSwitcherOpen(true);
    else if (c === "nav") toggleNav();
    else if (c === "settings") openSettings();
    else if (c === "theme") setThemePickerOpen(true);
    else if (c === "config") openConfig();
    else if (c === "palette") setPaletteOpen(true);
    else if (c === "commands") setCmdSearchOpen(true);
    else if (c === "cheatsheet") setCheatsheetOpen(true);
    else if (c === "new") void createNote();
    else if (c === "delete") deleteActive();
    else if (c === "duplicate") duplicateActive();
    else if (c === "rename") renameActive();
    else if (c === "pin") setActivePinned(true);
    else if (c === "unpin") setActivePinned(false);
    else if (c === "move") moveActive();
    else if (c === "newFolder") setPendingNewFolder({ parent: "" });
    else if (c === "renameFolder") withActiveFolder((dir) => setPendingFolderRename({ dir }));
    else if (c === "deleteFolder") withActiveFolder(requestFolderDelete);
    else if (c === "toggleFolder") withActiveFolder(toggleFolder);
    else if (c === "collapseAll") collapseAll();
    else if (c === "expandAll") expandAll();
    else if (c === "reveal") revealActive();
    else if (c === "reopen") session.reopenLast();
    else if (c === "nextNote") stepNote(1);
    else if (c === "prevNote") stepNote(-1);
    else if (c === "fontUp") bumpFont(1);
    else if (c === "fontDown") bumpFont(-1);
    else if (c === "fontReset") bumpFont(0);
    else if (c === "uiUp") bumpUi(0.05);
    else if (c === "uiDown") bumpUi(-0.05);
    else if (c === "uiReset") bumpUi(0);
    else {
      const exhaustive: never = c;
      return exhaustive;
    }
  };

  // Run a command chosen from the searchable palette. AppCommands via onCommand,
  // quit via the session, and other editor actions (table ops) through the
  // editor's registered dispatch — silently a no-op with no editor mounted
  // (empty state / config buffer).
  const runPaletteCommand = (cmd: Command) => {
    if (cmd.command) onCommand(cmd.command);
    else if (cmd.editor === "quit") session.quit();
    else if (cmd.editor) editorDispatchRef.current?.(cmd);
  };

  // Chords when no editor is focused (empty state / picker). Disabled while any
  // overlay is open so it never steals keys from a panel that owns its own focus.
  useGlobalChords({
    enabled: !(
      onboarding ||
      finder ||
      paletteOpen ||
      cmdSearchOpen ||
      cheatsheetOpen ||
      settingsOpen ||
      themePickerOpen ||
      notebookSwitcherOpen ||
      pendingDelete ||
      pendingRename ||
      pendingMove ||
      pendingDrop ||
      pendingNewFolder ||
      pendingFolderRename ||
      pendingFolderDelete ||
      noteMenu ||
      folderMenu
    ),
    overrides: cfg.chords,
    run: onCommand,
  });

  // Stable handles for the memoized sidebar (so autosaves/toasts re-render rows,
  // not the whole tree).
  // Clicking the row of the ALREADY-open note must not re-open it: open() never
  // short-circuits (it bumps navSeq → editor remount → caret reset, and records
  // frecency), so a same-id click — including the two clicks that precede a
  // double-click-rename — just hands focus back to the editor instead.
  const activeIdRef = useRef(s.activeId);
  useEffect(() => {
    activeIdRef.current = s.activeId;
  });
  const openNote = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) {
        setRefocus((r) => r + 1);
        return;
      }
      void session.open(id);
    },
    [session],
  );
  const onNewNote = useCallback(() => void createNoteInRef.current(), []);
  const onNewFolder = useCallback(() => setPendingNewFolder({ parent: "" }), []);
  // setNotePinned/duplicateNote close over fresh notes/session state each
  // render, but their consumers (the memo'd rows' pin toggle AND the
  // once-created native context menu) need ONE stable identity — so both are
  // read through latest-refs. Without this the native menu ran first-render
  // closures: `wasActive` was always false, so pinning the open note skipped
  // the flush+reopen and the next autosave silently wrote the pin away.
  const setNotePinnedRef = useRef(setNotePinned);
  const duplicateNoteRef = useRef(duplicateNote);
  useEffect(() => {
    setNotePinnedRef.current = setNotePinned;
    duplicateNoteRef.current = duplicateNote;
  });
  const onTogglePin = useCallback(
    (id: string, pinned: boolean) => void setNotePinnedRef.current(id, !pinned),
    [],
  );
  // Right-click a note row (or its ⋯ kebab) → a context menu. Native OS menu in
  // Tauri; the themed in-app ContextMenu in the web/demo build. Both are thin
  // dispatchers over the SAME handlers; "Delete" routes through the confirm
  // modal exactly like :rm.
  const openNoteMenu = useCallback(
    (id: string, title: string, pinned: boolean, x: number, y: number) => {
      if (!isTauri()) {
        setNoteMenu({ id, title, pinned, x, y });
        return;
      }
      void showNoteContextMenu(id, title, pinned, {
        onOpen: openNote,
        onReveal: revealNote,
        onDuplicate: (nid) => void duplicateNoteRef.current(nid),
        onMove: requestMove,
        onRename: requestRename,
        onTogglePin: (nid, next) => void setNotePinnedRef.current(nid, next),
        onDelete: requestDelete,
      });
    },
    // revealNote only captures the stable `flash`; the state-reading handlers go
    // through the latest-refs above, so this memo can never serve stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openNote, requestMove, requestRename, requestDelete],
  );
  const closeNoteMenu = useCallback(() => {
    setNoteMenu(null);
    setRefocus((r) => r + 1); // like every other overlay closer — don't strand focus on <body>
  }, []);
  // Commit a sidebar drag (or a handle double-click reset) into config — the
  // live drag already wrote the CSS var, so this just persists + re-renders once.
  const onSidebarResize = useCallback(
    (w: number) => setCfg((c) => ({ ...c, sidebarWidth: clampSidebarWidth(w) })),
    [],
  );

  // Pinned state of the open note — drives which of Pin/Unpin the palette offers.
  // Memoized so the O(notes) lookup runs when the list or the active note
  // changes, not on every unrelated re-render (a toast, a settings tweak).
  const activePinned = useMemo(
    () =>
      s.status === "note" && s.activeId
        ? (notes.find((n) => n.id === s.activeId)?.pinned ?? false)
        : false,
    [notes, s.activeId, s.status],
  );
  // Whether the open note lives in a folder — gates the folder-scoped commands
  // (renameFolder/deleteFolder act on the active note's folder).
  const activeInFolder = s.status === "note" && !!s.activeId && noteDir(s.activeId) !== "";
  const searchableCommands = useMemo(
    () =>
      withChordOverrides(
        paletteCommands.filter(
          (c) =>
            (!c.needsNote || s.status === "note") &&
            (c.needsPinned === undefined || c.needsPinned === activePinned) &&
            (c.needsFolder === undefined || c.needsFolder === activeInFolder),
        ),
        cfg.chords,
      ),
    [cfg.chords, s.status, activePinned, activeInFolder],
  );

  const titleText = s.title;
  const showEditor = s.status !== "empty";
  const vimSuffix = cfg.vimMode ? "v" : "t";

  return (
    <div className="av-desktop">
      <div className="av-window">
        <div className="av-titlebar" data-tauri-drag-region>
          {!isTauri() && <TrafficLights onCloseNote={() => s.activeId && session.quit()} />}
          <button
            className="av-iconbtn av-navtoggle"
            onClick={toggleNav}
            title={`toggle sidebar (${chordLabel("Mod-b")})`}
            aria-label="toggle sidebar"
          >
            <PanelLeft size={15} aria-hidden="true" />
          </button>
          <button
            className="av-iconbtn"
            onClick={() => openFinder("all")}
            title={`search (${chordLabel("Mod-p")})`}
            aria-label="search"
          >
            <Search size={15} aria-hidden="true" />
          </button>
          <button
            className="av-iconbtn"
            onClick={() => setNotebookSwitcherOpen(true)}
            title={`switch notebook (${chordLabel("Mod-o")})`}
            aria-label="switch notebook"
          >
            <Library size={15} aria-hidden="true" />
          </button>
          <button
            className="av-iconbtn"
            onClick={() => setCmdSearchOpen(true)}
            title={`commands (${chordLabel("Mod-Shift-P")})`}
            aria-label="commands"
          >
            <SquareChevronRight size={15} aria-hidden="true" />
          </button>
          {status === "ready" && (
            <button
              className="av-iconbtn"
              onClick={onNewNote}
              title={`new note (${chordLabel("Mod-n")})`}
              aria-label="new note"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          )}
          {(!navOpen || status !== "ready") && (
            // The sidebar (with its Settings button) is collapsed or not rendered —
            // keep a pointer path to Settings alive up here.
            <button
              className="av-iconbtn"
              onClick={openSettings}
              title="settings"
              aria-label="settings"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              {update?.kind === "available" && (
                <span className="av-update-dot" title="Update available" />
              )}
            </button>
          )}
          {!isTauri() && (
            <div className="av-title" data-tauri-drag-region>
              {titleText ? (
                <>
                  Noteside — {titleText}
                  {s.status === "note" && <span className="av-ext">.md</span>}
                </>
              ) : (
                "Noteside"
              )}
            </div>
          )}
        </div>

        <div className="av-body">
          {status === "ready" && (
            <Sidebar
              open={navOpen}
              rows={rows}
              activeId={s.activeId}
              onPick={openNote}
              onContext={openNoteMenu}
              onTogglePin={onTogglePin}
              onRename={requestRename}
              onToggleFolder={toggleFolder}
              onFolderContext={openFolderMenu}
              onDropNote={onDropNote}
              notebookName={notebookPath ? (notebookPath.split(/[\\/]/).pop() ?? null) : null}
              onSwitchNotebook={openNotebookSwitcher}
              onNew={onNewNote}
              onNewFolder={onNewFolder}
              onSettings={openSettings}
              updateAvailable={update?.kind === "available"}
              width={cfg.sidebarWidth}
              onResizeEnd={onSidebarResize}
            />
          )}
          <main className="av-main">
            {onboarding ? (
              <Onboarding onChoose={finishOnboarding} />
            ) : status === "boot" ? (
              <div className="av-empty">
                <div className="av-mark" aria-label="Noteside">
                  <span className="n">N</span>
                  <span className="cur" />
                </div>
              </div>
            ) : status === "no-notebook" ? (
              <NotebookPicker onPick={() => void pickNotebook()} />
            ) : showEditor ? (
              // Settings (chords/tabWidth/escMap) deliberately NOT in the key:
              // the editor reads them live through refs (a remount would lose
              // cursor + undo history and reseed from open-time text).
              <EditorBoundary>
                <Suspense fallback={null}>
                  <Editor
                    key={s.editorKey + ":" + vimSuffix}
                    notePath={s.activeId as string}
                    fileLabel={s.title ?? ""}
                    initialText={s.initialText}
                    savedText={s.savedText}
                    dirty={s.status === "note" ? s.dirty : undefined}
                    vimMode={cfg.vimMode}
                    cursorBlink={cfg.cursorBlink}
                    cursor={cfg.cursor}
                    tabWidth={cfg.tabWidth}
                    chordOverrides={cfg.chords}
                    escMap={cfg.escMap}
                    gotoLine={s.gotoLine}
                    notebookRoot={notebookPath ?? undefined}
                    refocusToken={refocus}
                    onChange={(text, dirty) => session.change(text, dirty)}
                    onSave={(text) => session.save(text)}
                    onQuit={() => session.quit()}
                    onCommand={onCommand}
                    onOpenUrl={onOpenUrl}
                    onNotify={(msg) => flash(msg, "error")}
                    onRegisterDispatch={(fn, alive) => {
                      if (alive) editorDispatchRef.current = fn;
                      else if (editorDispatchRef.current === fn) editorDispatchRef.current = null;
                    }}
                  />
                </Suspense>
              </EditorBoundary>
            ) : (
              <EmptyState
                hasClosed={!!s.lastNoteId}
                onReopen={() => session.reopenLast()}
                onNew={onNewNote}
                onFind={() => openFinder("all")}
                onCommands={() => setCmdSearchOpen(true)}
              />
            )}
            {toast && (
              <div
                className={"av-toast" + (toast.kind === "error" ? " is-error" : "")}
                role="status"
                aria-live="polite"
                title="dismiss"
                onClick={() => {
                  // selecting toast text (to copy an error) must not dismiss it
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed) return;
                  if (toastTimer.current !== null) {
                    window.clearTimeout(toastTimer.current);
                    toastTimer.current = null;
                  }
                  setToast(null);
                }}
              >
                {toast.msg}
              </div>
            )}
          </main>
        </div>

        {settingsOpen && (
          <SettingsPanel
            cfg={cfg}
            setCfg={setCfgPatch}
            update={update}
            onCheckUpdate={runUpdateCheck}
            onClose={closeSettings}
            onEditFile={openConfig}
            onShortcuts={() => {
              setSettingsOpen(false);
              setCheatsheetOpen(true);
            }}
            onPickTheme={() => {
              setSettingsOpen(false);
              setThemePickerOpen(true);
            }}
          />
        )}
        {themePickerOpen && (
          <ThemePicker
            current={cfg.theme}
            onCommit={(id) => setCfgPatch({ theme: id })}
            onClose={closeThemePicker}
          />
        )}
        {notebookSwitcherOpen && (
          <NotebookSwitcher
            current={notebookPath}
            onSwitch={(p) => void switchNotebook(p)}
            onOpenFolder={() => void pickAndSwitchNotebook()}
            onCreate={(parent, name) => void createNotebook(parent, name)}
            onClose={closeNotebookSwitcher}
          />
        )}
        {finder && (
          <Finder initialMode={finder.mode} onClose={closeFinder} onOpen={openFromFinder} />
        )}
        {paletteOpen && (
          <CommandPalette
            // Derived from the command table only while open (single source).
            actions={leaderCommands.map((c) => ({
              key: c.leader as string,
              label: c.title,
              hint: c.paletteHint,
              danger: c.danger,
              run: () => runPaletteCommand(c),
            }))}
            onClose={closePalette}
          />
        )}
        {cmdSearchOpen && (
          <CommandSearch
            commands={searchableCommands}
            onRun={runPaletteCommand}
            onClose={closeCmdSearch}
          />
        )}
        {cheatsheetOpen && (
          <Cheatsheet
            commands={cheatsheetCommands}
            overrides={cfg.chords}
            onSetOverrides={(chords) => setCfgPatch({ chords })}
            onClose={closeCheatsheet}
          />
        )}
        {noteMenu && (
          <ContextMenu
            x={noteMenu.x}
            y={noteMenu.y}
            onClose={closeNoteMenu}
            items={[
              { label: "Open", run: () => openNote(noteMenu.id) },
              {
                label: noteMenu.pinned ? "Unpin" : "Pin",
                run: () => void setNotePinned(noteMenu.id, !noteMenu.pinned),
              },
              { label: "Duplicate", run: () => void duplicateNote(noteMenu.id) },
              {
                label: "Move to folder…",
                run: () => requestMove(noteMenu.id, noteMenu.title),
              },
              { label: "Rename…", run: () => requestRename(noteMenu.id, noteMenu.title) },
              "sep",
              {
                label: "Delete",
                danger: true,
                run: () => requestDelete(noteMenu.id, noteMenu.title),
              },
            ]}
          />
        )}
        {pendingDelete && (
          <ConfirmDialog
            title={`Delete “${pendingDelete.title}”?`}
            message="This permanently removes the note file — it can't be undone."
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              const { id } = pendingDelete;
              setPendingDelete(null);
              void deleteNoteById(id);
            }}
            onCancel={() => {
              setPendingDelete(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingRename && (
          <PromptDialog
            title="Rename note"
            initialValue={pendingRename.title}
            placeholder="Note title"
            confirmLabel="Rename"
            onConfirm={(value) => {
              const { id } = pendingRename;
              setPendingRename(null);
              void renameNote(id, value);
            }}
            onCancel={() => {
              setPendingRename(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingMove && (
          <MovePicker
            title={pendingMove.title}
            currentDir={noteDir(pendingMove.id)}
            dirs={dirs}
            onMove={(dir) => {
              const { id } = pendingMove;
              setPendingMove(null);
              setRefocus((r) => r + 1);
              void moveNote(id, dir);
            }}
            onCreateFolder={onCreateFolder}
            onClose={() => {
              setPendingMove(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingDrop?.kind === "move" && (
          <ConfirmDialog
            title={`Move “${pendingDrop.title}” to ${pendingDrop.dir || "the notebook root"}?`}
            confirmLabel="Move"
            primary
            onConfirm={() => {
              const { id, dir } = pendingDrop;
              setPendingDrop(null);
              setRefocus((r) => r + 1);
              void moveNote(id, dir);
            }}
            onCancel={() => {
              setPendingDrop(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingDrop?.kind === "group" && (
          <PromptDialog
            title="New folder"
            message={`“${pendingDrop.title}” and “${pendingDrop.targetTitle}” move into it${
              noteDir(pendingDrop.targetId) ? `, inside ${noteDir(pendingDrop.targetId)}` : ""
            }.`}
            initialValue=""
            placeholder="Folder name"
            confirmLabel="Create & move"
            onConfirm={(value) => {
              const { id, targetId } = pendingDrop;
              setPendingDrop(null);
              setRefocus((r) => r + 1);
              if (!value.split("/").some((seg) => seg.trim())) {
                flash("folder name is empty", "error");
                return;
              }
              // The new folder lives beside the TARGET note (iOS-style: the
              // note you dropped onto "becomes" a folder in place).
              const parent = noteDir(targetId);
              void groupNotes([id, targetId], parent ? `${parent}/${value}` : value);
            }}
            onCancel={() => {
              setPendingDrop(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {folderMenu && (
          <ContextMenu
            x={folderMenu.x}
            y={folderMenu.y}
            onClose={closeFolderMenu}
            items={[
              { label: "New note here", run: () => void createNoteIn(folderMenu.dir) },
              {
                label: "New subfolder…",
                run: () => setPendingNewFolder({ parent: folderMenu.dir }),
              },
              {
                label: "Rename folder…",
                run: () => setPendingFolderRename({ dir: folderMenu.dir }),
              },
              "sep",
              { label: "Collapse all", run: collapseAll },
              { label: "Expand all", run: expandAll },
              "sep",
              {
                label: "Delete folder",
                danger: true,
                run: () => requestFolderDelete(folderMenu.dir),
              },
            ]}
          />
        )}
        {pendingNewFolder && (
          <PromptDialog
            title={
              pendingNewFolder.parent ? `New folder in ${pendingNewFolder.parent}` : "New folder"
            }
            initialValue=""
            placeholder="Folder name (a/b nests)"
            confirmLabel="Create"
            onConfirm={(value) => {
              const { parent } = pendingNewFolder;
              setPendingNewFolder(null);
              setRefocus((r) => r + 1);
              // A name made only of separators would sanitize down to the
              // parent and report "created" for a folder that already existed.
              if (!value.split("/").some((seg) => seg.trim())) {
                flash("folder name is empty", "error");
                return;
              }
              void createFolder(parent ? `${parent}/${value}` : value).then((rel) => {
                if (rel !== null) flash(`folder ${rel} created`);
              });
            }}
            onCancel={() => {
              setPendingNewFolder(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingFolderRename && (
          <PromptDialog
            title={`Rename folder ${pendingFolderRename.dir}`}
            initialValue={pendingFolderRename.dir.split("/").pop() ?? ""}
            placeholder="Folder name"
            confirmLabel="Rename"
            onConfirm={(value) => {
              const { dir } = pendingFolderRename;
              setPendingFolderRename(null);
              void renameFolder(dir, value);
            }}
            onCancel={() => {
              setPendingFolderRename(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
        {pendingFolderDelete && (
          <ConfirmDialog
            title={`Delete folder “${pendingFolderDelete.dir}”?`}
            message={
              pendingFolderDelete.count > 0
                ? `This permanently removes the folder and the ${pendingFolderDelete.count} ${
                    pendingFolderDelete.count === 1 ? "note" : "notes"
                  } inside it — it can't be undone.`
                : "This permanently removes the (empty) folder."
            }
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              const { dir } = pendingFolderDelete;
              setPendingFolderDelete(null);
              void deleteFolder(dir);
            }}
            onCancel={() => {
              setPendingFolderDelete(null);
              setRefocus((r) => r + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
