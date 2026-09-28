/**
 * The remaining Controls the game builds: ColorRect, TextureRect (+ ImageTexture, GradientTexture2D),
 * Panel, Range / HSlider, ScrollBar / VScrollBar, ScrollContainer, LineEdit and RichTextLabel — each
 * with the engine's minimum size, drawing and input rules.
 */
import { Color, F, TAU, colorByte } from '../math.js';
import { Signal } from '../signal.js';
import { SceneTree } from '../scene.js';
import { Control, MOUSE_FILTER, FOCUS, CURSOR, SIZE, Gui, ANCHOR_END, SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM } from './control.js';
import { Container } from './containers.js';
import { AUTOWRAP, Paragraph, autowrapFlags, lineRuns } from './text.js';

// ─────────────────────────────────────────────────────────────── textures ──────────────────────────

let textureSerial = 0;

/** A CPU-side RGBA8 image the renderer uploads once (and again when `version` changes). */
export class ImageTexture {
  constructor(width, height, pixels = new Uint8Array(width * height * 4)) {
    this.id = ++textureSerial;
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.version = 1;
  }
  get_width() { return this.width; }
  get_height() { return this.height; }
  get_size() { return { x: this.width, y: this.height }; }

  /** Image.set_pixel with a Godot Color (stored as RGBA8 with rounding, like Image::set_pixel). */
  set_pixel(x, y, c) {
    const i = (y * this.width + x) * 4;
    const byte = (v) => Math.min(255, Math.max(0, Math.round(Math.fround(v) * 255)));
    this.pixels[i] = byte(c.r);
    this.pixels[i + 1] = byte(c.g);
    this.pixels[i + 2] = byte(c.b);
    this.pixels[i + 3] = byte(c.a);
  }
}

export const GRADIENT_FILL = Object.freeze({ LINEAR: 0, RADIAL: 1, SQUARE: 2, CONIC: 3 });
export const GRADIENT_REPEAT = Object.freeze({ NONE: 0, REPEAT: 1, MIRROR: 2 });
/** Geometry2D::get_closest_point_to_segment_uncapped: a shorter segment counts as a point. */
const DEGENERATE_SEGMENT = F(1e-20);

/** Vector2::length in single precision. */
const length2 = (x, y) => F(Math.sqrt(F(F(x * x) + F(y * y))));

/**
 * GradientTexture2D::_get_gradient_offset_at — where texel (x, y) of a width × height texture falls
 * on the gradient, in the engine's single precision (Vector2 is float; the conic angle and the
 * mirror fold are computed in double, as there). O(1).
 */
function gradientOffsetAt(x, y, width, height, from, to, fill, repeat) {
  if (from.x === to.x && from.y === to.y) return 0;
  const px = width > 1 ? F(x / (width - 1)) : 0;
  const py = height > 1 ? F(y / (height - 1)) : 0;
  const nx = F(to.x - from.x);
  const ny = F(to.y - from.y);
  const qx = F(px - from.x);
  const qy = F(py - from.y);
  let ofs = 0;
  switch (fill) {
    case GRADIENT_FILL.LINEAR: {
      // The texel projected on the (unbounded) line through the segment, signed along it.
      const l2 = F(F(nx * nx) + F(ny * ny));
      let cx = 0;
      let cy = 0;
      if (!(l2 < DEGENERATE_SEGMENT)) {
        const d = F(F(F(nx * qx) + F(ny * qy)) / l2);
        cx = F(F(from.x + F(nx * d)) - from.x);
        cy = F(F(from.y + F(ny * d)) - from.y);
      }
      ofs = F(length2(cx, cy) / length2(nx, ny));
      if (F(F(cx * nx) + F(cy * ny)) < 0) ofs = -ofs;
      break;
    }
    case GRADIENT_FILL.RADIAL:
      ofs = F(length2(qx, qy) / length2(nx, ny));
      break;
    case GRADIENT_FILL.SQUARE:
      ofs = F(Math.max(Math.abs(qx), Math.abs(qy)) / Math.max(Math.abs(nx), Math.abs(ny)));
      break;
    case GRADIENT_FILL.CONIC: {
      // Vector2::angle_to = atan2f(cross, dot): libm's last bit may differ from the engine's.
      const angle = F(Math.atan2(F(F(nx * qy) - F(ny * qx)), F(F(nx * qx) + F(ny * qy))));
      const wrapped = angle % TAU;
      ofs = F((wrapped < 0 ? wrapped + TAU : wrapped) / TAU);
      break;
    }
    default:
      throw new Error(`unknown gradient fill ${fill}`);
  }
  switch (repeat) {
    case GRADIENT_REPEAT.NONE:
      return Math.min(Math.max(ofs, 0), 1);
    case GRADIENT_REPEAT.REPEAT: {
      const folded = ofs % 1;
      return folded < 0 ? F(1 + folded) : folded;
    }
    case GRADIENT_REPEAT.MIRROR: {
      const folded = Math.abs(ofs) % 2;
      return folded > 1 ? F(2 - folded) : folded;
    }
    default:
      throw new Error(`unknown gradient repeat ${repeat}`);
  }
}

