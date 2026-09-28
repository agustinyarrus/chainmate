/**
 * Buttons — BaseButton (press/hover/toggle state machine of the engine), Button (stylebox per draw
 * mode, focus box, centred or left-aligned text paragraph), CheckButton (switch icon on the right),
 * OptionButton (arrow icon, fit-to-longest-item width, PopupMenu with radio items).
 */
import { Color } from '../math.js';
import { Signal } from '../signal.js';
import { SceneTree } from '../scene.js';
import { Control, MOUSE_FILTER, FOCUS, HORIZONTAL_ALIGNMENT, Gui } from './control.js';
import { AUTOWRAP, Paragraph, autowrapFlags, lineRuns } from './text.js';

export const DRAW_MODE = Object.freeze({ NORMAL: 0, PRESSED: 1, HOVER: 2, DISABLED: 3, HOVER_PRESSED: 4 });
export const ACTION_MODE = Object.freeze({ PRESS: 0, RELEASE: 1 });

/** BaseButton.button_mask: the mouse buttons that press it (MOUSE_BUTTON_MASK_LEFT). */
const LEFT_BUTTON_MASK = 1;
const buttonMaskOf = (button) => 1 << (button - 1);

/**
 * BaseButton — Godot 4.7's (scene/gui/base_button.cpp): the hover comes from the viewport's mouse-over
 * notifications; a mouse press only starts pressing a button the pointer is over, ui_accept presses the
 * focused one; the action fires on release (or press, by action_mode) while the press stays inside;
 * leaving the focus, hiding or leaving the tree drops a press in progress. The button does not accept
 * the event: mouse events stop at it because it is a STOP control, keys go on to _unhandled_input.
 */
export class BaseButton extends Control {
  static themeType = 'BaseButton';

  constructor(name = '') {
    super(name);
    this.focus_mode = FOCUS.ALL;
    this.mouse_filter = MOUSE_FILTER.STOP;
    this.toggle_mode = false;
    this.action_mode = ACTION_MODE.RELEASE;
    this.keep_pressed_outside = false;
    this.button_mask = LEFT_BUTTON_MASK;
    this._disabled = false;
    // BaseButton::status
    this._pressed = false;
    this._hovering = false;
    this._pressAttempt = false;
    this._pressingInside = false;
    this._pressedDownWithFocus = false;
    this.pressed = new Signal();
    this.toggled = new Signal();
    this.button_down = new Signal();
    this.button_up = new Signal();
  }

  _notify_mouse_enter() {
    this._hovering = true;
    this.queue_redraw();
  }

  _notify_mouse_exit() {
    this._hovering = false;
    this.queue_redraw();
  }

  _notify_focus_enter() {
    super._notify_focus_enter();
    this.queue_redraw();
  }

  /** NOTIFICATION_FOCUS_EXIT (sent reversed: the button settles before the signal goes out). */
  _notify_focus_exit() {
    if (this._pressAttempt) {
      this._pressAttempt = false;
      this.queue_redraw();
    } else if (this._hovering) {
      this.queue_redraw();
    }
    if (this._pressedDownWithFocus) {
      this._pressedDownWithFocus = false;
      this.button_up.emit();
    }
    super._notify_focus_exit();
  }

  /** NOTIFICATION_VISIBILITY_CHANGED (hidden) and NOTIFICATION_EXIT_TREE. */
  _resetStatus() {
    if (!this.toggle_mode) this._pressed = false;
    this._hovering = false;
    this._pressAttempt = false;
    this._pressingInside = false;
  }

  _visibility_changed() {
    super._visibility_changed();
    if (!this.is_visible_in_tree()) this._resetStatus();
  }

  _exit_tree() {
    super._exit_tree();
    this._resetStatus();
  }

  get disabled() {
    return this._disabled;
  }
  set disabled(on) {
    on = Boolean(on);
    if (on === this._disabled) return;
    this._disabled = on;
    if (on) {
      if (!this.toggle_mode) this._pressed = false;
      this._pressAttempt = false;
      this._pressingInside = false;
      if (this._pressedDownWithFocus) {
        this._pressedDownWithFocus = false;
        this.button_up.emit();
      }
    }
    this.queue_redraw();
    this.update_minimum_size();
  }

  /** BaseButton::is_pressed: the toggle state, or a press in progress for plain buttons. */
  get button_pressed() {
    return this.toggle_mode ? this._pressed : this._pressAttempt;
  }
  set button_pressed(on) {
    on = Boolean(on);
    if (!this.toggle_mode || on === this._pressed) return;
    this._pressed = on;
    this.queue_redraw();
    this.toggled.emit(on);
  }

