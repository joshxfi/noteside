// image.ts — markdown images. attrs.src stays EXACTLY as written in the file
// (relative paths included) so serialization is byte-faithful; only the
// DISPLAY URL is resolved, through the resolveSrc option the editor wires up
// (Tauri: convertFileSrc over the notebook root; web/demo: passthrough, where
// a missing file simply shows its alt text).
import { Image } from "@tiptap/extension-image";

export interface NsImageOptions {
  resolveSrc: (src: string) => string;
}

export const NsImage = Image.extend<NsImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      resolveSrc: (src: string) => src,
    };
  },

  renderHTML({ node }) {
    const { src, alt, title } = node.attrs as { src: string; alt?: string; title?: string };
    return [
      "img",
      {
        src: this.options.resolveSrc(src),
        alt: alt || undefined,
        title: title || undefined,
        class: "av-image",
        draggable: "false",
      },
    ];
  },
});
