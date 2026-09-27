/**
 * ChessRules — port of scripts/core/chess_rules.gd: move generation on the 6×6 board with the run's
 * upgrades (piercing rays, extended knight jumps, rebellion pawns…), terrain (frozen blocks,
 * corrupted squares kings avoid, enchanted squares that shelter the player), marching enemies that
 * never retreat, and reversible perform/revert used by the search.
 *
 * Output order matters (the AI keeps the first best move), so every loop walks the same direction
 * tables in the same order as the original.
 */
import { Vector2i } from '../godot/math.js';
import { has } from '../godot/gdscript.js';
import { Board, isEmpty } from './board.js';
import { Upgrades } from './upgrades.js';

const v = (x, y) => new Vector2i(x, y);

export class ChessRules {
  static KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  static ROYAL = ['queen', 'king'];
  static MATERIAL = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

  static PIECE_INFO = {
    pawn: { name: 'Pawn', move: 'Forward one (two from home). Captures diagonally forward.', flavor: 'Small steps change everything.' },
    rook: { name: 'Rook', move: 'Any distance in a straight line.', flavor: 'Hold the line.' },
    knight: { name: 'Knight', move: 'L-shaped (2, 1), jumping over pieces.', flavor: 'Find another way.' },
    bishop: { name: 'Bishop', move: 'Any distance diagonally.', flavor: 'See further.' },
    queen: { name: 'Queen', move: 'Any distance in any straight line.', flavor: 'Make it happen.' },
    king: { name: 'King', move: 'One square in any direction.', flavor: 'Keep going.' },
  };

  static KNIGHT_JUMPS = [v(1, 2), v(2, 1), v(2, -1), v(1, -2), v(-1, -2), v(-2, -1), v(-2, 1), v(-1, 2)];
  static LONG_JUMPS = [v(1, 3), v(3, 1), v(3, -1), v(1, -3), v(-1, -3), v(-3, -1), v(-3, 1), v(-1, 3)];
  static EIGHT_WAYS = [v(0, -1), v(1, -1), v(1, 0), v(1, 1), v(0, 1), v(-1, 1), v(-1, 0), v(-1, -1)];
  static ORTHOGONAL = [v(0, -1), v(1, 0), v(0, 1), v(-1, 0)];
  static DIAGONAL = [v(1, -1), v(1, 1), v(-1, 1), v(-1, -1)];

  static forward(friendly) {
    return friendly ? -1 : 1;
  }

  static pawn_home_row(friendly) {
    return friendly ? Board.SIZE - 2 : 1;
  }

  static promotion_row(piece) {
    const early = piece.upgrades.includes('early_promotion');
    if (piece.friendly) return early ? 1 : 0;
    return early ? Board.SIZE - 2 : Board.SIZE - 1;
  }

  static enterable(board, cell) {
    return Board.in_bounds(cell) && board.tile(cell) !== 'frozen';
  }

  /** Enchanted squares shelter the player's pieces only. */
  static sheltered(board, cell, friendly) {
    return friendly && board.tile(cell) === 'enchanted';
  }

  static can_capture(board, piece, target) {
    return !isEmpty(target) && target.friendly !== piece.friendly && !ChessRules.sheltered(board, target.cell, target.friendly);
  }

  /** Moves ignoring check. O(reach) per direction. */
  static pseudo_moves(board, piece, quiet = true, captures = true) {
    let out = [];
    const upgrades = piece.upgrades;
    const piercing = upgrades.includes('piercing');
    switch (piece.kind) {
      case 'knight':
        ChessRules._steps(board, piece, ChessRules.KNIGHT_JUMPS, out, quiet, captures);
        if (upgrades.includes('extended_range')) ChessRules._steps(board, piece, ChessRules.LONG_JUMPS, out, quiet, captures);
        break;
      case 'king':
        ChessRules._rays(board, piece, ChessRules.EIGHT_WAYS, upgrades.includes('royal_stride') ? 2 : 1, false, out, quiet, captures);
        break;
      case 'rook':
        ChessRules._rays(board, piece, ChessRules.ORTHOGONAL, Board.SIZE, piercing, out, quiet, captures);
        if (upgrades.includes('siege_step')) ChessRules._steps(board, piece, ChessRules.DIAGONAL, out, quiet, captures);
        break;
      case 'bishop':
        ChessRules._rays(board, piece, ChessRules.DIAGONAL, Board.SIZE, piercing, out, quiet, captures);
        if (upgrades.includes('side_step')) ChessRules._steps(board, piece, ChessRules.ORTHOGONAL, out, quiet, captures);
        break;
      case 'queen':
        ChessRules._rays(board, piece, ChessRules.EIGHT_WAYS, Board.SIZE, piercing, out, quiet, captures);
        break;
      case 'pawn':
        ChessRules._pawn(board, piece, out, quiet, captures);
        break;
    }
    if (piece.kind === 'king') {
      const safe = [];
      for (const cell of out) if (board.tile(cell) !== 'corrupted') safe.push(cell);
      out = safe;
    }
    if (ChessRules.marches(piece)) return ChessRules._no_retreat(piece, out);
    return out;
  }

