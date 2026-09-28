/**
 * Autopilot — port of scripts/presentation/autopilot.gd: the original's own capture tour. With
 * `?capture` it drives the real game (menu, a whole run played by the tactics engine through
 * synthetic mouse and keyboard input, every stop) and takes the same numbered screenshots the
 * original took, so both builds can be compared shot by shot.
 *
 *   ?capture                 the full tour (seed TOUR-7, three acts)
 *   ?capture&menu            only the menu            ?capture&arena     the three arenas
 *   ?capture&pieces          the piece line-ups       ?capture&relics    the relic showcase
 *   ?capture&perf / &bench   frame statistics / AI timings
 *   &seed=…  &acts=…
 *
 * The page provides the host: capture(label) stores the frame just drawn, setWindowSize resizes the
 * game window, finish(failures) ends the tour.
 */
import { Node } from '../godot/scene.js';
import { go } from '../godot/coroutine.js';
import { OS, Time } from '../godot/os.js';
import { Vector2i, Vector3 } from '../godot/math.js';
import { Node3D } from '../godot/node3d.js';
import { RandomNumberGenerator } from '../godot/rng.js';
import { InputEvent, KEY, MOUSE_BUTTON } from '../godot/input.js';
import { Gui } from '../godot/ui/control.js';
import { GridContainer } from '../godot/ui/containers.js';
import { Label } from '../godot/ui/label.js';
import { Board, isEmpty } from '../core/board.js';
import { ChessRules } from '../core/chess_rules.js';
import { Events } from '../core/events.js';
import { GameState } from '../core/game_state.js';
import { Relics } from '../core/relics.js';
import { Tactics } from '../core/tactics.js';
import { Settings } from '../autoload/settings.js';
import { Arena } from './arena.js';
import { BoardView } from './board_view.js';
import { CameraRig } from './camera_rig.js';
import { RelicView } from './relic_view.js';
import { Palette } from './palette.js';
import { Screen } from './main_scene.js';
import { UiKit } from './ui/ui_kit.js';
import { Modal, RelicToken } from './ui/parts.js';
import { CreditsPanel, EventScreen, LevelUpScreen, MapScreen, MerchantScreen, RestScreen, RewardScreen } from './ui/screens.js';

const SIZES = Object.freeze([new Vector2i(1280, 720), new Vector2i(1920, 1080), new Vector2i(1024, 768), new Vector2i(2560, 1080)]);
const HOME_SIZE = Object.freeze(new Vector2i(1600, 900));
const TIME_LIMIT_MSEC = 20 * 60 * 1000;
const HITCH_MS = 50.0;
const VIDEO_ENCOUNTERS = 3;
const PERF_FRAMES = 180;

const pad2 = (n) => String(n).padStart(2, '0');

export class Autopilot extends Node {
  /** @type {{capture(label: string, index: number): void, setWindowSize(w: number, h: number): void, finish(failures: number): void, log(line: string): void, frameStats?(): {draws: number, triangles: number}}} */
  static host = null;

  constructor() {
    super('Autopilot');
    this.main = null;
    this._seed = 'TOUR-7';
    this._acts = 3;
    /** Which tour runs — one explicit mode instead of six booleans. */
    this._mode = 'run';
    this._hitches = false;
    this._video = false;
    this._last_frame = 0;
    this._slow = [];
    this._failures = 0;
    this._index = 0;
    this._seen = new Set();
    this._rng = new RandomNumberGenerator();
    this._started = 0;
    this._finished = false;
  }

  get host() {
    if (!Autopilot.host) throw new Error('the capture tour needs a host (Autopilot.host)');
    return Autopilot.host;
  }

  _ready() {
    const modes = { '--arena': 'arena', '--pieces': 'pieces', '--relics': 'relics', '--perf': 'perf', '--menu': 'menu', '--bench': 'bench' };
    for (const arg of OS.get_cmdline_user_args()) {
      if (arg.startsWith('--seed=')) this._seed = arg.slice('--seed='.length);
      else if (arg.startsWith('--acts=')) this._acts = Math.trunc(Number(arg.slice('--acts='.length)));
      else if (arg in modes) this._mode = modes[arg];
      else if (arg === '--hitches') this._hitches = true;
      else if (arg === '--video') this._video = true;
    }
    this._rng.seed = 7;
    this._started = Time.get_ticks_msec();
    Settings.set_value('animation_speed', 1.5);
    const tours = {
      bench: () => this._benchmark(),
      arena: () => this._arena_tour(),
      pieces: () => this._piece_lineup(),
      relics: () => this._relic_showcase(),
      perf: () => this._performance(),
      menu: () => this._menu_shot(),
      run: () => this._run(),
    };
    this.tree.callDeferred(() => go(tours[this._mode](), `tour:${this._mode}`));
  }

