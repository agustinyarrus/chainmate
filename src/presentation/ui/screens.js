/**
 * The game's screens and panels — ports of menu_screen.gd, new_run_screen.gd, map_screen.gd (+ MapView),
 * reward_screen.gd, merchant_screen.gd, rest_screen.gd, event_screen.gd, level_up_screen.gd,
 * summary_screen.gd, settings_panel.gd, records_panel.gd, credits_panel.gd, help_panel.gd, pause_menu.gd.
 * Layout, copy, colours and behaviour follow the originals line by line.
 */
import { Color, PI, TAU, lerpf, fposmod, is_equal_approx } from '../../godot/math.js';
import { Signal } from '../../godot/signal.js';
import { SceneTree } from '../../godot/scene.js';
import { OS } from '../../godot/os.js';
import { Control, MOUSE_FILTER, CURSOR, SIZE, PRESET, HORIZONTAL_ALIGNMENT, VERTICAL_ALIGNMENT } from '../../godot/ui/control.js';
import { MarginContainer, GridContainer, ALIGNMENT } from '../../godot/ui/containers.js';
import { CheckButton, OptionButton } from '../../godot/ui/buttons.js';
import { TextureRect, HSlider, ScrollContainer, LineEdit, gradientTexture2D, EXPAND_MODE, STRETCH_MODE, SCROLL_MODE } from '../../godot/ui/widgets.js';
import { Gradient } from '../../godot/particles.js';
import { GameState } from '../../core/game_state.js';
import { RunMap } from '../../core/run_map.js';
import { Relics } from '../../core/relics.js';
import { Events } from '../../core/events.js';
import { Upgrades } from '../../core/upgrades.js';
import { ChessRules } from '../../core/chess_rules.js';
import { Settings } from '../../autoload/settings.js';
import { Profile } from '../../autoload/profile.js';
import { Sfx } from '../../autoload/sfx.js';
import { Palette } from '../palette.js';
import { UiTheme } from './ui_theme.js';
import { UiKit } from './ui_kit.js';
import { Icons } from './icons.js';
import { Glyph } from './emblems.js';
import { IconBox, PiecePortrait, RelicToken, OptionCard, ChoiceCard, PiecePicker, Modal } from './parts.js';

const V = (x, y) => ({ x, y });
const deferred = (fn) => SceneTree.current.callDeferred(fn);
const ROMAN = ['I', 'II', 'III'];

// ────────────────────────────────────────────────────────────────── MenuScreen ─────────────────────

export class MenuScreen extends Control {
  constructor() {
    super('MenuScreen');
    this.continue_run = new Signal();
    this.new_run = new Signal();
    this.show_help = new Signal();
    this.show_records = new Signal();
    this.show_settings = new Signal();
    this.show_credits = new Signal();
    this.quit_game = new Signal();
    this._first_button = null;
  }

  setup(hasSave, summary) {
    this.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.mouse_filter = MOUSE_FILTER.IGNORE;
    this.theme = UiTheme.theme();
    const shade = new TextureRect();
    shade.texture = MenuScreen._side_gradient();
    shade.set_anchors_and_offsets_preset(PRESET.LEFT_WIDE);
    shade.offset_right = 820;
    shade.mouse_filter = MOUSE_FILTER.IGNORE;
    shade.expand_mode = EXPAND_MODE.IGNORE_SIZE;
    shade.stretch_mode = STRETCH_MODE.SCALE;
    this.add_child(shade);

    const margin = new MarginContainer();
    margin.set_anchors_and_offsets_preset(PRESET.LEFT_WIDE);
    margin.add_theme_constant_override('margin_left', 110);
    margin.add_theme_constant_override('margin_top', 96);
    margin.add_theme_constant_override('margin_bottom', 70);
    margin.mouse_filter = MOUSE_FILTER.IGNORE;
    this.add_child(margin);
    const column = UiKit.vbox(10);
    column.custom_minimum_size = V(440, 0);
    margin.add_child(column);
    const crown = IconBox.make('crown', 40);
    crown.size_flags_horizontal = SIZE.SHRINK_BEGIN;
    column.add_child(crown);
    column.add_child(UiKit.title('Chainmate', 88, Palette.INK));
    column.add_child(UiKit.ornament(360));
    column.add_child(UiKit.caption('A chess roguelite', Palette.GOLD, 15));
    column.add_child(UiKit.gap(8));
    column.add_child(UiKit.wrap('Same rules. More possibilities. Lead your ivory army across three acts, grow every piece, and never let the king fall.', 21, Palette.MUTED, 440));
    column.add_child(UiKit.gap(24));
    if (hasSave) {
      this._add(column, 'Continue run', () => this.continue_run.emit(), true);
      this._add(column, 'New run', () => this.new_run.emit());
    } else {
      this._add(column, 'New run', () => this.new_run.emit(), true);
    }
    this._add(column, 'How to play', () => this.show_help.emit());
    this._add(column, 'Records', () => this.show_records.emit());
    this._add(column, 'Settings', () => this.show_settings.emit());
    this._add(column, 'Credits', () => this.show_credits.emit());
    if (!OS.has_feature('web')) this._add(column, 'Quit', () => this.quit_game.emit());
    column.add_child(UiKit.spacer(false));
    if (summary !== '') column.add_child(UiKit.caption(summary, Palette.FAINT, 12));
    UiKit.fade_in(margin, 0.5, 20.0);
  }

  _ready() {
    if (this._first_button) deferred(() => this._first_button.grab_focus());
  }

  _add(column, text, action, primary = false) {
    const button = UiKit.button(text, action, primary, 300);
    button.size_flags_horizontal = SIZE.SHRINK_BEGIN;
    button.alignment = HORIZONTAL_ALIGNMENT.LEFT;
    column.add_child(button);
    this._first_button ??= button;
  }

  static _side_gradient() {
    const gradient = new Gradient();
    gradient.set_color(0, new Color(0.03, 0.045, 0.07, 0.94));
    gradient.set_color(1, new Color(0.03, 0.045, 0.07, 0.0));
    return gradientTexture2D(gradient, { width: 256, height: 4, fillFrom: V(0, 0.5), fillTo: V(1, 0.5) });
  }
}

// ────────────────────────────────────────────────────────────────── NewRunScreen ───────────────────

export class NewRunScreen extends Modal {
  constructor() {
    super('New run', 1080.0, 0.5);
    this.begin = new Signal();
    this._army = 'vanguard';
    this._difficulty = 'standard';
    this._seed_edit = null;
    this._army_cards = {};
    this._difficulty_cards = {};
  }