  /** Enemy pieces march: they never move back toward their own home row. */
  static marches(piece) {
    return !piece.friendly;
  }

  static _no_retreat(piece, cells) {
    const out = [];
    for (const cell of cells) if (cell.y >= piece.cell.y) out.push(cell);
    return out;
  }

  /** Squares this piece attacks (captures it could make if an enemy stood there). */
  static attack_cells(board, piece) {
    const out = [];
    const upgrades = piece.upgrades;
    switch (piece.kind) {
      case 'pawn': {
        const dy = ChessRules.forward(piece.friendly);
        const offsets = [v(-1, dy), v(1, dy)];
        if (upgrades.includes('rebellion')) offsets.push(v(-1, -dy), v(1, -dy));
        for (const offset of offsets) {
          const cell = piece.cell.add(offset);
          if (ChessRules.enterable(board, cell)) out.push(cell);
        }
        break;
      }
      case 'knight':
        for (const offset of ChessRules.KNIGHT_JUMPS) ChessRules._attack_step(board, piece.cell.add(offset), out);
        if (upgrades.includes('extended_range')) for (const offset of ChessRules.LONG_JUMPS) ChessRules._attack_step(board, piece.cell.add(offset), out);
        break;
      case 'king':
        ChessRules._attack_rays(board, piece, ChessRules.EIGHT_WAYS, upgrades.includes('royal_stride') ? 2 : 1, false, out);
        break;
      case 'rook':
        ChessRules._attack_rays(board, piece, ChessRules.ORTHOGONAL, Board.SIZE, upgrades.includes('piercing'), out);
        if (upgrades.includes('siege_step')) for (const offset of ChessRules.DIAGONAL) ChessRules._attack_step(board, piece.cell.add(offset), out);
        break;
      case 'bishop':
        ChessRules._attack_rays(board, piece, ChessRules.DIAGONAL, Board.SIZE, upgrades.includes('piercing'), out);
        if (upgrades.includes('side_step')) for (const offset of ChessRules.ORTHOGONAL) ChessRules._attack_step(board, piece.cell.add(offset), out);
        break;
      case 'queen':
        ChessRules._attack_rays(board, piece, ChessRules.EIGHT_WAYS, Board.SIZE, upgrades.includes('piercing'), out);
        break;
    }
    const reachable = [];
    const retreatLimit = ChessRules.marches(piece) ? piece.cell.y : -1;
    for (const cell of out) {
      if (ChessRules.sheltered(board, cell, !piece.friendly) || (piece.kind === 'king' && board.tile(cell) === 'corrupted') || cell.y < retreatLimit) continue;
      reachable.push(cell);
    }
    return reachable;
  }

  static is_attacked(board, cell, byFriendly) {
    for (const piece of board.pieces) {
      if (piece.friendly === byFriendly && has(ChessRules.attack_cells(board, piece), cell)) return true;
    }
    return false;
  }

  static in_check(board, friendly) {
    const king = board.king(friendly);
    return !isEmpty(king) && ChessRules.is_attacked(board, king.cell, !friendly);
  }

  /** Legal moves: the player's may not leave their own king in check; enemy moves are pseudo-legal. */
  static legal_moves(board, piece, quiet = true, captures = true) {
    const candidates = ChessRules.pseudo_moves(board, piece, quiet, captures);
    if (!piece.friendly || isEmpty(board.king(true))) return candidates;
    const out = [];
    for (const cell of candidates) {
      const record = ChessRules.perform(board, piece.id, cell);
      const safe = !ChessRules.in_check(board, piece.friendly);
      ChessRules.revert(board, record);
      if (safe) out.push(cell);
    }
    return out;
  }

  static has_legal_move(board, friendly) {
    for (const piece of board.side(friendly)) if (ChessRules.legal_moves(board, piece).length > 0) return true;
    return false;
  }