  _process(_delta) {
    if (this._finished) return;
    if (this._hitches) {
      const now = Time.get_ticks_usec();
      if (this._last_frame > 0 && (now - this._last_frame) / 1000.0 > HITCH_MS) {
        const main = this.main;
        const side = main.gs !== null && main.gs.battle !== null ? main.gs.battle.side : '-';
        this._slow.push([(now - this._last_frame) / 1000.0, (Time.get_ticks_msec() - this._started) / 1000.0, main.screen, side]);
      }
      this._last_frame = now;
    }
    if (Time.get_ticks_msec() - this._started > TIME_LIMIT_MSEC) {
      this._check(false, `tour finished within ${TIME_LIMIT_MSEC / 60000} minutes`);
      this._finish();
    }
  }

  // ─────────────────────────────────────────────────────────────── tours ─────────────────────────

  *_run() {
    const main = this.main;
    yield* this._wait(0.5);
    main.show_menu();
    yield* this._wait(2.8);
    yield* this._shot('menu');
    if (!this._video) {
      const credits = new CreditsPanel();
      main.overlay.add_child(credits);
      yield* this._wait(0.6);
      let text = '';
      for (const label of credits.find_children_of(Label)) text += label.text;
      this._check(text.includes('Godot Engine contributors') && text.includes('Cinzel Project Authors') && text.includes('Cormorant Project Authors'), 'the credits carry the Godot and font licence notices');
      yield* this._shot('credits');
      this._close_modals();
      yield* this._wait(0.3);
    }
    main._open_new_run();
    yield* this._wait(this._video ? 1.2 : 0.7);
    yield* this._shot('new_run');
    this._close_modals();
    yield* this._wait(0.2);

    main.start_run({ seed: this._seed, army: 'vanguard', difficulty: 'standard' });
    yield* this._wait(1.4);
    this._check(main.gs.phase === 'reward' && this._find(RewardScreen) !== null, 'a new run opens on the first relic choice');
    yield* this._shot('opening_relic');
    let resumed = false;
    while (main.gs !== null && main.gs.act < this._acts && main.screen !== Screen.SUMMARY) {
      if (this._video && main.gs.encounters_won >= VIDEO_ENCOUNTERS) {
        yield* this._wait(2.0);
        this._finish();
        return;
      }
      if (main.screen === Screen.BATTLE) {
        yield* this._play_battle();
      } else if (main.screen === Screen.MAP) {
        if (!resumed && main.gs.encounters_won === 1 && !this._video) {
          resumed = true;
          yield* this._resume_from_menu();
        }
        yield* this._choose_on_map();
      } else if (main.screen === Screen.STOP) {
        yield* this._handle_stop();
      } else {
        this._check(false, `tour reached an unexpected screen ${main.screen}`);
        break;
      }
      yield* this._wait(0.1);
    }
    yield* this._wait(1.0);
    if (main.screen === Screen.SUMMARY) {
      yield* this._shot('summary');
      this._check(true, `the run ends on the summary (${main.gs.phase}, ${main.gs.encounters_won} encounters won)`);
    } else {
      this._check(main.gs.act >= this._acts, `the tour played ${this._acts} act(s)`);
    }
    this._finish();
  }

  /** A battle of the tour's run, entered with an empty HUD-less board: the three arenas. */
  *_enter_first_battle(settle) {
    const main = this.main;
    yield* this._wait(0.5);
    main.start_run({ seed: this._seed, army: 'vanguard', difficulty: 'standard' });
    yield* this._wait(0.8);
    main.gs.skip_relic();
    main._leave_stop();
    yield* this._wait(0.6);
    main._choose_node(0);
    yield* this._wait(settle);
  }

