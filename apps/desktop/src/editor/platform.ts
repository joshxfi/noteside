// The "open link" click modifier: Cmd on macOS, Ctrl elsewhere — matching how
// CM resolves `Mod-` chords, so mac Ctrl-click stays a context-menu gesture.
// Shared by the editor's Mod-click handler and the rendered-table widget.
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

export const modActive = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  IS_MAC ? e.metaKey : e.ctrlKey;

export const isModKey = (key: string): boolean => key === (IS_MAC ? "Meta" : "Control");