  /**
   * Applies a move and returns everything needed to undo it. Wards (and the Fortress Stone's shield)
   * make a capture "bounce": nothing moves, the ward is spent.
   */
  static perform(board, id, to, shielded = false) {
    const piece = board.piece_by_id(id);
    const record = {
      id,
      friendly: piece.friendly,
      kind: piece.kind,
      from: piece.cell,
      to,
      captured: {},
      bounced: false,
      shielded: false,
      promoted: false,
      upgrades_before: piece.upgrades.slice(),
    };
    const target = board.piece_at(to);
    if (!isEmpty(target)) {
      if (shielded) {
        record.bounced = true;
        record.shielded = true;
        record.target_id = target.id;
        return record;
      }
      if (Math.trunc(target.ward) > 0) {
        target.ward = Math.trunc(target.ward) - 1;
        record.bounced = true;
        record.target_id = target.id;
        return record;
      }
      const captured = { ...target };
      captured.upgrades = target.upgrades.slice();
      record.captured = captured;
      record.captured_index = board.index_of(target.id);
      board.remove(target.id);
    }
    board.move(id, to);
    if (piece.kind === 'pawn' && to.y === ChessRules.promotion_row(piece)) {
      piece.kind = 'queen';
      piece.upgrades = Upgrades.carried_over(piece.upgrades, 'queen');
      record.promoted = true;
    }
    return record;
  }

  static revert(board, record) {
    if (record.bounced) {
      if (!record.shielded) {
        const target = board.piece_by_id(String(record.target_id));
        target.ward = Math.trunc(target.ward) + 1;
      }
      return;
    }
    const piece = board.piece_by_id(String(record.id));
    piece.kind = record.kind;
    piece.upgrades = record.upgrades_before.slice();
    board.move(String(record.id), record.from);
    if (!isEmpty(record.captured)) {
      const restored = { ...record.captured };
      restored.upgrades = record.captured.upgrades.slice();
      board.insert(restored, Math.trunc(record.captured_index));
    }
  }

  static _steps(board, piece, offsets, out, quiet, captures) {
    for (const offset of offsets) {
      const cell = piece.cell.add(offset);
      if (!ChessRules.enterable(board, cell)) continue;
      const other = board.piece_at(cell);
      if (isEmpty(other)) {
        if (quiet) out.push(cell);
      } else if (captures && ChessRules.can_capture(board, piece, other)) {
        out.push(cell);
      }
    }
  }

  static _rays(board, piece, directions, reach, piercing, out, quiet, captures) {
    for (const direction of directions) {
      let cell = piece.cell.add(direction);
      let travelled = 0;
      let pierced = false;
      while (travelled < reach && ChessRules.enterable(board, cell)) {
        travelled += 1;
        const other = board.piece_at(cell);
        if (isEmpty(other)) {
          if (quiet && !pierced) out.push(cell);
        } else {
          if (captures && ChessRules.can_capture(board, piece, other)) out.push(cell);
          if (piercing && !pierced) pierced = true;
          else break;
        }
        cell = cell.add(direction);
      }
    }
  }

  static _pawn(board, piece, out, quiet, captures) {
    const dy = ChessRules.forward(piece.friendly);
    const upgrades = piece.upgrades;
    if (quiet) {
      const one = piece.cell.add(v(0, dy));
      if (ChessRules.enterable(board, one) && board.is_free(one)) {
        out.push(one);
        const two = piece.cell.add(v(0, dy * 2));
        const mayDouble = piece.cell.y === ChessRules.pawn_home_row(piece.friendly) || upgrades.includes('vanguard');
        if (mayDouble && ChessRules.enterable(board, two) && board.is_free(two)) out.push(two);
      }
      if (upgrades.includes('rebellion')) {
        for (const dx of [-1, 1]) {
          const beside = piece.cell.add(v(dx, 0));
          if (ChessRules.enterable(board, beside) && board.is_free(beside)) out.push(beside);
        }
      }
    }
    if (captures) {
      const offsets = [v(-1, dy), v(1, dy)];
      if (upgrades.includes('rebellion')) offsets.push(v(-1, -dy), v(1, -dy));
      for (const offset of offsets) {
        const cell = piece.cell.add(offset);
        if (ChessRules.enterable(board, cell) && ChessRules.can_capture(board, piece, board.piece_at(cell))) out.push(cell);
      }
    }
  }

  static _attack_step(board, cell, out) {
    if (ChessRules.enterable(board, cell)) out.push(cell);
  }

  static _attack_rays(board, piece, directions, reach, piercing, out) {
    for (const direction of directions) {
      let cell = piece.cell.add(direction);
      let travelled = 0;
      let pierced = false;
      while (travelled < reach && ChessRules.enterable(board, cell)) {
        travelled += 1;
        const other = board.piece_at(cell);
        if (!pierced || !isEmpty(other)) out.push(cell);
        if (!isEmpty(other)) {
          if (piercing && !pierced) pierced = true;
          else break;
        }
        cell = cell.add(direction);
      }
    }
  }
}