  *_arena_tour() {
    const main = this.main;
    yield* this._enter_first_battle(2.5);
    main.hud.visible = false;
    for (const variant of Arena.VARIANTS) {
      main.arena.set_variant(variant);
      main.rig.reset_view();
      yield* this._wait(1.8);
      yield* this._shot(`arena_${variant}`);
      main.rig.target_pitch = 0.68;
      main.rig.target_yaw = CameraRig.DEFAULT_YAW - 0.7;
      yield* this._wait(1.8);
      yield* this._shot(`arena_${variant}_low`);
    }
    this._finish();
  }

  *_piece_lineup() {
    const main = this.main;
    yield* this._enter_first_battle(2.0);
    main.hud.visible = false;
    main.board_view.clear_marks();
    main._clear_pieces();
    const kinds = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
    const rows = [[5, true, 0], [4, true, 1], [3, true, 2], [2, true, 3], [1, false, 0], [0, false, 2]];
    for (const row of rows) {
      kinds.forEach((kind, x) => main._spawn_piece(Board.make_piece(`lineup_${row[0]}_${x}`, kind, row[1], new Vector2i(x, row[0]), row[2])));
    }
    main.rig.set_safe_area(-0.95, 0.95, -0.95, 0.95);
    main.rig.target_pitch = 0.62;
    main.rig.target_yaw = 0.0;
    yield* this._wait(2.0);
    yield* this._shot('pieces_all');
    main.rig.target_pitch = 0.32;
    main.rig.target_zoom = 0.55;
    main.rig.target_focus = new Vector3(0, 0, 1.6);
    yield* this._wait(2.0);
    yield* this._shot('pieces_ivory_front');
    main.rig.target_focus = new Vector3(0, 0, -0.6);
    yield* this._wait(2.0);
    yield* this._shot('pieces_ivory_late');
    main.rig.target_yaw = Math.PI;
    main.rig.target_focus = new Vector3(0, 0, -1.8);
    yield* this._wait(2.5);
    yield* this._shot('pieces_obsidian');

    for (const kind of ['knight', 'bishop', 'queen', 'king', 'rook', 'pawn']) {
      main._clear_pieces();
      for (let tier = 0; tier < 4; tier++) main._spawn_piece(Board.make_piece(`show_${tier}`, kind, true, new Vector2i(3, 5 - tier), tier));
      main._spawn_piece(Board.make_piece('show_enemy', kind, false, new Vector2i(3, 1), 2));
      main.rig.target_yaw = Math.PI * 0.5 + 0.35;
      main.rig.target_pitch = 0.2;
      main.rig.target_zoom = 0.5;
      main.rig.target_focus = new Vector3(0.5, 0.25, 0.6);
      yield* this._wait(1.6);
      yield* this._shot(`profile_${kind}`);
    }
    main.rig.frame_board();
    main.rig.reset_view();
    main.rig.release_focus();
    yield* this._wait(2.5);
    yield* this._shot('pieces_game_view');

    const sheet = new GridContainer();
    sheet.columns = 6;
    sheet.add_theme_constant_override('h_separation', 28);
    sheet.add_theme_constant_override('v_separation', 18);
    for (const id of Relics.ids()) {
      const cell = UiKit.vbox(6);
      cell.add_child(RelicToken.make(id, 96));
      cell.add_child(UiKit.caption(Relics.display_name(id), Palette.INK, 12));
      sheet.add_child(cell);
    }
    main.overlay.add_child(UiKit.centered(sheet));
    yield* this._wait(0.6);
    yield* this._shot('relic_icons');
    this._finish();
  }

