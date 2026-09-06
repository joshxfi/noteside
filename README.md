<p align="center">
  <img src="assets/logo.png" alt="Noteside" width="116" />
</p>

<h1 align="center">Noteside</h1>

<p align="center">
  An offline notes app that writes plain Markdown files. Edit in blocks, reach every command with the mouse or the keyboard, and turn on vim keys if you want them.
</p>

<p align="center">
  <a href="https://github.com/joshxfi/noteside/releases"><img alt="GitHub downloads" src="https://img.shields.io/github/downloads/joshxfi/noteside/total?logo=github&logoColor=white&label=downloads&color=a05e7e"></a>
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-a05e7e"></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-dea584?logo=rust&logoColor=white">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot-dark.png" />
    <img src="assets/screenshot.png" alt="Noteside: the editor with the note sidebar and status bar" width="840" />
  </picture>
</p>

---

## Install

Download for **macOS, Windows, or Linux** from **[noteside.app](https://noteside.app)**,
or grab a build directly from
[GitHub Releases](https://github.com/joshxfi/noteside/releases/latest).

Builds aren't code-signed yet, so the OS shows a one-time warning on first launch. The app
isn't broken; your system just can't verify an unsigned download.

- **macOS** reports the app as _"damaged."_ Drag **Noteside** into `/Applications`,
  then clear the quarantine flag once:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Noteside.app
  ```
- **Windows** shows a SmartScreen prompt. Click **More info → Run anyway**.

Full walkthrough: **[Getting started](https://docs.noteside.app/getting-started)**.

## Documentation

Everything lives at **[docs.noteside.app](https://docs.noteside.app)**:

- [Getting started](https://docs.noteside.app/getting-started). Install, open a notebook, write your first note.
- [Editor](https://docs.noteside.app/editor). Tables, code blocks, callouts, math, and images as blocks you edit in place. The file on disk stays plain Markdown.
- [Folders](https://docs.noteside.app/folders). Real subdirectories, collapsible sidebar groups, the move picker, drag-and-drop.
- [Keybindings](https://docs.noteside.app/keybindings). Conventional chords, the vim subset, and how to remap either.
- [Search](https://docs.noteside.app/search). Fuzzy file finder and line-level content grep.
- [Configuration](https://docs.noteside.app/configuration). `~/.notesiderc`, themes, and settings.
- [Performance](https://docs.noteside.app/performance). What keeps it fast at 50,000 notes.

## Contributing

Issues and PRs are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for prerequisites,
the dev/build commands, the project layout, and the conventions.

## License

[MIT](LICENSE) © Noteside. Built by Josh Daniel.
