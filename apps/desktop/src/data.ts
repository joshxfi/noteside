// data.ts — the note "notebook". Each note carries a path, git status and a
// frecency score so the fuzzy finder has something real to rank and annotate.
//
// This is the in-memory seed used by the prototype/demo. When the Rust backend
// lands, these come from scanning the user's notebook folder (Markdown files +
// frontmatter) and git status; the shape stays the same.

import type { Note } from "./types";

export const NOTES: Note[] = [
  {
    id: "welcome",
    title: "Welcome to Noteside",
    path: "welcome.md",
    tag: "start here",
    updated: "just now",
    git: null,
    frecency: 96,
    body: `Noteside is a notebook for keyboard people.

No mouse required, nothing in your way — just a warm page and a
blinking block cursor. Your hands stay on home row; the writing stays
in front of you.

It opens in NORMAL mode, the same as vim. Press i to start typing,
Esc to step back out. Move with h j k l. When you want to do something
to the whole document — save it, jump to a line, search — press : or /
and a quiet command line appears at the foot of the page.

Everything lives on this machine. Nothing leaves it. Close the lid and
your words are still here, exactly where the cursor left them.

Press j to read on, or open [[Keymap]] for the full set of motions.
Notes link to each other: type [[ to autocomplete a note's name, and
press gf on a link like [[Roadmap — Q3]] to follow it.`,
  },
  {
    id: "keymap",
    title: "Keymap",
    path: "keymap.md",
    tag: "reference",
    updated: "2h ago",
    git: null,
    frecency: 88,
    body: `MODES
  i  insert before cursor        a  insert after cursor
  I  insert at line start        A  insert at line end
  o  open line below             O  open line above
  v  visual (select)             Esc  back to normal

MOVE
  h j k l   left down up right
  w  next word    b  prev word    e  word end
  0  line start   ^  first word   $  line end
  gg top of note  G  bottom

EDIT
  x  delete char      dd  delete line     dw  delete word
  D  delete to end     r  replace a char   p  paste
  u  undo

COMMAND LINE   (press : )
  :w   save        :q   close note
  :wq  save + close    :42  jump to line 42
  :set  settings     :nav  toggle sidebar
  :find  find files    :grep  search contents

SEARCH   (press / )
  /word  find        n  next match     N  previous

Counts work too: 3j moves down three lines, 5x deletes five chars.`,
  },
  {
    id: "morning",
    title: "Morning pages",
    path: "journal/morning-pages.md",
    tag: "journal",
    updated: "yesterday",
    git: "modified",
    frecency: 71,
    body: `The kettle is the first thing awake in the house. I like the few
minutes before it boils, when nothing is asked of me yet.

Today I want to write without steering. Three pages, longhand-speed,
no backspacing to fix a clumsy phrase. The point is the motion, not
the polish — keep the pen moving and the cursor moving with it.

Things on my mind, loosely: the letter I keep meaning to answer, the
soup I want to make again, whether the fig tree survived the frost.
None of it urgent. All of it mine.`,
  },
  {
    id: "thursday",
    title: "Thursday",
    path: "journal/2026-06-11.md",
    tag: "journal",
    updated: "4d ago",
    git: null,
    frecency: 44,
    body: `Walked the long way to clear my head before the afternoon got loud.

Two small wins: finally answered the letter, and the fig tree has new
leaves after all. Frost bluffed.

Note to self — protect the first hour. Everything good today happened
before the inbox opened.`,
  },
  {
    id: "lighthouse",
    title: "Project — Lighthouse",
    path: "work/lighthouse.md",
    tag: "work",
    updated: "3d ago",
    git: "modified",
    frecency: 82,
    body: `A small writing tool that respects the keyboard. Quiet by default,
powerful when summoned.

Principles
  - The page is the interface. Everything else earns its place or disappears.
  - Every action has a key. The mouse is a guest, not the host.
  - Local first. Your notes are files, not someone else's database.

This week
  - Settle the command line behaviour for :w and :q
  - Decide whether search highlights stay lit or fade
  - Write the onboarding note (done — see Welcome)

Someday
  - Linked notes, the way thoughts actually connect
  - A focus mode that dims everything but the line you're on`,
  },
  {
    id: "meeting",
    title: "Sync — design review",
    path: "work/meeting-notes.md",
    tag: "work",
    updated: "1d ago",
    git: "untracked",
    frecency: 38,
    body: `Attendees: me, the rubber duck.

Decisions
  - Finder gets a preview pane on the right, prompt on top.
  - Match highlighting uses the accent, never a fill.
  - Git status shows as a single quiet letter, not a badge.

Open questions
  - Do we surface frecency in the list, or keep it invisible ranking?
  - Should grep jump straight to the matched line on open? (yes)

Follow up
  - Wire the keyboard: arrows + Ctrl-n/p to move, Tab to switch mode.`,
  },
  {
    id: "roadmap",
    title: "Roadmap — Q3",
    path: "work/roadmap.md",
    tag: "work",
    updated: "1w ago",
    git: "staged",
    frecency: 51,
    body: `Now
  - Fuzzy file finder over the notebook (this).
  - Plain-text mode for people who don't know vim.

Next
  - Linked notes and backlinks.
  - A focus mode: dim everything but the current line.

Later
  - Sync, maybe. Local-first stays the default either way.
  - Export to plain folders of Markdown — your files, your disk.`,
  },
  {
    id: "figjam",
    title: "Fig & vanilla jam",
    path: "recipes/fig-jam.md",
    tag: "recipe",
    updated: "2w ago",
    git: null,
    frecency: 22,
    body: `For when the tree gives more than you can eat fresh.

  - 1kg figs, quartered
  - 600g sugar
  - juice of one lemon
  - half a vanilla pod, seeds scraped

Macerate overnight. Cook low until it sheets off the spoon, skim the
foam, jar while hot. Tastes like the end of summer.`,
  },
  {
    id: "names",
    title: "Name ideas",
    path: "ideas/names.md",
    tag: "ideas",
    updated: "3w ago",
    git: "untracked",
    frecency: 17,
    body: `Working list for the writing tool. Say each one out loud.

  - Noteside  ← keeping this
  - Margin
  - Quill & Key
  - Homerow
  - Inkwell

Test: does it sound calm? Does it fit in a menu bar? Would a keyboard
person trust it with three years of notes?`,
  },
];
