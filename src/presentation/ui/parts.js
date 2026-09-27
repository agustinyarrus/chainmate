/**
 * Small game controls shared by the screens — ports of hud.gd's IconBox and PiecePortrait,
 * relic_token.gd, option_card.gd, choice_card.gd (+ IconView), piece_picker.gd, modal.gd, toast.gd.
 */
import { Color } from '../../godot/math.js';
import { Signal } from '../../godot/signal.js';
import { SceneTree } from '../../godot/scene.js';
import { Control, MOUSE_FILTER, FOCUS, CURSOR, SIZE, PRESET, GROW, HORIZONTAL_ALIGNMENT } from '../../godot/ui/control.js';
import { PanelContainer, HBoxContainer } from '../../godot/ui/containers.js';
import { Button } from '../../godot/ui/buttons.js';
import { ALIGNMENT } from '../../godot/ui/containers.js';
import { EASE } from '../../godot/tween.js';
import { Relics } from '../../core/relics.js';
import { GameState } from '../../core/game_state.js';
import { Sfx } from '../../autoload/sfx.js';
import { Palette } from '../palette.js';
import { UiTheme } from './ui_theme.js';
import { UiKit } from './ui_kit.js';
import { Icons } from './icons.js';
import { Emblems } from './emblems.js';

const V = (x, y) => ({ x, y });

/** Hud.IconBox: an icon drawn at 0.46 of the smaller side. */
export class IconBox extends Control {
  constructor() {
    super('IconBox');
    this.icon = '';
  }
  static make(iconName, size) {
    const box = new IconBox();
    box.icon = iconName;
    box.custom_minimum_size = V(size, size);
    box.size_flags_vertical = SIZE.SHRINK_CENTER;
    box.mouse_filter = MOUSE_FILTER.IGNORE;
    return box;
  }
  _draw() {
    const size = this.size;
    Icons.draw(this, this.icon, V(size.x * 0.5, size.y * 0.5), Math.min(size.x, size.y) * 0.46);
  }
}

/** Hud.PiecePortrait: framed silhouette with level pips. */
export class PiecePortrait extends Control {
  constructor() {
    super('PiecePortrait');
    this.kind = 'pawn';
    this.friendly = true;
    this.level = 0;
  }
  _draw() {
    const size = this.size;
    const rect = { x: 0, y: 0, w: size.x, h: size.y };
    this.draw_rect(rect, new Color(0.07, 0.1, 0.16, 0.9));
    this.draw_rect(rect, Palette.PANEL_EDGE_STRONG, false, 1.0);
    const tint = this.friendly ? Palette.INK : new Color('2a2830');
    const outline = this.friendly ? Palette.GOLD : Palette.CAPTURE;
    const centre = V(size.x * 0.5, size.y * 0.46);
    const radius = Math.min(size.x, size.y) * 0.36;
    Emblems.draw_piece(this, this.kind, V(centre.x + 1.5, centre.y + 1.5), radius, new Color(0, 0, 0, 0.5));
    Emblems.draw_piece(this, this.kind, centre, radius, tint);
    if (!this.friendly) Emblems.draw_piece(this, this.kind, centre, radius * 0.96, new Color(outline, 0.18));
    for (let i = 0; i < GameState.MAX_LEVEL; i++) {
      const at = V(size.x * 0.5 + (i - 1) * 14.0, size.y - 11.0);
      const pip = [V(at.x, at.y - 5), V(at.x + 5, at.y), V(at.x, at.y + 5), V(at.x - 5, at.y)];
      if (i < this.level) this.draw_colored_polygon(pip, Palette.GOLD);
      else this.draw_polyline([...pip, pip[0]], new Color(Palette.GOLD, 0.4), 1.0, true);
    }
  }
}