  *_relic_showcase() {
    const main = this.main;
    yield* this._enter_first_battle(2.0);
    main.hud.visible = false;
    main.board_view.clear_marks();
    main._clear_pieces();
    const shelf = new Node3D('Shelf');
    main.add_child(shelf);
    Relics.ids().forEach((id, i) => {
      const view = new RelicView();
      shelf.add_child(view);
      view.setup(id);
      view.place(BoardView.cell_to_world(new Vector2i(i % 6, Math.trunc(i / 6) * 2)));
    });
    main.rig.set_safe_area(-0.95, 0.95, -0.95, 0.95);
    main.rig.target_yaw = 0.0;
    main.rig.target_pitch = 0.62;
    yield* this._wait(2.0);
    yield* this._shot('relics_all');
    for (let row = 0; row < 3; row++) {
      const left = BoardView.cell_to_world(new Vector2i(0, row * 2));
      const right = BoardView.cell_to_world(new Vector2i(5, row * 2));
      main.rig.target_yaw = 0.0;
      main.rig.target_pitch = 0.5;
      main.rig.target_zoom = 0.5;
      main.rig.target_focus = left.lerp(right, 0.5).add(new Vector3(0, 0.3, 0));
      yield* this._wait(2.0);
      yield* this._shot(`relics_row_${row}`);
    }
    shelf.queue_free();
    main.rig.frame_board();
    main.rig.reset_view();
    main.rig.release_focus();
    main.gs.relics.splice(0, main.gs.relics.length, 'kibitzers_whisper', 'fortress_stone', 'clockmakers_key', 'brilliancy_prize', 'salt_horn', 'grandmaster_norm');
    go(main.enter_battle(false), 'enter_battle');
    main._clear_relics();
    yield* this._wait(1.5);
    main._sync_relics(true);
    yield* this._wait(0.45);
    yield* this._shot('relics_dropping');
    yield* this._wait(2.0);
    yield* this._shot('relics_game_view');
    main._relic_triggered('fortress_stone');
    yield* this._wait(0.22);
    yield* this._shot('relic_trigger');
    yield* this._wait(1.0);
    main.hud.visible = false;
    for (const variant of Arena.VARIANTS) {
      main._set_variant(variant);
      main.rig.target_pitch = 0.55;
      main.rig.target_zoom = 0.62;
      main.rig.target_focus = new Vector3(0, 0.3, 2.6);
      yield* this._wait(1.8);
      yield* this._shot(`relics_rim_${variant}`);
    }
    this._finish();
  }

  *_menu_shot() {
    yield* this._wait(0.5);
    this.main.show_menu();
    yield* this._wait(4.0);
    yield* this._shot('menu');
    this._finish();
  }

  /** Frame times of every arena, bare and with six relics on the rim. */
  *_performance() {
    const main = this.main;
    yield* this._wait(0.5);
    this.host.log(`PERF renderer=webgl2 size=${Gui.viewport.size.x}x${Gui.viewport.size.y}`);
    yield* this._enter_first_battle(2.5);
    for (const variant of Arena.VARIANTS) {
      main._set_variant(variant);
      for (const relics of [[], ['desperado_ribbon', 'brilliancy_prize', 'clockmakers_key', 'fianchetto_glass', 'grandmaster_norm', 'opening_book']]) {
        main.gs.relics.splice(0, main.gs.relics.length, ...relics);
        main._clear_relics();
        main._sync_relics(false);
        yield* this._wait(0.8);
        yield* this._sample(`${variant} relics=${relics.length}`);
      }
    }
    this._finish();
  }

  *_sample(label) {
    const times = [];
    let draws = 0;
    let triangles = 0;
    let last = Time.get_ticks_usec();
    for (let i = 0; i < PERF_FRAMES; i++) {
      yield this.tree.process_frame;
      const now = Time.get_ticks_usec();
      times.push((now - last) / 1000.0);
      last = now;
      const stats = this.host.frameStats?.() ?? { draws: 0, triangles: 0 };
      draws += stats.draws;
      triangles += stats.triangles;
    }
    times.sort((a, b) => a - b);
    const n = times.length;
    const at = (q) => times[Math.min(n - 1, Math.trunc(n * q))].toFixed(1);
    this.host.log(`PERF ${label} frame_ms p50=${at(0.5)} p90=${at(0.9)} p99=${at(0.99)} draws=${Math.round(draws / n)} primitives=${Math.round(triangles / n / 1000.0)}k`);
  }

  /** How long the enemy's search takes at every difficulty, on nine positions each. */
  *_benchmark() {
    yield* this._wait(0.5);
    this.host.log('BENCH renderer=webgl2');
    for (const difficulty of Object.keys(GameState.DIFFICULTIES)) {
      const depth = Math.trunc(GameState.DIFFICULTIES[difficulty].ai_depth);
      let worst = 0.0;
      let total = 0.0;
      let runs = 0;
      for (let i = 0; i < 3; i++) {
        for (const node of [0, 2, 4]) {
          const gs = new GameState();
          gs.new_run({ seed: `BENCH-${i}`, difficulty });
          gs.skip_relic();
          gs.leave();
          gs.step = node;
          gs.choose_node(gs.current_nodes().length - 1);
          const started = Time.get_ticks_usec();
          Tactics.best_move(gs.battle.board, false, depth, gs.rng, 0.0);
          const ms = (Time.get_ticks_usec() - started) / 1000.0;
          worst = Math.max(worst, ms);
          total += ms;
          runs += 1;
          yield this.tree.process_frame;
        }
      }
      this.host.log(`BENCH ${difficulty} depth=${depth} mean_ms=${(total / runs).toFixed(0)} worst_ms=${worst.toFixed(0)}`);
    }
    this._finish();
  }

