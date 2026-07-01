# Themes & palette credits

Noteside ships two built-in themes (**Noteside Light** / **Noteside Dark**) plus a
curated set of popular community color schemes. The community palettes are vendored
as [base16](https://github.com/tinted-theming/home) schemes in
[`src/bundled-schemes.json`](src/bundled-schemes.json), copied verbatim from the
MIT-licensed [`tinted-theming/schemes`](https://github.com/tinted-theming/schemes)
repository, which re-expresses every scheme below under a single MIT license.

Noteside maps each scheme'''s 16 slots onto its own design tokens at runtime
(`src/themes.ts`); we redistribute the color _values_, not the upstream projects'''
source. Raw color values are not themselves copyrightable, but attribution is the
right thing to do — thanks to the original authors:

| Theme                  | id                       | Mode  | Author / origin (via tinted-theming)                                              |
| ---------------------- | ------------------------ | ----- | --------------------------------------------------------------------------------- |
| Catppuccin Latte       | `catppuccin-latte`       | light | https://github.com/catppuccin/catppuccin                                          |
| Catppuccin Mocha       | `catppuccin-mocha`       | dark  | https://github.com/catppuccin/catppuccin                                          |
| Gruvbox Light          | `gruvbox-light`          | light | Dawid Kurek (dawikur@gmail.com)                                                   |
| Gruvbox Dark           | `gruvbox-dark`           | dark  | Dawid Kurek (dawikur@gmail.com)                                                   |
| Nord                   | `nord`                   | dark  | arcticicestudio                                                                   |
| Solarized Light        | `solarized-light`        | light | Ethan Schoonover (modified by aramisgithub)                                       |
| Solarized Dark         | `solarized-dark`         | dark  | Ethan Schoonover (modified by aramisgithub)                                       |
| Rosé Pine Dawn         | `rose-pine-dawn`         | light | Emilia Dunfelt <edun@dunfelt.se>                                                  |
| Rosé Pine              | `rose-pine`              | dark  | Emilia Dunfelt <edun@dunfelt.se>                                                  |
| Tokyo Night            | `tokyo-night`            | dark  | Michaël Ball                                                                      |
| Everforest             | `everforest`             | dark  | Sainnhe Park (https://github.com/sainnhe)                                         |
| One Light              | `one-light`              | light | Daniel Pfeifer (http://github.com/purpleKarrot)                                   |
| One Dark               | `onedark`                | dark  | Lalit Magant (http://github.com/tilal6991)                                        |
| Kanagawa               | `kanagawa`               | dark  | Tommaso Laurenzi (https://github.com/rebelot)                                     |
| Dracula                | `dracula`                | dark  | clach04 (https://github.com/clach04)                                              |
| Catppuccin Macchiato   | `catppuccin-macchiato`   | dark  | https://github.com/catppuccin/catppuccin                                          |
| Tokyo Night Storm      | `tokyo-night-storm`      | dark  | Michaël Ball                                                                      |
| Kanagawa Dragon        | `kanagawa-dragon`        | dark  | Stefan Weigl-Bosker (https://github.com/sweiglbosker)                             |
| Rosé Pine Moon         | `rose-pine-moon`         | dark  | Emilia Dunfelt <edun@dunfelt.se>                                                  |
| Monokai                | `monokai`                | dark  | Wimer Hazenberg (http://www.monokai.nl)                                           |
| Ayu Mirage             | `ayu-mirage`             | dark  | Tinted Theming (https://github.com/tinted-theming)                                |
| Material Palenight     | `material-palenight`     | dark  | Nate Peterson                                                                     |
| GitHub Light           | `github-light`           | light | Tinted Theming (https://github.com/tinted-theming)                                |
| Ayu Light              | `ayu-light`              | light | Tinted Theming (https://github.com/tinted-theming)                                |
| Tokyo Night Light      | `tokyo-night-light`      | light | Michaël Ball                                                                      |
| Everforest Light       | `everforest-light`       | light | Márcio Sobel (https://github.com/marciosobel)                                     |
| Gruvbox Material Light | `gruvbox-material-light` | light | Mayush Kumar (https://github.com/MayushKumar)                                     |
| PaperColor Light       | `papercolor-light`       | light | Jon Leopard (http://github.com/jonleopard)                                        |
| Flexoki Light          | `flexoki-light`          | light | Steph Ango (https://github.com/kepano/flexoki)                                    |
| Edge Light             | `edge-light`             | light | cjayross (https://github.com/cjayross)                                            |
| Selenized Light        | `selenized-light`        | light | Jan Warchol (https://github.com/jan-warchol/selenized) / adapted to base16 by ali |

All bundled schemes are MIT-licensed via `tinted-theming/schemes`.