/** RelicToken: a relic slot with rarity edge, hover/selection highlight, pulse and rich tooltip. */
export class RelicToken extends Control {
  constructor() {
    super('RelicToken');
    this.relic_id = '';
    this.side = 56.0;
    this.interactive = false;
    this._selected = false;
    this._pulse = 0.0;
    this._hover = false;
    this.activated = new Signal();
    this.mouse_entered.connect(() => this._setHover(true));
    this.mouse_exited.connect(() => this._setHover(false));
  }

  static make(id, size = 56.0, clickable = false) {
    const token = new RelicToken();
    token.relic_id = id;
    token.side = size;
    token.interactive = clickable;
    token.custom_minimum_size = V(size, size);
    token.mouse_filter = id !== '' ? MOUSE_FILTER.STOP : MOUSE_FILTER.IGNORE;
    token.tooltip_text = id !== '' ? ' ' : '';
    return token;
  }

  get selected() {
    return this._selected;
  }
  set selected(on) {
    this._selected = on;
    this.queue_redraw();
  }

  _ready() {
    if (this.interactive) this.mouse_default_cursor_shape = CURSOR.POINTING_HAND;
  }

  pulse() {
    const tween = this.create_tween();
    tween.tween_method((v) => this._setPulse(v), 1.0, 0.0, 0.8).set_ease(EASE.OUT);
  }

  _setPulse(value) {
    this._pulse = value;
    this.queue_redraw();
  }

  _setHover(on) {
    this._hover = on;
    this.queue_redraw();
  }

  _gui_input(event) {
    if (this.interactive && event.kind === 'mouse_button' && event.pressed && event.button_index === 1) this.activated.emit(this.relic_id);
  }

  _draw() {
    const size = this.size;
    const rect = { x: 1, y: 1, w: size.x - 2, h: size.y - 2 };
    if (this.relic_id === '') {
      this.draw_rect(rect, new Color(0.05, 0.07, 0.11, 0.55));
      this.draw_rect(rect, new Color(1, 1, 1, 0.1), false, 1.0);
      return;
    }
    const info = Relics.info(this.relic_id);
    const rarity = Palette.RARITY_COLORS[String(info.rarity)];
    if (this._pulse > 0.0) {
      const g = 6.0 * this._pulse;
      this.draw_rect({ x: rect.x - g, y: rect.y - g, w: rect.w + g * 2, h: rect.h + g * 2 }, new Color(Palette.ACCENT, 0.35 * this._pulse));
    }
    this.draw_rect(rect, new Color(0.06, 0.085, 0.13, 0.96));
    this.draw_rect({ x: rect.x + 3, y: rect.y + 3, w: rect.w - 6, h: rect.h - 6 }, new Color(0.09, 0.12, 0.18, 0.9));
    const lit = this._selected || this._hover || this._pulse > 0.0;
    const edge = lit ? Palette.ACCENT : new Color(rarity, 0.55);
    this.draw_rect(rect, edge, false, this._selected || this._hover ? 1.5 : 1.0);
    Icons.draw(this, String(info.icon), V(size.x * 0.5, size.y * 0.5), Math.min(size.x, size.y) * 0.34 * (1.0 + this._pulse * 0.1));
  }

  _make_custom_tooltip() {
    return RelicToken.describe(this.relic_id);
  }

  static describe(id, width = 300.0) {
    const info = Relics.info(id);
    const box = UiKit.vbox(4);
    const header = UiKit.hbox(10);
    header.add_child(UiKit.title(String(info.name), 20, Palette.INK));
    header.add_child(UiKit.caption(String(info.rarity), Palette.RARITY_COLORS[String(info.rarity)], 11));
    box.add_child(header);
    box.add_child(UiKit.wrap(String(info.desc), 18, Palette.INK, width));
    box.add_child(UiKit.flavor(String(info.flavor), 17));
    return box;
  }
}