/**
 * GradientTexture2D (LDR): every texel is the gradient at its offset, each channel stored as
 * Color::get_r8 (rounded in single precision). O(width × height × log points).
 */
export function gradientTexture2D(gradient, {
  width = 64, height = 64, fillFrom = { x: 0, y: 0 }, fillTo = { x: 1, y: 0 }, fill = GRADIENT_FILL.LINEAR, repeat = GRADIENT_REPEAT.NONE,
} = {}) {
  const texture = new ImageTexture(width, height);
  const from = { x: F(fillFrom.x), y: F(fillFrom.y) };
  const to = { x: F(fillTo.x), y: F(fillTo.y) };
  const pixels = texture.pixels;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = gradient.get_color_at_offset(gradientOffsetAt(x, y, width, height, from, to, fill, repeat));
      const i = (y * width + x) * 4;
      pixels[i] = colorByte(c.r);
      pixels[i + 1] = colorByte(c.g);
      pixels[i + 2] = colorByte(c.b);
      pixels[i + 3] = colorByte(c.a);
    }
  }
  return texture;
}

// ─────────────────────────────────────────────────────────────── simple rects ──────────────────────

export class ColorRect extends Control {
  static themeType = 'ColorRect';
  constructor(color = new Color(1, 1, 1, 1)) {
    super('ColorRect');
    this._color = color;
  }
  get color() { return this._color; }
  set color(c) { this._color = c; this.queue_redraw(); }
  _draw_self() {
    this.draw_rect({ x: 0, y: 0, w: this.size.x, h: this.size.y }, this._color);
  }
}

export const EXPAND_MODE = Object.freeze({ KEEP_SIZE: 0, IGNORE_SIZE: 1, FIT_WIDTH: 2 });
export const STRETCH_MODE = Object.freeze({ SCALE: 0, TILE: 1, KEEP: 2, KEEP_CENTERED: 3 });

export class TextureRect extends Control {
  static themeType = 'TextureRect';
  constructor() {
    super('TextureRect');
    this.mouse_filter = MOUSE_FILTER.PASS;
    this._texture = null;
    this.expand_mode = EXPAND_MODE.KEEP_SIZE;
    this.stretch_mode = STRETCH_MODE.SCALE;
  }
  get texture() { return this._texture; }
  set texture(t) { this._texture = t; this.update_minimum_size(); this.queue_redraw(); }
  get_minimum_size() {
    if (this._texture && this.expand_mode === EXPAND_MODE.KEEP_SIZE) return { x: this._texture.width, y: this._texture.height };
    return { x: 0, y: 0 };
  }
  _draw_self() {
    if (!this._texture) return;
    if (this.stretch_mode === STRETCH_MODE.SCALE) this.draw_texture_rect(this._texture, { x: 0, y: 0, w: this.size.x, h: this.size.y });
    else this.draw_texture_rect(this._texture, { x: 0, y: 0, w: this._texture.width, h: this._texture.height });
  }
}

