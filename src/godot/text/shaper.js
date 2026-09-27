/**
 * Text shaping exactly as the original build's TextServerAdvanced does it.
 *
 *   glyphs     HarfBuzz (same library Godot links) — ligatures, kerning, lnum/tnum identical;
 *   advances   base advance from FreeType's fixed-point path (hb-ft font funcs: 16.16 axis coordinates,
 *              HVAR, FT_MulDiv scaling, 26.6 rounding) + HarfBuzz's GPOS adjustment;
 *   spacing    FontVariation.spacing_glyph added to every glyph except the text's last;
 *   rounding   sizes ≤ 20 px keep fractional advances (subpixel positioning AUTO); larger sizes round
 *              each advance with the carried rounding remainder (keep_rounding_remainders = true in the
 *              font imports), the carry restarting at every space;
 *   metrics    ascent/descent from FreeType's rounded size metrics.
 *
 * Verified against the original engine over the whole game text corpus: glyph ids, per-glyph advances,
 * string widths at 22 sizes × 6 fonts, metrics for sizes 6–100 (test/text.test.mjs).
 *
 * Shaped results are memoised per (font, size, text) — LRU, O(1) lookups; shaping is O(n) per text.
 */
import { SfntFont } from './sfnt.js';
import { advance26, advanceUnits, harfbuzzScale, normalizedCoords, pixelScale, sizeMetrics } from './freetype.js';

/** SUBPIXEL_POSITIONING_AUTO: quarter-pixel up to 16 px, half-pixel up to 20 px, whole pixels above. */
export const SUBPIXEL_ONE_QUARTER_MAX_SIZE = 16;
export const SUBPIXEL_ONE_HALF_MAX_SIZE = 20;
const SHAPE_CACHE_LIMIT = 4096;

/** Glyph flags (TextServer.GraphemeFlag values used by the layout code). */
export const GLYPH = Object.freeze({
  VALID: 1,
  RTL: 2,
  VIRTUAL: 4,
  SPACE: 8,
  BREAK_HARD: 16,
  BREAK_SOFT: 32,
  TAB: 64,
  ELONGATION: 128,
  PUNCTUATION: 256,
  UNDERSCORE: 512,
  CONNECTED: 1024,
  SAFE_TO_INSERT_TATWEEL: 2048,
  EMBEDDED_OBJECT: 4096,
  SOFT_HYPHEN: 8192,
});

/** Godot's char_utils is_whitespace / is_linebreak (line breaks count as whitespace too). */
const isLinebreak = (c) => (c >= 0x0a && c <= 0x0d) || c === 0x85 || c === 0x2028 || c === 0x2029;
const isWhitespace = (c) =>
  c === 0x20 || c === 0x09 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000 || isLinebreak(c);
const isPunctuation = (c) => /[\p{P}\p{S}]/u.test(String.fromCodePoint(c)) && c !== 0x5f;
const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

/** One TrueType file: HarfBuzz face + the SFNT tables FreeType's numbers come from. */
export class FontFile {
  /**
   * @param {typeof import('harfbuzzjs')} hb the HarfBuzz module
   * @param {string} name
   * @param {Uint8Array} bytes
   */
  constructor(hb, name, bytes) {
    this.hb = hb;
    this.name = name;
    this.bytes = bytes;
    this.sfnt = new SfntFont(bytes);
    this.face = new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  }
}

/**
 * FontVariation: a FontFile at fixed axis values with glyph spacing and OpenType features — the six
 * UiTheme fonts are instances of this.
 */
export class FontVariation {
  /**
   * @param {FontFile} file
   * @param {{ variation?: Record<string, number>, spacingGlyph?: number, features?: Record<string, number>, name?: string }} options
   */
  constructor(file, { variation = {}, spacingGlyph = 0, features = {}, name = file.name } = {}) {
    this.file = file;
    this.name = name;
    this.variation = variation;
    this.spacingGlyph = spacingGlyph;
    this.features = features;
    const hb = file.hb;
    this._hbVariations = Object.entries(variation).map(([tag, value]) => new hb.Variation(tag, value));
    this._hbFeatures = Object.entries(features).map(([tag, value]) => new hb.Feature(tag, value));
    /** FreeType's normalized coordinates (16.16) — what base advances are computed with. */
    this.coords = normalizedCoords(file.sfnt, variation);
    this._hbFonts = new Map();
    this._unitAdvances = new Map();
    this._metrics = new Map();
    this._shapeCache = new Map();
    this._paths = new Map();
    this._unitsFont = null;
  }

  get upem() {
    return this.file.sfnt.upem;
  }

  /** HarfBuzz font at the scale hb-ft would give it for `size` px. */
  _hbFont(size) {
    let font = this._hbFonts.get(size);
    if (!font) {
      const hb = this.file.hb;
      font = new hb.Font(this.file.face);
      font.setVariations(this._hbVariations);
      const scale = harfbuzzScale(this.file.sfnt, pixelScale(this.file.sfnt, size));
      font.setScale(scale, scale);
      this._hbFonts.set(size, font);
    }
    return font;
  }

  /** Base advance in font units at this variation (hmtx + HVAR as FreeType blends it). Memoised. */
  unitAdvance(gid) {
    let units = this._unitAdvances.get(gid);
    if (units === undefined) {
      units = advanceUnits(this.file.sfnt, this.coords, gid);
      this._unitAdvances.set(gid, units);
    }
    return units;
  }

