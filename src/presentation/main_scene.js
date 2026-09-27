/**
 * Main — port of scripts/presentation/main.gd, the scene controller. It builds the arena, board,
 * pieces, relics, effects, camera, HUD and overlay; routes a run between menu, map, stops and
 * battles; animates every battle record; turns pointer, keyboard and gamepad input into moves; and
 * saves the run after every action.
 *
 * Every function that awaited in GDScript is a generator driven by coroutine.js (`yield` = await,
 * `yield*` = await of a sub-coroutine, `go()` = a call that does not await), so each resumed stretch
 * runs in the same frame phase as in the original.
 */
import { Vector2, Vector2i, Vector3 } from '../godot/math.js';
import { Node3D } from '../godot/node3d.js';
import { isInstanceValid } from '../godot/scene.js';
import { go } from '../godot/coroutine.js';
import { OS } from '../godot/os.js';
import { RandomNumberGenerator } from '../godot/rng.js';
import { CanvasLayer } from '../godot/ui/canvas_item.js';
import { Control, MOUSE_FILTER, PRESET } from '../godot/ui/control.js';
import { MOUSE_BUTTON } from '../godot/input.js';
import { intersectRay } from '../godot/physics.js';
import { Board, isEmpty } from '../core/board.js';
import { ChessRules } from '../core/chess_rules.js';
import { Battle } from '../core/battle.js';
import { Encounters } from '../core/encounters.js';
import { GameState } from '../core/game_state.js';
import { Relics } from '../core/relics.js';
import { Settings } from '../autoload/settings.js';
import { Profile } from '../autoload/profile.js';
import { Sfx } from '../autoload/sfx.js';
import { Arena } from './arena.js';
import { ArenaProps } from './arena_props.js';
import { BoardView, Mark } from './board_view.js';
import { CameraRig } from './camera_rig.js';
import { PieceView, PICK_LAYER } from './piece_view.js';
import { RelicView } from './relic_view.js';
import { Vfx } from './vfx.js';
import { Palette } from './palette.js';
import { UiTheme } from './ui/ui_theme.js';
import { UiKit } from './ui/ui_kit.js';
import { Hud } from './ui/hud.js';
import { Modal, Toast } from './ui/parts.js';
import {
  MenuScreen, NewRunScreen, MapScreen, RewardScreen, MerchantScreen, RestScreen, EventScreen, LevelUpScreen,
  SummaryScreen, SettingsPanel, RecordsPanel, CreditsPanel, HelpPanel, PauseMenu,
} from './ui/screens.js';

export const Screen = Object.freeze({ MENU: 0, MAP: 1, STOP: 2, BATTLE: 3, SUMMARY: 4 });

const NO_CELL = Object.freeze(new Vector2i(-1, -1));
const FILES = 'abcdef';
const CURSOR_STEPS = Object.freeze({
  cursor_up: new Vector2i(0, -1), cursor_down: new Vector2i(0, 1),
  cursor_left: new Vector2i(-1, 0), cursor_right: new Vector2i(1, 0),
});
/** A right click that moved less than this (canvas units) deselects instead of orbiting. */
const RIGHT_CLICK_SLOP = 6.0;
/** Picking ray length (world units): far past the arena. */
const PICK_RAY_LENGTH = 100.0;
const VICTORY_SUBTITLES = Object.freeze({
  regicide: 'The enemy king is taken.',
  eliminated: 'Every enemy piece is captured.',
  routed: 'The broken enemy flees the field.',
  withdrew: 'Outmatched, the enemy withdraws.',
});

const isNoCell = (cell) => cell.x === NO_CELL.x && cell.y === NO_CELL.y;
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
/** Cells → a Set of keys, so "is this cell a move" is O(1) inside the marking loops. */
const cellSet = (cells) => new Set(cells.map((cell) => cell.key()));

export class Main extends Node3D {
  /** The capture tour's driver class, set by the app shell only for `?capture` (autopilot.gd). */
  static Autopilot = null;

  constructor() {
    super('Main');
    this.gs = null;
    this.screen = Screen.MENU;
    this.busy = false;
    this.arena = null;
    this.board_view = null;
    this.pieces_root = null;
    this.relics_root = null;
    this.vfx = null;
    this.rig = null;
    this.hud = null;
    this.overlay = null;
    /** @type {Map<string, PieceView>} */
    this.piece_views = new Map();
    /** @type {Map<string, RelicView>} */
    this.relic_views = new Map();
    this.selected_id = '';
    this.hover_cell = NO_CELL;
    this.hover_id = '';
    this.cursor_cell = new Vector2i(2, 4);
    this.keyboard_mode = false;
    this.hint_move = {};
    this._screen_node = null;
    this._right_press = Vector2.ZERO;
    this._tutorial = false;
    this._clock_key_armed = false;
  }

  _ready() {
    document.title = 'Chainmate';
    this._build_scene();
    // The original warms up only its web export; here every platform compiles shaders on first draw.
    go(this._warm_up_shaders(), 'warm_up_shaders');
    Sfx.play_music();
    if (OS.get_cmdline_user_args().includes('--capture') && Main.Autopilot) {
      const pilot = new Main.Autopilot();
      pilot.main = this;
      this.add_child(pilot);
    } else {
      this.show_menu();
    }
  }

  /**
   * The web build's shader warm-up: one of each prop, a relic and every effect, under the floor for
   * four frames, so the first capture or relic does not stall on a shader compile.
   */
  *_warm_up_shaders() {
    const hold = new Node3D('ShaderWarmUp');
    hold.position = new Vector3(0, -0.7, 0);
    this.add_child(hold);
    const rng = new RandomNumberGenerator();
    const props = [ArenaProps.crate(0.3), ArenaProps.books(rng), ArenaProps.banner(0.5, Palette.CAPTURE, Palette.GOLD),
      ArenaProps.hanging_cloth(0.3, 0.3, Palette.CAPTURE, Palette.GOLD, true)];
    for (const lit of [ArenaProps.lantern(), ArenaProps.candelabra(), ArenaProps.candles(rng)]) {
      props.push(lit.node);
      for (const light of lit.lights) light.visible = false;
    }
    for (const prop of props) hold.add_child(prop);
    const relic = new RelicView();
    hold.add_child(relic);
    relic.setup('fianchetto_glass');
    const effects = this.vfx.warm_up(hold.position);
    for (let i = 0; i < 4; i++) yield this.tree.process_frame;
    hold.queue_free();
    effects.queue_free();
    document.getElementById('chainmate-loading')?.remove();
  }