export class Panel extends Control {
  static themeType = 'Panel';
  _draw_self() {
    const style = this.get_theme_stylebox('panel');
    if (style) this.draw_style_box(style, { x: 0, y: 0, w: this.size.x, h: this.size.y });
  }
}

// ─────────────────────────────────────────────────────────────── ranges ────────────────────────────

export class Range extends Control {
  static themeType = 'Range';
  constructor(name = 'Range') {
    super(name);
    this.min_value = 0;
    this.max_value = 100;
    this.step = 1;
    this.page = 0;
    this._value = 0;
    this.value_changed = new Signal();
    this.changed = new Signal();
  }
  get value() { return this._value; }
  set value(v) { this.set_value(v); }
  _clampValue(v) {
    if (this.step > 0) v = Math.round((v - this.min_value) / this.step) * this.step + this.min_value;
    return Math.min(Math.max(v, this.min_value), Math.max(this.min_value, this.max_value - this.page));
  }
  set_value(v) {
    v = this._clampValue(v);
    if (v === this._value) return;
    this._value = v;
    this.queue_redraw();
    this.value_changed.emit(v);
  }
  set_value_no_signal(v) {
    this._value = this._clampValue(v);
    this.queue_redraw();
  }
  get_as_ratio() {
    const span = this.max_value - this.min_value;
    return span === 0 ? 0 : (this._value - this.min_value) / span;
  }
}

export class HSlider extends Range {
  static themeType = 'HSlider';
  constructor() {
    super('HSlider');
    this.focus_mode = FOCUS.ALL;
    this.editable = true;
    this._dragging = false;
    this._mouseInside = false;
    this._dragStartValue = 0;
    this.drag_started = new Signal();
    this.drag_ended = new Signal();
    this.mouse_entered.connect(() => { this._mouseInside = true; this.queue_redraw(); });
    this.mouse_exited.connect(() => { this._mouseInside = false; this.queue_redraw(); });
  }

  get_minimum_size() {
    const style = this.get_theme_stylebox('slider');
    const grabber = this.get_theme_icon('grabber');
    const ss = style ? style.get_minimum_size() : { x: 0, y: 0 };
    const rs = grabber ? { x: grabber.width, y: grabber.height } : { x: 0, y: 0 };
    return { x: Math.trunc(ss.x), y: Math.trunc(Math.max(ss.y, rs.y)) };
  }

  _grabber() {
    if (!this.editable) return this.get_theme_icon('grabber_disabled');
    return this._mouseInside || this.has_focus(true) ? this.get_theme_icon('grabber_highlight') : this.get_theme_icon('grabber');
  }

  _valueAt(x) {
    const grabber = this._grabber();
    const areasize = this.size.x - (grabber ? grabber.width : 0);
    if (areasize <= 0) return this.min_value;
    const ratio = (x - (grabber ? grabber.width / 2 : 0)) / areasize;
    return this.min_value + Math.min(Math.max(ratio, 0), 1) * (this.max_value - this.min_value);
  }

  _gui_input(event) {
    if (!this.editable) return;
    if (event.kind === 'mouse_button' && event.button_index === 1) {
      if (event.pressed) {
        this._dragging = true;
        this._dragStartValue = this.value;
        this.drag_started.emit();
        this.set_value(this._valueAt(event.position.x));
      } else if (this._dragging) {
        this._dragging = false;
        this.drag_ended.emit(this.value !== this._dragStartValue);
      }
      this.accept_event();
    } else if (event.kind === 'mouse_motion' && this._dragging) {
      this.set_value(this._valueAt(event.position.x));
      this.accept_event();
    } else if (event.kind === 'key' && event.pressed) {
      if (event.is_action('ui_left')) {
        this.set_value(this.value - this.step);
        this.accept_event();
      } else if (event.is_action('ui_right')) {
        this.set_value(this.value + this.step);
        this.accept_event();
      }
    }
  }