  _finish() {
    if (this._finished) return;
    this._finished = true;
    if (this._hitches) {
      const limits = [50.0, 100.0, 250.0];
      const over = limits.map((limit) => this._slow.filter((entry) => entry[0] > limit).length);
      this.host.log(`HITCH frames over 50/100/250 ms: ${over.join(' / ')}`);
      this._slow.sort((a, b) => b[0] - a[0]);
      for (const entry of this._slow.slice(0, 25)) this.host.log(`HITCH ${entry[0].toFixed(0)} ms at ${entry[1].toFixed(1)}s screen=${entry[2]} side=${entry[3]}`);
    }
    this.host.log(`TOUR DONE shots=${this._index} failures=${this._failures} time=${((Time.get_ticks_msec() - this._started) / 1000.0).toFixed(0)}s`);
    this.host.finish(this._failures);
  }

  // ─────────────────────────────────────────────────────────────── battle ────────────────────────

  *_play_battle() {
    const main = this.main;
    const first = !this._seen.has('battle_intro');
    yield* this._wait(0.9);
    yield* this._shot_once(main.gs.node_type !== 'boss' ? 'battle_intro' : `boss_intro_act${main.gs.act + 1}`);
    yield* this._until_idle();
    yield* this._wait(1.6);
    yield* this._shot_once(`battle_act${main.gs.act + 1}`);
    if (first && !this._video) {
      yield* this._check_sizes();
      yield* this._try_keyboard();
    }
    while (main.screen === Screen.BATTLE) {
      yield* this._until_idle();
      if (main.screen !== Screen.BATTLE) break;
      const battle = main.gs.battle;
      if (!battle.is_player_turn()) {
        yield* this._wait(0.2);
        continue;
      }
      if (battle.threatened_ids().length > 0) yield* this._shot_once('threatened_piece');
      if (battle.player_in_check()) yield* this._shot_once('check');
      if (battle.turn === 2 && !this._seen.has('hint')) {
        main._hint();
        yield* this._wait(0.5);
        this._check(!isEmpty(main.hint_move), 'a hint suggests a move');
        yield* this._shot_once('hint');
      }
      yield* this._take_turn(battle);
    }
  }

  *_take_turn(battle) {
    let allowed = battle.allowed_moves();
    if (battle.in_follow_up()) {
      yield* this._shot_once('follow_up');
      allowed = allowed.filter((m) => !isEmpty(battle.board.piece_at(m.to)));
      if (allowed.length === 0) {
        this._press(KEY.ENTER);
        yield* this._wait(0.3);
        this._check(!battle.in_follow_up(), 'Enter ends a follow-up');
        return;
      }
    }
    if (allowed.length === 0) {
      go(this.main._end_turn(), 'end_turn');
      return;
    }
    const move = Tactics.best_move(battle.board, true, 2, this._rng, 0.0, allowed);
    yield* this._move_with_mouse(battle, String(move.id), move.to);
  }

  *_move_with_mouse(battle, id, to) {
    const main = this.main;
    const piece = battle.board.piece_by_id(id);
    if (this._video) yield* this._wait(0.15);
    if (main.selected_id !== id) {
      yield* this._click_cell(piece.cell);
      this._check_once('select', main.selected_id === id, 'clicking a piece selects it through the raycast');
      yield* this._wait(0.3);
      yield* this._shot_once('piece_selected');
    }
    yield* this._hover_cell(to);
    yield* this._wait(this._video ? 0.35 : 0.25);
    const capture = !isEmpty(battle.board.piece_at(to));
    yield* this._shot_once(capture ? 'capture_preview' : 'move_preview');
    const before = JSON.stringify(battle.board.to_data());
    yield* this._click_cell(to);
    const moved = JSON.stringify(battle.board.to_data()) !== before;
    this._check_once('move', moved, 'clicking a destination plays the move');
    if (!moved) {
      this.host.log(`TOUR note: ${piece.kind} ${piece.cell} -> ${to} was not played (selected '${main.selected_id}')`);
      this._finish();
    }
    if (capture) {
      yield* this._wait(0.42);
      yield* this._shot_once('capture_impact');
    }
  }

