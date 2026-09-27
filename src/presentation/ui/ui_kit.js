/**
 * UiKit — port of scripts/presentation/ui/ui_kit.gd: the label/button/box factories every screen is
 * built from, the primary button style, the ornament rule, scrims and the fade-in helper.
 */
import { Color } from '../../godot/math.js';
import { TRANS, EASE } from '../../godot/tween.js';
import { Control, MOUSE_FILTER, FOCUS, SIZE, PRESET } from '../../godot/ui/control.js';
import { Container, VBoxContainer, HBoxContainer, PanelContainer, CenterContainer } from '../../godot/ui/containers.js';
import { Label } from '../../godot/ui/label.js';
import { Button } from '../../godot/ui/buttons.js';
import { ColorRect, RichTextLabel } from '../../godot/ui/widgets.js';
import { AUTOWRAP } from '../../godot/ui/text.js';
import { ChessRules } from '../../core/chess_rules.js';
import { Sfx } from '../../autoload/sfx.js';
import { Palette } from '../palette.js';
import { UiTheme } from './ui_theme.js';

/** The small gold rule with a diamond in the middle. */
export class Ornament extends Control {
  constructor() {
    super('Ornament');
    this.color = Palette.GOLD;
  }
  _draw() {
    const size = this.size;
    const mid = { x: size.x * 0.5, y: size.y * 0.5 };
    this.draw_line({ x: 0, y: mid.y }, { x: mid.x - 9, y: mid.y }, new Color(this.color, 0.55), 1.0, true);
    this.draw_line({ x: mid.x + 9, y: mid.y }, { x: size.x, y: mid.y }, new Color(this.color, 0.55), 1.0, true);
    this.draw_colored_polygon([{ x: mid.x, y: mid.y - 5 }, { x: mid.x + 5, y: mid.y }, { x: mid.x, y: mid.y + 5 }, { x: mid.x - 5, y: mid.y }], this.color);
  }
}

export class UiKit {
  static label(text, size = 20, color = Palette.INK, font = null) {
    const node = new Label();
    node.text = text;
    node.add_theme_font_size_override('font_size', size);
    node.add_theme_color_override('font_color', color);
    if (font !== null) node.add_theme_font_override('font', font);
    return node;
  }

  static title(text, size = 34, color = Palette.INK) {
    return UiKit.label(text, size, color, UiTheme.display_font());
  }

  static caption(text, color = Palette.MUTED, size = 13) {
    return UiKit.label(String(text).toUpperCase(), size, color, UiTheme.caps_font());
  }

  static flavor(text, size = 18, color = Palette.MUTED) {
    return UiKit.label(text, size, color, UiTheme.italic_font());
  }

  static number(text, size = 28, color = Palette.INK) {
    return UiKit.label(text, size, color, UiTheme.number_font());
  }

  static wrap(text, size = 18, color = Palette.MUTED, width = 300.0) {
    const node = UiKit.label(text, size, color);
    node.autowrap_mode = AUTOWRAP.WORD_SMART;
    node.custom_minimum_size = { x: width, y: node.custom_minimum_size.y };
    return node;
  }

  static rich(bbcode, size = 19, width = 320.0) {
    const node = new RichTextLabel();
    node.bbcode_enabled = true;
    node.fit_content = true;
    node.scroll_active = false;
    node.text = bbcode;
    node.custom_minimum_size = { x: width, y: node.custom_minimum_size.y };
    node.add_theme_font_override('normal_font', UiTheme.body_font());
    node.add_theme_font_override('bold_font', UiTheme.bold_font());
    node.add_theme_font_override('italics_font', UiTheme.italic_font());
    node.add_theme_font_size_override('normal_font_size', size);
    node.add_theme_font_size_override('bold_font_size', size);
    node.add_theme_font_size_override('italics_font_size', size);
    node.add_theme_color_override('default_color', Palette.INK);
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    return node;
  }

  static button(text, action = null, primary = false, minWidth = 0.0) {
    const node = new Button();
    node.text = text;
    node.focus_mode = FOCUS.ALL;
    node.custom_minimum_size = { x: minWidth, y: node.custom_minimum_size.y };
    if (primary) UiKit.style_primary(node);
    node.mouse_entered.connect(() => UiKit._hover_sound(node));
    node.pressed.connect(() => Sfx.play('ui_click'));
    if (action) node.pressed.connect(action);
    return node;
  }

