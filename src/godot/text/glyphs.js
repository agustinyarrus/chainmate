/**
 * Glyph bitmaps for drawing — the engine's glyph cache (FontForSizeAdvanced.glyph_map) over the
 * FreeType rasterizer, plus the arithmetic of TextServerAdvanced::_font_draw_glyph that decides
 * WHICH bitmap a glyph needs at a given position and oversampling:
 *
 *   oversampling   quantised to 1/64: level = trunc(clamp(o, 0.1, 100) · 64), factor = level / 64
 *   size           Vector2i(font_size · 64 · factor, outline · factor): 26.6 size, whole outline px
 *   sub-pixel      sizes up to 16 px pick one of 4 variants from the pen's x, up to 20 px one of 2
 *   cache scale    size / y_ppem: 1 for whole sizes; glyph rectangles are multiplied by it
 *
 * Lookups are O(1) (Map keyed by font, size, outline, glyph and shift); a glyph is rasterised once.
 */
import { SUBPIXEL_ONE_HALF_MAX_SIZE, SUBPIXEL_ONE_QUARTER_MAX_SIZE } from './shaper.js';

const F = Math.fround;
/** One transparent pixel around every bitmap in the engine's atlas rectangle (rect_range). */
export const RECT_MARGIN = 1;
const OVERSAMPLING_MIN = 0.1;
const OVERSAMPLING_MAX = 100.0;
const FIXED_ONE = 64;

export const SubPixel = Object.freeze({ NONE: 0, HALF: 2, QUARTER: 4 });

/** oversampling → the factor the engine actually renders with (float, multiple of 1/64). */
export function quantizeOversampling(oversampling) {
  const clamped = Math.min(Math.max(F(oversampling), OVERSAMPLING_MIN), OVERSAMPLING_MAX);
  return Math.trunc(clamped * FIXED_ONE) / FIXED_ONE;
}

/** The cache key sizes for a font size drawn at a quantised oversampling factor. */
export function glyphSize(fontSize, outlineSize, factor) {
  return {
    size26: Math.trunc(F(F(fontSize * FIXED_ONE) * F(factor))),
    outline: outlineSize > 0 ? Math.trunc(F(outlineSize * F(factor))) : 0,
  };
}

/** SUBPIXEL_POSITIONING_AUTO, decided on the oversampled size. */
export function subPixelMode(size26) {
  if (size26 <= SUBPIXEL_ONE_QUARTER_MAX_SIZE * FIXED_ONE) return SubPixel.QUARTER;
  if (size26 <= SUBPIXEL_ONE_HALF_MAX_SIZE * FIXED_ONE) return SubPixel.HALF;
  return SubPixel.NONE;
}

/**
 * Where a glyph's bitmap goes for a pen at (x, y) in the item's own units:
 * { variant, shift26, x, y } — the variant and its 26.6 shift, and the position the glyph rectangle
 * is offset from (floored only when nothing is scaled, as in the engine).
 */
export function placeGlyph(x, y, mode, factor) {
  const px = F(x);
  let variant = 0;
  let shift26 = 0;
  let cx = px;
  if (mode === SubPixel.QUARTER) {
    variant = Math.floor(4 * (px + 0.125)) - 4 * Math.floor(px + 0.125);
    shift26 = variant << 4;
    cx = F(px + 0.125);
  } else if (mode === SubPixel.HALF) {
    variant = Math.floor(2 * (px + 0.25)) - 2 * Math.floor(px + 0.25);
    shift26 = variant << 5;
    cx = F(px + 0.25);
  }
  let cy = F(y);
  if (factor === 1) {
    cx = Math.floor(cx);
    cy = Math.floor(cy);
  }
  return { variant, shift26, x: cx, y: cy };
}

const EMPTY = Object.freeze({ empty: true, width: 0, rows: 0, left: 0, top: 0, pixels: null, scale: 1 });

export class GlyphBitmaps {
  /** @param {import('./ftw.js').Rasterizer} rasterizer */
  constructor(rasterizer) {
    this.rasterizer = rasterizer;
    /** FontVariation → face handle */
    this.faces = new Map();
    /** `${face}|${size26}` → size / y_ppem */
    this.scales = new Map();
    this.bitmaps = new Map();
  }

  /** One FreeType face per FontVariation (the engine: one per FontVariation cache entry). */
  face(font) {
    let handle = this.faces.get(font);
    if (handle === undefined) {
      handle = this.rasterizer.openFace(font.file.bytes, { variation: font.variation });
      this.faces.set(font, handle);
    }
    return handle;
  }

  /** FontForSizeAdvanced.scale = size / y_ppem (1 at whole pixel sizes). */
  scale(font, size26) {
    const face = this.face(font);
    const key = `${face}|${size26}`;
    let scale = this.scales.get(key);
    if (scale === undefined) {
      const ppem = this.rasterizer.metrics(face, size26).yPpem;
      scale = ppem !== 0 ? size26 / FIXED_ONE / ppem : 1;
      this.scales.set(key, scale);
    }
    return scale;
  }

  /**
   * The cached bitmap: { empty, width, rows, left, top, pixels, scale }. `left`/`top` are FreeType's
   * bitmap_left / bitmap_top; the engine's glyph rectangle is
   * ((left − 1, −top − 1), (width + 2, rows + 2)) · scale.
   */
  bitmap(font, size26, outline, glyph, shift26) {
    const face = this.face(font);
    const key = `${face}|${size26}|${outline}|${glyph}|${shift26}`;
    let entry = this.bitmaps.get(key);
    if (entry === undefined) {
      const rendered = glyph === 0 ? null : this.rasterizer.render(face, size26, outline, glyph, shift26);
      entry = rendered === null || rendered.width === 0 || rendered.rows === 0
        ? EMPTY
        : { empty: false, width: rendered.width, rows: rendered.rows, left: rendered.left, top: rendered.top, pixels: rendered.pixels, scale: this.scale(font, size26) };
      this.bitmaps.set(key, entry);
    }
    return entry;
  }
}

/** The shared instance, set once at boot (GlyphBitmaps over the loaded rasterizer). */
export const Glyphs = {
  /** @type {GlyphBitmaps|null} */
  bitmaps: null,
  use(rasterizer) {
    this.bitmaps = new GlyphBitmaps(rasterizer);
    return this.bitmaps;
  },
};