  set_pressed_no_signal(on) {
    if (!this.toggle_mode) return;
    this._pressed = Boolean(on);
    this.queue_redraw();
  }

  is_pressing() {
    return this._pressAttempt;
  }

  get_draw_mode() {
    if (this._disabled) return DRAW_MODE.DISABLED;
    if (!this._pressAttempt && this._hovering) return this._pressed ? DRAW_MODE.HOVER_PRESSED : DRAW_MODE.HOVER;
    let pressing;
    if (this._pressAttempt) {
      pressing = this._pressingInside || this.keep_pressed_outside;
      if (this._pressed) pressing = !pressing;
    } else pressing = this._pressed;
    return pressing ? DRAW_MODE.PRESSED : DRAW_MODE.NORMAL;
  }

  is_hovered() {
    return this._hovering;
  }

  /** BaseButton::_toggled then _pressed (virtual hooks, then the signals). */
  _activate() {
    if (this.toggle_mode) {
      this._pressed = !this._pressed;
      this._toggled_virtual?.(this._pressed);
      this.toggled.emit(this._pressed);
    }
    this._pressed_virtual?.();
    this.pressed.emit();
  }

  /** BaseButton::gui_input. */
  _gui_input(event) {
    this._gui_input_base(event);
  }

  _gui_input_base(event) {
    if (this._disabled) return;
    const mouseButton = event.kind === 'mouse_button';
    const uiAccept = event.is_action('ui_accept') && !event.echo;
    const masked = mouseButton && (this.button_mask & buttonMaskOf(event.button_index)) !== 0;
    if (masked || uiAccept) {
      this._onActionEvent(event, mouseButton);
    } else if (event.kind === 'mouse_motion' && this._pressAttempt) {
      const inside = this.has_point(event.position);
      if (inside !== this._pressingInside) {
        this._pressingInside = inside;
        this.queue_redraw();
      }
    }
  }

  /** BaseButton::on_action_event. */
  _onActionEvent(event, fromMouse) {
    if (event.pressed && (!fromMouse || this._hovering)) {
      this._pressAttempt = true;
      this._pressingInside = true;
      if (!this._pressedDownWithFocus) {
        this._pressedDownWithFocus = true;
        this.button_down.emit();
      }
    }
    if (this._pressAttempt && this._pressingInside) {
      const fires = (event.pressed && this.action_mode === ACTION_MODE.PRESS) || (!event.pressed && this.action_mode === ACTION_MODE.RELEASE);
      if (fires) {
        if (this.action_mode === ACTION_MODE.PRESS) {
          this._pressAttempt = false;
          this._pressingInside = false;
        }
        this._activate();
      }
    }
    if (!event.pressed) {
      this._pressAttempt = false;
      this._pressingInside = false;
      if (this._pressedDownWithFocus) {
        this._pressedDownWithFocus = false;
        this.button_up.emit();
      }
    }
    this.queue_redraw();
  }
}

export class Button extends BaseButton {
  static themeType = 'Button';

  constructor(text = '') {
    super('Button');
    this._text = text;
    this._alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.flat = false;
    this.clip_text = false;
    this.autowrap_mode = AUTOWRAP.OFF;
    this._paragraph = null;
    /** Space reserved at each side by subclasses (CheckButton's switch, OptionButton's arrow). */
    this._internalMargin = [0, 0, 0, 0];
  }

  get text() {
    return this._text;
  }
  set text(t) {
    t = String(t);
    if (t === this._text) return;
    this._text = t;
    this._paragraph = null;
    this.update_minimum_size();
    this.queue_redraw();
  }

  get alignment() {
    return this._alignment;
  }
  set alignment(a) {
    this._alignment = a;
    this.queue_redraw();
  }

  _theme_changed() {
    this._paragraph = null;
  }

  _textParagraph(text = this._text) {
    const font = this.get_theme_font('font');
    const size = this.get_theme_font_size('font_size');
    if (text !== this._text) return new Paragraph([{ text, font, size }]);
    this._paragraph ??= new Paragraph([{ text, font, size }]);
    return this._paragraph;
  }

  _currentStylebox() {
    switch (this.get_draw_mode()) {
      case DRAW_MODE.PRESSED:
        return this.get_theme_stylebox('pressed');
      case DRAW_MODE.HOVER:
        return this.get_theme_stylebox('hover');
      case DRAW_MODE.HOVER_PRESSED:
        return this.get_theme_stylebox('hover_pressed') ?? this.get_theme_stylebox('pressed');
      case DRAW_MODE.DISABLED:
        return this.get_theme_stylebox('disabled');
      default:
        return this.get_theme_stylebox('normal');
    }
  }