  /** { ascent, descent } in px (integers, FreeType-rounded). */
  metrics(size) {
    let m = this._metrics.get(size);
    if (!m) {
      m = sizeMetrics(this.file.sfnt, size);
      this._metrics.set(size, m);
    }
    return m;
  }
  get_ascent(size) { return this.metrics(size).ascent; }
  get_descent(size) { return this.metrics(size).descent; }
  get_height(size) { const m = this.metrics(size); return m.ascent + m.descent; }

  /** True when this size keeps fractional glyph positions. */
  static subpixel(size) {
    return size <= SUBPIXEL_ONE_HALF_MAX_SIZE;
  }

  /**
   * Shapes one text run. Returns glyphs in logical order:
   * { gid, start, end, count, advance, xOff, yOff, flags }. Memoised.
   */
  shape(text, size) {
    const key = `${size}\u0000${text}`;
    const cached = this._shapeCache.get(key);
    if (cached) {
      // LRU refresh.
      this._shapeCache.delete(key);
      this._shapeCache.set(key, cached);
      return cached;
    }
    const shaped = this._shape(text, size);
    this._shapeCache.set(key, shaped);
    if (this._shapeCache.size > SHAPE_CACHE_LIMIT) this._shapeCache.delete(this._shapeCache.keys().next().value);
    return shaped;
  }

  _shape(text, size) {
    const hb = this.file.hb;
    const sfnt = this.file.sfnt;
    const font = this._hbFont(size);
    const scale = pixelScale(sfnt, size);
    const subpos = FontVariation.subpixel(size);
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer, this._hbFeatures);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const count = infos.length;
    const glyphs = new Array(count);
    let width = 0;
    let remainder = 0;
    for (let k = 0; k < count; k++) {
      const info = infos[k];
      const pos = positions[k];
      const gid = info.codepoint;
      const start = info.cluster;
      const end = k + 1 < count ? infos[k + 1].cluster : text.length;
      const code = text.codePointAt(start) ?? 0;
      // Godot's x_advance: FreeType base (hb-ft) + GPOS adjustment (HarfBuzz), both in 26.6.
      const kern = pos.xAdvance - font.glyphHAdvance(gid);
      const x26 = advance26(sfnt, this.unitAdvance(gid), scale) + kern;
      const extra = k < count - 1 ? this.spacingGlyph : 0;
      let advance;
      if (subpos) {
        advance = x26 / 64 + extra;
      } else {
        if (isWhitespace(code)) remainder = 0;
        const full = remainder + (x26 / 64 + extra);
        advance = roundHalfAway(full);
        remainder = full - advance;
      }
      let flags = GLYPH.VALID;
      if (isWhitespace(code)) flags |= GLYPH.SPACE;
      if (isPunctuation(code)) flags |= GLYPH.PUNCTUATION;
      glyphs[k] = {
        gid,
        start,
        end,
        count: 1,
        advance,
        xOff: subpos ? pos.xOffset / 64 : roundHalfAway(pos.xOffset / 64),
        yOff: -roundHalfAway(pos.yOffset / 64),
        flags,
      };
      width += advance;
    }
    buffer.destroy?.();
    markBreaks(text, glyphs);
    const { ascent, descent } = this.metrics(size);
    return { text, size, font: this, glyphs, width, ascent, descent };
  }

  /** `Font.get_string_size(text, …, font_size)` for single-line text: shaped_text_get_size, ceiled. */
  get_string_size(text, size) {
    const shaped = this.shape(text, size);
    return { x: Math.ceil(shaped.width), y: Math.ceil(shaped.ascent + shaped.descent) };
  }

  /** HarfBuzz font at scale = units per em (outlines and extents in font units). */
  _units() {
    if (!this._unitsFont) {
      const hb = this.file.hb;
      this._unitsFont = new hb.Font(this.file.face);
      this._unitsFont.setVariations(this._hbVariations);
      this._unitsFont.setScale(this.upem, this.upem);
    }
    return this._unitsFont;
  }

  /** Glyph outline in font units as a Path2D (browser only), cached per glyph. */
  glyphPath(gid) {
    let path = this._paths.get(gid);
    if (path === undefined) {
      const svg = this._units().glyphToPath(gid);
      path = svg && typeof Path2D !== 'undefined' ? new Path2D(svg) : null;
      this._paths.set(gid, path);
    }
    return path;
  }

  /** Ink box in font units { xBearing, yBearing, width, height } (y up; height negative). Cached. */
  glyphExtents(gid) {
    this._extents ??= new Map();
    let e = this._extents.get(gid);
    if (e === undefined) {
      e = this._units().glyphExtents(gid) ?? { xBearing: 0, yBearing: 0, width: 0, height: 0 };
      this._extents.set(gid, e);
    }
    return e;
  }
}

/**
 * Break opportunities as the exported game computes them: its text server has no ICU data, so the
 * fallback applies — a soft break after every whitespace character, a hard break after line breaks
 * (the first of a CR LF pair skipped). Flags land on the glyph that ends at the break position.
 */
function markBreaks(text, glyphs) {
  const breaks = new Map();
  for (let j = 0; j < text.length; j++) {
    const c = text.charCodeAt(j);
    const next = j + 1 < text.length ? text.charCodeAt(j + 1) : 0;
    if (isWhitespace(c)) breaks.set(j + 1, false);
    if (isLinebreak(c) && (c !== 0x0d || next !== 0x0a)) breaks.set(j + 1, true);
  }
  for (const g of glyphs) {
    if (!breaks.has(g.end)) continue;
    const c = text.charCodeAt(g.start);
    if (breaks.get(g.end) && isLinebreak(c)) g.flags |= GLYPH.BREAK_HARD;
    else if (isWhitespace(c)) g.flags |= GLYPH.BREAK_SOFT;
  }
}