  _ready() {
    super._ready();
    const content = this.content;
    content.add_child(UiKit.caption('Army', Palette.MUTED, 13));
    const armies = UiKit.hbox(12);
    content.add_child(armies);
    for (const [preset, info] of Object.entries(GameState.ARMIES)) {
      const available = Profile.army_available(preset);
      const card = new OptionCard();
      card.size_flags_horizontal = SIZE.EXPAND_FILL;
      card.locked = !available;
      const column = UiKit.vbox(6);
      column.mouse_filter = MOUSE_FILTER.IGNORE;
      const pieces = UiKit.hbox(0);
      pieces.mouse_filter = MOUSE_FILTER.IGNORE;
      for (const kind of info.kinds) pieces.add_child(Glyph.make(String(kind), 30, Palette.INK));
      column.add_child(pieces);
      column.add_child(UiKit.title(String(info.name), 21));
      const note = available ? String(info.desc) : `Locked · ${Profile.unlock_hint(`army_${preset}`)}`;
      column.add_child(UiKit.wrap(note, 17, available ? Palette.MUTED : Palette.CAPTURE, 200));
      card.add_child(column);
      card.pressed.connect(() => this._pick_army(preset));
      armies.add_child(card);
      this._army_cards[preset] = card;
    }
    content.add_child(UiKit.gap(2));
    content.add_child(UiKit.caption('Difficulty', Palette.MUTED, 13));
    const levels = UiKit.hbox(12);
    content.add_child(levels);
    for (const [key, info] of Object.entries(GameState.DIFFICULTIES)) {
      const available = Profile.difficulty_available(key);
      const card = new OptionCard();
      card.size_flags_horizontal = SIZE.EXPAND_FILL;
      card.locked = !available;
      const column = UiKit.vbox(2);
      column.mouse_filter = MOUSE_FILTER.IGNORE;
      column.add_child(UiKit.title(String(info.name), 21));
      const note = available ? String(info.desc) : `Locked · ${Profile.unlock_hint(`difficulty_${key}`)}`;
      column.add_child(UiKit.wrap(note, 17, available ? Palette.MUTED : Palette.CAPTURE, 290));
      card.add_child(column);
      card.pressed.connect(() => this._pick_difficulty(key));
      levels.add_child(card);
      this._difficulty_cards[key] = card;
    }
    content.add_child(UiKit.gap(2));
    const seedRow = UiKit.hbox(12);
    seedRow.add_child(UiKit.caption('Seed', Palette.MUTED, 13));
    this._seed_edit = new LineEdit();
    this._seed_edit.placeholder_text = 'Random';
    this._seed_edit.max_length = 24;
    this._seed_edit.custom_minimum_size = V(260, 0);
    this._seed_edit.tooltip_text = 'The same seed and the same choices replay the same run.';
    seedRow.add_child(this._seed_edit);
    seedRow.add_child(UiKit.button('Roll', () => { this._seed_edit.text = GameState.random_seed_text(); }));
    seedRow.add_child(UiKit.spacer());
    seedRow.add_child(UiKit.button('Back', () => this.close()));
    const start = UiKit.button('Begin', () => this._begin(), true, 200);
    seedRow.add_child(start);
    content.add_child(UiKit.rule());
    content.add_child(seedRow);
    this._pick_army(this._army);
    this._pick_difficulty(this._difficulty);
    deferred(() => start.grab_focus());
  }

  _pick_army(preset) {
    if (!Profile.army_available(preset)) return;
    this._army = preset;
    for (const [key, card] of Object.entries(this._army_cards)) card.selected = key === preset;
  }

  _pick_difficulty(key) {
    if (!Profile.difficulty_available(key)) return;
    this._difficulty = key;
    for (const [level, card] of Object.entries(this._difficulty_cards)) card.selected = level === key;
  }

  _begin() {
    this.begin.emit({ army: this._army, difficulty: this._difficulty, seed: this._seed_edit.text });
    this.queue_free();
  }
}

// ────────────────────────────────────────────────────────────────── MapScreen ──────────────────────

class MapView extends Control {
  constructor() {
    super('MapView');
    this.chosen = new Signal();
    this.gs = null;
    this._hover = -1;
    this._time = 0.0;
  }

  _ready() {
    this.mouse_filter = MOUSE_FILTER.STOP;
  }

  _process(delta) {
    this._time += delta;
    this.queue_redraw();
  }

  _positions() {
    const columns = [];
    const steps = this.gs.map;
    const size = this.size;
    for (let s = 0; s < steps.length; s++) {
      const nodes = steps[s];
      const x = lerpf(90.0, size.x - 90.0, s / (steps.length - 1));
      const column = [];
      for (let n = 0; n < nodes.length; n++) {
        const spread = nodes.length > 1 ? 150.0 : 0.0;
        let y = size.y * 0.5 + (n - (nodes.length - 1) * 0.5) * spread;
        y += Math.sin((s * 3 + n) * 1.7 + this.gs.act) * 18.0;
        column.push(V(x, y));
      }
      columns.push(column);
    }
    return columns;
  }

  _gui_input(event) {
    if (event.kind === 'mouse_motion') {
      const hovered = this._node_at(event.position);
      if (hovered !== this._hover) {
        this._hover = hovered;
        if (hovered >= 0) Sfx.play('ui_hover', 1.0, -6.0);
        this.mouse_default_cursor_shape = hovered >= 0 ? CURSOR.POINTING_HAND : CURSOR.ARROW;
        this.tooltip_text = hovered >= 0 ? String(RunMap.NODE_INFO[this.gs.map[this.gs.step][hovered]].desc) : '';
      }
    } else if (event.kind === 'mouse_button' && event.pressed && event.button_index === 1) {
      const clicked = this._node_at(event.position);
      if (clicked >= 0) {
        Sfx.play('ui_click');
        this.chosen.emit(clicked);
      }
    }
  }

  _node_at(point) {
    const positions = this._positions();
    for (let n = 0; n < positions[this.gs.step].length; n++) {
      const q = positions[this.gs.step][n];
      if (Math.hypot(point.x - q.x, point.y - q.y) < 40.0) return n;
    }
    return -1;
  }

