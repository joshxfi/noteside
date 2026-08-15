// markdown-io.ts — the pure text seam between on-disk markdown and the block
// editor. The editor never sees frontmatter (lezer-era live preview HID it; the
// block editor simply never parses it): the leading `---` block is split off
// verbatim here and re-attached byte-identically on serialize, so everything
// Rust reads out of it (title:/tags:/pinned:) survives every save untouched.
//
// Line endings are the other half of the contract: the editor works in LF, but
// Rust's surgical rewrites (set_pinned/retitle) and the watcher's disk-verified
// echo suppression assume a save doesn't churn the file's own endings. A CRLF
// file is detected on load and re-emitted as CRLF; the presence or absence of a
// final trailing newline is preserved the same way.
//
// CodeMirror-free AND ProseMirror-free — plain strings, node-testable.
import { scanFrontmatter } from "../markdown";

export interface NoteIO {
  /** The leading `---` block, verbatim (LF form, including the newline after the
   *  closing fence), or "" when the note has none. */
  frontmatter: string;
  /** Source lines the frontmatter occupies, fences included (0 when none) —
   *  gotoLine targets from grep hits are offsets past this. */
  frontmatterLines: number;
  /** LF-normalized body handed to the editor. */
  body: string;
  /** The file used CRLF endings; re-applied on join. */
  crlf: boolean;
  /** The file ended with a newline; preserved on join. */
  trailingNewline: boolean;
}

/** Split disk text into the verbatim frontmatter prefix + the editable body. */
export function splitNote(text: string): NoteIO {
  const crlf = text.includes("\r\n");
  const lf = crlf ? text.replaceAll("\r\n", "\n") : text;
  const trailingNewline = lf.endsWith("\n");
  const lines = lf.split("\n");
  // split("\n") yields a final "" entry for a trailing newline — that empty tail
  // is an artifact of the split, not a source line. The body therefore never
  // carries the final newline; joinNote restores it from `trailingNewline`.
  if (trailingNewline) lines.pop();
  const fm = scanFrontmatter(lines);
  if (!fm) {
    return {
      frontmatter: "",
      frontmatterLines: 0,
      body: lines.join("\n"),
      crlf,
      trailingNewline,
    };
  }
  const frontmatterLines = fm.toLine + 1;
  const frontmatter = lines.slice(0, frontmatterLines).join("\n") + "\n";
  const body = lines.slice(frontmatterLines).join("\n");
  return { frontmatter, frontmatterLines, body, crlf, trailingNewline };
}

/** Re-attach the held frontmatter to a (possibly re-serialized) body and restore
 *  the file's own line-ending + trailing-newline shape. The serializer never
 *  emits a final newline (any trailing "\n"s in `body` are real blank lines),
 *  so the terminator is APPENDED — except for a frontmatter-only file, whose
 *  held block already ends with it. */
export function joinNote(
  io: Pick<NoteIO, "frontmatter" | "crlf" | "trailingNewline">,
  body: string,
): string {
  let out = io.frontmatter + body;
  if (io.trailingNewline) {
    if (body !== "" || io.frontmatter === "") out += "\n";
  } else if (out.endsWith("\n")) {
    out = out.slice(0, -1);
  }
  return io.crlf ? out.replaceAll("\n", "\r\n") : out;
}
