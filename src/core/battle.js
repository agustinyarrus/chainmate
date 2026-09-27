/**
 * Battle — port of scripts/core/battle.gd: one encounter's turn structure.
 *
 * The player's turn is a small state machine held in explicit fields (active piece + bonus counters):
 * a capture can grant Chain captures, the Desperado Ribbon a free move, Charge a quiet step, a quiet
 * move Momentum. The enemy turn asks Tactics for moves (twice every third turn against the Dowager).
 */
import { Vector2i } from '../godot/math.js';
import { has, duplicate } from '../godot/gdscript.js';
import { Board, isEmpty } from './board.js';
import { ChessRules } from './chess_rules.js';
import { Tactics } from './tactics.js';
import { Relics } from './relics.js';

export class Battle {
  static TURN_LIMIT = 40;
  static LIMIT_WARNING = 10;
  static ROUT_RATIO = 4;
  static CHAIN_MAX = 2;
  static CAPTURE_XP = 1;
  static ROYAL_XP = 2;
  static SWIFT_TURNS = 12;

  static SAVE_KEYS = [
    'board', 'turn', 'side', 'outcome', 'reason', 'objective', 'boss_rule', 'relics', 'fortress',
    'clock_key_ready', 'extra_turn_pending', 'active_id', 'bonus_captures', 'bonus_moves', 'bonus_quiet',
    'turn_captures', 'chain_granted', 'relic_follow_used', 'momentum_used', 'charge_used', 'xp_gained',
    'lost', 'promoted', 'captures', 'best_chain', 'gold_found',
  ];

  constructor() {
    this.board = new Board();
    this.turn = 1;
    this.side = 'player';
    this.outcome = '';
    this.reason = '';
    this.objective = 'eliminate';
    this.boss_rule = '';
    this.relics = [];
    this.fortress = 0;
    this.clock_key_ready = false;
    this.extra_turn_pending = false;
    // Follow-up state within the player's turn.
    this.active_id = '';
    this.bonus_captures = 0;
    this.bonus_moves = 0;
    this.bonus_quiet = 0;
    this.turn_captures = 0;
    this.chain_granted = false;
    this.relic_follow_used = false;
    this.momentum_used = false;
    this.charge_used = false;
    // Results.
    this.xp_gained = {};
    this.lost = [];
    this.promoted = [];
    this.captures = 0;
    this.best_chain = 0;
    this.gold_found = 0;
  }

  static create(start, runRelics, goal, rule) {
    const battle = new Battle();
    battle.board = start;
    battle.relics = runRelics.slice();
    battle.objective = goal;
    battle.boss_rule = rule;
    battle.fortress = runRelics.includes('fortress_stone') ? 1 : 0;
    battle.clock_key_ready = runRelics.includes('clockmakers_key');
    battle.extra_turn_pending = runRelics.includes('opening_book');
    for (const piece of start.friendlies()) battle.xp_gained[piece.id] = 0;
    return battle;
  }

  is_player_turn() {
    return this.outcome === '' && this.side === 'player';
  }

  in_follow_up() {
    return this.active_id !== '';
  }

  /** Legal destinations for one of the player's pieces right now (respecting follow-up limits). */
  moves_for(id) {
    if (!this.is_player_turn() || !this.board.has_piece(id)) return [];
    const piece = this.board.piece_by_id(id);
    if (!piece.friendly) return [];
    if (this.active_id !== '' && id !== this.active_id) return [];
    const capturesAllowed = this.active_id === '' || this.bonus_captures > 0 || this.bonus_moves > 0;
    const quietAllowed = this.active_id === '' || this.bonus_quiet > 0 || this.bonus_moves > 0;
    if (!capturesAllowed && !quietAllowed) return [];
    const moves = ChessRules.legal_moves(this.board, piece, quietAllowed, capturesAllowed);
    if (this.relics.includes('salt_horn')) return moves;
    // Stepping onto rot is only offered when losing the piece would not expose the king.
    const safe = [];
    for (const cell of moves) {
      if (this.board.tile(cell) !== 'corrupted' || !this._consumed_exposes_king(id, cell)) safe.push(cell);
    }
    return safe;
  }