  /** Slider::_notification(NOTIFICATION_DRAW), horizontal. */
  _draw_self() {
    const size = { x: Math.trunc(this.size.x), y: Math.trunc(this.size.y) };
    const ratio = Number.isNaN(this.get_as_ratio()) ? 0 : this.get_as_ratio();
    const style = this.get_theme_stylebox('slider');
    const highlighted = this.editable && (this._mouseInside || this.has_focus(true));
    const area = highlighted ? this.get_theme_stylebox('grabber_area_highlight') : this.get_theme_stylebox('grabber_area');
    const grabber = this._grabber();
    if (!style || !grabber) return;
    const widgetHeight = Math.trunc(style.get_minimum_size().y);
    const areasize = size.x - grabber.width;
    const top = Math.trunc((size.y - widgetHeight) / 2);
    this.draw_style_box(style, { x: 0, y: top, w: size.x, h: widgetHeight });
    if (area) this.draw_style_box(area, { x: 0, y: top, w: Math.trunc(areasize * ratio + grabber.width / 2), h: widgetHeight });
    const gx = Math.trunc(ratio * areasize) + (this.get_theme_constant('center_grabber') ? -Math.trunc(grabber.width / 2) : 0);
    const gy = Math.trunc((size.y - grabber.height) / 2) + this.get_theme_constant('grabber_offset');
    this.draw_texture_rect(grabber, { x: gx, y: gy, w: grabber.width, h: grabber.height });
  }
}

export class VScrollBar extends Range {
  static themeType = 'VScrollBar';
  constructor() {
    super('VScrollBar');
    this.step = 0;
    this._drag = null;
    this._hoverGrabber = false;
  }

  get_minimum_size() {
    const incr = this.get_theme_icon('increment');
    const decr = this.get_theme_icon('decrement');
    const bg = this.get_theme_stylebox('scroll');
    const bgMin = bg ? bg.get_minimum_size() : { x: 0, y: 0 };
    const grabber = this.get_theme_stylebox('grabber');
    const grabberMin = grabber ? grabber.get_minimum_size() : { x: 0, y: 0 };
    const w = Math.max(incr?.width ?? 0, bgMin.x);
    const h = (incr?.height ?? 0) + (decr?.height ?? 0) + bgMin.y + grabberMin.y;
    return { x: w, y: h };
  }

  _grabberRect() {
    const size = this.size;
    const span = this.max_value - this.min_value;
    if (span <= 0 || this.page >= span) return { y: 0, h: size.y };
    const h = Math.max((this.page / span) * size.y, 8);
    const y = ((this._value - this.min_value) / (span - this.page)) * (size.y - h);
    return { y, h };
  }

  scroll(amount) {
    this.set_value(this._value + amount);
  }

  _gui_input(event) {
    if (event.kind === 'mouse_button' && event.button_index === 1) {
      if (event.pressed) {
        const g = this._grabberRect();
        if (event.position.y >= g.y && event.position.y <= g.y + g.h) this._drag = { from: event.position.y, value: this._value };
        else this.scroll(event.position.y < g.y ? -this.page : this.page);
      } else this._drag = null;
      this.accept_event();
    } else if (event.kind === 'mouse_motion' && this._drag) {
      const span = this.max_value - this.min_value - this.page;
      const g = this._grabberRect();
      const travel = this.size.y - g.h;
      if (travel > 0) this.set_value(this._drag.value + ((event.position.y - this._drag.from) / travel) * span);
      this.accept_event();
    }
  }

  _draw_self() {
    const size = this.size;
    const bg = this.get_theme_stylebox('scroll');
    if (bg) this.draw_style_box(bg, { x: 0, y: 0, w: size.x, h: size.y });
    const g = this._grabberRect();
    const style = this._drag ? this.get_theme_stylebox('grabber_pressed') : this.get_theme_stylebox('grabber');
    if (style) this.draw_style_box(style, { x: 0, y: g.y, w: size.x, h: g.h });
  }
}

