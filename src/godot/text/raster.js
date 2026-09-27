/**
 * Glyph rasterisation on a 2D canvas, positioned the way Godot's font_draw_glyph places glyph bitmaps:
 * pen x quantised to 1/4 px up to 16 px, 1/2 px up to 20 px, whole pixels above; baseline on whole
 * pixels. Outlines are FreeType-stroker rings (FT_Glyph_Stroke) — radius = outline_size · 16 / 64 px,
 * round joins — drawn with the canvas stroker on the same path.
 *
 * Glyph outlines come from HarfBuzz (font units, y up) as cached Path2D objects. O(glyphs) per call.
 */
import { SUBPIXEL_ONE_HALF_MAX_SIZE, SUBPIXEL_ONE_QUARTER_MAX_SIZE } from './shaper.js';

/** FT_Stroker_Set(stroker, outline_size · 16, …) — the radius is in 26.6, so size/4 pixels. */
export const outlineRadius = (outlineSize) => (outlineSize * 16) / 64;

/** Godot's subpixel quantisation of a glyph's pen x at this font size. */
export function quantizeX(x, size) {
  if (size <= SUBPIXEL_ONE_QUARTER_MAX_SIZE) return Math.floor(4 * x + 0.5) / 4;
  if (size <= SUBPIXEL_ONE_HALF_MAX_SIZE) return Math.floor(2 * x + 0.5) / 2;
  return Math.round(x);
}

/**
 * Draws glyphs [from, to) of a shaped text with the pen starting at (x, baselineY).
 * mode 'fill' draws the glyphs, 'stroke' draws the outline ring of `radius` px.
 * Returns the pen x after the last glyph.
 */
export function drawGlyphs(ctx, shaped, x, baselineY, { mode = 'fill', radius = 0, from = 0, to = shaped.glyphs.length } = {}) {
  const font = shaped.font;
  const size = shaped.size;
  const k = size / font.upem;
  const y = Math.round(baselineY);
  let pen = x;
  if (mode === 'stroke') {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.lineWidth = (radius * 2) / k;
  }
  for (let i = from; i < to; i++) {
    const g = shaped.glyphs[i];
    const path = font.glyphPath(g.gid);
    if (path) {
      ctx.save();
      ctx.translate(quantizeX(pen + g.xOff, size), y + g.yOff);
      ctx.scale(k, -k);
      if (mode === 'stroke') ctx.stroke(path);
      else ctx.fill(path);
      ctx.restore();
    }
    pen += g.advance;
  }
  return pen;
}
