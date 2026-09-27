/**
 * GameState — port of scripts/core/game_state.gd: the whole run.
 *
 * Phases form an explicit state machine: reward → map → (battle | merchant | rest | event) → reward …
 * → won | lost. Every random draw comes from ONE PCG stream seeded with hash(seed_text), in the same
 * order as the original, so a seed replays the same run. `to_dict()` is the save format (and what the
 * oracle traces compare step by step against the Godot build).
 */
import { RandomNumberGenerator, hashString } from '../godot/rng.js';
import { round } from '../godot/math.js';
import { duplicate, erase, format, sortCustom, stripEdges, toUpper } from '../godot/gdscript.js';
import { Board, isEmpty } from './board.js';
import { ChessRules } from './chess_rules.js';
import { Tactics } from './tactics.js';
import { Battle } from './battle.js';
import { Encounters } from './encounters.js';
import { Events } from './events.js';
import { Relics } from './relics.js';
import { Upgrades } from './upgrades.js';
import { RunMap } from './run_map.js';

const PHASES = ['reward', 'map', 'battle', 'merchant', 'rest', 'event', 'won', 'lost'];
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class GameState {
  static SAVE_VERSION = 4;
  static START_GOLD = 10;
  static MAX_ARMY = 8;
  static MAX_LEVEL = 3;
  static ACT_COUNT = 3;
  static XP_THRESHOLDS = [2, 5, 9];
  static MEDAL_THRESHOLDS = [1, 3, 6];
  static RECRUIT_PRICE = { pawn: 6, knight: 11, bishop: 11, rook: 15, queen: 24 };
  static RECRUIT_KINDS = { pawn: 4, knight: 3, bishop: 3, rook: 2, queen: 1 };
  static TRAIN_PRICE = 12;
  static MEND_PRICE = 10;

  static ARMIES = {
    vanguard: { name: 'Classical', kinds: ['king', 'rook', 'knight', 'bishop', 'pawn', 'pawn'], desc: 'A balanced company around the king.' },
    cavalry: { name: 'Hussars', kinds: ['king', 'knight', 'knight', 'pawn', 'pawn', 'pawn'], desc: 'Two knights screened by three pawns.' },
    cathedral: { name: 'Bishop Pair', kinds: ['king', 'bishop', 'bishop', 'rook', 'pawn', 'pawn'], desc: 'Twin bishops and a rook.' },
    phalanx: { name: 'Pawn Chain', kinds: ['king', 'rook', 'pawn', 'pawn', 'pawn', 'pawn'], desc: 'A wall of pawns. Built for promotion.' },
  };

  static DIFFICULTIES = {
    apprentice: { name: 'Coffeehouse', ai_depth: 1, ai_noise: 140.0, budget_scale: 0.8, gold_scale: 1.25, hints: -1, desc: 'A forgiving opponent, smaller armies, unlimited hints.' },
    standard: { name: 'Tournament', ai_depth: 2, ai_noise: 12.0, budget_scale: 1.0, gold_scale: 1.0, hints: 3, desc: 'The intended challenge. Three hints per run.' },
    grandmaster: { name: 'Grandmaster', ai_depth: 3, ai_noise: 0.0, budget_scale: 1.45, gold_scale: 0.8, hints: 0, desc: 'A sharper opponent, larger armies, no hints.' },
  };

  static SAVE_KEYS = [
    'version', 'seed_text', 'difficulty', 'army_preset', 'rng_seed', 'rng_state', 'phase', 'act', 'step',
    'map', 'path', 'node_type', 'gold', 'relics', 'army', 'fallen', 'battle', 'fortified', 'phoenix_act',
    'hints_left', 'encounters_won', 'stats', 'pending_levels', 'reward', 'shop', 'event', 'rest_done',
    'seen_events', 'next_army_id',
  ];

  constructor() {
    this.seed_text = '';
    this.difficulty = 'standard';
    this.army_preset = 'vanguard';
    this.rng = new RandomNumberGenerator();
    this.phase = 'reward';
    this.act = 0;
    this.step = 0;
    this.map = [];
    this.path = [];
    this.node_type = '';
    this.gold = GameState.START_GOLD;
    this.relics = [];
    this.army = [];
    this.fallen = [];
    /** @type {Battle|null} */
    this.battle = null;
    this.fortified = false;
    this.phoenix_act = -1;
    this.hints_left = 3;
    this.encounters_won = 0;
    this.stats = {};
    this.pending_levels = [];
    this.reward = {};
    this.shop = {};
    this.event = {};
    this.rest_done = false;
    this.seen_events = [];
    this._next_army_id = 0;
  }

  new_run(config = {}) {
    this.seed_text = toUpper(stripEdges(String(config.seed ?? '')));
    if (this.seed_text === '') this.seed_text = GameState.random_seed_text();
    this.difficulty = String(config.difficulty ?? 'standard');
    this.army_preset = String(config.army ?? 'vanguard');
    if (!(this.difficulty in GameState.DIFFICULTIES)) throw new Error(`unknown difficulty '${this.difficulty}'`);
    if (!(this.army_preset in GameState.ARMIES)) throw new Error(`unknown army '${this.army_preset}'`);
    this.rng = new RandomNumberGenerator();
    this.rng.seed = hashString(this.seed_text);
    this.act = 0;
    this.step = 0;
    this.path = [];
    this.gold = GameState.START_GOLD;
    this.relics = [];
    this.army = [];
    this.fallen = [];
    this.pending_levels = [];
    this.seen_events = [];
    this.battle = null;
    this.fortified = false;
    this.phoenix_act = -1;
    this.encounters_won = 0;
    this.hints_left = Math.trunc(GameState.DIFFICULTIES[this.difficulty].hints);
    this.stats = GameState._fresh_stats();
    this._next_army_id = 0;
    for (const kind of GameState.ARMIES[this.army_preset].kinds) this._add_to_army(String(kind));
    this.map = RunMap.generate(this.rng);
    this.node_type = '';
    this.shop = {};
    this.event = {};
    this.rest_done = false;
    this.reward = { kind: 'opening', gold: 0, lines: [], relic_choices: this._relic_choices(3), relic_taken: false, revived: '' };
    this.phase = 'reward';
  }

  /** "ABCD-EF23" from an unambiguous alphabet, from a freshly randomized generator. */
  static random_seed_text() {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const generator = new RandomNumberGenerator();
    generator.randomize();
    let text = '';
    for (let i = 0; i < 8; i++) {
      if (i === 4) text += '-';
      text += ALPHABET[generator.randi_range(0, ALPHABET.length - 1)];
    }
    return text;
  }

  act_info() {
    return Encounters.ACTS[this.act];
  }

  /** 1-based number of the current (or next) encounter. */
  encounter_number() {
    return this.encounters_won + (this.phase === 'battle' ? 1 : 0);
  }

  total_encounters() {
    return GameState.ACT_COUNT * 3;
  }

  current_nodes() {
    return this.map[this.step];
  }

  choose_node(index) {
    if (this.phase !== 'map' || index < 0 || index >= this.map[this.step].length) return false;
    this.node_type = String(this.map[this.step][index]);
    this.path.push(index);
    if (RunMap.is_fight(this.node_type)) {
      this.battle = Encounters.build(this, this.node_type);
      this.fortified = false;
      this.phase = 'battle';
    } else if (this.node_type === 'merchant') {
      this.shop = this._roll_shop();
      this.phase = 'merchant';
    } else if (this.node_type === 'rest') {
      this.rest_done = false;
      this.phase = 'rest';
    } else {
      this.event = { id: this._pick_event(), resolved: false, outcome: '' };
      this.phase = 'event';
    }
    return true;
  }

  ai_depth() {
    return Math.trunc(GameState.DIFFICULTIES[this.difficulty].ai_depth);
  }

  run_enemy_turn() {
    return this.battle.enemy_turn(this.ai_depth(), this.rng, Number(GameState.DIFFICULTIES[this.difficulty].ai_noise));
  }

  /** The planner's suggestion (noise 0: does not consume the run RNG). Spends a hint. */
  hint() {
    if (this.phase !== 'battle' || !this.battle.is_player_turn() || this.hints_left === 0) return {};
    const allowed = this.battle.allowed_moves();
    if (allowed.length === 0) return {};
    const move = Tactics.best_move(this.battle.board, true, 2, this.rng, 0.0, allowed);
    if (isEmpty(move)) return {};
    if (this.hints_left > 0) this.hints_left -= 1;
    return move;
  }

  finish_battle() {
    if (this.phase !== 'battle' || this.battle.outcome === '') return {};
    const battle = this.battle;
    this.stats.turns = Math.trunc(this.stats.turns) + battle.turn;
    this.stats.captures = Math.trunc(this.stats.captures) + battle.captures;
    this.stats.best_chain = Math.max(Math.trunc(this.stats.best_chain), battle.best_chain);
    this.stats.pieces_lost = Math.trunc(this.stats.pieces_lost) + battle.lost.length;
    if (battle.outcome === 'lost') {
      this.phase = 'lost';
      return {};
    }
    const lostIds = battle.lost.map((piece) => piece.id);
    const survivors = [];
    const newlyFallen = [];
    for (const entry of this.army) {
      if (lostIds.includes(entry.id)) newlyFallen.push(entry);
      else survivors.push(entry);
    }
    this.army = survivors;
    this.fallen.push(...newlyFallen);
    for (const entry of this.army) {
      if (battle.promoted.includes(entry.id)) {
        entry.kind = 'queen';
        entry.upgrades = Upgrades.carried_over(entry.upgrades, 'queen');
        this.stats.promotions = Math.trunc(this.stats.promotions) + 1;
      }
      this._grant_xp(entry, Math.trunc(battle.xp_gained[entry.id]));
    }
    let revived = '';
    if (this.relics.includes('sealed_move') && this.phoenix_act !== this.act && newlyFallen.length > 0) {
      const returning = newlyFallen[0];
      erase(this.fallen, returning);
      this.army.push(returning);
      this.phoenix_act = this.act;
      revived = String(returning.kind);
    }
    const lines = [];
    const base = 10 + 3 * this.act;
    lines.push(['Victory', base]);
    if (this.node_type === 'elite') lines.push(['Elite bounty', Math.trunc(base / 2)]);
    if (this.node_type === 'boss') lines.push(['Boss bounty', 15]);
    if (battle.lost.length === 0) lines.push(['Flawless', 5]);
    if (battle.swift()) lines.push(['Swift', 3]);
    if (this.relics.includes('appearance_fee')) lines.push(['Appearance Fee', 2]);
    if (battle.gold_found > 0) lines.push(['Ransom', battle.gold_found]);
    let total = 0;
    for (const line of lines) total += Math.trunc(line[1]);
    total = Math.trunc(round(total * Number(GameState.DIFFICULTIES[this.difficulty].gold_scale)));
    this.gold += total;
    this.stats.gold_earned = Math.trunc(this.stats.gold_earned) + total;
    this.encounters_won += 1;
    let choices = [];
    if (this.node_type === 'elite' || this.node_type === 'boss') choices = this._relic_choices(3);
    this.reward = { kind: this.node_type, gold: total, lines, relic_choices: choices, relic_taken: choices.length === 0, revived };
    this.battle = null;
    this.phase = this.node_type === 'boss' && this.act === GameState.ACT_COUNT - 1 ? 'won' : 'reward';
    return this.reward;
  }

  army_entry(id) {
    for (const entry of this.army) if (entry.id === id) return entry;
    return {};
  }

  level_thresholds() {
    return this.relics.includes('grandmaster_norm') ? GameState.MEDAL_THRESHOLDS : GameState.XP_THRESHOLDS;
  }

  next_threshold(entry) {
    return Math.trunc(entry.level) >= GameState.MAX_LEVEL ? -1 : this.level_thresholds()[Math.trunc(entry.level)];
  }

  /** Upgrade choices for the first pending level-up (re-rolled if the stored ones went stale). */
  current_level_choices() {
    if (this.pending_levels.length === 0) return [];
    const pending = this.pending_levels[0];
    const entry = this.army_entry(String(pending.id));
    const available = Upgrades.pool_for(String(entry.kind), entry.upgrades);
    let valid = [];
    for (const id of pending.choices) if (available.includes(id)) valid.push(id);
    if (valid.length === 0 && available.length > 0) {
      valid = this._level_choices(entry);
      pending.choices = valid;
    }
    return valid;
  }

  choose_level(upgradeId) {
    if (!this.current_level_choices().includes(upgradeId)) return false;
    const entry = this.army_entry(String(this.pending_levels[0].id));
    entry.upgrades.push(upgradeId);
    this.pending_levels.shift();
    return true;
  }

  skip_level() {
    if (this.pending_levels.length === 0 || this.current_level_choices().length > 0) return false;
    this.pending_levels.shift();
    return true;
  }

  take_relic(id) {
    if (this.phase !== 'reward' || this.reward.relic_taken || !this.reward.relic_choices.includes(id) || this.relics.length >= Relics.MAX_EQUIPPED) return false;
    this.relics.push(id);
    this.reward.relic_taken = true;
    return true;
  }

  swap_relic(oldId, newId) {
    if (this.phase !== 'reward' || this.reward.relic_taken || !this.reward.relic_choices.includes(newId) || !this.relics.includes(oldId)) return false;
    this.relics[this.relics.indexOf(oldId)] = newId;
    this.reward.relic_taken = true;
    return true;
  }

  skip_relic() {
    if (this.phase === 'reward') this.reward.relic_taken = true;
  }

  can_leave() {
    if (this.pending_levels.length > 0) return false;
    switch (this.phase) {
      case 'reward':
        return this.reward.relic_taken;
      case 'event':
        return this.event.resolved;
      case 'merchant':
      case 'rest':
        return true;
    }
    return false;
  }

  /** Advances along the map (the opening relic choice does not consume a step). */
  leave() {
    if (!this.can_leave()) return false;
    const opening = this.phase === 'reward' && String(this.reward.kind) === 'opening';
    if (!opening) {
      this.step += 1;
      if (this.step >= RunMap.STEPS) {
        this.act += 1;
        this.step = 0;
        this.path = [];
        this.map = RunMap.generate(this.rng);
      }
    }
    this.reward = {};
    this.shop = {};
    this.event = {};
    this.phase = 'map';
    return true;
  }

  discounted() {
    return this.relics.includes('patrons_chit');
  }

  shop_relic_price(index) {
    return Relics.price(String(this.shop.relics[index]), this.discounted());
  }

  recruit_price(kind) {
    const base = GameState.RECRUIT_PRICE[kind];
    return this.discounted() ? Math.trunc(Math.ceil(base * 0.75)) : base;
  }

  service_price(base) {
    return this.discounted() ? Math.trunc(Math.ceil(base * 0.75)) : base;
  }

  buy_relic(index) {
    if (this.phase !== 'merchant' || index < 0 || index >= this.shop.relics.length || String(this.shop.relics[index]) === '') return false;
    const id = String(this.shop.relics[index]);
    const price = this.shop_relic_price(index);
    if (this.gold < price || this.relics.length >= Relics.MAX_EQUIPPED || this.relics.includes(id)) return false;
    this.gold -= price;
    this.relics.push(id);
    this.shop.relics[index] = '';
    return true;
  }

  buy_recruit(index) {
    if (this.phase !== 'merchant' || index < 0 || index >= this.shop.recruits.length || String(this.shop.recruits[index]) === '') return false;
    const kind = String(this.shop.recruits[index]);
    const price = this.recruit_price(kind);
    if (this.gold < price || this.army.length >= GameState.MAX_ARMY) return false;
    this.gold -= price;
    this._add_to_army(kind);
    this.shop.recruits[index] = '';
    return true;
  }

  train(id) {
    const entry = this.army_entry(id);
    const price = this.service_price(GameState.TRAIN_PRICE);
    if (this.phase !== 'merchant' || isEmpty(entry) || Math.trunc(entry.level) >= GameState.MAX_LEVEL || this.gold < price || this.pending_levels.length > 0) return false;
    this.gold -= price;
    this._level_up(entry);
    return true;
  }

  mend(index) {
    const price = this.service_price(GameState.MEND_PRICE);
    if (this.phase !== 'merchant' || index < 0 || index >= this.fallen.length || this.gold < price || this.army.length >= GameState.MAX_ARMY) return false;
    this.gold -= price;
    this.army.push(this.fallen[index]);
    this.fallen.splice(index, 1);
    return true;
  }

  rest_revive(index) {
    if (this.phase !== 'rest' || this.rest_done || index < 0 || index >= this.fallen.length || this.army.length >= GameState.MAX_ARMY) return false;
    this.army.push(this.fallen[index]);
    this.fallen.splice(index, 1);
    this.rest_done = true;
    return true;
  }

  rest_train(id) {
    const entry = this.army_entry(id);
    if (this.phase !== 'rest' || this.rest_done || isEmpty(entry) || Math.trunc(entry.level) >= GameState.MAX_LEVEL) return false;
    this._level_up(entry);
    this.rest_done = true;
    return true;
  }

  rest_fortify() {
    if (this.phase !== 'rest' || this.rest_done) return false;
    this.fortified = true;
    this.rest_done = true;
    return true;
  }

  event_choice_available(index) {
    const choices = Events.info(String(this.event.id)).choices;
    if (this.phase !== 'event' || this.event.resolved || index < 0 || index >= choices.length) return false;
    const choice = choices[index];
    switch (String(choice.requires)) {
      case 'pawn':
        return this._army_has('pawn');
      case 'fallen':
        return this.fallen.length > 0 && this.army.length < GameState.MAX_ARMY;
      case 'gold':
        return this.gold >= Math.trunc(choice.cost);
    }
    if (String(choice.effect) === 'recruit') return this.army.length < GameState.MAX_ARMY;
    return true;
  }

  event_choose(index) {
    if (!this.event_choice_available(index)) return '';
    const choice = Events.info(String(this.event.id)).choices[index];
    let outcome = '';
    switch (String(choice.effect)) {
      case 'gold':
        this.gold += Math.trunc(choice.amount);
        outcome = format('You gain %d gold.', Math.trunc(choice.amount));
        break;
      case 'train_random': {
        const candidates = this._trainable();
        if (candidates.length === 0) {
          this.gold += 10;
          outcome = 'Every piece is already a master. You sell the blade for 10 gold.';
        } else {
          const entry = candidates[this.rng.randi_range(0, candidates.length - 1)];
          this._level_up(entry);
          outcome = format('Your %s grows stronger.', String(entry.kind));
        }
        break;
      }
      case 'recruit':
        this.gold -= Math.trunc(choice.cost);
        this._add_to_army(String(choice.kind));
        outcome = format('A %s joins your army.', String(choice.kind));
        break;
      case 'sacrifice_pawn': {
        const pawns = [];
        for (const entry of this.army) if (entry.kind === 'pawn') pawns.push(entry);
        sortCustom(pawns, (a, b) => Math.trunc(a.level) < Math.trunc(b.level));
        erase(this.army, pawns[0]);
        let raised = 0;
        for (let i = 0; i < 2; i++) {
          const candidates = this._trainable();
          if (candidates.length === 0) break;
          this._level_up(candidates[this.rng.randi_range(0, candidates.length - 1)]);
          raised += 1;
        }
        outcome = format('The pawn is gone. %d of your pieces feel its strength.', raised);
        break;
      }
      case 'fortify':
        this.fortified = true;
        outcome = 'Your army will be warded in the next encounter.';
        break;
      case 'revive': {
        const returning = this.fallen.pop();
        this.army.push(returning);
        outcome = format('Your %s returns to the ranks.', String(returning.kind));
        break;
      }
      case 'xp_all':
        for (const entry of this.army) this._grant_xp(entry, Math.trunc(choice.amount));
        outcome = format('Every piece gains %d XP.', Math.trunc(choice.amount));
        break;
      case 'relic_random': {
        const offered = this._relic_choices(1);
        if (offered.length === 0 || this.relics.length >= Relics.MAX_EQUIPPED) {
          this.gold += 12;
          outcome = 'Nothing you can carry. You sell the tome for 12 gold.';
        } else {
          this.relics.push(offered[0]);
          outcome = format('You gain %s.', Relics.display_name(offered[0]));
        }
        break;
      }
      case 'gamble':
        this.gold -= Math.trunc(choice.cost);
        if (this.rng.randf() < 0.5) {
          this.gold += Math.trunc(choice.win);
          outcome = format('The dice favour you: %d gold.', Math.trunc(choice.win));
        } else {
          outcome = 'The house wins.';
        }
        break;
      case 'none':
        outcome = 'You move on.';
        break;
    }
    this.event.resolved = true;
    this.event.outcome = outcome;
    return outcome;
  }

  // ─────────────────────────────────────────────────────────────── save / load ─────────────────

  to_dict() {
    return {
      version: GameState.SAVE_VERSION,
      seed_text: this.seed_text,
      difficulty: this.difficulty,
      army_preset: this.army_preset,
      rng_seed: String(this.rng.seed),
      rng_state: String(this.rng.state),
      phase: this.phase,
      act: this.act,
      step: this.step,
      map: duplicate(this.map, true),
      path: this.path.slice(),
      node_type: this.node_type,
      gold: this.gold,
      relics: this.relics.slice(),
      army: GameState._entries_data(this.army),
      fallen: GameState._entries_data(this.fallen),
      battle: this.battle !== null ? this.battle.to_dict() : {},
      fortified: this.fortified,
      phoenix_act: this.phoenix_act,
      hints_left: this.hints_left,
      encounters_won: this.encounters_won,
      stats: { ...this.stats },
      pending_levels: this._pending_data(),
      reward: duplicate(this.reward, true),
      shop: duplicate(this.shop, true),
      event: duplicate(this.event, true),
      rest_done: this.rest_done,
      seen_events: this.seen_events.slice(),
      next_army_id: this._next_army_id,
    };
  }

  static from_dict(data) {
    if (!isDict(data) || Math.trunc(data.version ?? -1) !== GameState.SAVE_VERSION) return null;
    for (const key of GameState.SAVE_KEYS) if (!(key in data)) return null;
    const gs = new GameState();
    gs.seed_text = String(data.seed_text);
    gs.difficulty = String(data.difficulty);
    gs.army_preset = String(data.army_preset);
    gs.phase = String(data.phase);
    if (!(gs.difficulty in GameState.DIFFICULTIES) || !(gs.army_preset in GameState.ARMIES)) return null;
    if (!PHASES.includes(gs.phase)) return null;
    gs.act = Math.trunc(data.act);
    gs.step = Math.trunc(data.step);
    if (gs.act < 0 || gs.act >= GameState.ACT_COUNT || gs.step < 0 || gs.step >= RunMap.STEPS) return null;
    if (!Array.isArray(data.map) || data.map.length !== RunMap.STEPS) return null;
    for (const column of data.map) {
      if (!Array.isArray(column) || column.length === 0) return null;
      for (const node of column) if (!(String(node) in RunMap.NODE_INFO)) return null;
    }
    for (const key of ['path', 'relics', 'army', 'fallen', 'pending_levels', 'seen_events']) if (!Array.isArray(data[key])) return null;
    for (const key of ['battle', 'stats', 'reward', 'shop', 'event']) if (!isDict(data[key])) return null;
    gs.map = duplicate(data.map, true);
    for (const index of data.path) gs.path.push(Math.trunc(index));
    gs.node_type = String(data.node_type);
    gs.gold = Math.trunc(data.gold);
    for (const id of data.relics) {
      if (!Relics.exists(String(id))) return null;
      gs.relics.push(String(id));
    }
    const restoredArmy = GameState._entries_from(data.army);
    const restoredFallen = GameState._entries_from(data.fallen);
    if (restoredArmy === null || restoredFallen === null || restoredArmy.length === 0) return null;
    gs.army = restoredArmy;
    gs.fallen = restoredFallen;
    if (gs.phase === 'battle') {
      gs.battle = Battle.from_dict(data.battle);
      if (gs.battle === null) return null;
    }
    gs.fortified = Boolean(data.fortified);
    gs.phoenix_act = Math.trunc(data.phoenix_act);
    gs.hints_left = Math.trunc(data.hints_left);
    gs.encounters_won = Math.trunc(data.encounters_won);
    gs.stats = GameState._fresh_stats();
    for (const key of Object.keys(gs.stats)) {
      if (!(key in data.stats)) return null;
      gs.stats[key] = Math.trunc(data.stats[key]);
    }
    for (const pending of data.pending_levels) {
      if (!isDict(pending) || !('id' in pending) || !('choices' in pending)) return null;
      const choices = [];
      for (const id of pending.choices) {
        if (!Upgrades.exists(String(id))) return null;
        choices.push(String(id));
      }
      gs.pending_levels.push({ id: String(pending.id), choices });
    }
    gs.reward = GameState._normalised(data.reward);
    gs.shop = GameState._normalised(data.shop);
    gs.event = GameState._normalised(data.event);
    if (gs.phase === 'reward' && !GameState._has_keys(gs.reward, ['kind', 'gold', 'lines', 'relic_choices', 'relic_taken', 'revived'])) return null;
    if (gs.phase === 'merchant' && !GameState._has_keys(gs.shop, ['relics', 'recruits'])) return null;
    if (gs.phase === 'event' && (!GameState._has_keys(gs.event, ['id', 'resolved', 'outcome']) || !(String(gs.event.id) in Events.CATALOGUE))) return null;
    const offered = [];
    if (gs.phase === 'reward') offered.push(...gs.reward.relic_choices);
    if (gs.phase === 'merchant') offered.push(...gs.shop.relics);
    for (const id of offered) if (String(id) !== '' && !Relics.exists(String(id))) return null;
    gs.rest_done = Boolean(data.rest_done);
    for (const id of data.seen_events) gs.seen_events.push(String(id));
    gs._next_army_id = Math.trunc(data.next_army_id);
    gs.rng.seed = BigInt(String(data.rng_seed));
    gs.rng.state = BigInt(String(data.rng_state));
    return gs;
  }

  static _has_keys(value, keys) {
    for (const key of keys) if (!(key in value)) return false;
    return true;
  }

  static _fresh_stats() {
    return { captures: 0, pieces_lost: 0, best_chain: 0, turns: 0, gold_earned: 0, promotions: 0 };
  }

  _add_to_army(kind) {
    this.army.push({ id: format('a%d', this._next_army_id), kind, xp: 0, level: 0, upgrades: [] });
    this._next_army_id += 1;
  }

  _army_has(kind) {
    for (const entry of this.army) if (entry.kind === kind) return true;
    return false;
  }

  _trainable() {
    const out = [];
    for (const entry of this.army) if (Math.trunc(entry.level) < GameState.MAX_LEVEL) out.push(entry);
    return out;
  }

  _grant_xp(entry, amount) {
    entry.xp = Math.trunc(entry.xp) + amount;
    const thresholds = this.level_thresholds();
    while (Math.trunc(entry.level) < GameState.MAX_LEVEL && Math.trunc(entry.xp) >= thresholds[Math.trunc(entry.level)]) {
      entry.level = Math.trunc(entry.level) + 1;
      this.pending_levels.push({ id: entry.id, choices: this._level_choices(entry) });
    }
  }

  /** Training: jump to the next level's XP threshold and queue its upgrade choice. */
  _level_up(entry) {
    entry.xp = Math.max(Math.trunc(entry.xp), this.level_thresholds()[Math.trunc(entry.level)]);
    entry.level = Math.trunc(entry.level) + 1;
    this.pending_levels.push({ id: entry.id, choices: this._level_choices(entry) });
  }

  /** Fisher–Yates over the eligible pool with the run RNG, keep the first 3 (4 with the Quill). */
  _level_choices(entry) {
    const pool = Upgrades.pool_for(String(entry.kind), entry.upgrades);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.rng.randi_range(0, i);
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    const n = this.relics.includes('annotators_quill') ? 4 : 3;
    const choices = [];
    for (const id of pool) if (choices.length < n) choices.push(id);
    return choices;
  }

  /** Rarity-weighted draws without replacement from the relics not yet owned. */
  _relic_choices(n) {
    const pool = [];
    for (const id of Object.keys(Relics.CATALOGUE)) if (!this.relics.includes(id)) pool.push(id);
    const out = [];
    while (out.length < n && pool.length > 0) {
      let total = 0;
      for (const id of pool) total += Math.trunc(Relics.RARITY_WEIGHT[Relics.info(id).rarity]);
      let roll = this.rng.randi_range(1, total);
      for (const id of pool) {
        roll -= Math.trunc(Relics.RARITY_WEIGHT[Relics.info(id).rarity]);
        if (roll <= 0) {
          out.push(id);
          erase(pool, id);
          break;
        }
      }
    }
    return out;
  }

  _roll_shop() {
    const recruits = [];
    for (let i = 0; i < 2; i++) {
      let total = 0;
      for (const kind of Object.keys(GameState.RECRUIT_KINDS)) total += Math.trunc(GameState.RECRUIT_KINDS[kind]);
      let roll = this.rng.randi_range(1, total);
      for (const kind of Object.keys(GameState.RECRUIT_KINDS)) {
        roll -= Math.trunc(GameState.RECRUIT_KINDS[kind]);
        if (roll <= 0) {
          recruits.push(kind);
          break;
        }
      }
    }
    return { relics: this._relic_choices(3).slice(), recruits };
  }

  _pick_event() {
    let pool = [];
    for (const id of Events.ids()) if (!this.seen_events.includes(id)) pool.push(id);
    if (pool.length === 0) {
      this.seen_events = [];
      pool = Events.ids();
    }
    const id = pool[this.rng.randi_range(0, pool.length - 1)];
    this.seen_events.push(id);
    return id;
  }

  _pending_data() {
    return this.pending_levels.map((pending) => ({ id: pending.id, choices: pending.choices.slice() }));
  }

  static _entries_data(entries) {
    return entries.map((entry) => ({ id: entry.id, kind: entry.kind, xp: entry.xp, level: entry.level, upgrades: entry.upgrades.slice() }));
  }

  static _entries_from(data) {
    if (!Array.isArray(data)) return null;
    const out = [];
    for (const entry of data) {
      if (!isDict(entry)) return null;
      for (const key of ['id', 'kind', 'xp', 'level', 'upgrades']) if (!(key in entry)) return null;
      if (!ChessRules.KINDS.includes(String(entry.kind)) || Math.trunc(entry.level) < 0 || Math.trunc(entry.level) > GameState.MAX_LEVEL) return null;
      const upgrades = [];
      for (const id of entry.upgrades) {
        if (!Upgrades.exists(String(id))) return null;
        upgrades.push(String(id));
      }
      out.push({ id: String(entry.id), kind: String(entry.kind), xp: Math.trunc(entry.xp), level: Math.trunc(entry.level), upgrades });
    }
    return out;
  }

  /** JSON numbers come back as floats in Godot; the original folds them to ints. */
  static _normalised(value) {
    if (typeof value === 'number') return Math.trunc(value);
    if (Array.isArray(value)) return value.map((item) => GameState._normalised(item));
    if (isDict(value)) {
      const entries = {};
      for (const key of Object.keys(value)) entries[key] = GameState._normalised(value[key]);
      return entries;
    }
    return value;
  }
}

export { Board };