  *_try_keyboard() {
    this._press(KEY.TAB);
    yield* this._wait(0.35);
    this._check(this.main.selected_id !== '', 'Tab selects a movable piece');
    yield* this._shot('keyboard_select');
    this._press(KEY.BACKSPACE);
    yield* this._wait(0.2);
    this._check(this.main.selected_id === '', 'Backspace clears the selection');
  }

  *_check_sizes() {
    for (const size of SIZES) {
      this.host.setWindowSize(size.x, size.y);
      yield* this._wait(0.7);
      yield* this._shot(`size_${size.x}x${size.y}`);
    }
    this.host.setWindowSize(HOME_SIZE.x, HOME_SIZE.y);
    yield* this._wait(0.7);
  }

  // ─────────────────────────────────────────────────────────────── map & stops ───────────────────

  *_choose_on_map() {
    const main = this.main;
    yield* this._wait(0.9);
    yield* this._shot_once(`map_act${main.gs.act + 1}`);
    const nodes = main.gs.current_nodes();
    let index = 0;
    const labels = { merchant: 'stop_merchant', unknown: 'stop_event', rest: 'stop_rest', elite: 'reward_elite' };
    for (const [kind, label] of Object.entries(labels)) {
      if (!this._seen.has(label) && nodes.includes(kind)) {
        index = nodes.indexOf(kind);
        break;
      }
    }
    // Through the real input path: a tap on the node's position on the map.
    const map = this._find(MapScreen);
    const view = map._view;
    const local = view._positions()[main.gs.step][index];
    const m = view.get_global_transform_with_canvas();
    this._tap({ x: m[0] * local.x + m[2] * local.y + m[4], y: m[1] * local.x + m[3] * local.y + m[5] });
    yield* this._wait(0.3);
    this._check_once('map_tap', main.screen !== Screen.MAP, 'tapping a map node chooses it');
  }

  *_handle_stop() {
    const main = this.main;
    yield* this._wait(1.0);
    const levels = this._find(LevelUpScreen);
    if (levels !== null) {
      yield* this._shot_once('level_up');
      const choices = main.gs.current_level_choices();
      if (choices.length === 0) levels._skip();
      else levels._choose(choices[0]);
      return;
    }
    const gs = main.gs;
    switch (gs.phase) {
      case 'reward': {
        const reward = this._find(RewardScreen);
        if (reward === null) return;
        yield* this._shot_once(`reward_${String(gs.reward.kind)}`);
        if (!gs.reward.relic_taken) {
          const choices = gs.reward.relic_choices;
          let pick = String(choices[0]);
          for (const preferred of ['kibitzers_whisper', 'desperado_ribbon', 'fortress_stone']) if (choices.includes(preferred)) pick = preferred;
          if (gs.relics.length < Relics.MAX_EQUIPPED) reward._choose(pick);
          else reward._skip();
          yield* this._wait(0.4);
        }
        reward._finish();
        break;
      }
      case 'merchant': {
        const shop = this._find(MerchantScreen);
        if (shop === null) return;
        yield* this._shot_once('stop_merchant');
        for (let i = 0; i < gs.shop.relics.length; i++) {
          if (gs.buy_relic(i)) {
            shop.changed.emit();
            break;
          }
        }
        yield* this._wait(0.4);
        if (this._find(LevelUpScreen) === null) {
          shop.leave.emit();
          shop.queue_free();
        }
        break;
      }
      case 'rest': {
        const rest = this._find(RestScreen);
        if (rest === null) return;
        yield* this._shot_once('stop_rest');
        if (!gs.rest_done) {
          let moved = gs.fallen.length > 0 ? gs.rest_revive(0) : gs.rest_train(this._best_piece(gs));
          if (!moved) moved = gs.rest_fortify();
          this._check(moved, 'a rest action applies');
          rest.changed.emit();
          yield* this._wait(1.4);
          yield* this._shot_once('rest_evolve');
        }
        if (this._find(LevelUpScreen) === null) {
          rest.leave.emit();
          rest.queue_free();
        }
        break;
      }
      case 'event': {
        const event = this._find(EventScreen);
        if (event === null) return;
        yield* this._shot_once('stop_event');
        if (!gs.event.resolved) {
          const choices = Events.info(String(gs.event.id)).choices;
          for (let i = 0; i < choices.length; i++) {
            if (gs.event_choice_available(i)) {
              gs.event_choose(i);
              break;
            }
          }
          event.refresh();
          event.changed.emit();
          yield* this._wait(0.5);
          yield* this._shot_once('event_outcome');
        }
        if (this._find(LevelUpScreen) === null) {
          event.leave.emit();
          event.queue_free();
        }
        break;
      }
      default:
        break;
    }
    yield* this._wait(0.3);
  }

