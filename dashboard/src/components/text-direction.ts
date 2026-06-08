import { Extension } from '@tiptap/core';

// Adds a `dir` attribute (e.g. "rtl") to block nodes so Hebrew passages
// (psukim) render right-to-left. The toolbar sets it via updateAttributes;
// the website renderer reads the same attribute.
export const TextDirection = Extension.create({
  name: 'textDirection',
  addOptions() {
    return { types: ['paragraph', 'heading', 'blockquote'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('dir') || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs['dir'] ? { dir: attrs['dir'] } : {},
          },
        },
      },
    ];
  },
});
