/**
 * Hud — port of scripts/presentation/ui/hud.gd: act caption and purse (top left), encounter, objective,
 * boss rule and the Hint / Rules / Menu buttons (top right), relic slots (bottom left), the piece card
 * (bottom right), the turn bar with End turn / Clockmaker's Key (bottom centre) and the banner.
 */
import { Color } from '../../godot/math.js';
import { Signal } from '../../godot/signal.js';
import { Control, MOUSE_FILTER, FOCUS, SIZE, PRESET, GROW, HORIZONTAL_ALIGNMENT } from '../../godot/ui/control.js';
import { MarginContainer, VBoxContainer, ALIGNMENT } from '../../godot/ui/containers.js';
import { Battle } from '../../core/battle.js';
import { ChessRules } from '../../core/chess_rules.js';
import { Encounters } from '../../core/encounters.js';
import { Relics } from '../../core/relics.js';
import { Upgrades } from '../../core/upgrades.js';
import { Palette } from '../palette.js';
import { UiTheme } from './ui_theme.js';
import { UiKit } from './ui_kit.js';
import { IconBox, PiecePortrait, RelicToken } from './parts.js';

const V = (x, y) => ({ x, y });
const ROMAN = ['I', 'II', 'III'];

export class Hud extends Control {
  constructor() {
    super('Hud');
    this.end_turn_pressed = new Signal();
    this.hint_pressed = new Signal();
    this.help_pressed = new Signal();
    this.pause_pressed = new Signal();
    this.clock_key_pressed = new Signal();
    this._slots = {};
    this._banner_tween = null;
  }

  _ready() {
    this.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.mouse_filter = MOUSE_FILTER.IGNORE;
    this.theme = UiTheme.theme();
    this._build_top_left();
    this._build_top_right();
    this._build_relics();
    this._build_card();
    this._build_turn_bar();
    this._build_banner();
  }

  _corner(preset, margin, growH, growV) {
    const box = new MarginContainer();
    box.set_anchors_preset(preset);
    box.grow_horizontal = growH;
    box.grow_vertical = growV;
    for (const side of ['left', 'right']) box.add_theme_constant_override(`margin_${side}`, Math.trunc(margin.x));
    for (const side of ['top', 'bottom']) box.add_theme_constant_override(`margin_${side}`, Math.trunc(margin.y));
    box.mouse_filter = MOUSE_FILTER.IGNORE;
    this.add_child(box);
    return box;
  }

  _build_top_left() {
    const corner = this._corner(PRESET.TOP_LEFT, V(32, 26), GROW.END, GROW.END);
    const column = UiKit.vbox(6);
    column.mouse_filter = MOUSE_FILTER.IGNORE;
    corner.add_child(column);
    this.act_caption = UiKit.caption('', Palette.MUTED, 13);
    column.add_child(this.act_caption);
    const purse = UiKit.hbox(8);
    purse.mouse_filter = MOUSE_FILTER.PASS;
    purse.tooltip_text = 'Gold. Earned by winning encounters; spent at merchants.';
    purse.add_child(IconBox.make('coin', 26));
    this.gold_label = UiKit.number('10', 26, Palette.GOLD_BRIGHT);
    purse.add_child(this.gold_label);
    column.add_child(purse);
  }