  _draw() {
    const size = this.size;
    const rect = { x: 0, y: 0, w: size.x, h: size.y };
    const grow = (r, by) => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
    this.draw_rect(rect, new Color('5a4630'));
    this.draw_rect(grow(rect, -6), new Color('8a7152'));
    for (let i = 0; i < 26; i++) {
      const t = i;
      const at = V(fposmod(Math.sin(t * 12.9898) * 43758.5, 1.0) * size.x, fposmod(Math.sin(t * 78.233) * 12345.6, 1.0) * size.y);
      this.draw_circle(at, 30.0 + fposmod(t * 37.0, 60.0), new Color(0.3, 0.22, 0.14, 0.08));
    }
    for (let edge = 0; edge < 18; edge++) this.draw_rect(grow(rect, -edge * 3.0), new Color(0.16, 0.11, 0.07, 0.035), false, 3.0);
    const positions = this._positions();
    const gs = this.gs;
    const visited = [...gs.path];
    for (let s = 0; s < positions.length - 1; s++) {
      for (let a = 0; a < positions[s].length; a++) {
        for (let b = 0; b < positions[s + 1].length; b++) {
          const travelled = s < visited.length && visited[s] === a && (s + 1 >= visited.length || visited[s + 1] === b);
          const towardsChoice = s === gs.step - 1 && s < visited.length && visited[s] === a;
          let color = new Color('3b2a1a', 0.55);
          let width = 2.0;
          if (travelled && s + 1 < visited.length) {
            color = Palette.GOLD;
            width = 3.0;
          } else if (towardsChoice) {
            color = new Color(Palette.ACCENT, 0.7);
            width = 2.5;
          }
          this._dashed(positions[s][a], positions[s + 1][b], color, width);
        }
      }
    }
    for (let s = 0; s < positions.length; s++) {
      for (let n = 0; n < positions[s].length; n++) {
        const kind = String(gs.map[s][n]);
        const centre = positions[s][n];
        const isCurrent = s === gs.step;
        const wasVisited = s < visited.length && visited[s] === n;
        const radius = kind !== 'boss' ? 30.0 : 38.0;
        if (isCurrent) {
          const glow = 0.5 + 0.5 * Math.sin(this._time * 3.0 + n);
          this.draw_circle(centre, radius + 10.0 + glow * 4.0, new Color(Palette.ACCENT, 0.18 + 0.12 * glow));
          if (n === this._hover) this.draw_circle(centre, radius + 8.0, new Color(Palette.ACCENT, 0.45));
        }
        this.draw_circle(V(centre.x + 2, centre.y + 3), radius, new Color(0, 0, 0, 0.35));
        this.draw_circle(centre, radius, !wasVisited ? new Color('1a1f2a') : new Color('2a2418'));
        const ring = wasVisited ? Palette.GOLD : isCurrent ? Palette.ACCENT : new Color('c9b48a', 0.6);
        this.draw_arc(centre, radius, 0, TAU, 40, ring, wasVisited || isCurrent ? 2.5 : 1.5, true);
        const faded = s > gs.step;
        Icons.draw(this, kind, centre, radius * 0.62);
        if (faded) this.draw_circle(centre, radius - 1.0, new Color(0.1, 0.08, 0.06, 0.45));
      }
    }
  }

  _dashed(a, b, color, width) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.trunc(length / 14.0);
    for (let i = 0; i < count; i++) {
      if (i % 2 !== 0) continue;
      const p0 = V(a.x + (b.x - a.x) * (i / count), a.y + (b.y - a.y) * (i / count));
      const p1 = V(a.x + (b.x - a.x) * ((i + 1) / count), a.y + (b.y - a.y) * ((i + 1) / count));
      this.draw_line(p0, p1, color, width, true);
    }
  }
}

export class MapScreen extends Control {
  constructor() {
    super('MapScreen');
    this.node_chosen = new Signal();
    this._gs = null;
    this._view = null;
  }

  setup(gs) {
    this._gs = gs;
    this.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.mouse_filter = MOUSE_FILTER.IGNORE;
    this.theme = UiTheme.theme();
    this.add_child(UiKit.scrim(0.35));
    const frame = UiKit.panel(new Color(0.04, 0.06, 0.095, 0.95), Palette.PANEL_EDGE_STRONG, [28, 22, 28, 24], 4);
    frame.custom_minimum_size = V(1180, 0);
    this.add_child(UiKit.centered(frame));
    const column = UiKit.vbox(12);
    frame.add_child(column);

    const header = UiKit.hbox(16);
    const titles = UiKit.vbox(2);
    titles.add_child(UiKit.caption(`Run map · act ${ROMAN[gs.act]} of 3`, Palette.MUTED, 13));
    const act = gs.act_info();
    titles.add_child(UiKit.title(String(act.name), 36, Palette.INK));
    titles.add_child(UiKit.flavor(String(act.tagline), 19));
    header.add_child(titles);
    header.add_child(UiKit.spacer());
    const stats = UiKit.vbox(6);
    stats.alignment = ALIGNMENT.END;
    const purse = UiKit.hbox(8);
    purse.alignment = ALIGNMENT.END;
    purse.add_child(IconBox.make('coin', 24));
    purse.add_child(UiKit.number(String(gs.gold), 24, Palette.GOLD_BRIGHT));
    stats.add_child(purse);
    const counter = UiKit.label(`Encounters won  ${gs.encounters_won} / ${gs.total_encounters()}`, 19, Palette.MUTED);
    counter.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    stats.add_child(counter);
    header.add_child(stats);
    column.add_child(header);

    const body = UiKit.hbox(18);
    column.add_child(body);
    this._view = new MapView();
    this._view.custom_minimum_size = V(900, 440);
    this._view.gs = gs;
    this._view.chosen.connect((index) => this.node_chosen.emit(index));
    body.add_child(this._view);
    const legend = UiKit.vbox(10);
    legend.custom_minimum_size = V(190, 0);
    legend.add_child(UiKit.caption('Legend', Palette.MUTED, 12));
    for (const kind of ['encounter', 'elite', 'merchant', 'rest', 'unknown', 'boss']) {
      const row = UiKit.hbox(10);
      row.add_child(IconBox.make(kind, 30));
      const text = UiKit.vbox(0);
      text.add_child(UiKit.label(String(RunMap.NODE_INFO[kind].name), 19, Palette.INK));
      text.add_child(UiKit.wrap(String(RunMap.NODE_INFO[kind].desc), 15, Palette.FAINT, 140));
      row.add_child(text);
      legend.add_child(row);
    }
    body.add_child(legend);

    const footer = UiKit.hbox(10);
    footer.add_child(UiKit.caption('Army', Palette.MUTED, 12));
    for (const entry of gs.army) {
      const portrait = new PiecePortrait();
      portrait.kind = String(entry.kind);
      portrait.level = Math.trunc(entry.level);
      portrait.custom_minimum_size = V(44, 56);
      portrait.tooltip_text = `${UiKit.piece_name(String(entry.kind))} · level ${Math.trunc(entry.level)}`;
      footer.add_child(portrait);
    }
    if (gs.fallen.length > 0) footer.add_child(UiKit.caption(`  Fallen ${gs.fallen.length}`, Palette.CAPTURE, 12));
    footer.add_child(UiKit.spacer());
    for (const id of gs.relics) footer.add_child(RelicToken.make(id, 44));
    column.add_child(footer);
    const hint = UiKit.flavor('A longer road. Stronger ideas.  Choose where to go next.', 18);
    hint.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    column.add_child(hint);
    UiKit.fade_in(frame, 0.3, 0.0);
  }
}