  /** NOTIFICATION_WM_CLOSE_REQUEST: the tab or app is going away — keep the run. */
  save_on_close() {
    if (this.gs !== null) Profile.save_run(this.gs);
  }

  _build_scene() {
    this.arena = new Arena();
    this.add_child(this.arena);
    this.board_view = new BoardView();
    this.add_child(this.board_view);
    this.pieces_root = new Node3D('Pieces');
    this.add_child(this.pieces_root);
    this.relics_root = new Node3D('Relics');
    this.add_child(this.relics_root);
    this.vfx = new Vfx();
    this.add_child(this.vfx);
    this.rig = new CameraRig();
    this.rig.frame_board();
    this.add_child(this.rig);

    const layer = new CanvasLayer();
    this.add_child(layer);
    this.hud = new Hud();
    this.hud.visible = false;
    layer.add_child(this.hud);
    this.hud.end_turn_pressed.connect(() => go(this._end_turn(), 'end_turn'));
    this.hud.hint_pressed.connect(() => this._hint());
    this.hud.help_pressed.connect(() => this._open_help());
    this.hud.pause_pressed.connect(() => this._open_pause());
    this.hud.clock_key_pressed.connect(() => this._use_clock_key());
    this.overlay = new Control('Overlay');
    this.overlay.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
    this.overlay.mouse_filter = MOUSE_FILTER.IGNORE;
    this.overlay.theme = UiTheme.theme();
    layer.add_child(this.overlay);
  }

  // ─────────────────────────────────────────────────────────────── menu & run lifecycle ──────────

  show_menu() {
    this.screen = Screen.MENU;
    this.busy = false;
    this.gs = null;
    this.selected_id = '';
    this.hint_move = {};
    this._clear_overlays();
    this.hud.visible = false;
    this.hud.hide_banner();
    this.board_view.clear_marks();
    this.board_view.clear_cursor();
    this.board_view.hide_arc();
    this._clear_relics();
    this._set_variant('court');
    this.arena.set_mood(0.9, 0.25, 0.6);
    this.rig.idle_orbit = true;
    this.rig.input_enabled = false;
    this.rig.release_focus();
    this.rig.reset_view();
    // The menu column covers the left of the screen: keep the board in the free right part.
    this.rig.set_safe_area(-0.04, 0.86, -0.72, 0.72);

    const demo = new GameState();
    demo.new_run({ seed: 'CHAINMATE', army: 'vanguard' });
    demo.skip_relic();
    demo.leave();
    demo.choose_node(0);
    this._clear_pieces();
    this.board_view.show_terrain(demo.battle.board);
    this._sync_pieces(demo.battle.board);
    const menu = new MenuScreen();
    menu.setup(Profile.has_run(), this._record_summary());
    menu.continue_run.connect(() => this.continue_run());
    menu.new_run.connect(() => this._open_new_run());
    menu.show_help.connect(() => this._open_help());
    menu.show_records.connect(() => this.overlay.add_child(new RecordsPanel()));
    menu.show_settings.connect(() => this._open_settings());
    menu.show_credits.connect(() => this.overlay.add_child(new CreditsPanel()));
    menu.quit_game.connect(() => this._quit());
    this._set_screen_node(menu);
  }

  _record_summary() {
    const data = Profile.data;
    if (Math.trunc(data.runs) === 0) return '';
    return `${Math.trunc(data.runs)} runs  ·  ${Math.trunc(data.wins)} wins  ·  furthest ${Math.trunc(data.best_encounters)} / 9 encounters`;
  }

  _open_new_run() {
    const setup = new NewRunScreen();
    setup.begin.connect((config) => this.start_run(config));
    this.overlay.add_child(setup);
  }

  start_run(config) {
    this.gs = new GameState();
    this.gs.new_run(config);
    this._tutorial = !Profile.data.tutorial_done;
    this._clear_overlays();
    this._clear_pieces();
    this._clear_relics();
    go(this._route(), 'route');
  }

  continue_run() {
    const saved = Profile.load_run();
    if (saved === null) {
      Toast.show_on(this.overlay, 'The saved run could not be restored.', Palette.CAPTURE);
      Profile.clear_run();
      this.show_menu();
      return;
    }
    this.gs = saved;
    this._tutorial = false;
    this._clear_overlays();
    this._clear_pieces();
    this._clear_relics();
    go(this._route(), 'route');
  }

  _restart_run() {
    this.start_run({ difficulty: this.gs.difficulty, army: this.gs.army_preset });
  }

  _quit() {
    this.save_on_close();
    OS.quit();
  }

  // ─────────────────────────────────────────────────────────────── routing ───────────────────────

  /** Shows whatever the run's phase calls for; saves first so a closed tab resumes right here. */
  *_route() {
    this.busy = false;
    Profile.save_run(this.gs);
    this._set_variant(String(this.gs.act_info().variant));
    if (this.gs.phase === 'battle') {
      go(this.enter_battle(true), 'enter_battle');
      return;
    }
    const evolved = this._enter_camp();
    if (evolved) yield* this._wait(1.1);
    const gs = this.gs;
    switch (gs.phase) {
      case 'reward':
        this._open_reward();
        break;
      case 'map':
        this._open_map();
        break;
      case 'merchant': {
        const shop = new MerchantScreen();
        shop.setup(gs);
        this._open_stop(shop, shop.changed, shop.leave, () => shop.refresh());
        if (gs.discounted()) this._relic_triggered('patrons_chit');
        break;
      }
      case 'rest': {
        const rest = new RestScreen();
        rest.setup(gs);
        this._open_stop(rest, rest.changed, rest.leave, () => rest.refresh());
        break;
      }
      case 'event': {
        const event = new EventScreen();
        event.setup(gs);
        this._open_stop(event, event.changed, event.leave, () => event.refresh());
        break;
      }
      default:
        break;
    }
  }

  _set_variant(variant) {
    if (this.arena.variant === variant) return;
    this.arena.set_variant(variant);
    // Each arena variant has its own relic shelf: move the relics already standing.
    if (this.gs !== null) {
      this.gs.relics.forEach((id, i) => this.relic_views.get(id)?.place(this.arena.relic_spot(i)));
    }
  }