  _fontColor() {
    switch (this.get_draw_mode()) {
      case DRAW_MODE.NORMAL:
        // Focus colours only take precedence over the normal state, and only for a visible focus.
        return this.has_focus(true) ? this.get_theme_color('font_focus_color') : this.get_theme_color('font_color');
      case DRAW_MODE.HOVER_PRESSED:
        return this.get_theme_color('font_hover_pressed_color');
      case DRAW_MODE.PRESSED:
        return this.get_theme_color('font_pressed_color');
      case DRAW_MODE.HOVER:
        return this.get_theme_color('font_hover_color');
      default:
        return this.get_theme_color('font_disabled_color');
    }
  }

  /** TextParagraph::get_size for one line: (ceil width, ascent + descent). */
  _textSize(text = this._text) {
    const lines = this._textParagraph(text).lines(0, autowrapFlags(AUTOWRAP.OFF));
    let w = 0;
    let h = 0;
    for (const line of lines) {
      w = Math.max(w, line.size.x);
      h += line.size.y;
    }
    return { x: w, y: h };
  }

  get_minimum_size_for_text(text = this._text) {
    const size = text === '' ? { x: 0, y: 0 } : this._textSize(text);
    if (this.clip_text || this.autowrap_mode !== AUTOWRAP.OFF) size.x = 0;
    const style = this._currentStylebox();
    const m = style ? style.get_minimum_size() : { x: 0, y: 0 };
    return { x: m.x + size.x, y: m.y + size.y };
  }

  get_minimum_size() {
    const min = this.get_minimum_size_for_text();
    return { x: min.x + this._internalMarginWidth(), y: min.y };
  }

  _internalMarginWidth() {
    const hSep = Math.max(0, this.get_theme_constant('h_separation'));
    let w = 0;
    if (this._internalMargin[0] > 0) w += this._internalMargin[0] + hSep;
    if (this._internalMargin[2] > 0) w += this._internalMargin[2] + hSep;
    return w;
  }

  _draw_self() {
    const size = this.size;
    const style = this._currentStylebox();
    if (!this.flat && style) this.draw_style_box(style, { x: 0, y: 0, w: size.x, h: size.y });
    if (this.has_focus(true)) {
      const focus = this.get_theme_stylebox('focus');
      if (focus) this.draw_style_box(focus, { x: 0, y: 0, w: size.x, h: size.y });
    }
    this._draw_extras?.(style);
    if (this._text === '' || !style) return;
    const ml = style.get_margin(0);
    const mr = style.get_margin(2);
    const mt = style.get_margin(1);
    const mb = style.get_margin(3);
    const hSep = Math.max(0, this.get_theme_constant('h_separation'));
    let leftInternal = this._internalMargin[0];
    let rightInternal = this._internalMargin[2];
    if (leftInternal > 0) leftInternal += hSep;
    if (rightInternal > 0) rightInternal += hSep;
    const drawableW = size.x - ml - mr - leftInternal - rightInternal;
    const drawableH = size.y - mt - mb;
    const paragraph = this._textParagraph();
    const bufWidth = Math.ceil(Math.max(1, drawableW));
    const lines = paragraph.lines(this.autowrap_mode === AUTOWRAP.OFF ? 0 : bufWidth, autowrapFlags(this.autowrap_mode));
    let textH = 0;
    for (const line of lines) textH += line.size.y;
    let x;
    if (this._alignment === HORIZONTAL_ALIGNMENT.CENTER) x = Math.floor((size.x - bufWidth) / 2);
    else x = ml + leftInternal;
    let y = Math.floor((drawableH - textH) / 2) + mt;
    const color = this._fontColor();
    const outlineSize = this.get_theme_constant('outline_size');
    const outlineColor = this.get_theme_color('font_outline_color');
    const passes = [];
    if (outlineSize > 0 && outlineColor.a > 0) passes.push({ color: outlineColor, outline: outlineSize });
    passes.push({ color, outline: 0 });
    for (const line of lines) {
      y += line.ascent;
      let lx = x;
      if (this._alignment === HORIZONTAL_ALIGNMENT.CENTER) lx += Math.floor((bufWidth - line.size.x) / 2);
      else if (this._alignment === HORIZONTAL_ALIGNMENT.RIGHT) lx += bufWidth - line.size.x;
      for (const run of lineRuns(paragraph, line, lx, y, passes)) this.draw_glyph_run(run);
      y += line.descent;
    }
  }
}