  _build_top_right() {
    const corner = this._corner(PRESET.TOP_RIGHT, V(32, 24), GROW.BEGIN, GROW.END);
    const column = UiKit.vbox(4);
    column.alignment = ALIGNMENT.END;
    column.mouse_filter = MOUSE_FILTER.IGNORE;
    corner.add_child(column);
    this.encounter_label = UiKit.title('Encounter 1 / 9', 24, Palette.INK);
    this.encounter_label.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    column.add_child(this.encounter_label);
    const rule = UiKit.ornament(220, Palette.MUTED);
    rule.size_flags_horizontal = SIZE.SHRINK_END;
    column.add_child(rule);
    this.objective_label = UiKit.label('Eliminate all enemy pieces', 19, Palette.MUTED);
    this.objective_label.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    column.add_child(this.objective_label);
    this.rule_label = UiKit.wrap('', 17, Palette.CAPTURE, 340);
    this.rule_label.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    this.rule_label.visible = false;
    column.add_child(this.rule_label);
    column.add_child(UiKit.gap(6));
    const buttons = UiKit.hbox(8);
    buttons.alignment = ALIGNMENT.END;
    this.hint_button = this._small_button('Hint', 'The planner suggests a move (H).', () => this.hint_pressed.emit());
    buttons.add_child(this.hint_button);
    buttons.add_child(this._small_button('Rules', 'How to play (F1).', () => this.help_pressed.emit()));
    buttons.add_child(this._small_button('Menu', 'Pause (Esc).', () => this.pause_pressed.emit()));
    column.add_child(buttons);
  }

  _small_button(text, tip, action) {
    const node = UiKit.button(text, action);
    node.tooltip_text = tip;
    node.focus_mode = FOCUS.NONE;
    node.add_theme_font_size_override('font_size', 13);
    return node;
  }

  _build_relics() {
    const corner = this._corner(PRESET.BOTTOM_LEFT, V(32, 28), GROW.END, GROW.BEGIN);
    const column = UiKit.vbox(8);
    column.mouse_filter = MOUSE_FILTER.IGNORE;
    corner.add_child(column);
    column.add_child(UiKit.caption('Relics', Palette.MUTED, 13));
    this.relic_row = UiKit.hbox(8);
    this.relic_row.mouse_filter = MOUSE_FILTER.IGNORE;
    column.add_child(this.relic_row);
  }

  _build_card() {
    const corner = this._corner(PRESET.BOTTOM_RIGHT, V(32, 28), GROW.BEGIN, GROW.BEGIN);
    this.card = UiKit.panel(Palette.PANEL, Palette.PANEL_EDGE_STRONG, [18, 14, 20, 16], 4);
    this.card.custom_minimum_size = V(330, 0);
    this.card.visible = false;
    corner.add_child(this.card);
    const row = UiKit.hbox(14);
    this.card.add_child(row);
    this.card_portrait = new PiecePortrait();
    this.card_portrait.custom_minimum_size = V(76, 96);
    row.add_child(this.card_portrait);
    const column = UiKit.vbox(4);
    column.size_flags_horizontal = SIZE.EXPAND_FILL;
    row.add_child(column);
    const header = UiKit.hbox(8);
    this.card_name = UiKit.title('Knight', 24, Palette.INK);
    header.add_child(this.card_name);
    header.add_child(UiKit.spacer());
    this.card_level = UiKit.caption('', Palette.GOLD, 12);
    this.card_level.size_flags_vertical = SIZE.SHRINK_CENTER;
    header.add_child(this.card_level);
    column.add_child(header);
    this.card_move = UiKit.wrap('', 17, Palette.MUTED, 210);
    column.add_child(this.card_move);
    this.card_upgrades = UiKit.vbox(2);
    column.add_child(this.card_upgrades);
    this.card_xp = UiKit.caption('', Palette.FAINT, 11);
    column.add_child(this.card_xp);
    this.card_flavor = UiKit.flavor('', 17);
    column.add_child(this.card_flavor);
  }

