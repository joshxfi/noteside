<p align="center">
  <img src="assets/logo.png" alt="Noteside" width="116" />
</p>

<h1 align="center">Noteside</h1>

<p align="center">
  <strong>Notes for keyboard people.</strong><br/>
  An offline notebook you drive entirely from the keyboard — vim keybindings, or the conventional shortcuts you already know. Your notes stay as plain Markdown files on your disk.
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
    <img src="assets/screenshot.png" alt="Noteside — the editor in NORMAL mode, with the note sidebar and live status bar" width="840" />
  </picture>
</p>

---

## Install

Download for **macOS, Windows, or Linux** from **[noteside.app](https://noteside.app)** —
or grab a build directly from
[GitHub Releases](https://github.com/joshxfi/noteside/releases/latest).

Builds aren't code-signed yet, so the OS shows a one-time warning on first launch —
the app isn't broken, your system just can't verify an unsigned download:

- **macOS** reports the app as _"damaged."_ Drag **Noteside** into `/Applications`,
  then clear the quarantine flag once:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Noteside.app
  ```
- **Windows** — click **More info → Run anyway** on the SmartScreen prompt.

Full walkthrough: **[Getting started](https://docs.noteside.app/getting-started)**.

## Documentation

Everything lives at **[docs.noteside.app](https://docs.noteside.app)**:

- [Getting started](https://docs.noteside.app/getting-started) — install, open a notebook, your first note
- [Keybindings](https://docs.noteside.app/keybindings) — vim + conventional chords, and remapping them
- [Search](https://docs.noteside.app/search) — fuzzy file finder and line-level content grep
- [Live preview](https://docs.noteside.app/live-preview) — inline Markdown that hides markup off the cursor line
- [Configuration](https://docs.noteside.app/configuration) — `~/.notesiderc`, themes, and settings
- [Performance](https://docs.noteside.app/performance) — how it stays fast at scale

## Contributing

Issues and PRs are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for prerequisites,
the dev/build commands, the project layout, and the conventions.

## License

[MIT](LICENSE) © Noteside — built by Josh Daniel