// ────────────────────────────────────────────────────────────────── RewardScreen ───────────────────

export class RewardScreen extends Modal {
  constructor() {
    super('', 900.0, 0.45);
    this.dismissable = false;
    this.done = new Signal();
    this._gs = null;
    this._continue = null;
    this._cards = null;
  }

  setup(gs) {
    this._gs = gs;
    const opening = String(gs.reward.kind) === 'opening';
    const heading = UiKit.title(opening ? 'Choose your first relic' : 'Victory', 40, !opening ? Palette.GOLD_BRIGHT : Palette.INK);
    heading.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(heading);
    const rule = UiKit.ornament(260);
    rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
    this.content.add_child(rule);
    if (opening) {
      const line = UiKit.flavor('Small curiosities. Big consequences.', 20);
      line.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      this.content.add_child(line);
    } else {
      const lines = UiKit.hbox(18);
      lines.alignment = ALIGNMENT.CENTER;
      for (const entry of gs.reward.lines) lines.add_child(UiKit.label(`${String(entry[0])}  +${Math.trunc(entry[1])}`, 19, Palette.MUTED));
      this.content.add_child(lines);
      const total = UiKit.hbox(8);
      total.alignment = ALIGNMENT.CENTER;
      total.add_child(IconBox.make('coin', 26));
      total.add_child(UiKit.number(`+${Math.trunc(gs.reward.gold)} gold`, 26, Palette.GOLD_BRIGHT));
      this.content.add_child(total);
      if (String(gs.reward.revived) !== '') {
        const revived = UiKit.label(`The Sealed Move returns your ${String(gs.reward.revived)}.`, 19, Palette.CHAIN);
        revived.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
        this.content.add_child(revived);
      }
    }
    this._cards = UiKit.hbox(18);
    this._cards.alignment = ALIGNMENT.CENTER;
    this.content.add_child(this._cards);
    const footer = this.add_footer([]);
    this._continue = UiKit.button('Continue', () => this._finish(), true, 180);
    footer.add_child(this._continue);
    this.refresh();
  }

  refresh() {
    for (const child of this._cards.get_children()) child.queue_free();
    const reward = this._gs.reward;
    const choosing = !reward.relic_taken && reward.relic_choices.length > 0;
    if (choosing) {
      const full = this._gs.relics.length >= Relics.MAX_EQUIPPED;
      for (const id of reward.relic_choices) {
        const info = Relics.info(String(id));
        const card = ChoiceCard.make(String(info.icon), String(info.name), String(info.desc), 'Choose', String(info.rarity));
        card.chosen.connect(() => this._choose(String(id)));
        if (full) card.set_enabled(false, 'All six relic slots are full.');
        this._cards.add_child(card);
      }
      if (full) this._cards.add_child(UiKit.label('Your relic slots are full.', 18, Palette.MUTED));
      const skip = UiKit.button('Skip', () => this._skip());
      skip.size_flags_vertical = SIZE.SHRINK_CENTER;
      this._cards.add_child(skip);
    }
    this._cards.visible = choosing;
    this._continue.visible = !choosing;
    if (!choosing) deferred(() => this._continue.grab_focus());
  }

  _choose(id) {
    if (this._gs.take_relic(id)) Sfx.play('relic_trigger');
    this.refresh();
  }

  _skip() {
    this._gs.skip_relic();
    this.refresh();
  }

  _finish() {
    this.done.emit();
    this.queue_free();
  }
}

// ────────────────────────────────────────────────────────────────── MerchantScreen ─────────────────

export class MerchantScreen extends Modal {
  constructor() {
    super('The Merchant', 1120.0, 0.45);
    this.dismissable = false;
    this.changed = new Signal();
    this.leave = new Signal();
    this._gs = null;
    this._body = null;
    this._gold = null;
  }

  setup(gs) {
    this._gs = gs;
    const purse = UiKit.hbox(8);
    purse.alignment = ALIGNMENT.CENTER;
    purse.add_child(IconBox.make('coin', 26));
    this._gold = UiKit.number('', 26, Palette.GOLD_BRIGHT);
    purse.add_child(this._gold);
    this.content.add_child(purse);
    this._body = UiKit.vbox(16);
    this.content.add_child(this._body);
    const go = UiKit.button('Leave', () => {
      this.leave.emit();
      this.queue_free();
    }, true, 160);
    this.add_footer([go]);
    this.refresh();
  }

  refresh() {
    const gs = this._gs;
    this._gold.text = `${gs.gold} gold`;
    for (const child of this._body.get_children()) child.queue_free();
    const shelf = UiKit.hbox(16);
    shelf.alignment = ALIGNMENT.CENTER;
    gs.shop.relics.forEach((relic, i) => {
      const id = String(relic);
      if (id === '') {
        const sold = UiKit.panel(new Color(0.04, 0.05, 0.08, 0.6), Palette.PANEL_EDGE, [18, 16, 18, 16]);
        sold.custom_minimum_size = V(230, 300);
        const text = UiKit.caption('Sold', Palette.FAINT, 13);
        text.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
        text.vertical_alignment = VERTICAL_ALIGNMENT.CENTER;
        sold.add_child(text);
        shelf.add_child(sold);
        return;
      }
      const info = Relics.info(id);
      const price = gs.shop_relic_price(i);
      const card = ChoiceCard.make(String(info.icon), String(info.name), String(info.desc), `Buy · ${price}`, String(info.rarity));
      card.chosen.connect(() => this._buy_relic(i));
      if (gs.relics.length >= Relics.MAX_EQUIPPED) card.set_enabled(false, 'All six relic slots are full.');
      else if (gs.gold < price) card.set_enabled(false, 'Not enough gold.');
      shelf.add_child(card);
    });
    gs.shop.recruits.forEach((recruit, i) => {
      const kind = String(recruit);
      if (kind === '') return;
      const price = gs.recruit_price(kind);
      const card = ChoiceCard.make('', `Recruit a ${UiKit.piece_name(kind).toLowerCase()}`, 'Joins your army for the rest of the run.', `Hire · ${price}`, '', kind);
      card.chosen.connect(() => this._recruit(i));
      if (gs.army.length >= GameState.MAX_ARMY) card.set_enabled(false, 'Your army is at full strength.');
      else if (gs.gold < price) card.set_enabled(false, 'Not enough gold.');
      shelf.add_child(card);
    });
    this._body.add_child(shelf);

    const services = UiKit.hbox(30);
    services.alignment = ALIGNMENT.CENTER;
    const train = UiKit.vbox(8);
    train.add_child(UiKit.caption(`Training · ${gs.service_price(GameState.TRAIN_PRICE)} gold · +1 level`, Palette.MUTED, 12));
    const trainees = PiecePicker.make(gs.army, (entry) => Math.trunc(entry.level) < GameState.MAX_LEVEL && gs.gold >= gs.service_price(GameState.TRAIN_PRICE));
    trainees.picked.connect((index) => {
      if (gs.train(String(gs.army[index].id))) Sfx.play('train');
      this.changed.emit();
      this.refresh();
    });
    train.add_child(trainees);
    services.add_child(train);
    if (gs.fallen.length > 0) {
      const mend = UiKit.vbox(8);
      mend.add_child(UiKit.caption(`Mending · ${gs.service_price(GameState.MEND_PRICE)} gold · revive a fallen piece`, Palette.MUTED, 12));
      const fallen = PiecePicker.make(gs.fallen, () => gs.gold >= gs.service_price(GameState.MEND_PRICE) && gs.army.length < GameState.MAX_ARMY);
      fallen.picked.connect((index) => {
        if (gs.mend(index)) Sfx.play('purchase');
        this.changed.emit();
        this.refresh();
      });
      mend.add_child(fallen);
      services.add_child(mend);
    }
    this._body.add_child(services);
  }