  *_resume_from_menu() {
    const main = this.main;
    const phase = main.gs.phase;
    const gold = main.gs.gold;
    main.show_menu();
    yield* this._wait(1.6);
    yield* this._shot('menu_with_save');
    main.continue_run();
    yield* this._wait(1.2);
    this._check(main.gs !== null && main.gs.phase === phase && main.gs.gold === gold, 'Continue restores the saved run');
  }

  /** The most valuable piece that can still level up (never the king). */
  _best_piece(gs) {
    let best = '';
    let bestValue = -1;
    for (const entry of gs.army) {
      if (Math.trunc(entry.level) < GameState.MAX_LEVEL && entry.kind !== 'king') {
        const value = Math.trunc(ChessRules.MATERIAL[entry.kind]) * 10 + Math.trunc(entry.xp);
        if (value > bestValue) {
          bestValue = value;
          best = String(entry.id);
        }
      }
    }
    return best;
  }

  // ─────────────────────────────────────────────────────────────── helpers ───────────────────────

  _find(type) {
    for (const child of this.main.overlay.get_children()) if (child instanceof type && !child.is_queued_for_deletion()) return child;
    return null;
  }

  _push(event) {
    Gui.viewport.push(event);
  }

  *_click_cell(cell) {
    const position = this._cell_position(cell);
    this._motion(position);
    yield this.tree.process_frame;
    for (const pressed of [true, false]) this._push(new InputEvent('mouse_button', { button_index: MOUSE_BUTTON.LEFT, pressed, position, echo: false }));
    yield this.tree.process_frame;
  }

  _tap(position) {
    for (const pressed of [true, false]) this._push(new InputEvent('mouse_button', { button_index: MOUSE_BUTTON.LEFT, pressed, position, echo: false }));
  }

  *_hover_cell(cell) {
    this._motion(this._cell_position(cell));
    yield this.tree.process_frame;
  }

  _cell_position(cell) {
    const occupied = !isEmpty(this.main.gs.battle.board.piece_at(cell));
    return this.main.cell_screen_position(cell, occupied ? 0.25 : 0.06);
  }

  _motion(position) {
    this._push(new InputEvent('mouse_motion', { position, relative: { x: 0, y: 0 }, button_mask: 0, pressed: false, echo: false }));
  }

  _press(code) {
    for (const pressed of [true, false]) this._push(new InputEvent('key', { code, keycode: code, physical_keycode: code, pressed, echo: false, shift: false }));
  }

  _close_modals() {
    for (const child of this.main.overlay.get_children()) if (child instanceof Modal) child.queue_free();
  }

  *_until_idle(limit = 20.0) {
    let waited = 0.0;
    yield* this._wait(0.1);
    while (this.main.busy && waited < limit) {
      yield* this._wait(0.1);
      waited += 0.1;
    }
    this._check_once('idle', waited < limit, 'animations settle');
  }

  *_wait(seconds) {
    yield this.tree.create_timer(seconds);
  }

  *_shot_once(label) {
    if (this._seen.has(label)) return;
    this._seen.add(label);
    yield* this._shot(label);
  }

  *_shot(label) {
    if (this._video) {
      yield* this._wait(0.5);
      return;
    }
    yield this.tree.frame_post_draw;
    this._index += 1;
    const name = `${pad2(this._index)}_${label}`;
    this.host.capture(name, this._index);
    this.host.log(`TOUR shot ${name}.png`);
  }

  _check_once(key, ok, label) {
    if (ok && this._seen.has(`check_${key}`)) return;
    this._seen.add(`check_${key}`);
    this._check(ok, label);
  }

  _check(ok, label) {
    if (ok) this.host.log(`TOUR PASS ${label}`);
    else {
      this._failures += 1;
      this.host.log(`TOUR FAIL ${label}`);
    }
  }
}