  /** The camp between battles: the army on the board, relics on their shelf. True if a piece evolved. */
  _enter_camp() {
    this.screen = this.gs.phase === 'map' ? Screen.MAP : Screen.STOP;
    this.selected_id = '';
    this.hint_move = {};
    this.hud.visible = false;
    this.hud.hide_banner();
    this.board_view.clear_marks();
    this.board_view.clear_cursor();
    this.board_view.hide_arc();
    this.arena.set_mood(1.0, 0.15, 0.8);
    this.rig.idle_orbit = true;
    this.rig.input_enabled = false;
    this.rig.release_focus();
    this.rig.frame_board();
    const board = Encounters.camp(this.gs.army);
    this.board_view.show_terrain(board);
    this._sync_relics(false);
    return this._sync_pieces(board);
  }

  _refresh_camp() {
    this._sync_pieces(Encounters.camp(this.gs.army));
  }

  _open_map() {
    this.screen = Screen.MAP;
    const map = new MapScreen();
    map.setup(this.gs);
    map.node_chosen.connect((index) => this._choose_node(index));
    this._set_screen_node(map);
  }

  _choose_node(index) {
    if (this.busy || !this.gs.choose_node(index)) return;
    Sfx.play('map_step');
    this._set_screen_node(null);
    go(this._route(), 'route');
  }

  _open_reward() {
    this.screen = Screen.STOP;
    const reward = new RewardScreen();
    reward.setup(this.gs);
    reward.done.connect(() => go(this._reward_done(), 'reward_done'));
    this.overlay.add_child(reward);
    if (String(this.gs.reward.revived) !== '') this._relic_triggered('sealed_move');
  }

  /** The reward screen's `done` handler (a coroutine lambda in main.gd). */
  *_reward_done() {
    Profile.save_run(this.gs);
    this._refresh_camp();
    // New relics drop onto their shelf before the map opens.
    if (this._sync_relics(true)) yield* this._wait(1.3);
    this._resolve_levels(() => this._leave_stop());
  }

  /** Merchant, rest and event stops share this wiring: every change saves, re-syncs and levels up. */
  _open_stop(stop, changed, leave, refresh) {
    this.screen = Screen.STOP;
    changed.connect(() => {
      Profile.save_run(this.gs);
      this._refresh_camp();
      this._sync_relics(true);
      this._resolve_levels(refresh);
    });
    leave.connect(() => this._leave_stop());
    this.overlay.add_child(stop);
    if (this.gs.pending_levels.length > 0) this._resolve_levels(refresh);
  }

  /** Pending level-ups come first; `then` runs once they are resolved (or right away if none). */
  _resolve_levels(then) {
    if (this.gs.pending_levels.length === 0) {
      then();
      return;
    }
    const panel = new LevelUpScreen();
    panel.setup(this.gs);
    if (this.gs.relics.includes('annotators_quill')) this._relic_triggered('annotators_quill');
    panel.done.connect(() => {
      Profile.save_run(this.gs);
      then();
    });
    this.overlay.add_child(panel);
  }

  _leave_stop() {
    const left = this.gs.leave();
    if (!left) throw new Error(`leave() refused in phase ${this.gs.phase}`);
    go(this._route(), 'route');
  }

  _show_summary(won, reason, unlocked) {
    this.screen = Screen.SUMMARY;
    this.busy = false;
    const summary = new SummaryScreen();
    summary.setup(this.gs, won, reason, unlocked);
    summary.new_run.connect(() => {
      this.show_menu();
      this._open_new_run();
    });
    summary.main_menu.connect(() => this.show_menu());
    this.overlay.add_child(summary);
  }

  // ─────────────────────────────────────────────────────────────── pieces & relics ───────────────

  _clear_pieces() {
    for (const view of this.piece_views.values()) view.queue_free();
    this.piece_views.clear();
  }

  /**
   * Makes the piece views match a board: new pieces drop in, changed kinds re-model, higher levels
   * evolve, moved pieces hop over, missing pieces sink. True if any piece evolved. O(pieces).
   */
  _sync_pieces(board) {
    const present = new Set();
    let arrivals = 0;
    let evolved = false;
    const ordered = [...board.friendlies(), ...board.enemies()];
    for (const piece of ordered) {
      const id = String(piece.id);
      present.add(id);
      const existing = this.piece_views.get(id);
      if (existing && existing.friendly !== Boolean(piece.friendly)) {
        existing.queue_free();
        this.piece_views.delete(id);
      }
      if (!this.piece_views.has(id)) {
        const fresh = this._spawn_piece(piece);
        fresh.drop_in(0.05 + arrivals * 0.045);
        arrivals += 1;
        continue;
      }
      const view = this.piece_views.get(id);
      if (view.kind !== String(piece.kind)) view.set_kind(String(piece.kind));
      const level = Math.trunc(piece.level);
      if (level > view.level) {
        view.evolve(this.vfx, level);
        evolved = true;
      } else if (level !== view.level) {
        view.set_level(level);
      }
      const target = BoardView.cell_to_world(piece.cell);
      if (view.position.distance_to(target) > 0.01) view.travel(target, 'hop', Settings.duration(0.45));
    }
    for (const [id, view] of [...this.piece_views]) {
      if (present.has(id)) continue;
      view.sink(0.0);
      this.piece_views.delete(id);
    }
    if (evolved) Sfx.play('level_up');
    return evolved;
  }

  _spawn_piece(piece) {
    const view = new PieceView();
    view.name = `Piece_${piece.id}`;
    this.pieces_root.add_child(view);
    view.setup(piece);
    view.position = BoardView.cell_to_world(piece.cell);
    this.piece_views.set(String(piece.id), view);
    return view;
  }

  _clear_relics() {
    for (const view of this.relic_views.values()) view.queue_free();
    this.relic_views.clear();
  }

  /** Relic miniatures follow gs.relics: lost ones sink, new ones drop (animated) or appear. O(relics). */
  _sync_relics(animate) {
    const owned = new Set(this.gs.relics);
    for (const [id, view] of [...this.relic_views]) {
      if (owned.has(id)) continue;
      view.sink();
      this.relic_views.delete(id);
    }
    let arrivals = 0;
    this.gs.relics.forEach((id, i) => {
      const spot = this.arena.relic_spot(i);
      const view = this.relic_views.get(id);
      if (view) {
        if (view.spot.distance_to(spot) > 0.01) view.slide_to(spot);
        return;
      }
      const fresh = new RelicView();
      this.relics_root.add_child(fresh);
      fresh.setup(id);
      fresh.place(spot);
      const rotation = fresh.rotation;
      rotation.y = CameraRig.DEFAULT_YAW;
      fresh.rotation = rotation;
      this.relic_views.set(id, fresh);
      if (animate) {
        fresh.drop_in(this.vfx, arrivals * 0.25);
        arrivals += 1;
      }
    });
    if (arrivals > 0) Sfx.play('land', 0.7);
    return arrivals > 0;
  }

