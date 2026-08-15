// code-block.ts — fenced code blocks with lowlight highlighting, a language
// label, and a copy button (the CM block-preview affordances, reborn as a
// plain-DOM NodeView — no per-node React).
//
// Languages load LAZILY: each allowlisted highlight.js grammar is its own
// dynamic import, so vite emits it as a separate chunk (the successor of the
// CM-era codeLanguages contract — offline-safe, off the editor chunk). When a
// grammar lands, every code block is nudged with a same-attrs setNodeMarkup —
// a doc-changed transaction the lowlight plugin recomputes decorations for,
// but one that is content-neutral: doc.eq(saved) still holds, so it can never
// dirty the buffer, and addToHistory:false keeps undo clean.
import type { Editor } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";

export const lowlight = createLowlight();

// The allowlist keeps rollup's chunk fan-out finite (a template-string import
// would emit all ~190 grammars). Extend freely; each line is one lazy chunk.
const LOADERS: Record<string, () => Promise<{ default: Parameters<typeof lowlight.register>[1] }>> =
  {
    bash: () => import("highlight.js/lib/languages/bash"),
    c: () => import("highlight.js/lib/languages/c"),
    cpp: () => import("highlight.js/lib/languages/cpp"),
    csharp: () => import("highlight.js/lib/languages/csharp"),
    css: () => import("highlight.js/lib/languages/css"),
    diff: () => import("highlight.js/lib/languages/diff"),
    dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
    go: () => import("highlight.js/lib/languages/go"),
    graphql: () => import("highlight.js/lib/languages/graphql"),
    ini: () => import("highlight.js/lib/languages/ini"),
    java: () => import("highlight.js/lib/languages/java"),
    javascript: () => import("highlight.js/lib/languages/javascript"),
    json: () => import("highlight.js/lib/languages/json"),
    kotlin: () => import("highlight.js/lib/languages/kotlin"),
    lua: () => import("highlight.js/lib/languages/lua"),
    makefile: () => import("highlight.js/lib/languages/makefile"),
    markdown: () => import("highlight.js/lib/languages/markdown"),
    perl: () => import("highlight.js/lib/languages/perl"),
    php: () => import("highlight.js/lib/languages/php"),
    python: () => import("highlight.js/lib/languages/python"),
    r: () => import("highlight.js/lib/languages/r"),
    ruby: () => import("highlight.js/lib/languages/ruby"),
    rust: () => import("highlight.js/lib/languages/rust"),
    scss: () => import("highlight.js/lib/languages/scss"),
    shell: () => import("highlight.js/lib/languages/shell"),
    sql: () => import("highlight.js/lib/languages/sql"),
    swift: () => import("highlight.js/lib/languages/swift"),
    typescript: () => import("highlight.js/lib/languages/typescript"),
    xml: () => import("highlight.js/lib/languages/xml"),
    yaml: () => import("highlight.js/lib/languages/yaml"),
  };

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  zsh: "bash",
  console: "shell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  "c++": "cpp",
  cs: "csharp",
  golang: "go",
  yml: "yaml",
  toml: "ini",
  html: "xml",
  htm: "xml",
  svg: "xml",
  md: "markdown",
  patch: "diff",
  dsconfig: "ini",
};

const loading = new Set<string>();

function canonical(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  return ALIASES[lower] ?? lower;
}

/** Kick the lazy grammar load for `lang`; `onReady` fires once registered. */
function ensureLanguage(lang: string | null | undefined, onReady: () => void): void {
  const canon = canonical(lang);
  if (!canon || loading.has(canon) || lowlight.registered(canon)) return;
  const load = LOADERS[canon];
  if (!load) return; // unknown language — renders unhighlighted, still correct
  loading.add(canon);
  load()
    .then((mod) => {
      lowlight.register(canon, mod.default);
      onReady();
    })
    .catch(() => {
      /* offline chunk-load failure: plain text is fine */
    })
    .finally(() => loading.delete(canon));
}

/** Content-neutral nudge so the lowlight plugin recomputes decorations. */
function refreshCodeBlocks(editor: Editor, typeName: string): void {
  if (editor.isDestroyed) return;
  const { state, view } = editor;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name === typeName) tr.setNodeMarkup(pos, undefined, { ...node.attrs });
  });
  if (!tr.steps.length) return;
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

export const NsCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    const typeName = this.name;
    return ({ node, editor }) => {
      const dom = document.createElement("pre");
      dom.className = "av-codeblock";

      const lang = document.createElement("span");
      lang.className = "av-code-lang";
      lang.contentEditable = "false";

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "av-code-copy";
      copy.textContent = "copy";
      copy.title = "copy code";
      copy.contentEditable = "false";
      // preventDefault keeps the editor focused (Chromium focuses buttons on
      // click); stopPropagation keeps ProseMirror's root mouse handling from
      // node-selecting the block — the selectednode decoration would RECREATE
      // this NodeView mid-click and wipe the button's feedback state.
      copy.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      let copiedTimer: ReturnType<typeof setTimeout> | null = null;
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(code.textContent ?? "");
        copy.classList.add("is-copied");
        copy.textContent = "copied";
        if (copiedTimer !== null) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copy.classList.remove("is-copied");
          copy.textContent = "copy";
          copiedTimer = null;
        }, 1200);
      });

      const code = document.createElement("code");
      dom.append(lang, copy, code);

      const apply = (n: typeof node) => {
        const language = (n.attrs.language as string | null) ?? "";
        lang.textContent = language;
        ensureLanguage(language, () => refreshCodeBlocks(editor, typeName));
      };
      apply(node);

      return {
        dom,
        contentDOM: code,
        // Keep ProseMirror's mouse handling off the (non-editable) chrome.
        stopEvent(e: Event) {
          const t = e.target as globalThis.Node | null;
          return !!t && (copy.contains(t) || lang.contains(t));
        },
        // The chrome mutates itself (label text, the copied flash) — without
        // this, PM's DOM observer sees those as unexpected mutations and
        // REDRAWS the whole NodeView, wiping the state it just set.
        ignoreMutation(m: MutationRecord | { type: "selection"; target: globalThis.Node }) {
          return !code.contains(m.target);
        },
        update(n) {
          if (n.type.name !== typeName) return false;
          apply(n);
          return true;
        },
        destroy() {
          if (copiedTimer !== null) clearTimeout(copiedTimer);
        },
      };
    };
  },
}).configure({ lowlight });