  _buy_relic(index) {
    if (this._gs.buy_relic(index)) Sfx.play('purchase');
    this.changed.emit();
    this.refresh();
  }

  _recruit(index) {
    if (this._gs.buy_recruit(index)) Sfx.play('purchase');
    this.changed.emit();
    this.refresh();
  }
}

// ────────────────────────────────────────────────────────────────── RestScreen ─────────────────────

export class RestScreen extends Modal {
  constructor() {
    super('Rest', 1000.0, 0.45);
    this.dismissable = false;
    this.changed = new Signal();
    this.leave = new Signal();
    this._gs = null;
    this._body = null;
  }

  setup(gs) {
    this._gs = gs;
    const line = UiKit.flavor('A quiet fire. Time to tend the army.', 20);
    line.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(line);
    this._body = UiKit.vbox(16);
    this.content.add_child(this._body);
    const go = UiKit.button('Move on', () => {
      this.leave.emit();
      this.queue_free();
    }, true, 160);
    this.add_footer([go]);
    this.refresh();
  }

  refresh() {
    const gs = this._gs;
    for (const child of this._body.get_children()) child.queue_free();
    if (gs.rest_done) {
      const done = UiKit.label('Rested. The road goes on.', 22, Palette.INK);
      done.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      this._body.add_child(done);
      return;
    }
    const options = UiKit.hbox(18);
    options.alignment = ALIGNMENT.CENTER;
    const revive = ChoiceCard.make('feather', 'Revive', 'A fallen piece returns to the ranks.', 'Choose');
    revive.chosen.connect(() => this._show_picker('revive'));
    if (gs.fallen.length === 0 || gs.army.length >= GameState.MAX_ARMY) revive.set_enabled(false, 'No one to revive.');
    options.add_child(revive);
    const train = ChoiceCard.make('veteran', 'Train', 'One piece gains a level and an upgrade.', 'Choose');
    train.chosen.connect(() => this._show_picker('train'));
    options.add_child(train);
    const fortify = ChoiceCard.make('shield', 'Fortify', 'Every piece begins the next encounter warded.', 'Choose');
    fortify.chosen.connect(() => {
      if (gs.rest_fortify()) Sfx.play('train');
      this.changed.emit();
      this.refresh();
    });
    options.add_child(fortify);
    this._body.add_child(options);
  }

  _show_picker(mode) {
    const gs = this._gs;
    for (const child of this._body.get_children()) child.queue_free();
    const caption = UiKit.caption(mode === 'revive' ? 'Choose a fallen piece' : 'Choose a piece to train', Palette.MUTED, 13);
    caption.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this._body.add_child(caption);
    const entries = mode === 'revive' ? gs.fallen : gs.army;
    const picker = PiecePicker.make(entries, (entry) => mode === 'revive' || Math.trunc(entry.level) < GameState.MAX_LEVEL);
    picker.picked.connect((index) => {
      const ok = mode === 'revive' ? gs.rest_revive(index) : gs.rest_train(String(gs.army[index].id));
      if (ok) Sfx.play(mode === 'revive' ? 'promote' : 'train');
      this.changed.emit();
      this.refresh();
    });
    this._body.add_child(picker);
    const back = UiKit.button('Back', () => this.refresh());
    back.size_flags_horizontal = SIZE.SHRINK_CENTER;
    this._body.add_child(back);
  }
}

// ────────────────────────────────────────────────────────────────── EventScreen ────────────────────

export class EventScreen extends Modal {
  constructor() {
    super('', 760.0, 0.45);
    this.dismissable = false;
    this.changed = new Signal();
    this.leave = new Signal();
    this._gs = null;
    this._body = null;
  }

  setup(gs) {
    this._gs = gs;
    const info = Events.info(String(gs.event.id));
    const icon = IconBox.make('unknown', 64);
    icon.size_flags_horizontal = SIZE.SHRINK_CENTER;
    this.content.add_child(icon);
    const heading = UiKit.title(String(info.title), 34, Palette.INK);
    heading.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(heading);
    const rule = UiKit.ornament(220);
    rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
    this.content.add_child(rule);
    const text = UiKit.wrap(String(info.text), 21, Palette.INK, 680);
    text.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(text);
    this._body = UiKit.vbox(10);
    this.content.add_child(this._body);
    this.refresh();
  }

  refresh() {
    const gs = this._gs;
    for (const child of this._body.get_children()) child.queue_free();
    if (gs.event.resolved) {
      const outcome = UiKit.wrap(String(gs.event.outcome), 21, Palette.GOLD_BRIGHT, 680);
      outcome.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      this._body.add_child(outcome);
      const go = UiKit.button('Continue', () => {
        this.leave.emit();
        this.queue_free();
      }, true, 180);
      go.size_flags_horizontal = SIZE.SHRINK_CENTER;
      this._body.add_child(go);
      deferred(() => go.grab_focus());
      return;
    }
    const choices = Events.info(String(gs.event.id)).choices;
    choices.forEach((choice, i) => {
      const row = UiKit.hbox(14);
      const button = UiKit.button(String(choice.label), () => this._choose(i), i === 0, 230);
      button.disabled = !gs.event_choice_available(i);
      row.add_child(button);
      row.add_child(UiKit.wrap(String(choice.desc), 19, !button.disabled ? Palette.MUTED : Palette.FAINT, 400));
      this._body.add_child(row);
    });
  }

  _choose(index) {
    this._gs.event_choose(index);
    Sfx.play('relic_trigger');
    this.changed.emit();
    this.refresh();
  }
}

// ────────────────────────────────────────────────────────────────── LevelUpScreen ──────────────────