  /** A relic did something: its HUD token pulses and its miniature flares in its rarity colour. */
  _relic_triggered(id, sound = true) {
    this.hud.pulse_relic(id);
    this.relic_views.get(id)?.trigger(this.vfx, Palette.RARITY_COLORS[String(Relics.info(id).rarity)]);
    if (sound) Sfx.play('relic_trigger');
  }

  /** The Castling Deed wards the rooks when a battle opens: show it once the intro has played. */
  *_opening_relics() {
    const battle = this.gs.battle;
    if (battle.turn !== 1 || battle.side !== 'player' || !this.gs.relics.includes('castling_deed')) return;
    let warded = false;
    for (const piece of battle.board.friendlies()) if (piece.kind === 'rook' && Math.trunc(piece.ward) > 0) warded = true;
    if (warded) {
      yield* this._wait(0.9);
      this._relic_triggered('castling_deed');
    }
  }

  // ─────────────────────────────────────────────────────────────── battle ────────────────────────

  *enter_battle(intro) {
    this.screen = Screen.BATTLE;
    this.busy = false;
    this.selected_id = '';
    this.hint_move = {};
    this.hover_cell = NO_CELL;
    this.hover_id = '';
    this._clock_key_armed = false;
    this._clear_overlays();
    const battle = this.gs.battle;
    this.hud.visible = true;
    this.hud.refresh(this.gs);
    this.hud.show_piece({}, {}, 0);
    this.hud.set_status('');
    this.rig.idle_orbit = false;
    this.rig.input_enabled = true;
    this.rig.release_focus();
    this.rig.reset_view();
    this.rig.frame_board();
    this.arena.set_mood(1.0, 0.0, 0.8);
    this.board_view.show_terrain(battle.board);
    this._sync_pieces(battle.board);
    this._sync_relics(false);
    this.cursor_cell = battle.board.king(true).cell;
    if (intro) {
      this._announce_encounter();
      go(this._opening_relics(), 'opening_relics');
    }
    this._refresh_board();
    if (battle.outcome !== '') {
      go(this._battle_over(), 'battle_over');
    } else if (battle.side === 'enemy') {
      // A run restored mid-battle on the enemy's move: let the scene settle, then play it.
      this.busy = true;
      yield* this._wait(0.9);
      yield* this._enemy_turn();
    } else if (battle.in_follow_up()) {
      this.selected_id = battle.active_id;
      this._refresh_board();
    }
  }

  _announce_encounter() {
    const gs = this.gs;
    const number = `Encounter ${gs.encounter_number()} / ${gs.total_encounters()}`;
    if (gs.node_type === 'boss') {
      const boss = Encounters.BOSSES[gs.act];
      this.hud.show_banner(String(boss.name), `${String(boss.desc)}\nCapture the enemy king.`, Palette.CAPTURE, 2.4);
    } else if (gs.node_type === 'elite') {
      this.hud.show_banner('Elite', `${number}  ·  A relic awaits the victor.`, Palette.CHAIN, 1.8);
    } else {
      this.hud.show_banner(String(gs.act_info().name), number, Palette.INK, 1.6);
    }
    Sfx.play('encounter_start');
  }

  /** A click, tap or keyboard confirm on a cell: move there, select, deselect, or explain why not. */
  act_at(cell) {
    if (this.busy || this.screen !== Screen.BATTLE || !this.gs.battle.is_player_turn() || !Board.in_bounds(cell)) return;
    const battle = this.gs.battle;
    const piece = battle.board.piece_at(cell);
    if (this.selected_id !== '' && cellSet(battle.moves_for(this.selected_id)).has(cell.key())) {
      go(this._commit(this.selected_id, cell), 'commit');
      return;
    }
    if (battle.in_follow_up()) {
      if (isEmpty(piece) || piece.id !== battle.active_id) {
        this._reject(`Only your ${UiKit.piece_name(battle.board.piece_by_id(battle.active_id).kind)} can act now. End the turn to stop.`);
      }
      return;
    }
    if (!isEmpty(piece) && piece.friendly) {
      if (piece.id === this.selected_id) this._deselect();
      else if (battle.moves_for(piece.id).length === 0) {
        if (battle.player_in_check()) this._reject(`Your king is in check. That ${UiKit.piece_name(piece.kind).toLowerCase()} can't help.`);
        else this._reject(`Your ${UiKit.piece_name(piece.kind).toLowerCase()} has no moves.`);
      } else {
        this._select(piece.id);
      }
      return;
    }
    if (this.selected_id !== '') this._deselect();
  }

  _select(id) {
    this.selected_id = id;
    this.cursor_cell = this.gs.battle.board.piece_by_id(id).cell;
    Sfx.play('select');
    this._show_card();
    this._refresh_board();
  }

  _deselect() {
    if (this.selected_id === '' || this.gs.battle.in_follow_up()) return;
    this.selected_id = '';
    Sfx.play('deselect');
    this._show_card();
    this._refresh_board();
  }

  _reject(message) {
    Sfx.play('error');
    Toast.show_on(this.overlay, message, Palette.MUTED, 1.4);
  }

  /** Plays the player's move: relic checks are read before the move changes the battle state. */
  *_commit(id, to) {
    const battle = this.gs.battle;
    const mover = battle.board.piece_by_id(id);
    const ribbonReady = this.gs.relics.includes('desperado_ribbon') && !battle.relic_follow_used;
    const chartReady = this.gs.relics.includes('knights_tour_chart') && mover.kind === 'knight' && !battle.momentum_used;
    const pierces = this.gs.relics.includes('fianchetto_glass') && mover.kind === 'bishop' && Main._passes_through(battle.board, mover.cell, to);
    const record = battle.move(id, to);
    if (isEmpty(record)) throw new Error(`move ${id} -> ${to} was offered but refused`);
    this.hint_move = {};
    this.busy = true;
    Profile.save_run(this.gs);
    this._refresh_board();
    if (pierces) this._relic_triggered('fianchetto_glass');
    yield* this._animate_move(record);
    if (ribbonReady && battle.relic_follow_used) this._relic_triggered('desperado_ribbon');
    if (chartReady && battle.momentum_used) this._relic_triggered('knights_tour_chart');
    this.hud.refresh(this.gs);
    yield* this._continue_turn(record.turn_end);
  }