/** CheckButton: a Button with the switch icon in the right internal margin. */
export class CheckButton extends Button {
  static themeType = 'CheckButton';

  constructor(text = '') {
    super(text);
    this.toggle_mode = true;
  }

  _icon() {
    const on = this._pressed;
    const name = this._disabled ? (on ? 'checked_disabled' : 'unchecked_disabled') : on ? 'checked' : 'unchecked';
    return this.get_theme_icon(name);
  }

  _iconSize() {
    let w = 0;
    let h = 0;
    for (const name of ['checked', 'unchecked', 'checked_disabled', 'unchecked_disabled']) {
      const icon = this.get_theme_icon(name);
      if (icon) {
        w = Math.max(w, icon.width);
        h = Math.max(h, icon.height);
      }
    }
    return { x: w, y: h };
  }

  get_minimum_size() {
    const icon = this._iconSize();
    this._internalMargin[2] = icon.x;
    const min = super.get_minimum_size();
    const style = this._currentStylebox();
    const styleH = style ? style.get_minimum_size().y : 0;
    return { x: min.x, y: Math.max(min.y, icon.y + styleH) };
  }

  _draw_extras(style) {
    const icon = this._icon();
    if (!icon) return;
    const size = this.size;
    const mr = style ? style.get_margin(2) : 0;
    const x = size.x - (icon.width + mr);
    const y = Math.trunc((size.y - icon.height) / 2) + this.get_theme_constant('check_v_offset');
    const tint = this._pressed ? this.get_theme_color('button_checked_color') : this.get_theme_color('button_unchecked_color');
    this.draw_texture_rect(icon, { x, y, w: icon.width, h: icon.height }, false, tint);
  }
}

/** OptionButton + its PopupMenu. */
export class OptionButton extends Button {
  static themeType = 'OptionButton';

  constructor() {
    super('');
    this.items = [];
    this.selected = -1;
    this.item_selected = new Signal();
    this.fit_to_longest_item = true;
    this._popup = null;
    this.alignment = HORIZONTAL_ALIGNMENT.LEFT;
    this.pressed.connect(() => this._openPopup());
  }

  add_item(label, id = -1) {
    this.items.push({ label: String(label), id: id < 0 ? this.items.length : id });
    if (this.selected < 0) this.select(0);
    this.update_minimum_size();
  }

  select(index) {
    if (index < 0 || index >= this.items.length) return;
    this.selected = index;
    this.text = this.items[index].label;
  }

  get_selected() {
    return this.selected;
  }

  get_minimum_size() {
    let min;
    if (this.fit_to_longest_item) {
      min = { x: 0, y: 0 };
      for (const item of this.items) {
        const s = this.get_minimum_size_for_text(item.label);
        min.x = Math.max(min.x, s.x);
        min.y = Math.max(min.y, s.y);
      }
      if (this.items.length === 0) min = this.get_minimum_size_for_text('');
    } else min = super.get_minimum_size();
    const arrow = this.get_theme_icon('arrow');
    if (arrow) {
      const style = this._currentStylebox();
      const padding = style ? style.get_minimum_size() : { x: 0, y: 0 };
      const content = { x: min.x - padding.x, y: min.y - padding.y };
      content.x += arrow.width + Math.max(0, this.get_theme_constant('h_separation'));
      content.y = Math.max(content.y, arrow.height);
      min = { x: content.x + padding.x, y: content.y + padding.y };
    }
    return min;
  }

  _draw_extras(style) {
    const arrow = this.get_theme_icon('arrow');
    if (!arrow) return;
    const size = this.size;
    const mr = style ? style.get_margin(2) : 0;
    const x = size.x - arrow.width - Math.max(mr, this.get_theme_constant('arrow_margin'));
    const y = Math.floor((size.y - arrow.height) / 2);
    const color = this.get_theme_constant('modulate_arrow') ? this._fontColor() : Color.WHITE;
    this.draw_texture_rect(arrow, { x, y, w: arrow.width, h: arrow.height }, false, color);
  }

  _openPopup() {
    if (this._popup || this.items.length === 0) return;
    const popup = new PopupMenu(this);
    this._popup = popup;
    Gui.viewport?.openPopup(popup, this);
  }

  _popupClosed(index) {
    this._popup = null;
    if (index >= 0 && index !== this.selected) {
      this.select(index);
      this.item_selected.emit(index);
    }
  }
}

