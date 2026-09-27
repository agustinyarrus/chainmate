/**
 * Label — Godot 4's Label: text shaped with the theme font, broken into lines (mandatory breaks, or
 * autowrap at the control's width), minimum size from the widest line (or 1 px wide when wrapping),
 * lines drawn with the engine's passes — shadow outline, shadow, outline, text — at integer-aligned
 * horizontal positions (`int(size − line) / 2` for centring) and integer baselines.
 */
import { Color } from '../math.js';
import { Control, MOUSE_FILTER, HORIZONTAL_ALIGNMENT, VERTICAL_ALIGNMENT } from './control.js';
import { AUTOWRAP, Paragraph, autowrapFlags, lineRuns } from './text.js';

export class Label extends Control {
  static themeType = 'Label';

  constructor(text = '') {
    super('Label');
    this.mouse_filter = MOUSE_FILTER.IGNORE;
    this._text = text;
    this._hAlign = HORIZONTAL_ALIGNMENT.LEFT;
    this._vAlign = VERTICAL_ALIGNMENT.TOP;
    this._autowrap = AUTOWRAP.OFF;
    this.clip_text = false;
    this._paragraph = null;
    this._lines = null;
    this._linesWidth = -1;
  }

  get text() {
    return this._text;
  }
  set text(t) {
    t = String(t);
    if (t === this._text) return;
    this._text = t;
    this._invalidateText();
  }

  get horizontal_alignment() { return this._hAlign; }
  set horizontal_alignment(v) { this._hAlign = v; this.queue_redraw(); }
  get vertical_alignment() { return this._vAlign; }
  set vertical_alignment(v) { this._vAlign = v; this.queue_redraw(); }
  get autowrap_mode() { return this._autowrap; }
  set autowrap_mode(v) {
    this._autowrap = v;
    this._lines = null;
    this.update_minimum_size();
    this.queue_redraw();
  }

  _invalidateText() {
    this._paragraph = null;
    this._lines = null;
    this.update_minimum_size();
    this.queue_redraw();
  }

  _theme_changed() {
    this._paragraph = null;
    this._lines = null;
  }

  _resized() {
    if (this._autowrap !== AUTOWRAP.OFF) {
      this._lines = null;
      this.update_minimum_size();
    }
  }

  _font() {
    return this.get_theme_font('font');
  }
  _fontSize() {
    return this.get_theme_font_size('font_size');
  }

  _shape() {
    const font = this._font();
    const size = this._fontSize();
    if (!font) return [];
    if (!this._paragraph) {
      this._paragraph = new Paragraph([{ text: this._text, font, size }]);
      this._lines = null;
    }
    const style = this.get_theme_stylebox('normal');
    const width = this._autowrap === AUTOWRAP.OFF ? 0 : Math.max(this.size.x - (style ? style.get_minimum_size().x : 0), 0);
    if (!this._lines || this._linesWidth !== width) {
      this._lines = this._paragraph.lines(width, autowrapFlags(this._autowrap));
      this._linesWidth = width;
    }
    return this._lines;
  }

  get_line_count() {
    return this._shape().length;
  }

  get_line_height() {
    const font = this._font();
    return font ? font.get_height(this._fontSize()) : 0;
  }

  get_minimum_size() {
    const font = this._font();
    const size = this._fontSize();
    const lines = this._shape();
    const spacing = this.get_theme_constant('line_spacing');
    const style = this.get_theme_stylebox('normal');
    const styleMin = style ? style.get_minimum_size() : { x: 0, y: 0 };
    let width = 0;
    for (const line of lines) width = Math.max(width, line.size.x);
    let height = 0;
    lines.forEach((line, i) => {
      height += line.size.y + (i > 0 ? spacing : 0);
    });
    height = Math.max(height, font ? font.get_height(size) : 0);
    if (this._autowrap !== AUTOWRAP.OFF) return { x: 1 + styleMin.x, y: (this.clip_text ? 1 : height) + styleMin.y };
    return { x: (this.clip_text ? 1 : width) + styleMin.x, y: height + styleMin.y };
  }

  _draw_self() {
    const lines = this._shape();
    if (lines.length === 0) return;
    const size = this.size;
    const style = this.get_theme_stylebox('normal');
    if (style) this.draw_style_box(style, { x: 0, y: 0, w: size.x, h: size.y });
    const styleOffset = style ? style.get_offset() : { x: 0, y: 0 };
    const rightMargin = style ? style.get_margin(2) : 0;
    const spacing = this.get_theme_constant('line_spacing');
    const fontColor = this.get_theme_color('font_color');
    const shadowColor = this.get_theme_color('font_shadow_color');
    const outlineColor = this.get_theme_color('font_outline_color');
    const outlineSize = this.get_theme_constant('outline_size');
    const shadowOutline = this.get_theme_constant('shadow_outline_size');
    const shadowOffset = { x: this.get_theme_constant('shadow_offset_x'), y: this.get_theme_constant('shadow_offset_y') };
    let totalH = 0;
    for (const line of lines) totalH += line.size.y + spacing;
    let vbegin = 0;
    if (this._vAlign === VERTICAL_ALIGNMENT.CENTER) vbegin = Math.trunc((size.y - (totalH - spacing)) / 2);
    else if (this._vAlign === VERTICAL_ALIGNMENT.BOTTOM) vbegin = Math.trunc(size.y - (totalH - spacing));
    const passes = [];
    if (shadowColor.a > 0 && shadowOutline > 0) passes.push({ color: shadowColor, outline: shadowOutline, offset: shadowOffset });
    if (shadowColor.a > 0) passes.push({ color: shadowColor, outline: 0, offset: shadowOffset });
    if (outlineSize > 0 && outlineColor.a > 0) passes.push({ color: outlineColor, outline: outlineSize });
    passes.push({ color: fontColor, outline: 0 });
    let y = styleOffset.y + vbegin;
    for (const line of lines) {
      y += line.ascent;
      let x;
      switch (this._hAlign) {
        case HORIZONTAL_ALIGNMENT.CENTER:
          x = Math.trunc(Math.trunc(size.x - line.size.x) / 2);
          break;
        case HORIZONTAL_ALIGNMENT.RIGHT:
          x = Math.trunc(size.x - rightMargin - line.size.x);
          break;
        default:
          x = styleOffset.x;
      }
      for (const run of lineRuns(this._paragraph, line, x, y, passes)) this.draw_glyph_run(run);
      y += line.descent + spacing;
    }
  }
}

export { AUTOWRAP, HORIZONTAL_ALIGNMENT, VERTICAL_ALIGNMENT, Color };