  /** A straight slide over at least one occupied square (the Fianchetto Glass pierce). O(steps). */
  static _passes_through(board, from, to) {
    const delta = to.sub(from);
    const steps = Math.max(Math.abs(delta.x), Math.abs(delta.y));
    if (steps < 2 || (delta.x !== 0 && delta.y !== 0 && Math.abs(delta.x) !== Math.abs(delta.y))) return false;
    const step = new Vector2i(Math.sign(delta.x), Math.sign(delta.y));
    for (let i = 1; i < steps; i++) if (!isEmpty(board.piece_at(from.add(step.mul(i))))) return true;
    return false;
  }

  *_end_turn() {
    if (this.busy || this.screen !== Screen.BATTLE || !this.gs.battle.is_player_turn()) return;
    const turnEnd = this.gs.battle.end_turn();
    this.busy = true;
    this.selected_id = '';
    this.hint_move = {};
    Profile.save_run(this.gs);
    yield* this._continue_turn(turnEnd);
  }

  /** After a player move or pass: terrain losses, extra turns, then the enemy or the next follow-up. */
  *_continue_turn(turnEnd) {
    const battle = this.gs.battle;
    if (!isEmpty(turnEnd)) {
      this.selected_id = '';
      yield* this._animate_destroyed(turnEnd.destroyed);
      if (turnEnd.extra_turn) {
        const relic = this._clock_key_armed ? 'clockmakers_key' : 'opening_book';
        this._clock_key_armed = false;
        this._relic_triggered(relic);
        this.hud.show_banner('Extra turn', Relics.display_name(relic), Palette.CHAIN, 1.0);
      }
    }
    if (battle.outcome !== '') {
      go(this._battle_over(), 'battle_over');
      return;
    }
    if (battle.side === 'enemy') {
      yield* this._enemy_turn();
      return;
    }
    this.busy = false;
    if (battle.in_follow_up()) {
      this.selected_id = battle.active_id;
      Sfx.play_step('chain_step', battle.turn_captures);
      const view = this.piece_views.get(this.selected_id);
      this.vfx.ring(view.global_position.add(Vector3.UP.mul(0.05)), Palette.CHAIN, 0.9, 0.5);
    }
    this._show_card();
    this._refresh_board();
  }

  *_enemy_turn() {
    const battle = this.gs.battle;
    this.busy = true;
    this.selected_id = '';
    this._refresh_board();
    this.hud.set_status('');
    yield* this._wait(0.35);
    if (battle.enemy_moves_twice()) {
      this.hud.show_banner(`${String(Encounters.BOSSES[this.gs.act].name)} moves twice`, '', Palette.CAPTURE, 0.9);
      yield* this._wait(0.8);
    }
    const records = this.gs.run_enemy_turn();
    Profile.save_run(this.gs);
    for (const record of records) {
      if ('terrain' in record) {
        yield* this._animate_destroyed(record.terrain);
      } else {
        yield* this._animate_move(record);
        yield* this._wait(0.1);
      }
    }
    this.hud.refresh(this.gs);
    if (battle.outcome !== '') {
      go(this._battle_over(), 'battle_over');
      return;
    }
    this.busy = false;
    if (battle.player_in_check()) {
      Sfx.play('check', 1.0, -4.0);
      const king = this.piece_views.get(String(battle.board.king(true).id));
      this.vfx.ring(king.global_position.add(Vector3.UP.mul(0.05)), Palette.THREAT, 1.1, 0.6);
      this.hud.show_banner('Check', 'Protect your king.', Palette.CAPTURE, 0.9);
    }
    this._show_card();
    this._refresh_board();
  }

  /** One move record: travel (or bounce off a ward), landing, capture, XP and gold, promotion. */
  *_animate_move(record) {
    const view = this.piece_views.get(String(record.id));
    const from = record.from;
    const to = record.to;
    const toWorld = BoardView.cell_to_world(to);
    const friendly = Boolean(record.friendly);
    if (record.bounced) {
      Sfx.play('move');
      view.bounce_towards(toWorld, Settings.duration(0.5));
      yield* this._wait(0.22);
      const guard = this.piece_views.get(String(record.target_id));
      const above = guard.global_position.add(Vector3.UP.mul(guard.top_height() + 0.3));
      if (record.shielded) {
        this._relic_triggered('fortress_stone');
        this.vfx.ring(guard.global_position.add(Vector3.UP.mul(0.05)), Palette.GOLD_BRIGHT, 1.1, 0.5);
        this.vfx.float_text(above, 'Fortress', Palette.GOLD_BRIGHT, 56);
      } else {
        Sfx.play('land', 0.8);
        this.vfx.ring(guard.global_position.add(Vector3.UP.mul(0.05)), Palette.MOVE, 1.0, 0.5);
        this.vfx.float_text(above, 'Warded', Palette.MOVE, 56);
      }
      this.rig.add_trauma(0.15);
      yield* this._wait(0.4);
      return;
    }
    const distance = Board.distance(from, to);
    const style = Main._is_jump(String(record.kind), from, to) ? 'jump' : distance <= 1 ? 'hop' : 'slide';
    const duration = Settings.duration(0.24 + 0.07 * distance + (style === 'jump' ? 0.12 : 0.0));
    Sfx.play(friendly ? 'move' : 'enemy_move');
    view.travel(toWorld, style, duration);
    yield this.tree.create_timer(duration);
    Sfx.play('land');
    if (friendly) this.board_view.pulse_tile(to, Palette.MOVE, 0.3);
    if (!isEmpty(record.captured)) {
      this._shatter(String(record.captured.id), ChessRules.ROYAL.includes(String(record.captured.kind)));
      if (friendly) {
        this.vfx.float_text(toWorld.add(Vector3.UP.mul(view.top_height() + 0.35)), `+${Math.trunc(record.xp)} XP`, Palette.GOLD_BRIGHT, 60);
        if (Math.trunc(record.gold) > 0) {
          this._relic_triggered('ransom_ledger', false);
          Sfx.play('coin');
          this.vfx.float_text(toWorld.add(Vector3.UP.mul(view.top_height() + 0.75)), `+${Math.trunc(record.gold)} gold`, Palette.GOLD, 52);
        }
        if (this.gs.relics.includes('brilliancy_prize')) this._relic_triggered('brilliancy_prize', false);
      } else {
        this.rig.add_trauma(0.12);
      }
      if (friendly && !isNoCell(record.corrupted)) {
        const corrupted = record.corrupted;
        this.board_view.show_terrain(this.gs.battle.board);
        this.vfx.burst(BoardView.cell_to_world(corrupted, 0.2), Palette.CORRUPTED, 22, 2.0, 0.07);
      }
      yield* this._wait(0.2);
    }
    if (record.promoted) {
      view.promote(this.vfx);
      Sfx.play('promote');
      this.vfx.float_text(toWorld.add(Vector3.UP.mul(1.6)), 'Promoted', Palette.GOLD_BRIGHT, 60);
      if (friendly && this.gs.relics.includes('queening_charter')) this._relic_triggered('queening_charter', false);
      yield* this._wait(0.55);
    }
  }

