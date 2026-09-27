/**
 * UiTheme — port of scripts/presentation/ui/ui_theme.gd: the six font variations (see fonts.js), the
 * `box` / `glow_box` StyleBoxFlat factories and the Theme every screen uses.
 */
import { Color } from '../../godot/math.js';
import { Theme } from '../../godot/ui/theme.js';
import { StyleBoxFlat } from '../../godot/ui/stylebox.js';
import { ImageTexture } from '../../godot/ui/widgets.js';
import { Fonts } from './fonts.js';
import { Palette } from '../palette.js';

let theme = null;

export class UiTheme {
  static theme() {
    theme ??= UiTheme._build();
    return theme;
  }

  static display_font() { return Fonts.display; }
  static caps_font() { return Fonts.caps; }
  static body_font() { return Fonts.body; }
  static bold_font() { return Fonts.bold; }
  static italic_font() { return Fonts.italic; }
  static number_font() { return Fonts.numbers; }

  /** box(fill, edge = TRANSPARENT, border = 0, radius = 3, pad = (14, 10, 14, 10)) */
  static box(fill, edge = Color.TRANSPARENT, border = 0, radius = 3, pad = [14, 10, 14, 10]) {
    const style = new StyleBoxFlat();
    style.bg_color = fill;
    style.border_color = edge;
    style.set_border_width_all(border);
    style.set_corner_radius_all(radius);
    style.content_margin = [pad[0], pad[1], pad[2], pad[3]];
    style.anti_aliasing = true;
    return style;
  }

  static glow_box(pad = [18, 16, 18, 16]) {
    const style = UiTheme.box(new Color(0.06, 0.1, 0.17, 0.96), Palette.ACCENT, 1, 4, pad);
    style.shadow_color = Palette.ACCENT_GLOW;
    style.shadow_size = 12;
    return style;
  }