export const SCROLL_MODE = Object.freeze({ DISABLED: 0, AUTO: 1, SHOW_ALWAYS: 2, SHOW_NEVER: 3 });
/** ScrollContainer wheel step: a notch scrolls an eighth of the page (ScrollContainer::gui_input). */
const WHEEL_PAGE_FRACTION = 1 / 8;
const TOUCH_DRAG_THRESHOLD = 6;

export class ScrollContainer extends Container {
  static themeType = 'ScrollContainer';

  constructor() {
    super('ScrollContainer');
    this.clip_contents = true;
    this.horizontal_scroll_mode = SCROLL_MODE.AUTO;
    this.vertical_scroll_mode = SCROLL_MODE.AUTO;
    this.v_scroll = new VScrollBar();
    this.v_scroll.visible = false;
    this.v_scroll._internal = true;
    this.v_scroll.value_changed.connect(() => this.queue_sort());
    this.add_child(this.v_scroll);
    this._touch = null;
  }

  get scroll_vertical() {
    return this.v_scroll.value;
  }
  set scroll_vertical(v) {
    this.v_scroll.value = v;
  }

  _content() {
    return this.children.find((c) => c instanceof Control && !c._internal && c.visible && !c._queued) ?? null;
  }

  get_minimum_size() {
    let largest = { x: 0, y: 0 };
    for (const c of this.children) {
      if (!(c instanceof Control) || c._internal || !c.visible) continue;
      const m = c.get_combined_minimum_size();
      largest = { x: Math.max(largest.x, m.x), y: Math.max(largest.y, m.y) };
    }
    const min = { x: 0, y: 0 };
    if (this.horizontal_scroll_mode === SCROLL_MODE.DISABLED) min.x = Math.max(min.x, largest.x);
    if (this.vertical_scroll_mode === SCROLL_MODE.DISABLED) min.y = Math.max(min.y, largest.y);
    const vShow = this.vertical_scroll_mode === SCROLL_MODE.SHOW_ALWAYS || (this.vertical_scroll_mode === SCROLL_MODE.AUTO && largest.y > min.y);
    if (vShow) min.x += this.v_scroll.get_minimum_size().x;
    const panel = this.get_theme_stylebox('panel');
    if (panel) {
      const m = panel.get_minimum_size();
      min.x += m.x;
      min.y += m.y;
    }
    return min;
  }

  _sort() {
    const panel = this.get_theme_stylebox('panel');
    const size = this.size;
    const ofs = { x: 0, y: 0 };
    if (panel) {
      const m = panel.get_minimum_size();
      size.x -= m.x;
      size.y -= m.y;
      const o = panel.get_offset();
      ofs.x += o.x;
      ofs.y += o.y;
    }
    const content = this._content();
    const contentMin = content ? content.get_combined_minimum_size() : { x: 0, y: 0 };
    // Scroll bar: visible when the content is taller than the viewport.
    const vShow = this.vertical_scroll_mode === SCROLL_MODE.SHOW_ALWAYS || (this.vertical_scroll_mode === SCROLL_MODE.AUTO && contentMin.y > size.y);
    this.v_scroll.visible = vShow;
    const barWidth = vShow ? this.v_scroll.get_minimum_size().x : 0;
    this.v_scroll.min_value = 0;
    this.v_scroll.max_value = contentMin.y;
    this.v_scroll.page = size.y;
    this.v_scroll.set_value_no_signal(this.v_scroll.value);
    this.v_scroll.anchor = [ANCHOR_END, 0, ANCHOR_END, ANCHOR_END];
    this.v_scroll.offset = [-barWidth, 0, 0, 0];
    this.v_scroll._size_changed();
    if (vShow) size.x -= barWidth;
    if (!content) return;
    const r = { x: 0, y: -this.v_scroll.value, w: contentMin.x, h: contentMin.y };
    if (content.size_flags_horizontal & SIZE.EXPAND) r.w = Math.max(size.x, contentMin.x);
    if (content.size_flags_vertical & SIZE.EXPAND) r.h = Math.max(size.y, contentMin.y);
    r.x = Math.floor(r.x + ofs.x);
    r.y = Math.floor(r.y + ofs.y);
    this.fit_child_in_rect(content, r);
    this.queue_redraw();
  }