  _shatter(id, royal) {
    const victim = this.piece_views.get(id);
    this.piece_views.delete(id);
    const origin = victim.global_position;
    victim.shatter(this.vfx, royal ? 1.6 : 1.0);
    this.vfx.burst(origin.add(Vector3.UP.mul(0.35)), Palette.CAPTURE, 26, 3.0);
    this.vfx.flash(origin.add(Vector3.UP.mul(0.5)), Palette.CAPTURE, 2.2, 0.2, 2.2);
    this.rig.add_trauma(royal ? 0.55 : 0.32);
    Sfx.play('capture');
    Sfx.play('shatter', 1.0, -6.0);
  }

  /** Pieces consumed by corrupted terrain. */
  *_animate_destroyed(destroyed) {
    if (!destroyed || destroyed.length === 0) return;
    for (const piece of destroyed) {
      const id = String(piece.id);
      const view = this.piece_views.get(id);
      this.piece_views.delete(id);
      this.vfx.burst(view.global_position.add(Vector3.UP.mul(0.3)), Palette.CORRUPTED, 30, 2.4, 0.08);
      this.vfx.float_text(view.global_position.add(Vector3.UP.mul(view.top_height() + 0.3)), 'Consumed', Palette.CORRUPTED, 54);
      view.shatter(this.vfx, 1.2);
    }
    Sfx.play('shatter');
    this.rig.add_trauma(0.3);
    yield* this._wait(0.6);
  }

  /** Knights, and any move that is neither straight nor diagonal, leap instead of sliding. */
  static _is_jump(kind, from, to) {
    const delta = to.sub(from).abs();
    return kind === 'knight' || (delta.x !== 0 && delta.y !== 0 && delta.x !== delta.y);
  }

  *_battle_over() {
    this.busy = true;
    this.selected_id = '';
    this.hint_move = {};
    this.hover_cell = NO_CELL;
    this.hover_id = '';
    const battle = this.gs.battle;
    this.board_view.clear_marks();
    this.board_view.clear_cursor();
    this.board_view.hide_arc();
    this.hud.show_piece({}, {}, 0);
    this.hud.set_turn('idle', battle.turn);
    this.hud.set_status('');
    for (const view of this.piece_views.values()) {
      view.clear_marks();
      view.set_threatened(false);
    }
    const won = battle.outcome === 'won';
    const reason = battle.reason;
    const boss = this.gs.node_type === 'boss';
    if (won) {
      let delay = 0.15;
      for (const piece of battle.board.enemies()) {
        const id = String(piece.id);
        this.piece_views.get(id).sink(delay);
        this.piece_views.delete(id);
        delay += 0.08;
      }
      Sfx.play(boss ? 'victory' : 'encounter_won');
      this.arena.set_mood(1.25, 0.4, 0.8);
      const title = boss ? `${String(Encounters.BOSSES[this.gs.act].name)} falls` : 'Victory';
      const subtitle = VICTORY_SUBTITLES[reason];
      if (subtitle === undefined) throw new Error(`no victory subtitle for reason "${reason}"`);
      this.hud.show_banner(title, subtitle, Palette.GOLD_BRIGHT, 1.6);
      if (this.gs.relics.includes('appearance_fee')) {
        yield* this._wait(0.7);
        this._relic_triggered('appearance_fee', false);
        Sfx.play('coin');
        this.vfx.float_text(this.relic_views.get('appearance_fee').top(), '+2 gold', Palette.GOLD, 52);
        yield* this._wait(1.4);
      } else {
        yield* this._wait(2.1);
      }
    } else {
      let delay = 0.1;
      for (const piece of battle.board.friendlies()) {
        this.piece_views.get(String(piece.id)).topple(delay);
        delay += 0.07;
      }
      Sfx.play('lost');
      this.arena.set_mood(0.5, 0.0, 1.2);
      this.hud.show_banner('Defeat', String(SummaryScreen.REASONS[reason]), Palette.CAPTURE, 2.0);
      yield* this._wait(2.6);
    }
    this.gs.finish_battle();
    if (this.gs.phase === 'lost') {
      this._show_summary(false, reason, Profile.record_run_end(this.gs, false));
      return;
    }
    const unlocked = [];
    if (boss) unlocked.push(...Profile.record_boss(this.gs));
    if (this.gs.phase === 'won') {
      unlocked.push(...Profile.record_run_end(this.gs, true));
      this._show_summary(true, reason, unlocked);
      return;
    }
    if (this._tutorial) {
      Profile.mark_tutorial_done();
      this._tutorial = false;
    }
    for (const id of unlocked) Toast.show_on(this.overlay, `Unlocked: ${String(Profile.UNLOCKS[id].name)}`, Palette.GOLD_BRIGHT, 3.0);
    go(this._route(), 'route');
  }

  // ─────────────────────────────────────────────────────────────── board presentation ────────────

