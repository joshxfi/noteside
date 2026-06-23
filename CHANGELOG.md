## [1.1.0](https://github.com/joshxfi/noteside/compare/v1.0.0...v1.1.0) (2026-06-23)

### Features

* **desktop:** detect a genuine first launch (isFirstLaunch helper) ([382c67e](https://github.com/joshxfi/noteside/commit/382c67e506ece9e42cd9fa61b23e60cfcb65ede8))
* **desktop:** first-launch vim vs. plain-keyboard onboarding choice ([4884aae](https://github.com/joshxfi/noteside/commit/4884aae4c3254aec2ace3811365e74ba7652ba31))
* **landing:** one-click downloads for the visitor's OS ([3876bf0](https://github.com/joshxfi/noteside/commit/3876bf09a8cebf640a39b226ee4e826754ab009e))

### Polish

* **desktop:** tighten onboarding focus, copy, and CSS ([6b61006](https://github.com/joshxfi/noteside/commit/6b610061c9364832bfb3ea5e666942006d5fdb1c))
* **desktop:** trim onboarding hint to arrows + confirm ([e734436](https://github.com/joshxfi/noteside/commit/e734436e4dec2af99535d11ce94f87ed6c1a5090))
* **landing:** tidy the hero download CTA, hide demo on mobile ([12183ae](https://github.com/joshxfi/noteside/commit/12183ae36412eb7e198293c85db6aaeb6b118cb1))

### Documentation

* explain the macOS "damaged" Gatekeeper warning on first launch ([39dea52](https://github.com/joshxfi/noteside/commit/39dea521ef1e4eef8d5fabbbaae7da67629ec1b6))

## 1.0.0 (2026-06-18)

### Features

* **a11y:** visible keyboard focus ring + reduced-motion support ([6ce8a90](https://github.com/joshxfi/noteside/commit/6ce8a90b16e0e28662e840b98510de8aa895daeb))
* **desktop:** add a monochrome accent option ([dd605f1](https://github.com/joshxfi/noteside/commit/dd605f181776f1a1cec9872e93c9b19e0244ede5))
* **desktop:** add Liquid Glass icon bundle for macOS 26 (Icon Composer) ([3240ded](https://github.com/joshxfi/noteside/commit/3240dedac18ad19e5ea44f3a69b3cbb55d3ef352))
* **desktop:** app icon uses the canonical mark on the macOS icon grid ([e589627](https://github.com/joshxfi/noteside/commit/e5896279850819b8ab8fbb49f4e9dcfd7d34127b))
* **desktop:** brand app icon + sidebar wordmark cursor ([f302666](https://github.com/joshxfi/noteside/commit/f302666f7d3d64ce996d516e93c75023cb23c33c))
* **desktop:** brand the vault picker with the Noteside wordmark ([4989e3c](https://github.com/joshxfi/noteside/commit/4989e3c4160e3ab4ffad6be0d26250ac38b31dd2))
* **desktop:** bundle fonts locally for offline use ([5ff1c47](https://github.com/joshxfi/noteside/commit/5ff1c473c6cb1868e96cfc56715c3110eb9a1900))
* **desktop:** CodeMirror 6 vim editor + backend-wired UI ([9e11efb](https://github.com/joshxfi/noteside/commit/9e11efbfc238737de53aa4c8c6cb4a6705ca8ef6))
* **desktop:** enforce single instance ([a8a0dc6](https://github.com/joshxfi/noteside/commit/a8a0dc6e8cfb52b051c60a28ef1efcd0121eff27))
* **desktop:** files-as-truth Rust vault backend ([ef3737b](https://github.com/joshxfi/noteside/commit/ef3737bb6fdb801a8bbe44f238952c5e4f48dbfc))
* **desktop:** first-class keyboard shortcuts for non-vim users ([4184009](https://github.com/joshxfi/noteside/commit/4184009938a9cfddbd31cb3eaa4966a68decf8d7))
* **desktop:** in-note find (Mod-f) for non-vim users ([cec27e4](https://github.com/joshxfi/noteside/commit/cec27e439301c46b941dd957b14cce2f21650f5f))
* **desktop:** inline live-preview (Obsidian-style markdown rendering) ([70d6f56](https://github.com/joshxfi/noteside/commit/70d6f566ab1759bd6601f7d0446c98dbedccfe70))
* **desktop:** leader command palette + ex-commands + hlsearch ([539f839](https://github.com/joshxfi/noteside/commit/539f839f082eeb5ca1a67952d522f3e4505d7ba0))
* **desktop:** logo-tile picker + rename vault->notebook in UI ([1b25841](https://github.com/joshxfi/noteside/commit/1b25841e9ad64fbd789474a850b65533253d2aae))
* **desktop:** persist user keymaps in ~/.notesiderc ([403e4c2](https://github.com/joshxfi/noteside/commit/403e4c2681e3d8666fda2adc71ec1ed46d0c3dc9))
* **desktop:** round the native window corners ([16a6c73](https://github.com/joshxfi/noteside/commit/16a6c7346f9e17b9be8552ee650e4b1de4b0c3e9))
* **desktop:** unified finder — search files + content by default ([60b20d7](https://github.com/joshxfi/noteside/commit/60b20d7839be3d6eb3412446f8b7ec740157735f))
* **desktop:** vim-first notes app on Tauri 2 + React 19 ([24df29e](https://github.com/joshxfi/noteside/commit/24df29ee13a40e2b22ced62ffa60a892ac8f7a0f))
* **desktop:** watch vault for external changes ([d226392](https://github.com/joshxfi/noteside/commit/d2263922ff2c41711e5f42b98e8aba47b27f955c))
* **desktop:** wikilinks + backlinks ([[links]], autocomplete, gf, panel) ([d369647](https://github.com/joshxfi/noteside/commit/d36964701f3f552f5a086f66a4faf02d762f8c41))
* **docs:** add Fumadocs documentation site ([ea36969](https://github.com/joshxfi/noteside/commit/ea36969e84e999105009e597a5db9c8fd7f9df93))
* **finder:** Home/End/PageUp/PageDown navigation + listbox ARIA ([ba47cda](https://github.com/joshxfi/noteside/commit/ba47cdac226df821360ae23d8d8f2138f64e6a0d))
* **help:** discoverable shortcuts link in Settings; clickable cheatsheet close; legible "Esc" hints ([9b9e54f](https://github.com/joshxfi/noteside/commit/9b9e54f6dd3267daf2e93f8fbf019219e541af7a))
* **keys:** close, reopen, follow, search-nav & note-stepping chords + sidebar ARIA ([5603935](https://github.com/joshxfi/noteside/commit/5603935e2fa7fb3dda1f6d5a8eceaaf25a72b051))
* **keys:** in-app shortcut editor (editable cheatsheet) + declutter Settings footer ([e0c7995](https://github.com/joshxfi/noteside/commit/e0c79959c274d870e7bee19fae6767bebc0ca7a6))
* **landing,docs:** surface the performance story — native, in-memory, the numbers ([424e15f](https://github.com/joshxfi/noteside/commit/424e15f404b7bd6628205290c0d7f24ba16668a2))
* **landing:** brand logo + brand guide page ([c9e4889](https://github.com/joshxfi/noteside/commit/c9e48892c2d65eb2026d71f3c3d123ff566408b3))
* **landing:** marketing site with embedded live demo ([640ef6c](https://github.com/joshxfi/noteside/commit/640ef6c7e4ecb2610d6037ad72d8a3d82240e2f4))
* **landing:** remove theme toggle (light-only, matches the design) ([d3ef656](https://github.com/joshxfi/noteside/commit/d3ef656b66336e8e47638cc9015b94250657270a))
* **search:** finder matches note titles + previews from the in-memory cache ([0b4947e](https://github.com/joshxfi/noteside/commit/0b4947ec8decfe8820558800d11a0fe4df298926))
* **seo:** landing + docs SEO, OG cards, cross-links, and attribution ([f2d62e2](https://github.com/joshxfi/noteside/commit/f2d62e26070fc0a93720f2bd47880c13c3fdf4ef))
* **settings:** interface-size scale for the UI chrome (editor stays immune) ([2f9aa01](https://github.com/joshxfi/noteside/commit/2f9aa017b6567160a097a12cba7840e7822abcb9))
* **settings:** relative line numbers toggle, defaulting to absolute ([41d5323](https://github.com/joshxfi/noteside/commit/41d53234385b3a7419e772ab4bb1f8f00fc83f07))

### Bug Fixes

* **a11y:** finder combobox aria-activedescendant; aria-current=page; tidy ([00e8c51](https://github.com/joshxfi/noteside/commit/00e8c51c38dcb9b351baa43a8065e7bd42dfc811))
* address final-audit findings across docs, landing, and repo ([3feb18a](https://github.com/joshxfi/noteside/commit/3feb18a8be2d04b87355ee061eecc4b28437b47f))
* **brand:** match the app icon + logo to the brand guide (Newsreader mark) ([4ce4fa7](https://github.com/joshxfi/noteside/commit/4ce4fa72a93ebfd0059f77cf88054d776b5a6505))
* **deps:** bump esbuild under Vite 7 to clear the npm audit ([cbf79df](https://github.com/joshxfi/noteside/commit/cbf79df58f85b58c7c1b0a97f5eb8dc5ea2c6fcd))
* **desktop:** bind autosave to its note; harden watcher + grep ([fb2d123](https://github.com/joshxfi/noteside/commit/fb2d12331ec809d9ddbdeb2e288803eac9a790d5))
* **desktop:** guard EditingSession against out-of-order open()/reconcile races ([3cb4026](https://github.com/joshxfi/noteside/commit/3cb4026c3e78440510fa7266074fe997daa836b1))
* **desktop:** hide the vim block cursor while a command or overlay is focused ([ea76ce3](https://github.com/joshxfi/noteside/commit/ea76ce35dc5423cf39035641331799b76f822a7e))
* **desktop:** Mod-f toggles the find panel (closes it if open) ([c953623](https://github.com/joshxfi/noteside/commit/c9536238681687ffdf5b8f2e1c30c85e8a4d02be))
* **desktop:** no active-line band over a visual-mode selection ([7ae1a49](https://github.com/joshxfi/noteside/commit/7ae1a49a0d4403888ee84260f51bd919756c6d0a))
* **desktop:** replace sidebar Unicode glyphs with crisp inline SVG icons ([3415e33](https://github.com/joshxfi/noteside/commit/3415e33f98b2315b8b97c206997744e2650e6a6c))
* **desktop:** selection showed CodeMirror's default lavender, not the theme color ([94437c3](https://github.com/joshxfi/noteside/commit/94437c316bafb73ffc121d3c47caa7dfd5dc4105)), closes [#d7d4f0](https://github.com/joshxfi/noteside/issues/d7d4f0)
* **desktop:** stop the native selection bleeding across the editor ([8685b27](https://github.com/joshxfi/noteside/commit/8685b27123afcfc61b912905a3186cc7840b07c0))
* **desktop:** vim cursor accent, single status bar, larger fonts ([ecabd9f](https://github.com/joshxfi/noteside/commit/ecabd9ff561992914f9ee1bb0d1004496218f2ca)), closes [#ff9696](https://github.com/joshxfi/noteside/issues/ff9696)
* **desktop:** wire insert-escape mapping (e.g. jj) to the editor ([a7045cb](https://github.com/joshxfi/noteside/commit/a7045cbb76e1c25a4fd352649d0f7c69b9364c08))
* **keys:** apply chord rebinds to the open editor live (CM compartment) ([b255b26](https://github.com/joshxfi/noteside/commit/b255b26b8bc66d93022ccd2c213ef7ae3931eb87))
* **keys:** review fixes — live aria-labels, no redundant overrides, single tab-stop ([8ad3c05](https://github.com/joshxfi/noteside/commit/8ad3c05acf921757235bfa38a74c24dafe2009a8))
* **keys:** wire F3/Shift-F3 into the command table (search-nav was orphaned) ([3b98b9c](https://github.com/joshxfi/noteside/commit/3b98b9c9adf776fd4ae3be131fc1ded4670e92d7))
* **security:** restrict note IPC to .md paths inside the notebook ([c3922a2](https://github.com/joshxfi/noteside/commit/c3922a25da4767a09d68dcae3a1e0be01adedd6d))
* **settings:** config is persisted — correct the panel copy ([e48cbc6](https://github.com/joshxfi/noteside/commit/e48cbc6fd740684d6f471b194cdc4d34f4e377a7))
* **tauri:** bundle identifier no longer ends in .app ([cbf9f5c](https://github.com/joshxfi/noteside/commit/cbf9f5cfffa07135a6ba5f91ae3cbb9d728de1ac))
* **ui-scale:** ellipsis sidebar titles at scale; symmetric stepper clamp ([effac46](https://github.com/joshxfi/noteside/commit/effac46c5933d9c76025d8405bf2f7c67a7cbb1a))

### Performance

* **desktop:** benchmark harness + baseline numbers ([e6e59db](https://github.com/joshxfi/noteside/commit/e6e59db59b6c2c73e673d534edcc9a098172fe32))
* **desktop:** first performance pass — lazy autosave, off-mutex search, blocking workers ([4f60afa](https://github.com/joshxfi/noteside/commit/4f60afa25e37d0ec1fa33f61769f4a05581a0015))
* **desktop:** move the backlinks scan into Rust (indexed, off the JS thread) ([b985dbe](https://github.com/joshxfi/noteside/commit/b985dbe5cdc9c514538914fbb70beb9c622c1cec))
* **desktop:** split editor/react vendor chunks ([aca96ae](https://github.com/joshxfi/noteside/commit/aca96ae857fd8edad5b09c07ca9a8b80452fccf2))
* **desktop:** virtualize the sidebar list for large notebooks ([a0441fa](https://github.com/joshxfi/noteside/commit/a0441fae638b4bd999bd9489a944294945e1e483))
* **editor:** debounced exact dirty check; cancel autosave on revert-to-saved ([428b189](https://github.com/joshxfi/noteside/commit/428b1896443242769c17949b33b89f5b57ade36f))

### Polish

* **copy:** drop the 'local-first, keyboard-first' stutter — use 'offline & keyboard-first' ([9fe9068](https://github.com/joshxfi/noteside/commit/9fe90681b161f614eaf4a8135ebe50dbcdd6dfde))
* **demo:** drop 'chrome' wording from the seed notes ([382ad5b](https://github.com/joshxfi/noteside/commit/382ad5b7b4baccf64ece629bd3fc862ec991232c))
* **landing,docs:** widen keycast caption, drop 'Tauri' from the pitch, replace 'chrome' wording ([6632a8b](https://github.com/joshxfi/noteside/commit/6632a8bbbf128650da7c48196af30fc904e16580))
* **settings:** match row focus to the finder/cheatsheet outline; drop redundant hint ([5b63b67](https://github.com/joshxfi/noteside/commit/5b63b674ca76cf092d646081a09bc05c7f6eac8b))
* **ui:** bump finder/palette/backlinks chrome to the readable floor ([30705c1](https://github.com/joshxfi/noteside/commit/30705c178edbec35f6e700296f20d08a585494c7))
* **ui:** cheatsheet focus matches the finder selection; space the subhead ([ed46c75](https://github.com/joshxfi/noteside/commit/ed46c758cd9b0e0c8fc12372694aa4639e6793de))
* **ui:** raise min editor font size 14→16; bump undersized chrome text ([0b0483b](https://github.com/joshxfi/noteside/commit/0b0483ba339c8b9fa0f543a74c17493a080319ba))

### Refactors

* **brand:** extract brand guide into a standalone reference app ([97a2b8b](https://github.com/joshxfi/noteside/commit/97a2b8b7f493a6094264446416790e90e030ae77))
* **desktop:** extract EditingSession store from App.tsx ([0a5614e](https://github.com/joshxfi/noteside/commit/0a5614e6a6ff608ac8cce558c4ea1585d50828ab))
* **desktop:** give NotebookState a method interface for watcher-echo suppression ([9d74144](https://github.com/joshxfi/noteside/commit/9d74144ce61c5f2e19778d1023b060440876ee57))
* **landing:** migrate styling to Tailwind v4 utilities ([4b2a67f](https://github.com/joshxfi/noteside/commit/4b2a67f4e243370cad46c1a801104e11662f2d90))
* rename "vault" → "notebook" across the codebase ([09a0bbd](https://github.com/joshxfi/noteside/commit/09a0bbdbffb1d60e75431f724702be3a0351341c))
* rename CamelCase source files to kebab-case ([da889d3](https://github.com/joshxfi/noteside/commit/da889d30aef1f47312787d29950a24729cf1fa77))

### Documentation

* add AGENTS.md as the canonical agent guide; CLAUDE.md points to it ([4b8394f](https://github.com/joshxfi/noteside/commit/4b8394f979c5065306655699c9bf921cdd58bafc))
* add app screenshot to the README ([8fd8ca9](https://github.com/joshxfi/noteside/commit/8fd8ca9b56069ef17ae791dafc27900230026223))
* add format:check to the gates; align release rules with config ([ccfbce5](https://github.com/joshxfi/noteside/commit/ccfbce50bb93bf90667da89f455c81694b8dba05))
* add repository README ([7ec391d](https://github.com/joshxfi/noteside/commit/7ec391d3b0092ad211cd0fbd9f75a5f235b1bec1))
* add test commands to README ([126659a](https://github.com/joshxfi/noteside/commit/126659a242f86884648fd0b79a3c7373a730968f))
* **agents:** document the release pipeline (semantic-release + CI) ([c1a42c7](https://github.com/joshxfi/noteside/commit/c1a42c7aa0103ec517e262c1309e89c45d4e757f))
* **agents:** drop the CLAUDE.md import note — keep AGENTS.md tool-agnostic ([8e3d1b6](https://github.com/joshxfi/noteside/commit/8e3d1b6f0bdca6cd00f1a9f1bd8c7ddf1e74fe98))
* **agents:** drop the design-handoff note, keep only what helps agents work ([fd99523](https://github.com/joshxfi/noteside/commit/fd9952349b2a2fa4aa341d7eab3b8d29feb26106))
* **agents:** fix three stale claims (apps/docs, build scope, fuzzy = path-only) ([c2d2cb0](https://github.com/joshxfi/noteside/commit/c2d2cb0887791c5417ebb4abe94fcafbeb2d7df3))
* desktop fonts are vendored ([@fontsource](https://github.com/fontsource)), genuinely offline ([6d54f9a](https://github.com/joshxfi/noteside/commit/6d54f9a08ca1ca7d266fba226be643a6d5435c37))
* download & install content for the release ([66e309d](https://github.com/joshxfi/noteside/commit/66e309de7b712f5164fb0f81636bb99a5b9af1d7))
* drop the README roadmap; make contributing actually useful ([56f3c62](https://github.com/joshxfi/noteside/commit/56f3c629621c4446ac69690303985c0840927052))
* **landing:** position as keyboard-first (vim AND shortcuts), not vim-only ([2e1359b](https://github.com/joshxfi/noteside/commit/2e1359b61a4a516b40a62c2ea3b6ca5d5e9c3870))
* **perf:** drop the 'not Electron' comparison — keep the positive native framing ([17e1a7c](https://github.com/joshxfi/noteside/commit/17e1a7c9db6d827c239d252a1cd3e5e33866cb4e))
* **perf:** refresh content-search numbers after the perf pass (~2ms/1k, ~20ms/10k, ~100ms/50k) ([8832c19](https://github.com/joshxfi/noteside/commit/8832c195cb4e713c512397b585e929beee3606e8))
* position as keyboard-first (vim and shortcuts), not vim-only ([2f1affd](https://github.com/joshxfi/noteside/commit/2f1affd54ed54fb39fb158dc14ee73a08fe54c57))
* **readme:** refresh hero screenshots from the demo build ([8d34340](https://github.com/joshxfi/noteside/commit/8d34340d4aed13ef466be9815b37ea2cb6bca22e))
* refresh for v1 — new chords, in-app keymap editor, interface-size + relative-numbers ([319818e](https://github.com/joshxfi/noteside/commit/319818eeb00ff670b28d3e0ae98e14528db9ef3e))
* rewrite README + add logo & MIT license for open-source release ([2f54472](https://github.com/joshxfi/noteside/commit/2f5447276834535f945f2be08b9859722c13623d))
* theme-adaptive README screenshot (dark variant for GitHub dark mode) ([583d4a0](https://github.com/joshxfi/noteside/commit/583d4a04101e293d12c96745e3be877aae5d5b62))
* update README for the v1 app (vault, CM6 vim, search, releasing) ([1b99d39](https://github.com/joshxfi/noteside/commit/1b99d39f6cd175196a86af58171436165e7796a5))
