/**
 * Text layout for 2D controls — the TextParagraph / Label path of TextServerAdvanced:
 *   shape the whole text once, break it into lines (layout.js, the engine's line-break routine with
 *   trimming), measure each line as shaped_text_get_size does (ceil of the summed advances), and emit
 *   glyph runs for drawing (pen positions in local units, one run per colour/outline pass).
 * Multi-span paragraphs (RichTextLabel) concatenate per-span shaping, as the engine does with spans.
 */
import { lineBreaks, BREAK } from '../text/layout.js';
import { GLYPH } from '../text/shaper.js';

export const AUTOWRAP = Object.freeze({ OFF: 0, ARBITRARY: 1, WORD: 2, WORD_SMART: 3 });

/** Label's autowrap flags (+ the default trim flags). */
export function autowrapFlags(mode) {
  const trim = BREAK.TRIM_START_EDGE_SPACES | BREAK.TRIM_END_EDGE_SPACES;
  switch (mode) {
    case AUTOWRAP.WORD_SMART:
      return BREAK.WORD_BOUND | BREAK.ADAPTIVE | BREAK.MANDATORY | trim;
    case AUTOWRAP.WORD:
      return BREAK.WORD_BOUND | BREAK.MANDATORY | trim;
    case AUTOWRAP.ARBITRARY:
      return BREAK.GRAPHEME_BOUND | BREAK.MANDATORY | trim;
    default:
      return BREAK.MANDATORY | trim;
  }
}

/**
 * A shaped paragraph of one or more spans. Each span: { text, font, size, color?, meta? }.
 * `glyphs` carry { gid, start, end, count, advance, xOff, yOff, flags, span } over the joined text.
 */
export class Paragraph {
  constructor(spans) {
    this.spans = spans;
    this.text = spans.map((s) => s.text).join('');
    this.glyphs = [];
    this.ascent = 0;
    this.descent = 0;
    let offset = 0;
    spans.forEach((span, index) => {
      if (span.text.length > 0) {
        const shaped = span.font.shape(span.text, span.size);
        for (const g of shaped.glyphs) this.glyphs.push({ ...g, start: g.start + offset, end: g.end + offset, span: index });
        this.ascent = Math.max(this.ascent, shaped.ascent);
        this.descent = Math.max(this.descent, shaped.descent);
      } else {
        this.ascent = Math.max(this.ascent, span.font.get_ascent(span.size));
        this.descent = Math.max(this.descent, span.font.get_descent(span.size));
      }
      offset += span.text.length;
    });
  }

  /** Lines as { start, end, glyphs, width (raw), size: {x: ceil(width), y: ceil(ascent+descent)} }. */
  lines(width, flags) {
    const ranges = lineBreaks(this, width, flags);
    const out = [];
    for (let i = 0; i < ranges.length; i += 2) {
      const start = ranges[i];
      const end = ranges[i + 1];
      const glyphs = this.glyphs.filter((g) => g.start >= start && g.end <= end && g.start < end);
      let w = 0;
      let ascent = 0;
      let descent = 0;
      for (const g of glyphs) w += g.advance;
      const spansInLine = new Set(glyphs.map((g) => g.span));
      if (spansInLine.size === 0) {
        ascent = this.ascent;
        descent = this.descent;
      }
      for (const index of spansInLine) {
        const span = this.spans[index];
        ascent = Math.max(ascent, span.font.get_ascent(span.size));
        descent = Math.max(descent, span.font.get_descent(span.size));
      }
      out.push({ start, end, glyphs, width: w, ascent, descent, size: { x: Math.ceil(w), y: Math.ceil(ascent + descent) } });
    }
    return out;
  }
}

/**
 * Emits glyph runs for one line: `passes` is a list of { color, outline, offset } drawn in order
 * (shadow outline, shadow, outline, text…). Runs group consecutive glyphs of the same span.
 */
export function lineRuns(paragraph, line, penX, baselineY, passes) {
  const runs = [];
  for (const pass of passes) {
    let run = null;
    let x = penX;
    for (const g of line.glyphs) {
      const span = paragraph.spans[g.span];
      const color = pass.colorFor ? pass.colorFor(span) : pass.color;
      if (!run || run.font !== span.font || run.size !== span.size || run.color !== color) {
        run = { font: span.font, size: span.size, outline: pass.outline ?? 0, color, glyphs: [] };
        runs.push(run);
      }
      if (!(g.flags & GLYPH.VIRTUAL)) run.glyphs.push({ gid: g.gid, x: x + g.xOff + (pass.offset?.x ?? 0), y: baselineY + g.yOff + (pass.offset?.y ?? 0) });
      x += g.advance;
    }
  }
  return runs.filter((r) => r.glyphs.length > 0);
}