  _build_turn_bar() {
    const holder = new VBoxContainer();
    holder.set_anchors_preset(PRESET.CENTER_BOTTOM);
    holder.grow_horizontal = GROW.BOTH;
    holder.grow_vertical = GROW.BEGIN;
    holder.offset_bottom = -26;
    holder.alignment = ALIGNMENT.END;
    holder.add_theme_constant_override('separation', 6);
    holder.mouse_filter = MOUSE_FILTER.IGNORE;
    this.add_child(holder);
    this.status_label = UiKit.label('', 18, Palette.MUTED);
    this.status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    holder.add_child(this.status_label);
    const bar = UiKit.hbox(14);
    bar.alignment = ALIGNMENT.CENTER;
    holder.add_child(bar);
    const labels = UiKit.vbox(0);
    this.turn_label = UiKit.title('Your turn', 20, Palette.INK);
    this.turn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    labels.add_child(this.turn_label);
    this.turn_note = UiKit.caption('Turn 1', Palette.FAINT, 11);
    this.turn_note.horizontal_alignment = HORIZONTAL_ALIGNMENT.RIGHT;
    labels.add_child(this.turn_note);
    bar.add_child(labels);
    this.end_turn_button = UiKit.button('End turn', () => this.end_turn_pressed.emit(), false, 150);
    this.end_turn_button.tooltip_text = 'Finish your turn (Enter).';
    this.end_turn_button.focus_mode = FOCUS.NONE;
    bar.add_child(this.end_turn_button);
    this.clock_key_button = UiKit.button("Clockmaker's Key", () => this.clock_key_pressed.emit());
    this.clock_key_button.tooltip_text = 'Take an extra turn before the enemy moves (once per encounter).';
    this.clock_key_button.focus_mode = FOCUS.NONE;
    this.clock_key_button.visible = false;
    bar.add_child(this.clock_key_button);
  }

  _build_banner() {
    this.banner = new Control('Banner');
    this.banner.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.banner.mouse_filter = MOUSE_FILTER.IGNORE;
    this.banner.visible = false;
    this.add_child(this.banner);
    const column = UiKit.vbox(8);
    column.alignment = ALIGNMENT.CENTER;
    column.set_anchors_and_offsets_preset(PRESET.CENTER);
    column.grow_horizontal = GROW.BOTH;
    column.grow_vertical = GROW.BOTH;
    column.offset_top = -200;
    column.mouse_filter = MOUSE_FILTER.IGNORE;
    this.banner.add_child(column);
    this.banner_title = UiKit.title('', 60, Palette.INK);
    this.banner_title.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.banner_title.add_theme_constant_override('outline_size', 12);
    this.banner_title.add_theme_color_override('font_outline_color', new Color(0, 0, 0, 0.55));
    column.add_child(this.banner_title);
    const rule = UiKit.ornament(260, Palette.GOLD);
    rule.size_flags_horizontal = SIZE.SHRINK_CENTER;
    column.add_child(rule);
    this.banner_subtitle = UiKit.label('', 24, Palette.INK);
    this.banner_subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT.CENTER;
    this.banner_subtitle.add_theme_constant_override('outline_size', 8);
    this.banner_subtitle.add_theme_color_override('font_outline_color', new Color(0, 0, 0, 0.6));
    column.add_child(this.banner_subtitle);
  }

  refresh(gs) {
    const act = gs.act_info();
    this.act_caption.text = `ACT ${ROMAN[gs.act]}  ·  ${String(act.name).toUpperCase()}`;
    this.gold_label.text = String(gs.gold);
    this.encounter_label.text = `Encounter ${gs.encounter_number()} / ${gs.total_encounters()}`;
    const battle = gs.battle;
    if (battle === null || battle === undefined) return;
    this.objective_label.text = battle.objective === 'regicide' ? 'Capture the enemy King' : 'Eliminate all enemy pieces';
    this.rule_label.visible = battle.boss_rule !== '';
    if (battle.boss_rule !== '') {
      const boss = Encounters.BOSSES[gs.act];
      this.rule_label.text = `${boss.name}  ·  ${boss.desc}`;
    }
    this.hint_button.disabled = gs.hints_left === 0;
    this.hint_button.text = gs.hints_left < 0 ? 'Hint' : `Hint (${gs.hints_left})`;
    this.clock_key_button.visible = battle.clock_key_ready;
    this._refresh_relics(gs.relics);
  }

  _refresh_relics(relics) {
    for (const child of this.relic_row.get_children()) child.queue_free();
    this._slots = {};
    for (let i = 0; i < Relics.MAX_EQUIPPED; i++) {
      const id = i < relics.length ? relics[i] : '';
      const slot = RelicToken.make(id, 56);
      this.relic_row.add_child(slot);
      if (id !== '') this._slots[id] = slot;
    }
  }