export class LevelUpScreen extends Modal {
  constructor() {
    super('', 980.0, 0.5);
    this.dismissable = false;
    this.done = new Signal();
    this._gs = null;
    this._heading = null;
    this._sub = null;
    this._cards = null;
  }

  setup(gs) {
    this._gs = gs;
    const caption = UiKit.caption('Level up', Palette.GOLD, 14);
    caption.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(caption);
    this._heading = UiKit.title('', 34, Palette.INK);
    this._heading.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(this._heading);
    const rule = UiKit.ornament(240);
    rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
    this.content.add_child(rule);
    this._sub = UiKit.flavor('', 20);
    this._sub.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(this._sub);
    this._cards = UiKit.hbox(18);
    this._cards.alignment = ALIGNMENT.CENTER;
    this.content.add_child(this._cards);
    this.refresh();
  }

  refresh() {
    const gs = this._gs;
    for (const child of this._cards.get_children()) child.queue_free();
    if (gs.pending_levels.length === 0) {
      this.done.emit();
      this.queue_free();
      return;
    }
    const pending = gs.pending_levels[0];
    const entry = gs.army_entry(String(pending.id));
    const kind = String(entry.kind);
    this._heading.text = `Choose an upgrade for your ${UiKit.piece_name(kind)}`;
    this._sub.text = `${UiKit.piece_name(kind)} reaches level ${Math.trunc(entry.level)}.  ${String(ChessRules.PIECE_INFO[kind].flavor)}`;
    const choices = gs.current_level_choices();
    if (choices.length === 0) {
      this._cards.add_child(UiKit.label('Nothing left to learn. The level still counts.', 19, Palette.MUTED));
      this._cards.add_child(UiKit.button('Continue', () => this._skip(), true));
      return;
    }
    let first = null;
    for (const id of choices) {
      const info = Upgrades.info(id);
      const card = ChoiceCard.make(id, String(info.name), String(info.desc), 'Choose', '', kind);
      card.chosen.connect(() => this._choose(id));
      this._cards.add_child(card);
      first ??= card;
    }
    first.focus_button();
  }

  _choose(id) {
    if (this._gs.choose_level(id)) Sfx.play('level_up');
    this.refresh();
  }

  _skip() {
    this._gs.skip_level();
    this.refresh();
  }
}

// ────────────────────────────────────────────────────────────────── SummaryScreen ──────────────────

export class SummaryScreen extends Modal {
  static REASONS = Object.freeze({
    checkmate: 'Checkmated',
    exhausted: 'Worn down: the enemy held the stronger army at the turn limit',
    king: 'Your king has fallen',
  });

  constructor() {
    super('', 640.0, 0.55);
    this.dismissable = false;
    this.new_run = new Signal();
    this.main_menu = new Signal();
  }

  setup(gs, won, reason, unlocked) {
    const content = this.content;
    const crown = IconBox.make('crown', 54);
    crown.size_flags_horizontal = SIZE.SHRINK_CENTER;
    content.add_child(crown);
    const heading = UiKit.title(won ? 'Victory' : 'Defeat', 58, won ? Palette.GOLD_BRIGHT : Palette.CAPTURE);
    heading.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    content.add_child(heading);
    const rule = UiKit.ornament(240);
    rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
    content.add_child(rule);
    let line = `All three acts conquered on ${GameState.DIFFICULTIES[gs.difficulty].name}.`;
    if (!won) line = `${SummaryScreen.REASONS[reason]} in ${String(gs.act_info().name)}, encounter ${gs.encounters_won + 1}.`;
    const subtitle = UiKit.wrap(line, 20, Palette.INK, 560);
    subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    content.add_child(subtitle);
    content.add_child(UiKit.gap(6));
    const stats = [
      ['Encounters', `${gs.encounters_won} / ${gs.total_encounters()}`],
      ['Relics', String(gs.relics.length)],
      ['Pieces remaining', String(gs.army.length)],
      ['Captures', String(Math.trunc(gs.stats.captures))],
      ['Best chain', String(Math.trunc(gs.stats.best_chain))],
      ['Promotions', String(Math.trunc(gs.stats.promotions))],
    ];
    for (const [label, value] of stats) {
      const row = UiKit.hbox(10);
      row.add_child(UiKit.label(label, 20, Palette.MUTED));
      row.add_child(UiKit.spacer());
      row.add_child(UiKit.number(value, 22, Palette.INK));
      content.add_child(row);
      content.add_child(UiKit.rule(new Color(1, 1, 1, 0.05)));
    }
    if (gs.relics.length > 0) {
      const relics = UiKit.hbox(8);
      relics.alignment = ALIGNMENT.CENTER;
      for (const id of gs.relics) relics.add_child(RelicToken.make(id, 44));
      content.add_child(relics);
    }
    for (const id of unlocked) {
      const unlock = UiKit.label(`Unlocked: ${String(Profile.UNLOCKS[id].name)}`, 20, Palette.CHAIN, UiTheme.display_font());
      unlock.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
      content.add_child(unlock);
    }
    const seedLine = UiKit.caption(`Seed  ${gs.seed_text}`, Palette.FAINT, 11);
    seedLine.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    content.add_child(seedLine);
    const again = UiKit.button('New run', () => this._choose(this.new_run), true, 170);
    this.add_footer([UiKit.button('Main menu', () => this._choose(this.main_menu), false, 170), again]);
    deferred(() => again.grab_focus());
  }

  _choose(choice) {
    choice.emit();
    this.queue_free();
  }
}

// ────────────────────────────────────────────────────────────────── SettingsPanel ──────────────────

export class SettingsPanel extends Modal {
  constructor() {
    super('Settings', 620.0, 0.6);
  }

  _ready() {
    super._ready();
    const content = this.content;
    content.add_child(UiKit.caption('Audio'));
    this._slider('Master volume', 'master_volume');
    this._slider('Music', 'music_volume');
    this._slider('Effects', 'sfx_volume');
    content.add_child(UiKit.gap(4));
    content.add_child(UiKit.caption('Display'));
    this._toggle('Fullscreen', 'fullscreen');
    this._toggle('Vertical sync', 'vsync');
    this._choice('Interface scale', 'ui_scale', [['85%', 0.85], ['100%', 1.0], ['115%', 1.15], ['130%', 1.3]]);
    content.add_child(UiKit.gap(4));
    content.add_child(UiKit.caption('Motion and readability'));
    this._choice('Animation speed', 'animation_speed', [['Relaxed', 0.8], ['Normal', 1.0], ['Brisk', 1.5], ['Fast', 2.2]]);
    this._slider('Screen shake', 'screen_shake');
    this._toggle('Reduced motion', 'reduced_motion');
    this._toggle('High-contrast highlights', 'high_contrast');
    content.add_child(UiKit.rule());
    const footer = UiKit.hbox(10);
    footer.add_child(UiKit.caption('Settings save automatically', Palette.FAINT, 12));
    footer.add_child(UiKit.spacer());
    const done = UiKit.button('Done', () => this.close(), true, 120);
    footer.add_child(done);
    content.add_child(footer);
    deferred(() => done.grab_focus());
  }