  /**
   * Redraws every board mark from the battle state: threats, selection, moves (danger-marked under
   * the Kibitzer's Whisper), capture targets, the hover arc, the hint and the cursor. O(pieces + cells).
   */
  _refresh_board() {
    const battle = this.gs.battle;
    this.board_view.clear_marks();
    this.board_view.hide_arc();
    const playerTurn = battle.is_player_turn() && !this.busy;
    // Kibitzer's Whisper: every square an enemy attacks, plus the hovered enemy's own reach.
    const foresight = playerTurn && this.gs.relics.includes('kibitzers_whisper');
    const attacked = foresight ? cellSet(battle.enemy_attack_cells()) : new Set();
    if (foresight && this.hover_id !== '' && battle.board.has_piece(this.hover_id) && !battle.board.piece_by_id(this.hover_id).friendly) {
      for (const cell of ChessRules.attack_cells(battle.board, battle.board.piece_by_id(this.hover_id))) this.board_view.mark(cell, Mark.REACH, Palette.THREAT);
    }
    const threatened = new Set(battle.outcome === '' ? battle.threatened_ids() : []);
    const hinted = isEmpty(this.hint_move) ? '' : String(this.hint_move.id);
    for (const [id, view] of this.piece_views) {
      view.set_threatened(view.friendly && threatened.has(id));
      view.set_selected(id === this.selected_id);
      view.set_hinted(hinted !== '' && id === hinted && id !== this.selected_id);
      view.set_targeted(false);
      view.set_hovered(playerTurn && id === this.hover_id);
    }
    if (playerTurn && this.selected_id !== '') {
      const piece = battle.board.piece_by_id(this.selected_id);
      const follow = battle.in_follow_up();
      const moves = battle.moves_for(this.selected_id);
      this.board_view.mark(piece.cell, Mark.SELECTED, Palette.SELECT);
      for (const cell of moves) {
        const target = battle.board.piece_at(cell);
        if (isEmpty(target)) {
          const tileColor = follow ? Palette.CHAIN : Palette.MOVE;
          if (attacked.has(cell.key())) this.board_view.mark(cell, Mark.DANGER, tileColor);
          else this.board_view.mark(cell, follow ? Mark.CHAIN : Mark.MOVE, tileColor);
        } else {
          this.board_view.mark(cell, Mark.CAPTURE, Palette.CAPTURE);
          this.piece_views.get(String(target.id)).set_targeted(true);
        }
      }
      if (cellSet(moves).has(this.hover_cell.key())) {
        const capture = !isEmpty(battle.board.piece_at(this.hover_cell));
        const color = capture ? Palette.CAPTURE : follow ? Palette.CHAIN : Palette.MOVE;
        this.board_view.show_arc(piece.cell, this.hover_cell, Main._is_jump(String(piece.kind), piece.cell, this.hover_cell), color);
      }
    }
    if (playerTurn && !isEmpty(this.hint_move)) this.board_view.mark(this.hint_move.to, Mark.HINT, Palette.HINT);
    if (playerTurn && this.keyboard_mode) this.board_view.set_cursor(this.cursor_cell, Mark.CURSOR, Palette.INK);
    else if (playerTurn && !isNoCell(this.hover_cell)) this.board_view.set_cursor(this.hover_cell, Mark.HOVER, Palette.INK);
    else this.board_view.clear_cursor();
    this._refresh_turn_bar();
  }

  _refresh_turn_bar() {
    const battle = this.gs.battle;
    if (!battle.is_player_turn()) {
      this.hud.set_turn(battle.outcome === '' ? 'enemy' : 'idle', battle.turn);
      return;
    }
    const canMove = battle.movable_ids().length > 0;
    this.hud.set_turn('player', battle.turn, battle.in_follow_up(), canMove);
    if (this.busy) return;
    this.hud.set_status(this._status_text(canMove));
  }

  /** The turn bar's guidance line, most specific situation first. */
  _status_text(canMove) {
    const battle = this.gs.battle;
    if (!isEmpty(this.hint_move)) {
      const piece = battle.board.piece_by_id(String(this.hint_move.id));
      return `Hint: your ${UiKit.piece_name(piece.kind).toLowerCase()} to ${this._cell_name(this.hint_move.to)}.`;
    }
    if (battle.in_follow_up()) {
      const kindName = UiKit.piece_name(battle.board.piece_by_id(battle.active_id).kind).toLowerCase();
      if (battle.bonus_captures > 0 && battle.bonus_moves === 0 && battle.bonus_quiet === 0) return `Chain: your ${kindName} may capture again.`;
      if (battle.bonus_quiet > 0 && battle.bonus_moves === 0 && battle.bonus_captures === 0) return `Charge: your ${kindName} may step back to safety.`;
      return `Your ${kindName} may move again.`;
    }
    if (battle.player_in_check()) return 'Your king is in check.';
    if (Battle.TURN_LIMIT - battle.turn < Battle.LIMIT_WARNING) return `At turn ${Battle.TURN_LIMIT} the field goes to the stronger army.`;
    if (!canMove) return 'No legal moves. Pass the turn.';
    if (this._tutorial && this.selected_id === '' && battle.turn <= 2) return 'Select a piece. Blue squares are moves, red squares are captures.';
    if (this._tutorial && this.selected_id !== '' && battle.turn <= 2) return 'Choose a square. The enemy moves after you.';
    return '';
  }

  /** Algebraic square name: files a–f left to right, ranks 6–1 top to bottom. */
  _cell_name(cell) {
    return `${FILES[cell.x]}${Board.SIZE - cell.y}`;
  }

  /** The piece card shows the hovered piece, else the selected one; friendlies with live XP. */
  _show_card() {
    const battle = this.gs.battle;
    const id = this.hover_id !== '' ? this.hover_id : this.selected_id;
    if (id === '' || !battle.board.has_piece(id)) {
      this.hud.show_piece({}, {}, 0);
      return;
    }
    const piece = battle.board.piece_by_id(id);
    if (!piece.friendly) {
      this.hud.show_piece(piece, {}, 0);
      return;
    }
    const entry = { ...this.gs.army_entry(id) };
    const gained = battle.xp_gained[id];
    if (gained === undefined) throw new Error(`no xp_gained entry for ${id}`);
    entry.xp = Math.trunc(entry.xp) + Math.trunc(gained);
    this.hud.show_piece(piece, entry, this.gs.next_threshold(entry));
  }

  // ─────────────────────────────────────────────────────────────── input ─────────────────────────

  _unhandled_input(event) {
    if (this.gs === null || this.screen === Screen.MENU || this.screen === Screen.SUMMARY) return;
    if (this.screen !== Screen.BATTLE) {
      if (event.is_action_pressed('pause')) {
        this.tree.setInputAsHandled();
        this._open_pause();
      }
      return;
    }
    if (event.is_action_pressed('pause')) {
      this.tree.setInputAsHandled();
      if (this.selected_id !== '' && !this.busy && !this.gs.battle.in_follow_up()) this._deselect();
      else this._open_pause();
      return;
    }
    if (event.is_action_pressed('help')) {
      this._open_help();
      return;
    }
    if (this.busy || !this.gs.battle.is_player_turn() || this._modal_open()) return;
    if (event.kind === 'mouse_motion') {
      this.keyboard_mode = false;
      this._update_hover(event.position);
    } else if (event.kind === 'mouse_button') {
      if (event.button_index === MOUSE_BUTTON.LEFT && event.pressed) {
        this.keyboard_mode = false;
        const hit = this._pick(event.position);
        if (!isNoCell(hit.cell)) this.act_at(hit.cell);
        else if (!this.gs.battle.in_follow_up()) this._deselect();
      } else if (event.button_index === MOUSE_BUTTON.RIGHT) {
        // Right drag orbits the camera (CameraRig); a right click without drag deselects.
        if (event.pressed) this._right_press = new Vector2(event.position.x, event.position.y);
        else if (Math.hypot(event.position.x - this._right_press.x, event.position.y - this._right_press.y) < RIGHT_CLICK_SLOP) this._deselect();
      }
    } else if (event.is_action_pressed('confirm')) {
      if (this.gs.battle.in_follow_up() || this.gs.battle.movable_ids().length === 0) go(this._end_turn(), 'end_turn');
    } else if (event.is_action_pressed('undo')) {
      this._deselect();
    } else if (event.is_action_pressed('hint')) {
      this._hint();
    } else if (event.is_action_pressed('cycle_piece')) {
      this._cycle_piece();
    } else if (event.is_action_pressed('cursor_act')) {
      this.keyboard_mode = true;
      this.act_at(this.cursor_cell);
    } else {
      for (const action of Object.keys(CURSOR_STEPS)) {
        if (event.is_action_pressed(action, true)) {
          this._move_cursor(action);
          break;
        }
      }
    }
  }