/** OptionCard: a selectable panel (army / difficulty choices). */
export class OptionCard extends PanelContainer {
  constructor() {
    super();
    this.name = 'OptionCard';
    this._selected = false;
    this._locked = false;
    this._hover = false;
    this.pressed = new Signal();
    this.focus_mode = FOCUS.ALL;
    this.mouse_filter = MOUSE_FILTER.STOP;
    this.mouse_default_cursor_shape = CURSOR.POINTING_HAND;
    this.mouse_entered.connect(() => this._setHover(true));
    this.mouse_exited.connect(() => this._setHover(false));
    this.focus_entered.connect(() => this._restyle());
    this.focus_exited.connect(() => this._restyle());
  }

  get selected() { return this._selected; }
  set selected(v) { this._selected = v; this._restyle(); }
  get locked() { return this._locked; }
  set locked(v) { this._locked = v; this._restyle(); }

  _ready() {
    this._restyle();
  }

  _setHover(on) {
    this._hover = on;
    if (on && !this._locked) Sfx.play('ui_hover', 1.0, -6.0);
    this._restyle();
  }

  _gui_input(event) {
    const clicked = event.kind === 'mouse_button' && event.pressed && event.button_index === 1;
    if ((clicked || event.is_action_pressed('ui_accept')) && !this._locked) {
      Sfx.play('ui_click');
      this.pressed.emit();
      this.accept_event();
    }
  }

  _restyle() {
    const pad = [16, 14, 16, 14];
    if (this._selected) this.add_theme_stylebox_override('panel', UiTheme.glow_box(pad));
    else if ((this._hover || this.has_focus()) && !this._locked) this.add_theme_stylebox_override('panel', UiTheme.box(new Color(0.06, 0.09, 0.14, 0.96), new Color(Palette.ACCENT, 0.6), 1, 4, pad));
    else this.add_theme_stylebox_override('panel', UiTheme.box(new Color(0.045, 0.065, 0.1, 0.94), Palette.PANEL_EDGE, 1, 4, pad));
    this.modulate = new Color(this.modulate, this._locked ? 0.55 : 1.0);
    this.update_minimum_size();
  }
}

/** ChoiceCard.IconView: halo + icon, or a piece silhouette with a badge icon. */
class IconView extends Control {
  constructor() {
    super('IconView');
    this.icon = '';
    this.piece_kind = '';
  }
  _draw() {
    const size = this.size;
    const centre = V(size.x * 0.5, size.y * 0.5);
    const radius = Math.min(size.x, size.y) * 0.42;
    this.draw_circle(centre, radius * 1.15, new Color(Palette.ACCENT, 0.06));
    if (this.piece_kind !== '') {
      Emblems.draw_piece(this, this.piece_kind, V(centre.x - radius * 0.35, centre.y), radius * 0.85, Palette.INK);
      if (this.icon !== '') Icons.draw(this, this.icon, V(centre.x + radius * 0.55, centre.y + radius * 0.25), radius * 0.55);
    } else Icons.draw(this, this.icon, centre, radius);
  }
}

/** ChoiceCard: a relic / upgrade / service card with an action button. */
export class ChoiceCard extends PanelContainer {
  constructor() {
    super();
    this.name = 'ChoiceCard';
    this.icon = '';
    this.piece_kind = '';
    this._button = null;
    this._hover = false;
    this._icon_view = null;
    this.chosen = new Signal();
  }