  static _build() {
    const t = new Theme();
    t.default_font = 'body';
    t.default_font_size = 20;

    t.set_color('font_color', 'Label', Palette.INK);
    t.set_color('font_shadow_color', 'Label', new Color(0, 0, 0, 0.6));
    t.set_constant('shadow_offset_x', 'Label', 0);
    t.set_constant('shadow_offset_y', 'Label', 1);

    const pad = [20, 9, 20, 10];
    t.set_stylebox('normal', 'Button', UiTheme.box(new Color(0.05, 0.075, 0.115, 0.94), Palette.PANEL_EDGE_STRONG, 1, 3, pad));
    t.set_stylebox('hover', 'Button', UiTheme.box(new Color(0.07, 0.11, 0.18, 0.97), Palette.ACCENT, 1, 3, pad));
    t.set_stylebox('pressed', 'Button', UiTheme.box(new Color(0.09, 0.15, 0.26, 0.98), Palette.ACCENT, 1, 3, pad));
    t.set_stylebox('disabled', 'Button', UiTheme.box(new Color(0.04, 0.05, 0.075, 0.7), new Color(1, 1, 1, 0.06), 1, 3, pad));
    const focus = UiTheme.box(Color.TRANSPARENT, Palette.ACCENT, 2, 4, [0, 0, 0, 0]);
    focus.draw_center = false;
    t.set_stylebox('focus', 'Button', focus);
    t.set_color('font_color', 'Button', Palette.INK);
    t.set_color('font_hover_color', 'Button', Color.WHITE);
    t.set_color('font_pressed_color', 'Button', Color.WHITE);
    t.set_color('font_focus_color', 'Button', Palette.INK);
    t.set_color('font_disabled_color', 'Button', Palette.FAINT);
    t.set_font('font', 'Button', 'display');
    t.set_font_size('font_size', 'Button', 16);

    t.set_stylebox('panel', 'PanelContainer', UiTheme.box(Palette.PANEL, Palette.PANEL_EDGE, 1, 4, [22, 18, 22, 18]));
    t.set_stylebox('panel', 'Panel', UiTheme.box(Palette.PANEL, Palette.PANEL_EDGE, 1, 4));

    t.set_stylebox('panel', 'TooltipPanel', UiTheme.box(new Color(0.03, 0.045, 0.075, 0.97), Palette.PANEL_EDGE_STRONG, 1, 3, [12, 8, 12, 8]));
    t.set_color('font_color', 'TooltipLabel', Palette.INK);
    t.set_font_size('font_size', 'TooltipLabel', 18);

    t.set_stylebox('normal', 'LineEdit', UiTheme.box(new Color(0.03, 0.045, 0.075, 0.95), Palette.PANEL_EDGE_STRONG, 1, 3, [12, 8, 12, 8]));
    t.set_stylebox('focus', 'LineEdit', UiTheme.box(new Color(0.03, 0.045, 0.075, 0.95), Palette.ACCENT, 1, 3, [12, 8, 12, 8]));
    t.set_color('font_color', 'LineEdit', Palette.INK);
    t.set_color('font_placeholder_color', 'LineEdit', Palette.FAINT);
    t.set_color('caret_color', 'LineEdit', Palette.ACCENT);
    t.set_font_size('font_size', 'LineEdit', 20);

    const groove = UiTheme.box(new Color(0.12, 0.14, 0.18, 1), Color.TRANSPARENT, 0, 2, [0, 3, 0, 3]);
    t.set_stylebox('slider', 'HSlider', groove);
    const fill = UiTheme.box(Palette.ACCENT.darkened(0.2), Color.TRANSPARENT, 0, 2, [0, 3, 0, 3]);
    t.set_stylebox('grabber_area', 'HSlider', fill);
    t.set_stylebox('grabber_area_highlight', 'HSlider', fill);
    t.set_icon('grabber', 'HSlider', UiTheme._dot_texture(18, Palette.INK));
    t.set_icon('grabber_highlight', 'HSlider', UiTheme._dot_texture(18, Color.WHITE));

    t.set_color('font_color', 'CheckButton', Palette.INK);
    t.set_color('font_hover_color', 'CheckButton', Color.WHITE);
    const flat = UiTheme.box(Color.TRANSPARENT, Color.TRANSPARENT, 0, 3, [4, 4, 4, 4]);
    t.set_stylebox('normal', 'CheckButton', flat);
    t.set_stylebox('hover', 'CheckButton', UiTheme.box(new Color(1, 1, 1, 0.04), Color.TRANSPARENT, 0, 3, [4, 4, 4, 4]));
    t.set_stylebox('pressed', 'CheckButton', flat);
    t.set_stylebox('focus', 'CheckButton', focus);

    t.set_stylebox('panel', 'PopupMenu', UiTheme.box(new Color(0.03, 0.045, 0.075, 0.97), Palette.PANEL_EDGE_STRONG, 1, 3));
    t.set_stylebox('normal', 'OptionButton', t.get_stylebox('normal', 'Button'));
    t.set_stylebox('hover', 'OptionButton', t.get_stylebox('hover', 'Button'));
    t.set_stylebox('pressed', 'OptionButton', t.get_stylebox('pressed', 'Button'));
    t.set_stylebox('focus', 'OptionButton', focus);
    t.set_font('font', 'OptionButton', 'body');
    t.set_font_size('font_size', 'OptionButton', 18);
    t.set_font('font', 'PopupMenu', 'body');
    t.set_font_size('font_size', 'PopupMenu', 18);

    const scroll = UiTheme.box(new Color(1, 1, 1, 0.04), Color.TRANSPARENT, 0, 2, [0, 0, 0, 0]);
    t.set_stylebox('scroll', 'VScrollBar', scroll);
    t.set_stylebox('grabber', 'VScrollBar', UiTheme.box(Palette.FAINT, Color.TRANSPARENT, 0, 2, [0, 0, 0, 0]));
    t.set_stylebox('grabber_highlight', 'VScrollBar', UiTheme.box(Palette.MUTED, Color.TRANSPARENT, 0, 2, [0, 0, 0, 0]));
    t.set_stylebox('grabber_pressed', 'VScrollBar', UiTheme.box(Palette.INK, Color.TRANSPARENT, 0, 2, [0, 0, 0, 0]));
    return t;
  }

  /** An anti-aliased disc: alpha = clamp(centre − d + 0.5), like the original's Image loop. */
  static _dot_texture(size, color) {
    const texture = new ImageTexture(size, size);
    const center = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.fround(Math.hypot(x - center, y - center));
        texture.set_pixel(x, y, new Color(color, Math.min(Math.max(center - d + 0.5, 0), 1)));
      }
    }
    return texture;
  }
}