  /** Any modal among the overlay's children — including one closing this frame, as in Godot. */
  _modal_open() {
    return this.overlay.children.some((child) => child instanceof Modal);
  }

  /**
   * Board cell under a screen point. A piece's pick cylinder (layer PICK_LAYER) wins over the tile
   * under the ray, except when the tile is a legal move of the selection and the piece's cell is not
   * (so tall pieces never hide the square behind them).
   */
  _pick(screenPosition) {
    const camera = this.rig.camera;
    const board = this.gs.battle.board;
    const origin = camera.project_ray_origin(screenPosition);
    const direction = camera.project_ray_normal(screenPosition);
    const floorCell = this.board_view.cell_from_ray(origin, direction);
    let cell = floorCell;
    const hit = intersectRay(origin, origin.add(direction.mul(PICK_RAY_LENGTH)), PICK_LAYER);
    if (!isEmpty(hit)) {
      const id = String(hit.collider.get_meta('piece_id'));
      if (board.has_piece(id)) cell = board.piece_by_id(id).cell;
    }
    if (this.selected_id !== '' && !sameCell(cell, floorCell)) {
      const moves = cellSet(this.gs.battle.moves_for(this.selected_id));
      if (!moves.has(cell.key()) && moves.has(floorCell.key())) cell = floorCell;
    }
    const standing = isNoCell(cell) ? {} : board.piece_at(cell);
    return { cell, id: isEmpty(standing) ? '' : String(standing.id) };
  }

  /** A cell's screen position in canvas units (the capture tour aims clicks with it). */
  cell_screen_position(cell, height = 0.3) {
    return this.rig.camera.unproject_position(BoardView.cell_to_world(cell, height));
  }

  _update_hover(screenPosition) {
    const hit = this._pick(screenPosition);
    if (sameCell(hit.cell, this.hover_cell) && hit.id === this.hover_id) return;
    this.hover_cell = hit.cell;
    this.hover_id = hit.id;
    this._show_card();
    this._refresh_board();
  }

  _move_cursor(action) {
    this.keyboard_mode = true;
    const step = CURSOR_STEPS[action];
    this.cursor_cell = this.cursor_cell.add(step).clamp(Vector2i.ZERO, new Vector2i(Board.SIZE - 1, Board.SIZE - 1));
    this.hover_cell = this.cursor_cell;
    const piece = this.gs.battle.board.piece_at(this.cursor_cell);
    this.hover_id = isEmpty(piece) ? '' : String(piece.id);
    Sfx.play('ui_hover', 1.0, -8.0);
    this._show_card();
    this._refresh_board();
  }

  /** Tab / shoulder button: the next piece that can move (wrapping). */
  _cycle_piece() {
    if (this.gs.battle.in_follow_up()) return;
    const movable = this.gs.battle.movable_ids();
    if (movable.length === 0) return;
    const next = movable[(movable.indexOf(this.selected_id) + 1) % movable.length];
    this.keyboard_mode = true;
    this._select(next);
  }

  _hint() {
    if (this.busy || this.screen !== Screen.BATTLE || !this.gs.battle.is_player_turn()) return;
    if (this.gs.hints_left === 0) {
      this._reject('No hints left this run.');
      return;
    }
    const move = this.gs.hint();
    if (isEmpty(move)) {
      this._reject('There is no move to suggest.');
      return;
    }
    Profile.save_run(this.gs);
    this.hint_move = move;
    this.selected_id = String(move.id);
    Sfx.play('relic_trigger', 1.3, -6.0);
    this.hud.refresh(this.gs);
    this._show_card();
    this._refresh_board();
  }

  _use_clock_key() {
    if (this.busy || this.screen !== Screen.BATTLE || !this.gs.battle.use_clock_key()) return;
    this._clock_key_armed = true;
    Profile.save_run(this.gs);
    this._relic_triggered('clockmakers_key');
    this.hud.refresh(this.gs);
    Toast.show_on(this.overlay, 'The clock is wound: you move again before the enemy.', Palette.CHAIN, 2.0);
  }

  // ─────────────────────────────────────────────────────────────── overlays ──────────────────────

  /** The one full-screen page (menu or map) sits under any panels opened over it. */
  _set_screen_node(node) {
    if (isInstanceValid(this._screen_node)) this._screen_node.queue_free();
    this._screen_node = node;
    if (node !== null) {
      this.overlay.add_child(node);
      this.overlay.move_child(node, 0);
    }
  }

  _clear_overlays() {
    for (const child of this.overlay.get_children()) child.queue_free();
    this._screen_node = null;
  }

  _open_pause() {
    if (this.gs === null || this.busy) return;
    if (this.overlay.children.some((child) => child instanceof PauseMenu)) return;
    const pause = new PauseMenu();
    pause.setup(this.gs);
    pause.show_help.connect(() => this._open_help());
    pause.show_settings.connect(() => this._open_settings());
    pause.restart_run.connect(() => this._restart_run());
    pause.quit_to_menu.connect(() => {
      Profile.save_run(this.gs);
      this.show_menu();
    });
    this.overlay.add_child(pause);
  }

  _open_help() {
    if (this.overlay.children.some((child) => child instanceof HelpPanel)) return;
    this.overlay.add_child(new HelpPanel());
  }

  _open_settings() {
    const panel = new SettingsPanel();
    panel.closed.connect(() => {
      if (this.screen === Screen.BATTLE) this._refresh_board();
    });
    this.overlay.add_child(panel);
  }

  /** `await _wait(seconds)`: a timer scaled by the animation-speed setting. */
  *_wait(seconds) {
    yield this.tree.create_timer(Settings.duration(seconds));
  }
}