  pulse_relic(id) {
    const slot = this._slots[id];
    if (slot && !slot._freed) slot.pulse();
  }

  set_status(text) {
    this.status_label.text = text;
  }

  set_turn(state, turn, followUp = false, canMove = true) {
    const left = Battle.TURN_LIMIT - turn;
    this.turn_note.text = left >= Battle.LIMIT_WARNING ? `TURN ${turn}` : `TURN ${turn} / ${Battle.TURN_LIMIT}`;
    this.turn_note.add_theme_color_override('font_color', left >= Battle.LIMIT_WARNING ? Palette.FAINT : Palette.CHAIN);
    if (state === 'player') {
      this.turn_label.text = 'Your turn';
      this.turn_label.add_theme_color_override('font_color', Palette.INK);
      this.end_turn_button.disabled = false;
      this.end_turn_button.text = followUp ? 'End turn' : !canMove ? 'Pass' : 'End turn';
      this.end_turn_button.visible = followUp || !canMove;
      if (followUp) UiKit.style_primary(this.end_turn_button);
    } else if (state === 'enemy') {
      this.turn_label.text = 'Enemy turn';
      this.turn_label.add_theme_color_override('font_color', Palette.CAPTURE);
      this.end_turn_button.visible = false;
    } else {
      this.turn_label.text = '';
      this.end_turn_button.visible = false;
    }
  }

  show_piece(piece, entry, nextXp) {
    if (!piece || Object.keys(piece).length === 0) {
      this.card.visible = false;
      return;
    }
    this.card.visible = true;
    const kind = piece.kind;
    const info = ChessRules.PIECE_INFO[kind];
    this.card_portrait.kind = kind;
    this.card_portrait.friendly = piece.friendly;
    this.card_portrait.level = Math.trunc(piece.level);
    this.card_portrait.queue_redraw();
    this.card_name.text = piece.friendly ? String(info.name) : `Enemy ${String(info.name).toLowerCase()}`;
    this.card_level.text = Math.trunc(piece.level) > 0 ? `Level ${Math.trunc(piece.level)}` : '';
    let move = String(info.move);
    if (!piece.friendly) move += ' Never retreats.';
    this.card_move.text = move;
    for (const child of this.card_upgrades.get_children()) child.queue_free();
    for (const id of piece.upgrades) {
      if ('hidden' in Upgrades.info(String(id)) && piece.friendly) continue;
      const line = UiKit.hbox(6);
      line.add_child(IconBox.make(String(id), 20));
      line.add_child(UiKit.label(Upgrades.display_name(String(id)), 17, Palette.INK));
      this.card_upgrades.add_child(line);
    }
    if (Math.trunc(piece.ward) > 0) this.card_upgrades.add_child(UiKit.label('Warded', 17, Palette.MOVE));
    const hasEntry = entry && Object.keys(entry).length > 0;
    this.card_xp.visible = hasEntry;
    if (hasEntry) this.card_xp.text = nextXp > 0 ? `XP ${Math.trunc(entry.xp)} / ${nextXp}` : `XP ${Math.trunc(entry.xp)} · max level`;
    this.card_flavor.text = String(info.flavor);
  }

  show_banner(title, subtitle, color = Palette.INK, hold = 1.6) {
    if (this._banner_tween) this._banner_tween.kill();
    this.banner_title.text = title;
    this.banner_title.add_theme_color_override('font_color', color);
    this.banner_subtitle.text = subtitle;
    this.banner.visible = true;
    this.banner.modulate = new Color(this.banner.modulate, 0.0);
    this._banner_tween = this.create_tween();
    this._banner_tween.tween_property(this.banner, 'modulate:a', 1.0, 0.25);
    if (hold > 0.0) {
      this._banner_tween.tween_interval(hold);
      this._banner_tween.tween_property(this.banner, 'modulate:a', 0.0, 0.45);
      this._banner_tween.tween_callback(() => { this.banner.visible = false; });
    }
  }

  hide_banner() {
    if (this._banner_tween) this._banner_tween.kill();
    this.banner.visible = false;
  }
}
