/**
 * Tactics — port of scripts/core/tactics.gd: the enemy (and hint) planner.
 *
 * Negamax with alpha-beta pruning over a cloned board, captures ordered first (MVV). Scores are
 * doubles accumulated in exactly the original order: with noise ≠ 0 the choice depends on sums like
 * `score + rng.randf() * noise`, so even the order of additions is part of the contract.
 * Cost: O(b^d) nodes worst case, pruned toward O(b^(d/2)); depth ≤ 3 on a 6×6 board.
 */
import { sortCustom } from '../godot/gdscript.js';
import { Board, isEmpty } from './board.js';
import { ChessRules } from './chess_rules.js';

export class Tactics {
  static VALUE = { pawn: 100, knight: 310, bishop: 325, rook: 500, queen: 900, king: 0 };
  static LOSS = 100000.0;
  static LEVEL_VALUE = 30.0;
  static UPGRADE_VALUE = 22.0;
  static WARD_VALUE = 70.0;
  static AGGRESSION = 16.0;
  static PURSUIT = 9.0;
  static THREAT = 14.0;

  /**
   * Best move for `friendly` at `depth` plies; `allowed` restricts the root moves (follow-ups, second
   * boss move). Returns {} when nothing can move, otherwise {id, to, score}.
   */
  static best_move(board, friendly, depth, rng, noise = 0.0, allowed = []) {
    const work = board.clone();
    const kings = { true: !isEmpty(work.king(true)), false: !isEmpty(work.king(false)) };
    const candidates = [];
    if (allowed.length === 0) {
      for (const piece of work.side(friendly)) {
        for (const cell of ChessRules.legal_moves(work, piece)) candidates.push({ id: piece.id, to: cell });
      }
    } else {
      for (const entry of allowed) candidates.push({ id: String(entry.id), to: entry.to });
    }
    if (candidates.length === 0) return {};
    Tactics._order(work, candidates);
    let best = {};
    let bestScore = -Infinity;
    for (const move of candidates) {
      const record = ChessRules.perform(work, move.id, move.to);
      let score = -Tactics._negamax(work, !friendly, depth - 1, -Infinity, Infinity, kings);
      ChessRules.revert(work, record);
      if (noise > 0.0) score += rng.randf() * noise;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    best.score = bestScore;
    return best;
  }

  /** Static evaluation from `friendly`'s point of view. O(pieces · attacks). */
  static evaluate(board, friendly) {
    let score = 0.0;
    const playerKing = board.king(true);
    const enemies = board.enemies();
    for (const piece of board.pieces) {
      let value = Tactics.VALUE[piece.kind];
      value += Math.trunc(piece.level) * Tactics.LEVEL_VALUE + piece.upgrades.length * Tactics.UPGRADE_VALUE + Math.trunc(piece.ward) * Tactics.WARD_VALUE;
      const cell = piece.cell;
      if (piece.kind === 'pawn') {
        const advanced = piece.friendly ? Board.SIZE - 2 - cell.y : cell.y - 1;
        value += advanced * 14.0;
      } else if (piece.kind !== 'king') {
        const fromCentre = Math.abs(cell.x - 2.5) + Math.abs(cell.y - 2.5);
        value += (5.0 - fromCentre) * 5.0;
      }
      if (piece.kind !== 'king') {
        if (!piece.friendly && !isEmpty(playerKing)) {
          value += (Board.SIZE - Board.distance(cell, playerKing.cell)) * Tactics.AGGRESSION;
        } else if (piece.friendly && enemies.length > 0) {
          let nearest = Board.SIZE;
          for (const enemy of enemies) nearest = Math.min(nearest, Board.distance(cell, enemy.cell));
          value += (Board.SIZE - nearest) * Tactics.PURSUIT;
        }
      }
      switch (board.tile(cell)) {
        case 'corrupted':
          value *= 0.35;
          break;
        case 'enchanted':
          value *= 1.1;
          break;
      }
      for (const targetCell of ChessRules.attack_cells(board, piece)) {
        const target = board.piece_at(targetCell);
        if (!isEmpty(target) && target.friendly !== piece.friendly && target.kind !== 'king') {
          value += Tactics.THREAT + Math.max(0.0, Tactics.VALUE[target.kind] - Tactics.VALUE[piece.kind]) * 0.08;
        }
      }
      score += piece.friendly === friendly ? value : -value;
    }
    return score;
  }

  static _negamax(board, friendly, depth, alpha, beta, kings) {
    const mine = board.side(friendly);
    if (mine.length === 0 || (kings[friendly] && isEmpty(board.king(friendly)))) return -Tactics.LOSS - depth;
    if (board.side(!friendly).length === 0 || (kings[!friendly] && isEmpty(board.king(!friendly)))) return Tactics.LOSS + depth;
    if (depth <= 0) return Tactics.evaluate(board, friendly);
    let moves = [];
    for (const piece of mine) {
      for (const cell of ChessRules.pseudo_moves(board, piece)) moves.push({ id: piece.id, to: cell });
    }
    // In check: only replies that leave the king safe; none left = mated.
    if (kings[friendly] && ChessRules.in_check(board, friendly)) {
      const answers = [];
      for (const move of moves) {
        const record = ChessRules.perform(board, move.id, move.to);
        if (!ChessRules.in_check(board, friendly)) answers.push(move);
        ChessRules.revert(board, record);
      }
      if (answers.length === 0) return -Tactics.LOSS - depth;
      moves = answers;
    }
    if (moves.length === 0) return Tactics.evaluate(board, friendly);
    Tactics._order(board, moves);
    let best = -Infinity;
    for (const move of moves) {
      const record = ChessRules.perform(board, move.id, move.to);
      const score = -Tactics._negamax(board, !friendly, depth - 1, -beta, -alpha, kings);
      ChessRules.revert(board, record);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** Captures first (most valuable victim, kings above all), generation order among equals. */
  static _order(board, moves) {
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const target = board.piece_at(move.to);
      move.priority = isEmpty(target) ? 0.0 : 1000.0 + Tactics.VALUE[target.kind] + (target.kind === 'king' ? 10000.0 : 0.0);
      move.index = i;
    }
    sortCustom(moves, (a, b) => a.priority > b.priority || (a.priority === b.priority && a.index < b.index));
  }
}