  static make(iconName, heading, body, buttonText, footer = '', kind = '') {
    const card = new ChoiceCard();
    card.icon = iconName;
    card.piece_kind = kind;
    card.custom_minimum_size = V(230, 300);
    const column = UiKit.vbox(10);
    column.alignment = ALIGNMENT.BEGIN;
    card.add_child(column);
    card._icon_view = new IconView();
    card._icon_view.icon = iconName;
    card._icon_view.piece_kind = kind;
    card._icon_view.custom_minimum_size = V(0, 100);
    column.add_child(card._icon_view);
    const nameLabel = UiKit.title(heading, 21, Palette.INK);
    nameLabel.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    nameLabel.autowrap_mode = 3;
    column.add_child(nameLabel);
    const text = UiKit.wrap(body, 18, Palette.MUTED, 190);
    text.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    column.add_child(text);
    column.add_child(UiKit.spacer(false));
    if (footer !== '') {
      const foot = UiKit.caption(footer, Palette.GOLD, 12);
      foot.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      column.add_child(foot);
    }
    card._button = UiKit.button(buttonText, () => card._choose());
    card._button.size_flags_horizontal = SIZE.SHRINK_CENTER;
    card._button.custom_minimum_size = V(140, card._button.custom_minimum_size.y);
    column.add_child(card._button);
    return card;
  }

  _ready() {
    this.mouse_filter = MOUSE_FILTER.PASS;
    this.mouse_entered.connect(() => this._setHover(true));
    this.mouse_exited.connect(() => this._setHover(false));
    this._button.focus_entered.connect(() => this._restyle());
    this._button.focus_exited.connect(() => this._restyle());
    this._restyle();
  }

  set_enabled(on, reason = '') {
    this._button.disabled = !on;
    this._button.tooltip_text = reason;
    this.modulate = new Color(this.modulate, on ? 1.0 : 0.6);
  }

  focus_button() {
    SceneTree.current.callDeferred(() => this._button.grab_focus());
  }

  _setHover(on) {
    this._hover = on;
    this._restyle();
  }

  _restyle() {
    const lit = (this._hover || this._button.has_focus()) && !this._button.disabled;
    this.add_theme_stylebox_override('panel', lit ? UiTheme.glow_box() : UiTheme.box(new Color(0.045, 0.065, 0.1, 0.95), Palette.PANEL_EDGE, 1, 4, [18, 16, 18, 16]));
  }

  _choose() {
    this.chosen.emit();
  }
}

/** PiecePicker: a row of portrait buttons; `picked(index)`. */
export class PiecePicker extends HBoxContainer {
  constructor() {
    super();
    this.name = 'PiecePicker';
    this.picked = new Signal();
  }

  static make(entries, enabled = null) {
    const row = new PiecePicker();
    row.add_theme_constant_override('separation', 8);
    row.alignment = ALIGNMENT.CENTER;
    entries.forEach((entry, i) => {
      const button = new Button();
      button.custom_minimum_size = V(92, 104);
      button.tooltip_text = `${UiKit.piece_name(String(entry.kind))} · level ${Math.trunc(entry.level)}`;
      button.focus_mode = FOCUS.ALL;
      if (enabled) button.disabled = !enabled(entry);
      const column = UiKit.vbox(2);
      column.mouse_filter = MOUSE_FILTER.IGNORE;
      column.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
      column.alignment = ALIGNMENT.CENTER;
      const portrait = new PiecePortrait();
      portrait.kind = String(entry.kind);
      portrait.level = Math.trunc(entry.level);
      portrait.custom_minimum_size = V(0, 70);
      portrait.mouse_filter = MOUSE_FILTER.IGNORE;
      column.add_child(portrait);
      const titleLabel = UiKit.caption(UiKit.piece_name(String(entry.kind)), Palette.INK, 11);
      titleLabel.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      column.add_child(titleLabel);
      button.add_child(column);
      button.pressed.connect(() => {
        Sfx.play('ui_click');
        row.picked.emit(i);
      });
      row.add_child(button);
    });
    return row;
  }
}

