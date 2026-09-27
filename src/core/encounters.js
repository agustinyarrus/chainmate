/**
 * Encounters — port of scripts/core/encounters.gd: builds each fight from the run's army, relics,
 * act and difficulty, drawing every random choice from the run RNG in the original order.
 */
import { Vector2i, round } from '../godot/math.js';
import { erase, format } from '../godot/gdscript.js';
import { Board } from './board.js';
import { ChessRules } from './chess_rules.js';
import { Upgrades } from './upgrades.js';
import { Battle } from './battle.js';
import { GameState } from './game_state.js';

export class Encounters {
  static ACTS = [
    { name: 'The Moss Ranks', variant: 'outpost', tagline: 'Ivy-choked ramparts in open daylight.' },
    { name: 'The Sunken Files', variant: 'crypt', tagline: 'Cold, flooded galleries under the board.' },
    { name: 'The Back Rank', variant: 'court', tagline: 'Where the enemy king holds court.' },
  ];

  static BUDGET = [7, 11, 15];
  static ELITE_SCALE = 1.45;
  static MAX_ENEMIES = 9;
  static POOLS = [
    { pawn: 6, knight: 2, bishop: 2, rook: 1 },
    { pawn: 5, knight: 2, bishop: 2, rook: 2, queen: 1 },
    { pawn: 4, knight: 2, bishop: 2, rook: 2, queen: 2 },
  ];
  static BOSSES = [
    { name: 'Lucena of the Long File', army: ['king', 'rook', 'rook', 'pawn', 'pawn', 'pawn'], rule: 'piercing_rooks', desc: 'Her rooks skewer: their captures pass through one piece.' },
    { name: 'Canon Oblique', army: ['king', 'bishop', 'bishop', 'knight', 'knight', 'pawn', 'pawn', 'pawn'], rule: 'corrupting_pawns', desc: 'His pawns are poisoned: take one and the square your piece left rots.' },
    { name: 'The Dowager Zwischen', army: ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'pawn', 'pawn'], rule: 'double_move', desc: 'Every third turn she slips in a second move.' },
  ];

  static TERRAIN = [
    { enchanted: [0, 2] },
    { frozen: [1, 2], corrupted: [0, 2] },
    { corrupted: [1, 2], enchanted: [0, 1], frozen: [0, 1] },
  ];
  static BACK_FILES = {
    king: [3, 2], queen: [2, 4, 1], rook: [0, 5, 1, 4], bishop: [2, 4, 1, 5], knight: [1, 4, 2, 5, 0, 3], pawn: [],
  };
  static PAWN_FILES = [3, 2, 4, 1, 5, 0];
  static PLACEMENT_ORDER = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

  static build(gs, nodeType) {
    const rng = gs.rng;
    const board = new Board();
    const friends = [];
    for (const entry of gs.army) {
      const upgrades = entry.upgrades.slice();
      if (entry.kind === 'knight' && gs.relics.includes('knights_tour_chart') && !upgrades.includes('momentum')) upgrades.push('momentum');
      if (entry.kind === 'bishop' && gs.relics.includes('fianchetto_glass') && !upgrades.includes('piercing')) upgrades.push('piercing');
      if (entry.kind === 'pawn' && gs.relics.includes('queening_charter')) upgrades.push('early_promotion');
      const piece = Board.make_piece(String(entry.id), String(entry.kind), true, Vector2i.ZERO, Math.trunc(entry.level), upgrades);
      if (entry.kind === 'rook' && gs.relics.includes('castling_deed')) piece.ward = Math.trunc(piece.ward) + 1;
      if (gs.fortified && entry.kind !== 'king') piece.ward = Math.trunc(piece.ward) + 1;
      friends.push(piece);
    }
    Encounters._place(board, friends, true);

    let objective = 'eliminate';
    let rule = '';
    let kinds = [];
    const scale = GameState.DIFFICULTIES[gs.difficulty].budget_scale;
    if (nodeType === 'boss') {
      const boss = Encounters.BOSSES[gs.act];
      kinds = boss.army.slice();
      rule = boss.rule;
      objective = 'regicide';
      if (gs.difficulty === 'apprentice') erase(kinds, 'pawn');
      else if (gs.difficulty === 'grandmaster') kinds.push('pawn');
    } else {
      const budget = Math.trunc(round(Encounters.BUDGET[gs.act] * scale * (nodeType === 'elite' ? Encounters.ELITE_SCALE : 1.0)));
      kinds = Encounters._compose(rng, gs.act, budget);
    }
    const foes = [];
    for (let i = 0; i < kinds.length; i++) foes.push(Board.make_piece(format('e%d', i), kinds[i], false, Vector2i.ZERO));
    if (rule === 'piercing_rooks') {
      for (const foe of foes) if (foe.kind === 'rook') foe.upgrades.push('piercing');
    }
    if (nodeType === 'elite' || nodeType === 'boss') {
      const champions = [];
      for (const foe of foes) if (foe.kind !== 'king' && foe.kind !== 'pawn') champions.push(foe);
      const promotions = nodeType === 'elite' ? 1 : gs.act;
      const rounds = Math.min(promotions, champions.length);
      for (let n = 0; n < rounds; n++) {
        const champion = champions[rng.randi_range(0, champions.length - 1)];
        erase(champions, champion);
        const pool = Upgrades.pool_for(champion.kind, champion.upgrades);
        erase(pool, 'veteran');
        champion.level = 1;
        if (pool.length > 0) {
          const pick = pool[rng.randi_range(0, pool.length - 1)];
          champion.upgrades.push(pick);
          if (pick === 'ward') champion.ward = Math.trunc(champion.ward) + 1;
        }
      }
    }
    Encounters._place(board, foes, false);

    if (gs.relics.includes('forfeit_slip')) {
      const pawns = [];
      for (const foe of board.enemies()) if (foe.kind === 'pawn') pawns.push(foe);
      if (pawns.length > 0) board.remove(pawns[rng.randi_range(0, pawns.length - 1)].id);
    }

    Encounters._place_terrain(board, rng, gs.act);
    return Battle.create(board, gs.relics, objective, rule);
  }

  /** The army laid out on the home rows (shown between fights). */
  static camp(army) {
    const board = new Board();
    const pieces = [];
    for (const entry of army) {
      pieces.push(Board.make_piece(String(entry.id), String(entry.kind), true, Vector2i.ZERO, Math.trunc(entry.level), entry.upgrades.slice()));
    }
    Encounters._place(board, pieces, true);
    return board;
  }

  /** Weighted draws from the act's pool until the material budget (+1 slack) is spent. */
  static _compose(rng, act, budget) {
    const pool = Encounters.POOLS[act];
    const kinds = [];
    let spent = 0;
    let guard = 0;
    while (spent < budget && kinds.length < Encounters.MAX_ENEMIES && guard < 80) {
      guard += 1;
      const kind = Encounters._weighted(pool, rng);
      const cost = ChessRules.MATERIAL[kind];
      if (spent + cost > budget + 1) continue;
      kinds.push(kind);
      spent += cost;
    }
    while (kinds.length < 2) kinds.push('pawn');
    return kinds;
  }

  static _place(board, pieces, friendly) {
    const back = friendly ? Board.SIZE - 1 : 0;
    const front = friendly ? Board.SIZE - 2 : 1;
    const ordered = [];
    for (const kind of Encounters.PLACEMENT_ORDER) for (const piece of pieces) if (piece.kind === kind) ordered.push(piece);
    for (const piece of ordered) {
      let cell = new Vector2i(-1, -1);
      if (piece.kind === 'pawn') {
        for (const file of Encounters.PAWN_FILES) {
          if (board.is_free(new Vector2i(file, front))) {
            cell = new Vector2i(file, front);
            break;
          }
        }
      } else {
        for (const file of Encounters.BACK_FILES[piece.kind]) {
          if (board.is_free(new Vector2i(file, back))) {
            cell = new Vector2i(file, back);
            break;
          }
        }
      }
      if (cell.x < 0) {
        for (const row of [back, front]) {
          for (const file of Encounters.PAWN_FILES) {
            if (cell.x < 0 && board.is_free(new Vector2i(file, row))) cell = new Vector2i(file, row);
          }
        }
      }
      piece.cell = cell;
      board.add(piece);
    }
  }

  static _place_terrain(board, rng, act) {
    const plan = Encounters.TERRAIN[act];
    const open = [];
    for (const y of [2, 3]) {
      for (let x = 0; x < Board.SIZE; x++) {
        const cell = new Vector2i(x, y);
        if (board.is_free(cell)) open.push(cell);
      }
    }
    for (const state of Object.keys(plan)) {
      const n = rng.randi_range(Math.trunc(plan[state][0]), Math.trunc(plan[state][1]));
      for (let i = 0; i < n; i++) {
        if (open.length === 0) return;
        const cell = open[rng.randi_range(0, open.length - 1)];
        erase(open, cell);
        board.set_tile(cell, state);
      }
    }
  }

  static _weighted(pool, rng) {
    let total = 0;
    for (const kind of Object.keys(pool)) total += Math.trunc(pool[kind]);
    let roll = rng.randi_range(1, total);
    for (const kind of Object.keys(pool)) {
      roll -= Math.trunc(pool[kind]);
      if (roll <= 0) return kind;
    }
    const keys = Object.keys(pool);
    return keys[keys.length - 1];
  }
}