  allowed_moves() {
    const out = [];
    for (const piece of this.board.friendlies()) {
      for (const cell of this.moves_for(piece.id)) out.push({ id: piece.id, to: cell });
    }
    return out;
  }

  movable_ids() {
    const out = [];
    for (const piece of this.board.friendlies()) if (this.moves_for(piece.id).length > 0) out.push(piece.id);
    return out;
  }

  player_in_check() {
    return ChessRules.in_check(this.board, true);
  }

  threatened_ids() {
    const out = [];
    for (const piece of this.board.friendlies()) if (ChessRules.is_attacked(this.board, piece.cell, false)) out.push(piece.id);
    return out;
  }

  /** Union of enemy attack squares, first-seen order. O(pieces · reach) with a keyed set. */
  enemy_attack_cells() {
    const seen = new Set();
    const out = [];
    for (const piece of this.board.enemies()) {
      for (const cell of ChessRules.attack_cells(this.board, piece)) {
        const key = cell.key();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cell);
        }
      }
    }
    return out;
  }

  material(friendly) {
    let total = 0;
    for (const piece of this.board.side(friendly)) total += Math.trunc(ChessRules.MATERIAL[piece.kind]);
    return total;
  }

  enemy_moves_twice() {
    return this.boss_rule === 'double_move' && this.turn % 3 === 0;
  }

  swift() {
    return this.turn <= Battle.SWIFT_TURNS;
  }

  /** Plays a player move; returns the ChessRules record enriched with xp/gold/terrain/turn_end. */
  move(id, to) {
    if (!has(this.moves_for(id), to)) return {};
    const piece = this.board.piece_by_id(id);
    const followUp = this.active_id !== '';
    const capturing = !isEmpty(this.board.piece_at(to));
    if (followUp) {
      if (capturing) {
        if (this.bonus_captures > 0) this.bonus_captures -= 1;
        else this.bonus_moves -= 1;
      } else if (this.bonus_quiet > 0) {
        this.bonus_quiet -= 1;
      } else {
        this.bonus_moves -= 1;
      }
    }
    const record = ChessRules.perform(this.board, id, to);
    this.active_id = id;
    record.follow_up = followUp;
    record.xp = 0;
    record.gold = 0;
    record.corrupted = new Vector2i(-1, -1);
    record.turn_end = {};
    if (!isEmpty(record.captured)) {
      this.captures += 1;
      this.turn_captures += 1;
      this.best_chain = Math.max(this.best_chain, this.turn_captures);
      let xp = ChessRules.ROYAL.includes(record.captured.kind) ? Battle.ROYAL_XP : Battle.CAPTURE_XP;
      if (piece.upgrades.includes('veteran')) xp += 1;
      if (this.relics.includes('brilliancy_prize')) xp += 1;
      this.xp_gained[id] = Math.trunc(this.xp_gained[id]) + xp;
      record.xp = xp;
      if (this.relics.includes('ransom_ledger') && ChessRules.ROYAL.includes(record.captured.kind)) {
        this.gold_found += 5;
        record.gold = 5;
      }
      if (this.boss_rule === 'corrupting_pawns' && record.captured.kind === 'pawn') {
        this.board.set_tile(record.from, 'corrupted');
        record.corrupted = record.from;
      }
      if (!this.chain_granted) {
        this.chain_granted = true;
        this.bonus_captures += Math.min(piece.upgrades.filter((u) => u === 'chain').length, Battle.CHAIN_MAX);
      }
      if (this.relics.includes('desperado_ribbon') && !this.relic_follow_used) {
        this.relic_follow_used = true;
        this.bonus_moves += 1;
      }
      if (piece.upgrades.includes('charge') && !this.charge_used) {
        this.charge_used = true;
        this.bonus_quiet += 1;
      }
    } else if (!record.bounced && piece.upgrades.includes('momentum') && !this.momentum_used) {
      this.momentum_used = true;
      this.bonus_moves += 1;
    }
    if (record.promoted) this.promoted.push(id);
    this._check_victory();
    if (this.outcome !== '' || this.moves_for(id).length === 0) record.turn_end = this._end_player_turn();
    record.outcome = this.outcome;
    return record;
  }

  end_turn() {
    if (!this.is_player_turn()) return {};
    return this._end_player_turn();
  }

  use_clock_key() {
    if (!this.is_player_turn() || !this.clock_key_ready) return false;
    this.clock_key_ready = false;
    this.extra_turn_pending = true;
    return true;
  }

  /** Enemy turn: 1 move (2 on the Dowager's every third turn), rot, victory/limit/checkmate checks. */
  enemy_turn(depth, rng, noise) {
    const records = [];
    if (this.outcome !== '' || this.side !== 'enemy') return records;
    const moves = this.enemy_moves_twice() ? 2 : 1;
    for (let i = 0; i < moves; i++) {
      if (this.board.enemies().length === 0) break;
      if (!ChessRules.has_legal_move(this.board, false)) break;
      // The second move may not take the king: it has to leave the player a reply.
      const allowed = [];
      if (i > 0) {
        for (const piece of this.board.enemies()) {
          for (const cell of ChessRules.legal_moves(this.board, piece)) {
            const occupant = this.board.piece_at(cell);
            if (isEmpty(occupant) || occupant.kind !== 'king') allowed.push({ id: piece.id, to: cell });
          }
        }
        if (allowed.length === 0) break;
      }
      const choice = Tactics.best_move(this.board, false, depth, rng, noise, allowed);
      const target = this.board.piece_at(choice.to);
      const shielded = this.fortress > 0 && !isEmpty(target) && target.friendly && Math.trunc(target.ward) <= 0;
      const record = ChessRules.perform(this.board, choice.id, choice.to, shielded);
      if (record.shielded) this.fortress -= 1;
      if (!isEmpty(record.captured)) {
        this.lost.push(record.captured);
        if (record.captured.kind === 'king') {
          this.outcome = 'lost';
          this.reason = 'king';
        }
      }
      records.push(record);
      if (this.outcome !== '') break;
    }
    const destroyed = this._resolve_corruption(false);
    records.push({ terrain: destroyed });
    this._check_victory();
    if (this.outcome === '') {
      this.turn += 1;
      this.side = 'player';
      if (this.turn > Battle.TURN_LIMIT) {
        const ahead = this.material(true) > this.material(false);
        this.outcome = ahead ? 'won' : 'lost';
        this.reason = ahead ? 'withdrew' : 'exhausted';
      } else if (ChessRules.in_check(this.board, true) && !ChessRules.has_legal_move(this.board, true)) {
        this.outcome = 'lost';
        this.reason = 'checkmate';
      }
    }
    return records;
  }

  /** Would losing the piece after this move (to rot) leave the king in check? */
  _consumed_exposes_king(id, cell) {
    const record = ChessRules.perform(this.board, id, cell);
    const index = this.board.index_of(id);
    const mover = this.board.remove(id);
    const exposed = ChessRules.in_check(this.board, true);
    this.board.insert(mover, index);
    ChessRules.revert(this.board, record);
    return exposed;
  }

  _end_player_turn() {
    const record = { destroyed: [], extra_turn: false };
    if (!this.relics.includes('salt_horn')) record.destroyed = this._resolve_corruption(true);
    this._reset_turn();
    this._check_victory();
    if (this.outcome !== '') return record;
    if (this.extra_turn_pending) {
      this.extra_turn_pending = false;
      record.extra_turn = true;
      return record;
    }
    this.side = 'enemy';
    return record;
  }

  _reset_turn() {
    this.active_id = '';
    this.bonus_captures = 0;
    this.bonus_moves = 0;
    this.bonus_quiet = 0;
    this.turn_captures = 0;
    this.chain_granted = false;
    this.relic_follow_used = false;
    this.momentum_used = false;
    this.charge_used = false;
  }

  /** Pieces of `friendly` standing on corrupted tiles are consumed. */
  _resolve_corruption(friendly) {
    const destroyed = [];
    for (const piece of this.board.side(friendly)) {
      if (this.board.tile(piece.cell) === 'corrupted') destroyed.push(duplicate(piece, true));
    }
    for (const piece of destroyed) {
      this.board.remove(piece.id);
      if (friendly) this.lost.push(piece);
    }
    return destroyed;
  }

  _check_victory() {
    if (this.outcome !== '') return;
    if (this.board.enemies().length === 0) {
      this.outcome = 'won';
      this.reason = 'eliminated';
    } else if (this.objective === 'regicide' && isEmpty(this.board.king(false))) {
      this.outcome = 'won';
      this.reason = 'regicide';
    } else if (this.objective === 'eliminate' && this.board.enemies().length === 1 && this.material(false) * Battle.ROUT_RATIO <= this.material(true)) {
      // A lone, badly outmatched enemy flees.
      this.outcome = 'won';
      this.reason = 'routed';
    }
  }

  to_dict() {
    const lostData = [];
    for (const piece of this.lost) {
      const entry = duplicate(piece, true);
      entry.cell = [piece.cell.x, piece.cell.y];
      entry.upgrades = piece.upgrades.slice();
      lostData.push(entry);
    }
    return {
      board: this.board.to_data(), turn: this.turn, side: this.side, outcome: this.outcome, reason: this.reason,
      objective: this.objective, boss_rule: this.boss_rule, relics: this.relics.slice(), fortress: this.fortress,
      clock_key_ready: this.clock_key_ready, extra_turn_pending: this.extra_turn_pending,
      active_id: this.active_id, bonus_captures: this.bonus_captures, bonus_moves: this.bonus_moves,
      bonus_quiet: this.bonus_quiet, turn_captures: this.turn_captures, chain_granted: this.chain_granted,
      relic_follow_used: this.relic_follow_used, momentum_used: this.momentum_used, charge_used: this.charge_used,
      xp_gained: { ...this.xp_gained }, lost: lostData, promoted: this.promoted.slice(),
      captures: this.captures, best_chain: this.best_chain, gold_found: this.gold_found,
    };
  }

  static from_dict(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    for (const key of Battle.SAVE_KEYS) if (!(key in data)) return null;
    const restored = Board.from_data(data.board);
    if (restored === null || !['player', 'enemy'].includes(String(data.side))) return null;
    const battle = new Battle();
    battle.board = restored;
    battle.turn = Math.trunc(data.turn);
    battle.side = String(data.side);
    battle.outcome = String(data.outcome);
    battle.reason = String(data.reason);
    battle.objective = String(data.objective);
    battle.boss_rule = String(data.boss_rule);
    for (const id of data.relics) {
      if (!Relics.exists(String(id))) return null;
      battle.relics.push(String(id));
    }
    battle.fortress = Math.trunc(data.fortress);
    battle.clock_key_ready = Boolean(data.clock_key_ready);
    battle.extra_turn_pending = Boolean(data.extra_turn_pending);
    battle.active_id = String(data.active_id);
    battle.bonus_captures = Math.trunc(data.bonus_captures);
    battle.bonus_moves = Math.trunc(data.bonus_moves);
    battle.bonus_quiet = Math.trunc(data.bonus_quiet);
    battle.turn_captures = Math.trunc(data.turn_captures);
    battle.chain_granted = Boolean(data.chain_granted);
    battle.relic_follow_used = Boolean(data.relic_follow_used);
    battle.momentum_used = Boolean(data.momentum_used);
    battle.charge_used = Boolean(data.charge_used);
    if (data.xp_gained === null || typeof data.xp_gained !== 'object' || Array.isArray(data.xp_gained) || !Array.isArray(data.lost)) return null;
    for (const id of Object.keys(data.xp_gained)) battle.xp_gained[String(id)] = Math.trunc(data.xp_gained[id]);
    for (const entry of data.lost) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !('cell' in entry) || !('upgrades' in entry)) return null;
      const piece = duplicate(entry, true);
      piece.cell = new Vector2i(Math.trunc(entry.cell[0]), Math.trunc(entry.cell[1]));
      piece.level = Math.trunc(entry.level);
      piece.ward = Math.trunc(entry.ward);
      battle.lost.push(piece);
    }
    for (const id of data.promoted) battle.promoted.push(String(id));
    battle.captures = Math.trunc(data.captures);
    battle.best_chain = Math.trunc(data.best_chain);
    battle.gold_found = Math.trunc(data.gold_found);
    return battle;
  }
}
