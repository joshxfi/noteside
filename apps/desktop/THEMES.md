# Themes & palette credits

Noteside ships two built-in themes (**Noteside Light** / **Noteside Dark**) plus a
curated set of popular community color schemes. The community palettes are vendored
as [base16](https://github.com/tinted-theming/home) schemes in
[`src/bundled-schemes.json`](src/bundled-schemes.json), copied verbatim from the
MIT-licensed [`tinted-theming/schemes`](https://github.com/tinted-theming/schemes)
repository (which re-expresses every scheme below under a single MIT license).

Noteside maps each scheme's 16 slots onto its own design tokens at runtime
(`src/themes.ts`); we redistribute the color _values_, not the upstream projects'
source. Thanks to the original authors:

| Theme            | id                 | Mode  | Author / origin                                                                        |
| ---------------- | ------------------ | ----- | -------------------------------------------------------------------------------------- |
| Catppuccin Latte | `catppuccin-latte` | light | [Catppuccin](https://github.com/catppuccin/catppuccin)                                 |
| Catppuccin Mocha | `catppuccin-mocha` | dark  | [Catppuccin](https://github.com/catppuccin/catppuccin)                                 |
| Gruvbox Light    | `gruvbox-light`    | light | [morhetz](https://github.com/morhetz/gruvbox) (base16 by Dawid Kurek)                  |
| Gruvbox Dark     | `gruvbox-dark`     | dark  | [morhetz](https://github.com/morhetz/gruvbox) (base16 by Dawid Kurek)                  |
| Nord             | `nord`             | dark  | [arcticicestudio](https://github.com/nordtheme/nord)                                   |
| Solarized Light  | `solarized-light`  | light | Ethan Schoonover (base16 by aramisgithub)                                              |
| Solarized Dark   | `solarized-dark`   | dark  | Ethan Schoonover (base16 by aramisgithub)                                              |
| Rosé Pine Dawn   | `rose-pine-dawn`   | light | [Emilia Dunfelt](https://github.com/rose-pine)                                         |
| Rosé Pine        | `rose-pine`        | dark  | [Emilia Dunfelt](https://github.com/rose-pine)                                         |
| Tokyo Night      | `tokyo-night`      | dark  | Michaël Ball (after [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim)) |
| Everforest       | `everforest`       | dark  | [Sainnhe Park](https://github.com/sainnhe/everforest)                                  |
| One Light        | `one-light`        | light | Daniel Pfeifer (after Atom One)                                                        |
| One Dark         | `onedark`          | dark  | Lalit Magant (after Atom One)                                                          |
| Kanagawa         | `kanagawa`         | dark  | [Tommaso Laurenzi](https://github.com/rebelot/kanagawa.nvim)                           |

All bundled schemes are MIT-licensed via `tinted-theming/schemes`. Raw color values
are not themselves copyrightable, but attribution is the right thing to do.