  _gui_input(event) {
    if (event.kind === 'mouse_button' && event.pressed && (event.button_index === 4 || event.button_index === 5)) {
      const direction = event.button_index === 4 ? -1 : 1;
      this.v_scroll.scroll(direction * this.v_scroll.page * WHEEL_PAGE_FRACTION * (event.factor || 1));
      this.accept_event();
    } else if (event.kind === 'screen_touch' || (event.kind === 'mouse_button' && event.button_index === 1 && event.is_touch)) {
      this._touch = event.pressed ? { y: event.position.y, value: this.v_scroll.value, dragging: false } : null;
    } else if (event.kind === 'mouse_motion' && this._touch) {
      const dy = event.position.y - this._touch.y;
      if (!this._touch.dragging && Math.abs(dy) > TOUCH_DRAG_THRESHOLD) this._touch.dragging = true;
      if (this._touch.dragging) {
        this.v_scroll.value = this._touch.value - dy;
        this.accept_event();
      }
    }
  }

  _draw_self() {
    const panel = this.get_theme_stylebox('panel');
    if (panel) this.draw_style_box(panel, { x: 0, y: 0, w: this.size.x, h: this.size.y });
  }
}

// ─────────────────────────────────────────────────────────────── LineEdit ─────────────────────────

/** Caret blink half-period (LineEdit caret_blink_interval). */
const CARET_BLINK = 0.65;

export class LineEdit extends Control {
  static themeType = 'LineEdit';

  constructor() {
    super('LineEdit');
    this.focus_mode = FOCUS.ALL;
    this.mouse_default_cursor_shape = CURSOR.IBEAM;
    this._text = '';
    this.placeholder_text = '';
    this.max_length = 0;
    this.editable = true;
    this.caret_column = 0;
    this.text_changed = new Signal();
    this.text_submitted = new Signal();
    this._blink = 0;
    this._caretVisible = true;
    this.focus_entered.connect(() => {
      this._blink = 0;
      this._caretVisible = true;
      Gui.viewport?.textInput?.attach(this);
      this.queue_redraw();
    });
    this.focus_exited.connect(() => {
      Gui.viewport?.textInput?.detach(this);
      this.queue_redraw();
    });
  }

  get text() {
    return this._text;
  }
  set text(t) {
    t = String(t);
    if (this.max_length > 0) t = t.slice(0, this.max_length);
    this._text = t;
    this.caret_column = Math.min(this.caret_column, t.length);
    this.queue_redraw();
  }

  /** Edits from the text-input bridge (typing, IME, paste). */
  _edited(text, caret) {
    const before = this._text;
    this.text = text;
    this.caret_column = Math.min(caret, this._text.length);
    this._blink = 0;
    this._caretVisible = true;
    if (this._text !== before) this.text_changed.emit(this._text);
  }

  _process(delta) {
    if (!this.has_focus()) return;
    this._blink += delta;
    if (this._blink >= CARET_BLINK) {
      this._blink -= CARET_BLINK;
      this._caretVisible = !this._caretVisible;
      this.queue_redraw();
    }
  }

  get_minimum_size() {
    const style = this.get_theme_stylebox('normal');
    const font = this.get_theme_font('font');
    const size = this.get_theme_font_size('font_size');
    const m = style ? style.get_minimum_size() : { x: 0, y: 0 };
    const charW = font.shape('M', size).width;
    return { x: m.x + this.get_theme_constant('minimum_character_width') * charW, y: m.y + font.get_height(size) };
  }