  static _hover_sound(node) {
    if (!node.disabled) Sfx.play('ui_hover', 1.0, -6.0);
  }

  static style_primary(node) {
    const pad = [24, 10, 24, 11];
    const normal = UiTheme.box(new Color(0.06, 0.1, 0.17, 0.96), Palette.ACCENT, 1, 3, pad);
    normal.shadow_color = new Color(Palette.ACCENT, 0.35);
    normal.shadow_size = 8;
    const hover = UiTheme.box(new Color(0.09, 0.15, 0.26, 0.98), Palette.ACCENT.lightened(0.3), 1, 3, pad);
    hover.shadow_color = new Color(Palette.ACCENT, 0.55);
    hover.shadow_size = 12;
    node.add_theme_stylebox_override('normal', normal);
    node.add_theme_stylebox_override('hover', hover);
    node.add_theme_stylebox_override('pressed', UiTheme.box(new Color(0.12, 0.2, 0.34, 1.0), Palette.ACCENT.lightened(0.3), 1, 3, pad));
    node.add_theme_stylebox_override('disabled', UiTheme.box(new Color(0.04, 0.05, 0.075, 0.7), new Color(1, 1, 1, 0.08), 1, 3, pad));
    node.add_theme_font_size_override('font_size', 17);
  }

  static vbox(separation = 10) {
    const node = new VBoxContainer();
    node.add_theme_constant_override('separation', separation);
    return node;
  }

  static hbox(separation = 10) {
    const node = new HBoxContainer();
    node.add_theme_constant_override('separation', separation);
    return node;
  }

  static spacer(expandHorizontal = true) {
    const node = new Control('Spacer');
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    if (expandHorizontal) node.size_flags_horizontal = SIZE.EXPAND_FILL;
    else node.size_flags_vertical = SIZE.EXPAND_FILL;
    return node;
  }

  static gap(height) {
    const node = new Control('Gap');
    node.custom_minimum_size = { x: 0, y: height };
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    return node;
  }

  static panel(fill = Palette.PANEL, edge = Palette.PANEL_EDGE, pad = [22, 18, 22, 18], radius = 4) {
    const node = new PanelContainer();
    node.add_theme_stylebox_override('panel', UiTheme.box(fill, edge, 1, radius, pad));
    return node;
  }

  static rule(color = Palette.PANEL_EDGE) {
    const node = new ColorRect();
    node.color = color;
    node.custom_minimum_size = { x: 0, y: 1 };
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    return node;
  }

  static ornament(width = 160.0, color = Palette.GOLD) {
    const node = new Ornament();
    node.custom_minimum_size = { x: width, y: 12 };
    node.color = color;
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    return node;
  }

  static scrim(alpha = 0.55) {
    const node = new ColorRect();
    node.color = new Color(0.01, 0.015, 0.025, alpha);
    node.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    node.mouse_filter = MOUSE_FILTER.STOP;
    return node;
  }

  static centered(child) {
    const node = new CenterContainer();
    node.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    node.mouse_filter = MOUSE_FILTER.IGNORE;
    node.add_child(child);
    return node;
  }

  /** Fades a node in (and slides it up by `rise`), as the original's screens appear. */
  static fade_in(node, duration = 0.25, rise = 12.0) {
    node.modulate = new Color(node.modulate, 0.0);
    const tween = node.create_tween().set_parallel(true);
    tween.tween_property(node, 'modulate:a', 1.0, duration);
    if (node instanceof Control && rise !== 0.0) {
      if (node.parent instanceof Container) throw new Error('fade_in cannot rise a container child');
      const rest = node.position;
      node.position = { x: rest.x, y: rest.y + rise };
      tween.tween_property(node, 'position:y', rest.y, duration).set_trans(TRANS.CUBIC).set_ease(EASE.OUT);
    }
  }

  static format_int(value) {
    let digits = String(Math.abs(value));
    let out = '';
    while (digits.length > 3) {
      out = `,${digits.slice(-3)}${out}`;
      digits = digits.slice(0, -3);
    }
    return (value < 0 ? '-' : '') + digits + out;
  }

  static piece_name(kind) {
    return String(ChessRules.PIECE_INFO[kind].name);
  }
}
