/**
 * Glyph atlas — the engine's font texture cache: glyph bitmaps shelf-packed into RGBA pages (white
 * colour, coverage in alpha — the engine's LA8 "grayscale as 1"), each with the transparent margin
 * the engine draws around it. CPU side only: a renderer mirrors dirty pages to its own textures
 * (the 2D canvas with raw WebGL, Label3D with three.js textures).
 *
 * Lookups are O(1): entries are keyed by the glyph bitmap object of text/glyphs.js.
 */
import { Glyphs, RECT_MARGIN } from './glyphs.js';

export const ATLAS_SIZE = 1024;
/** Transparent pixels kept around each bitmap: the quad's margin plus one for linear filtering. */
const GLYPH_PAD = RECT_MARGIN + 1;
const BYTES_PER_PIXEL = 4;
export const NO_GLYPH = Object.freeze({ empty: true });

export class GlyphAtlas {
  constructor() {
    /** @type {Array<{pixels: Uint8Array, x: number, y: number, rowH: number, dirty: boolean, id: number, handle: any}>} */
    this.pages = [];
    this.entries = new Map();
  }

  _page() {
    const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * BYTES_PER_PIXEL);
    // White everywhere: the glyph's colour comes from the vertex colour, its shape from alpha.
    for (let i = 0; i < pixels.length; i += BYTES_PER_PIXEL) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
    }
    const page = { pixels, x: 0, y: 0, rowH: 0, dirty: true, id: this.pages.length, handle: null };
    this.pages.push(page);
    return page;
  }

  /** Shelf packing: left to right, a new shelf when the row is full, a new page when shelves are. */
  _alloc(w, h) {
    if (w > ATLAS_SIZE || h > ATLAS_SIZE) throw new Error(`glyph of ${w}x${h} px does not fit a ${ATLAS_SIZE} px atlas page`);
    let page = this.pages[this.pages.length - 1] ?? this._page();
    if (page.x + w > ATLAS_SIZE) {
      page.x = 0;
      page.y += page.rowH;
      page.rowH = 0;
    }
    if (page.y + h > ATLAS_SIZE) page = this._page();
    const slot = { page, x: page.x, y: page.y };
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    return slot;
  }

  /**
   * Atlas entry of a glyph: { page, u0…v1, left, top, w, h, scale } — the rectangle the engine draws
   * (bitmap plus its one-pixel margin: FontGlyph.rect / uv_rect), offset (left, top) from the pen in
   * rasterised pixels, y down. NO_GLYPH for glyphs without ink.
   */
  glyph(font, size26, outline, gid, shift26) {
    const bitmap = Glyphs.bitmaps.bitmap(font, size26, outline, gid, shift26);
    if (bitmap.empty) return NO_GLYPH;
    let entry = this.entries.get(bitmap);
    if (entry) return entry;
    const slot = this._alloc(bitmap.width + 2 * GLYPH_PAD, bitmap.rows + 2 * GLYPH_PAD);
    const page = slot.page;
    for (let row = 0; row < bitmap.rows; row++) {
      const to = ((slot.y + GLYPH_PAD + row) * ATLAS_SIZE + slot.x + GLYPH_PAD) * BYTES_PER_PIXEL;
      const from = row * bitmap.width;
      for (let col = 0; col < bitmap.width; col++) page.pixels[to + col * BYTES_PER_PIXEL + 3] = bitmap.pixels[from + col];
    }
    page.dirty = true;
    const inset = GLYPH_PAD - RECT_MARGIN;
    const w = bitmap.width + 2 * RECT_MARGIN;
    const h = bitmap.rows + 2 * RECT_MARGIN;
    entry = {
      empty: false,
      page,
      u0: (slot.x + inset) / ATLAS_SIZE,
      v0: (slot.y + inset) / ATLAS_SIZE,
      u1: (slot.x + inset + w) / ATLAS_SIZE,
      v1: (slot.y + inset + h) / ATLAS_SIZE,
      left: bitmap.left - RECT_MARGIN,
      top: -bitmap.top - RECT_MARGIN,
      w,
      h,
      scale: bitmap.scale,
    };
    this.entries.set(bitmap, entry);
    return entry;
  }
}