  _slider(text, key) {
    const slider = new HSlider();
    slider.min_value = 0.0;
    slider.max_value = 1.0;
    slider.step = 0.05;
    slider.value = Number(Settings.get_value(key));
    slider.custom_minimum_size = V(220, 24);
    slider.value_changed.connect((v) => Settings.set_value(key, v));
    slider.drag_ended.connect(() => Sfx.play('ui_click'));
    this.add_row(text, slider);
  }

  _toggle(text, key) {
    const check = new CheckButton();
    check.button_pressed = Boolean(Settings.get_value(key));
    check.toggled.connect((on) => {
      Sfx.play('ui_click');
      Settings.set_value(key, on);
    });
    this.add_row(text, check);
  }

  _choice(text, key, options) {
    const picker = new OptionButton();
    const current = Number(Settings.get_value(key));
    options.forEach(([label, value], i) => {
      picker.add_item(String(label), i);
      if (is_equal_approx(Number(value), current)) picker.select(i);
    });
    picker.item_selected.connect((index) => {
      Sfx.play('ui_click');
      Settings.set_value(key, Number(options[index][1]));
    });
    this.add_row(text, picker);
  }
}

// ────────────────────────────────────────────────────────────────── RecordsPanel ───────────────────

export class RecordsPanel extends Modal {
  constructor() {
    super('Records', 720.0, 0.6);
  }

  _ready() {
    super._ready();
    const data = Profile.data;
    const grid = new GridContainer();
    grid.columns = 4;
    grid.add_theme_constant_override('h_separation', 36);
    grid.add_theme_constant_override('v_separation', 10);
    const cells = [
      ['Runs', String(Math.trunc(data.runs))],
      ['Victories', String(Math.trunc(data.wins))],
      ['Bosses', String(Math.trunc(data.bosses))],
      ['Best chain', String(Math.trunc(data.best_chain))],
    ];
    for (const key of Object.keys(GameState.DIFFICULTIES)) cells.push([`Furthest · ${GameState.DIFFICULTIES[key].name}`, `${Profile.best_for(key)} / 9`]);
    cells.push(['Captures', UiKit.format_int(Math.trunc(data.total_captures))]);
    for (const [label, value] of cells) {
      const cell = UiKit.vbox(0);
      cell.add_child(UiKit.caption(label, Palette.MUTED, 11));
      cell.add_child(UiKit.number(value, 26));
      grid.add_child(cell);
    }
    this.content.add_child(grid);
    this.content.add_child(UiKit.rule());
    this.content.add_child(UiKit.caption('Unlocks', Palette.MUTED, 12));
    for (const id of Object.keys(Profile.UNLOCKS)) {
      const row = UiKit.hbox(10);
      const open = Profile.is_unlocked(id);
      row.add_child(Glyph.make('tempo', 14, open ? Palette.MOVE : Palette.FAINT, open));
      row.add_child(UiKit.label(String(Profile.UNLOCKS[id].name), 19, open ? Palette.INK : Palette.MUTED));
      row.add_child(UiKit.spacer());
      row.add_child(UiKit.caption(open ? 'Unlocked' : String(Profile.UNLOCKS[id].hint), open ? Palette.MOVE : Palette.FAINT, 11));
      this.content.add_child(row);
    }
    const history = data.history;
    if (history.length > 0) {
      this.content.add_child(UiKit.rule());
      this.content.add_child(UiKit.caption('Recent runs', Palette.MUTED, 12));
      for (const run of history.slice(0, 6)) {
        const row = UiKit.hbox(12);
        row.add_child(UiKit.label(run.won ? 'Victory' : 'Defeat', 18, run.won ? Palette.GOLD_BRIGHT : Palette.INK));
        row.add_child(UiKit.label(`${Math.trunc(run.encounters)} / 9 · ${Math.trunc(run.survivors)} pieces left`, 18, Palette.INK));
        row.add_child(UiKit.label(`${GameState.DIFFICULTIES[String(run.difficulty)].name} · ${GameState.ARMIES[String(run.army)].name}`, 17, Palette.MUTED));
        row.add_child(UiKit.spacer());
        row.add_child(UiKit.caption(String(run.seed), Palette.FAINT, 10));
        this.content.add_child(row);
      }
    }
    const done = UiKit.button('Close', () => this.close(), true, 140);
    this.add_footer([done]);
    deferred(() => done.grab_focus());
  }
}

// ────────────────────────────────────────────────────────────────── CreditsPanel ───────────────────

/** Licence texts loaded at startup (public/credits/*.json and the fonts' OFL notices). */
export const CreditsData = { godot: null, port: null, fontNotices: [] };

export async function loadCredits(fetchText = async (path) => (await fetch(new URL(path, document.baseURI))).text()) {
  const [godot, port, cinzel, cormorant] = await Promise.all([
    fetchText('credits/godot.json').then(JSON.parse),
    fetchText('credits/port.json').then(JSON.parse),
    fetchText('fonts/Cinzel-OFL.txt'),
    fetchText('fonts/CormorantGaramond-OFL.txt'),
  ]);
  Object.assign(CreditsData, { godot, port, fontNotices: [cinzel, cormorant] });
}

export class CreditsPanel extends Modal {
  static WIDTH = 700.0;

  constructor() {
    super('Credits', 800.0, 0.6);
  }