/**
 * PopupMenu for OptionButton: panel stylebox, one row per item (radio icon + label), hover stylebox,
 * placed under the button (flipped above when it would leave the viewport).
 */
export class PopupMenu extends Control {
  static themeType = 'PopupMenu';

  constructor(owner) {
    super('PopupMenu');
    this.owner = owner;
    this.mouse_filter = MOUSE_FILTER.STOP;
    this.focus_mode = FOCUS.ALL;
    this.hovered = owner.selected;
    this.theme = owner.find_theme();
  }

  _font() {
    return this.get_theme_font('font');
  }
  _fontSize() {
    return this.get_theme_font_size('font_size');
  }

  _rowHeight() {
    const font = this._font();
    const size = this._fontSize();
    const icon = this.get_theme_icon('radio_checked');
    return Math.max(font.get_height(size), icon ? icon.height : 0) + this.get_theme_constant('v_separation');
  }

  get_minimum_size() {
    const panel = this.get_theme_stylebox('panel');
    const font = this._font();
    const size = this._fontSize();
    const icon = this.get_theme_icon('radio_checked');
    const hSep = this.get_theme_constant('h_separation');
    let w = 0;
    for (const item of this.owner.items) w = Math.max(w, Math.ceil(font.shape(item.label, size).width));
    const iconW = icon ? icon.width + hSep : 0;
    const pad = this.get_theme_constant('item_start_padding') + this.get_theme_constant('item_end_padding');
    const m = panel ? panel.get_minimum_size() : { x: 0, y: 0 };
    return { x: Math.max(w + iconW + pad + m.x, this.owner.size.x), y: this.owner.items.length * this._rowHeight() + m.y };
  }

  _itemAt(point) {
    const panel = this.get_theme_stylebox('panel');
    const top = panel ? panel.get_margin(1) : 0;
    const index = Math.floor((point.y - top) / this._rowHeight());
    return index >= 0 && index < this.owner.items.length ? index : -1;
  }

  _gui_input(event) {
    if (event.kind === 'mouse_motion') {
      const index = this._itemAt(event.position);
      if (index !== this.hovered) {
        this.hovered = index;
        this.queue_redraw();
      }
    } else if (event.kind === 'mouse_button' && event.button_index === 1 && !event.pressed) {
      const index = this._itemAt(event.position);
      if (index >= 0) this.close(index);
    } else if (event.kind === 'key' && event.pressed) {
      if (event.is_action('ui_down')) this.hovered = Math.min(this.owner.items.length - 1, this.hovered + 1);
      else if (event.is_action('ui_up')) this.hovered = Math.max(0, this.hovered - 1);
      else if (event.is_action('ui_accept')) this.close(this.hovered);
      else if (event.is_action('ui_cancel')) this.close(-1);
      this.queue_redraw();
    }
    this.accept_event();
  }

  close(index) {
    Gui.viewport?.closePopup(this);
    this.owner._popupClosed(index);
  }

  _draw_self() {
    const size = this.size;
    const panel = this.get_theme_stylebox('panel');
    if (panel) this.draw_style_box(panel, { x: 0, y: 0, w: size.x, h: size.y });
    const font = this._font();
    const fontSize = this._fontSize();
    const rowH = this._rowHeight();
    const left = panel ? panel.get_margin(0) : 0;
    const top = panel ? panel.get_margin(1) : 0;
    const hSep = this.get_theme_constant('h_separation');
    const start = this.get_theme_constant('item_start_padding');
    const hover = this.get_theme_stylebox('hover');
    this.owner.items.forEach((item, i) => {
      const y = top + i * rowH;
      if (i === this.hovered && hover) this.draw_style_box(hover, { x: left, y, w: size.x - left * 2, h: rowH });
      const icon = this.get_theme_icon(i === this.owner.selected ? 'radio_checked' : 'radio_unchecked');
      let x = left + start;
      if (icon) {
        this.draw_texture_rect(icon, { x, y: y + Math.floor((rowH - icon.height) / 2), w: icon.width, h: icon.height });
        x += icon.width + hSep;
      }
      const paragraph = new Paragraph([{ text: item.label, font, size: fontSize }]);
      const [line] = paragraph.lines(0, autowrapFlags(AUTOWRAP.OFF));
      const color = i === this.hovered ? this.get_theme_color('font_hover_color') : this.get_theme_color('font_color');
      const baseline = y + Math.floor((rowH - line.size.y) / 2) + line.ascent;
      for (const run of lineRuns(paragraph, line, x, baseline, [{ color, outline: 0 }])) this.draw_glyph_run(run);
    });
  }
}


export { SceneTree };