  _gui_input(event) {
    if (event.kind === 'mouse_button' && event.button_index === 1 && event.pressed) {
      // LineEdit::edit(hide_focus = true): a click edits; its box shows the focus anyway (setting 1).
      if (!this.has_focus()) this.grab_focus(true);
      this.caret_column = this._columnAt(event.position.x);
      Gui.viewport?.textInput?.setCaret(this.caret_column);
      this.accept_event();
    } else if (event.kind === 'key' && event.pressed && event.is_action('ui_text_submit')) {
      this.text_submitted.emit(this._text);
      this.accept_event();
    }
  }

  _columnAt(x) {
    const style = this.get_theme_stylebox(this.has_focus() ? 'focus' : 'normal');
    const font = this.get_theme_font('font');
    const size = this.get_theme_font_size('font_size');
    const shaped = font.shape(this._text, size);
    let pen = style ? style.get_offset().x : 0;
    for (const g of shaped.glyphs) {
      if (x < pen + g.advance / 2) return g.start;
      pen += g.advance;
    }
    return this._text.length;
  }

  _draw_self() {
    const size = this.size;
    const style = this.get_theme_stylebox(this.has_focus() ? 'focus' : 'normal');
    if (style) this.draw_style_box(style, { x: 0, y: 0, w: size.x, h: size.y });
    const font = this.get_theme_font('font');
    const fontSize = this.get_theme_font_size('font_size');
    const offset = style ? style.get_offset() : { x: 0, y: 0 };
    const innerH = size.y - (style ? style.get_minimum_size().y : 0);
    const placeholder = this._text === '';
    const text = placeholder ? this.placeholder_text : this._text;
    const color = placeholder ? this.get_theme_color('font_placeholder_color') : this.get_theme_color('font_color');
    const paragraph = new Paragraph([{ text, font, size: fontSize }]);
    const [line] = paragraph.lines(0, autowrapFlags(AUTOWRAP.OFF));
    const top = offset.y + Math.trunc((innerH - line.size.y) / 2);
    const baseline = top + line.ascent;
    for (const run of lineRuns(paragraph, line, offset.x, baseline, [{ color, outline: 0 }])) this.draw_glyph_run(run);
    if (this.has_focus() && this._caretVisible && this.editable) {
      let caretX = offset.x;
      if (!placeholder) {
        for (const g of line.glyphs) if (g.end <= this.caret_column) caretX += g.advance;
      }
      const width = this.get_theme_constant('caret_width');
      this.draw_rect({ x: Math.round(caretX), y: top, w: width, h: line.size.y }, this.get_theme_color('caret_color'));
    }
  }
}

// ─────────────────────────────────────────────────────────────── RichTextLabel ────────────────────

/** A BBCode subset: [b] [i] [color=…] and plain text, split into paragraphs at newlines. */
function parseBBCode(source) {
  const spans = [];
  const stack = { bold: 0, italic: 0, colors: [] };
  let text = '';
  const flush = () => {
    if (text) spans.push({ text, bold: stack.bold > 0, italic: stack.italic > 0, color: stack.colors[stack.colors.length - 1] ?? null });
    text = '';
  };
  const tag = /\[(\/?)([a-z_]+)(?:=([^\]]+))?\]/gi;
  let last = 0;
  for (const m of source.matchAll(tag)) {
    text += source.slice(last, m.index);
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (!['b', 'i', 'color'].includes(name)) {
      text += m[0];
      continue;
    }
    flush();
    if (name === 'b') stack.bold += closing ? -1 : 1;
    else if (name === 'i') stack.italic += closing ? -1 : 1;
    else if (closing) stack.colors.pop();
    else stack.colors.push(new Color(m[3].replace('#', '')));
  }
  text += source.slice(last);
  flush();
  return spans;
}

export class RichTextLabel extends Control {
  static themeType = 'RichTextLabel';

