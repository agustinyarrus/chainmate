/**
 * Line breaking — TextServer::shaped_text_get_line_breaks, the routine Label, RichTextLabel and
 * TextParagraph use, ported with its trimming rules. Input: a shaped text (see shaper.js); output:
 * [start, end, start, end, …] character ranges, one pair per line. O(glyphs).
 */
import { GLYPH } from './shaper.js';

/** TextServer.LineBreakFlag */
export const BREAK = Object.freeze({
  NONE: 0,
  MANDATORY: 1,
  WORD_BOUND: 2,
  GRAPHEME_BOUND: 4,
  ADAPTIVE: 8,
  TRIM_EDGE_SPACES: 16,
  TRIM_INDENT: 32,
  TRIM_START_EDGE_SPACES: 64,
  TRIM_END_EDGE_SPACES: 128,
});

const TRIMMABLE = GLYPH.SPACE | GLYPH.BREAK_HARD | GLYPH.BREAK_SOFT;
const trimmable = (g) => (g.flags & TRIMMABLE) !== 0;

/**
 * @param {{ glyphs: Array<{start:number,end:number,count:number,advance:number,flags:number}>, text: string }} shaped
 * @param {number} width line width (≤ 0 → only mandatory breaks)
 * @param {number} flags BREAK.* bitmask
 * @returns {number[]}
 */
export function lineBreaks(shaped, width, flags, start = 0) {
  const gl = shaped.glyphs;
  const size = gl.length;
  const rangeEnd = shaped.text.length;
  const lines = [];
  if (size === 0) return [0, 0];
  const trimStart = (flags & (BREAK.TRIM_START_EDGE_SPACES | BREAK.TRIM_EDGE_SPACES)) !== 0;
  const trimEnd = (flags & (BREAK.TRIM_END_EDGE_SPACES | BREAK.TRIM_EDGE_SPACES)) !== 0;
  let lineWidth = 0;
  let lineStart = start;
  let lastEnd = lineStart;
  let prevSafeBreak = 0;
  let lastSafeBreak = -1;
  let wordCount = 0;
  let trimNext = false;

  /**
   * Pushes the trimmed range [prevSafeBreak, endIndex] (glyph indices). After the first line, a soft
   * break that would leave nothing but spaces (a run of spaces straddling the break) adds no line —
   * the engine's result for double spaces, verified on the corpus.
   */
  const pushTrimmed = (endIndex, keepTrimNext, softBreak) => {
    let startPos = prevSafeBreak;
    let endPos = endIndex;
    while (trimNext && startPos < endPos && trimmable(gl[startPos])) startPos += gl[startPos].count;
    if (trimEnd) while (startPos < endPos && trimmable(gl[endPos])) endPos -= gl[endPos].count;
    const onlySpaces = softBreak && trimNext && startPos === endPos && trimmable(gl[startPos]);
    if (!onlySpaces && lastEnd <= gl[startPos].start) {
      lines.push(gl[startPos].start, gl[endPos].end);
      lastEnd = gl[endPos].end;
    }
    trimNext = keepTrimNext;
  };

  for (let i = 0; i < size; i++) {
    const g = gl[i];
    if (g.start < start) {
      prevSafeBreak = i + 1;
      continue;
    }
    if (g.count > 0) {
      if (width > 0 && lineWidth + g.advance > width && lastSafeBreak >= 0) {
        const safe = lastSafeBreak;
        if (trimStart) pushTrimmed(lastSafeBreak, true, true);
        else if (lastEnd <= lineStart) {
          lines.push(lineStart, gl[lastSafeBreak].end);
          lastEnd = gl[lastSafeBreak].end;
        }
        lineStart = gl[safe].end;
        prevSafeBreak = safe + 1;
        while (prevSafeBreak < size && gl[prevSafeBreak].end === lineStart) prevSafeBreak++;
        i = safe;
        lastSafeBreak = -1;
        lineWidth = 0;
        wordCount = 0;
        continue;
      }
      if (flags & BREAK.MANDATORY && g.flags & GLYPH.BREAK_HARD) {
        if (trimStart) pushTrimmed(i, false, false);
        else if (lastEnd <= lineStart) {
          lines.push(lineStart, g.end);
          lastEnd = g.end;
        }
        lineStart = g.end;
        prevSafeBreak = i + 1;
        while (prevSafeBreak < size && gl[prevSafeBreak].end === lineStart) prevSafeBreak++;
        lastSafeBreak = -1;
        lineWidth = 0;
        wordCount = 0;
        continue;
      }
      if (flags & BREAK.WORD_BOUND) {
        if (g.flags & GLYPH.BREAK_SOFT) {
          lastSafeBreak = i;
          wordCount++;
        }
        if (flags & BREAK.ADAPTIVE && wordCount === 0) lastSafeBreak = i;
      }
      if (flags & BREAK.GRAPHEME_BOUND) lastSafeBreak = i;
    }
    lineWidth += g.advance;
  }

  if (lines.length === 0 || (lines[lines.length - 1] < rangeEnd && prevSafeBreak < size)) {
    if (trimStart) {
      let startPos = prevSafeBreak < size ? prevSafeBreak : size - 1;
      if (lastEnd <= gl[startPos].start) {
        const endPos = size - 1;
        while (trimNext && startPos < endPos && trimmable(gl[startPos])) startPos += gl[startPos].count;
        lines.push(gl[startPos].start);
      } else {
        lines.push(lastEnd);
      }
    } else {
      lines.push(Math.max(lastEnd, lineStart));
    }
    lines.push(rangeEnd);
  }
  return lines;
}