  _ready() {
    super._ready();
    const scroll = new ScrollContainer();
    scroll.custom_minimum_size = V(730, 480);
    scroll.horizontal_scroll_mode = SCROLL_MODE.DISABLED;
    this.content.add_child(scroll);
    const column = UiKit.vbox(12);
    column.size_flags_horizontal = SIZE.EXPAND_FILL;
    scroll.add_child(column);
    const WIDTH = CreditsPanel.WIDTH;
    column.add_child(UiKit.wrap('Chainmate is made with the Godot Engine. Its pieces, arenas, relics, music and sounds are generated in code.', 20, Palette.INK, WIDTH));
    column.add_child(UiKit.title('Godot Engine', 22, Palette.GOLD_BRIGHT));
    column.add_child(UiKit.wrap('This game uses Godot Engine, available under the following licence:', 18, Palette.MUTED, WIDTH));
    const godot = CreditsData.godot;
    column.add_child(this._plain(godot?.license_text ?? ''));
    column.add_child(UiKit.title('Fonts', 22, Palette.GOLD_BRIGHT));
    column.add_child(UiKit.wrap('Cinzel and Cormorant Garamond are used under the SIL Open Font Licence 1.1.', 18, Palette.MUTED, WIDTH));
    for (const notice of CreditsData.fontNotices) column.add_child(this._plain(notice));
    column.add_child(UiKit.title("Godot's third-party components", 22, Palette.GOLD_BRIGHT));
    const components = [];
    for (const component of godot?.components ?? []) {
      components.push(String(component.name));
      for (const part of component.parts) {
        for (const line of part.copyright) components.push(`    © ${line}`);
        components.push(`    Licence: ${part.license}`);
      }
    }
    column.add_child(this._plain(components.join('\n')));
    for (const [name, text] of Object.entries(godot?.license_info ?? {})) {
      column.add_child(UiKit.title(String(name), 18, Palette.INK));
      column.add_child(this._plain(String(text)));
    }
    // The JavaScript edition's own libraries (not part of the original build).
    const port = CreditsData.port;
    if (port) {
      column.add_child(UiKit.title('JavaScript edition', 22, Palette.GOLD_BRIGHT));
      column.add_child(UiKit.wrap(port.intro, 18, Palette.MUTED, WIDTH));
      for (const library of port.libraries) {
        column.add_child(UiKit.title(library.name, 18, Palette.INK));
        column.add_child(this._plain(library.license));
      }
    }
    const done = UiKit.button('Close', () => this.close(), true, 140);
    this.add_footer([done]);
    deferred(() => done.grab_focus());
  }

  _plain(text) {
    return UiKit.wrap(String(text).trim(), 15, Palette.MUTED, CreditsPanel.WIDTH);
  }
}

// ────────────────────────────────────────────────────────────────── HelpPanel ──────────────────────

export class HelpPanel extends Modal {
  static PAGES = [
    ['The run', 'Lead your ivory army across three acts: [b]The Moss Ranks[/b], [b]The Sunken Files[/b] and [b]The Back Rank[/b]. Each act is a short road: fights, a choice of stops, an elite or a normal fight, more stops, then a boss. Nine fights in all. Lose one and the run is over.'],
    ['Your turn', 'Select one of your pieces and make one legal chess move or capture. Blue squares are moves, red squares are captures.\nSome abilities let the same piece keep going: [b]Chain Capture[/b] captures again, [b]Momentum[/b] moves again after a quiet move. Take the follow-up, or press [b]End turn[/b].'],
    ['The enemy', 'The obsidian army moves one piece per turn and [b]never retreats[/b]: enemy pieces only move forward or sideways. Your pieces under attack pulse red.\nWin by eliminating every enemy piece, or in boss fights by [b]capturing the enemy King[/b]. When a single enemy piece is left and you outmatch it four to one, it [b]flees[/b] and the fight is won. If a fight reaches turn 40, the field goes to the stronger army.'],
    ['Your king', 'Your King must never be left in check. If it is attacked and no legal move remains, you are [b]checkmated[/b] and the run ends. Pieces you lose stay lost unless you revive them at a rest or pay a merchant to mend them.'],
    ['Growth', 'Every capture earns the capturing piece experience. At levels 1, 2 and 3 you choose one of three upgrades for that piece, and it visibly changes: gold trim, then banners and gems, then a late-run glow.\nPawns that reach the far rank become queens for the rest of the run.'],
    ['Relics and stops', 'Relics are run-wide powers (up to six), won from elites and bosses or bought from merchants. [b]Merchants[/b] also sell recruits, training and mending. [b]Rests[/b] revive, train or fortify. [b]Unknown[/b] stops hold small stories and choices.'],
    ['Terrain', '[b]Frozen[/b] tiles block movement (knights can jump them). [b]Corrupted[/b] tiles destroy a piece left standing on one at the end of its side\'s turn. [b]Enchanted[/b] tiles shelter your pieces: one of yours standing there cannot be captured. They give the enemy no shelter.'],
    ['Controls', '[b]Mouse[/b]: click a piece, then a square. Right-click or Esc clears the selection. Right-drag orbits the camera, the wheel zooms, middle-click resets it.\n[b]Keyboard[/b]: arrows or WASD move the board cursor, Space acts on it, Enter ends the turn, Tab cycles your pieces, Q and E orbit, C resets the view, H asks for a hint, F1 opens these rules, Esc pauses.\n[b]Controller[/b]: D-pad cursor, A act, X end turn, B back, Y hint, bumpers orbit, Start pause.'],
  ];

  constructor() {
    super('How to play', 800.0, 0.6);
  }

  _ready() {
    super._ready();
    const scroll = new ScrollContainer();
    scroll.custom_minimum_size = V(730, 480);
    scroll.horizontal_scroll_mode = SCROLL_MODE.DISABLED;
    this.content.add_child(scroll);
    const column = UiKit.vbox(14);
    column.size_flags_horizontal = SIZE.EXPAND_FILL;
    scroll.add_child(column);
    for (const [title, text] of HelpPanel.PAGES) {
      column.add_child(UiKit.title(String(title), 22, Palette.GOLD_BRIGHT));
      column.add_child(UiKit.rich(String(text), 20, 700));
    }
    const done = UiKit.button('Close', () => this.close(), true, 140);
    this.add_footer([done]);
    deferred(() => done.grab_focus());
  }
}

// ────────────────────────────────────────────────────────────────── PauseMenu ──────────────────────

export class PauseMenu extends Modal {
  constructor() {
    super('Paused', 420.0, 0.6);
    this.show_help = new Signal();
    this.show_settings = new Signal();
    this.restart_run = new Signal();
    this.quit_to_menu = new Signal();
    this._restart = null;
  }

  setup(gs) {
    const line = UiKit.caption(`${String(gs.act_info().name)} · seed ${gs.seed_text}`, Palette.FAINT, 11);
    line.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.content.add_child(line);
    const resume = UiKit.button('Resume', () => this.close(), true);
    this.content.add_child(resume);
    this.content.add_child(UiKit.button('Settings', () => this.show_settings.emit()));
    this.content.add_child(UiKit.button('Rules', () => this.show_help.emit()));
    this._restart = UiKit.button('Restart run', () => this._confirm_restart());
    this._restart.tooltip_text = 'Abandon this run and start again with the same choices.';
    this.content.add_child(this._restart);
    this.content.add_child(UiKit.button('Main menu', () => this.quit_to_menu.emit()));
    deferred(() => resume.grab_focus());
  }

  _confirm_restart() {
    if (this._restart.text !== 'Confirm restart') {
      this._restart.text = 'Confirm restart';
      this._restart.add_theme_color_override('font_color', Palette.CAPTURE);
      return;
    }
    this.restart_run.emit();
    this.queue_free();
  }
}

export { PI };