/** Modal: scrim + centred panel that scales down to fit, fades in, closes on Esc. */
export class Modal extends Control {
  constructor(titleText = '', width = 640.0, scrimAlpha = 0.6) {
    super('Modal');
    this.closed = new Signal();
    this.dismissable = true;
    this.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.mouse_filter = MOUSE_FILTER.STOP;
    this.theme = UiTheme.theme();
    this.add_child(UiKit.scrim(scrimAlpha));
    this.panel = UiKit.panel(new Color(0.04, 0.06, 0.095, 0.97), Palette.PANEL_EDGE_STRONG, [34, 28, 34, 28], 4);
    this.panel.custom_minimum_size = V(width, this.panel.custom_minimum_size.y);
    this._frame = new Control('Frame');
    this._frame.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this._frame.mouse_filter = MOUSE_FILTER.IGNORE;
    this._frame.add_child(this.panel);
    this.add_child(this._frame);
    this.content = UiKit.vbox(14);
    this.panel.add_child(this.content);
    if (titleText !== '') {
      const heading = UiKit.title(titleText, 34, Palette.INK);
      heading.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      this.content.add_child(heading);
      const rule = UiKit.ornament(240);
      rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
      this.content.add_child(rule);
    }
    this._fitDeferred = () => SceneTree.current.callDeferred(() => this._fit());
  }

  _ready() {
    UiKit.fade_in(this._frame, 0.22, 16.0);
    this.panel.minimum_size_changed.connect(this._fitDeferred);
    this.resized.connect(this._fitDeferred);
    this._fit();
  }

  _fit() {
    if (!this._inside) return;
    this.panel.reset_size();
    const need = this.panel.size;
    const room = V(this.size.x - 32.0, this.size.y - 32.0);
    const fit = Math.min(1.0, Math.min(room.x / need.x, room.y / need.y));
    this.panel.pivot_offset = V(need.x * 0.5, need.y * 0.5);
    this.panel.scale = V(fit, fit);
    this.panel.position = V((this.size.x - need.x) * 0.5, (this.size.y - need.y) * 0.5);
  }

  _unhandled_input(event) {
    if (this.dismissable && (event.is_action_pressed('pause') || event.is_action_pressed('ui_cancel'))) {
      SceneTree.current.setInputAsHandled();
      this.close();
    }
  }

  close() {
    Sfx.play('ui_back');
    this.closed.emit();
    this.queue_free();
  }

  add_row(captionText, control) {
    const row = UiKit.hbox(16);
    const label = UiKit.label(captionText, 19, Palette.INK);
    label.custom_minimum_size = V(240, label.custom_minimum_size.y);
    row.add_child(label);
    control.size_flags_horizontal = SIZE.EXPAND_FILL;
    row.add_child(control);
    this.content.add_child(row);
    return row;
  }

  add_footer(buttons) {
    this.content.add_child(UiKit.gap(4));
    const row = UiKit.hbox(12);
    row.alignment = ALIGNMENT.CENTER;
    for (const button of buttons) row.add_child(button);
    this.content.add_child(row);
    return row;
  }
}

/** Toast: a short message dropping in under the top edge, stacked. */
export class Toast extends PanelContainer {
  static show_on(parent, text, color = Palette.INK, hold = 2.2) {
    const toast = new Toast();
    toast.name = 'Toast';
    toast.add_theme_stylebox_override('panel', UiTheme.box(new Color(0.03, 0.045, 0.075, 0.95), new Color(color, 0.55), 1, 3, [20, 10, 20, 10]));
    toast.mouse_filter = MOUSE_FILTER.IGNORE;
    toast.add_child(UiKit.label(text, 19, color));
    toast.set_anchors_preset(PRESET.CENTER_TOP);
    toast.grow_horizontal = GROW.BOTH;
    let stacked = 0;
    for (const child of parent.children) if (child instanceof Toast) stacked += 1;
    toast.offset_top = 150 + stacked * 54;
    parent.add_child(toast);
    toast.modulate = new Color(toast.modulate, 0.0);
    const tween = toast.create_tween();
    tween.tween_property(toast, 'modulate:a', 1.0, 0.2);
    tween.tween_interval(hold);
    tween.tween_property(toast, 'modulate:a', 0.0, 0.4);
    tween.tween_callback(() => toast.queue_free());
  }
}