  constructor() {
    super('RichTextLabel');
    this.clip_contents = true;
    this.bbcode_enabled = false;
    this.fit_content = false;
    this.scroll_active = true;
    this.autowrap_mode = AUTOWRAP.WORD_SMART;
    this._text = '';
    this._layout = null;
    this._layoutWidth = -1;
  }

  get text() {
    return this._text;
  }
  set text(t) {
    this._text = String(t);
    this._layout = null;
    this.update_minimum_size();
    this.queue_redraw();
  }

  _theme_changed() {
    this._layout = null;
  }

  _resized() {
    this._layout = null;
    this.update_minimum_size();
  }

  _fontFor(span) {
    if (span.bold && span.italic) return [this.get_theme_font('bold_italics_font'), this.get_theme_font_size('bold_italics_font_size')];
    if (span.bold) return [this.get_theme_font('bold_font'), this.get_theme_font_size('bold_font_size')];
    if (span.italic) return [this.get_theme_font('italics_font'), this.get_theme_font_size('italics_font_size')];
    return [this.get_theme_font('normal_font'), this.get_theme_font_size('normal_font_size')];
  }

  /** Paragraphs (split at newlines), each laid out at the current width. */
  _laidOut() {
    const style = this.get_theme_stylebox('normal');
    const width = Math.max(1, this.size.x - (style ? style.get_minimum_size().x : 0));
    if (this._layout && this._layoutWidth === width) return this._layout;
    const spans = this.bbcode_enabled ? parseBBCode(this._text) : [{ text: this._text, bold: false, italic: false, color: null }];
    const paragraphs = [[]];
    for (const span of spans) {
      const parts = span.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) paragraphs.push([]);
        if (part) paragraphs[paragraphs.length - 1].push({ ...span, text: part });
      });
    }
    const lineSep = this.get_theme_constant('line_separation');
    const paraSep = this.get_theme_constant('paragraph_separation');
    const layout = [];
    let y = 0;
    let contentW = 0;
    for (const para of paragraphs) {
      const resolved = para.map((s) => {
        const [font, size] = this._fontFor(s);
        return { text: s.text, font, size, color: s.color };
      });
      if (resolved.length === 0) {
        const [font, size] = this._fontFor({});
        resolved.push({ text: '', font, size, color: null });
      }
      const paragraph = new Paragraph(resolved);
      const lines = paragraph.lines(this.autowrap_mode === AUTOWRAP.OFF ? 0 : width, autowrapFlags(this.autowrap_mode));
      for (const line of lines) {
        layout.push({ paragraph, line, y });
        y += line.size.y + lineSep;
        contentW = Math.max(contentW, line.size.x);
      }
      y += paraSep;
    }
    this._layout = layout;
    this._layoutWidth = width;
    this._contentHeight = Math.max(0, y - lineSep - paraSep);
    this._contentWidth = contentW;
    return layout;
  }

  get_content_height() {
    this._laidOut();
    return this._contentHeight;
  }

  get_minimum_size() {
    const style = this.get_theme_stylebox('normal');
    const sb = style ? style.get_minimum_size() : { x: 0, y: 0 };
    const min = { x: 0, y: 0 };
    if (this.fit_content) {
      this._laidOut();
      min.x = this._contentWidth;
      min.y = this._contentHeight;
    }
    return this.autowrap_mode !== AUTOWRAP.OFF ? { x: sb.x + 1, y: sb.y + min.y } : { x: sb.x + min.x, y: sb.y + min.y };
  }

  _draw_self() {
    const style = this.get_theme_stylebox('normal');
    const ofs = style ? style.get_offset() : { x: 0, y: 0 };
    const defaultColor = this.get_theme_color('default_color');
    for (const { paragraph, line, y } of this._laidOut()) {
      const pass = { colorFor: (span) => span.color ?? defaultColor, outline: 0 };
      for (const run of lineRuns(paragraph, line, ofs.x, ofs.y + y + line.ascent, [pass])) this.draw_glyph_run(run);
    }
  }
}

export { SceneTree, SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM };
