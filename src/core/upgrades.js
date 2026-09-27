/**
 * Upgrades — port of scripts/core/upgrades.gd. Catalogue order is significant: `pool_for` walks it in
 * insertion order before the run's RNG shuffles the level-up choices.
 */
import { count } from '../godot/gdscript.js';

const ALL = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const NOT_KING = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

export class Upgrades {
  static ALL = ALL;
  static NOT_KING = NOT_KING;

  static CATALOGUE = {
    chain: { name: 'Chain Capture', kinds: ALL, max: 2, desc: 'After capturing, this piece may capture again.', short: 'Capture again after a capture.' },
    momentum: { name: 'Momentum', kinds: ALL, max: 1, desc: 'After moving to an empty square, this piece may move again.', short: 'Move again after a quiet move.' },
    ward: { name: 'Ward', kinds: NOT_KING, max: 1, desc: 'The first capture against this piece each encounter fails.', short: 'Survives one capture per encounter.' },
    veteran: { name: 'Veteran', kinds: ALL, max: 1, desc: 'Gains 1 extra XP from every capture.', short: '+1 XP per capture.' },
    extended_range: { name: 'Extended Range', kinds: ['knight'], max: 1, desc: 'Also jumps three and one, as well as two and one.', short: 'Also jumps (3, 1).' },
    charge: { name: 'Charge', kinds: ['knight'], max: 1, desc: 'After capturing, may make one more move to an empty square.', short: 'Strike, then reposition.' },
    piercing: { name: 'Piercing', kinds: ['rook', 'bishop', 'queen'], max: 1, desc: 'Captures may pass through one piece in the line.', short: 'Capture through one piece.' },
    siege_step: { name: 'Siege Step', kinds: ['rook'], max: 1, desc: 'Also steps one square diagonally.', short: 'Adds diagonal steps.' },
    side_step: { name: 'Side Step', kinds: ['bishop'], max: 1, desc: 'Also steps one square orthogonally.', short: 'Adds straight steps.' },
    rebellion: { name: 'Rebellion', kinds: ['pawn'], max: 1, desc: 'Captures diagonally forward and backward, and may step sideways.', short: 'Captures in all diagonals.' },
    vanguard: { name: 'Vanguard', kinds: ['pawn'], max: 1, desc: 'May always advance two squares.', short: 'Always double-steps.' },
    royal_stride: { name: 'Royal Stride', kinds: ['king'], max: 1, desc: 'Moves up to two squares in a straight line.', short: 'King moves two squares.' },
    early_promotion: { name: 'Pawn Storm', kinds: ['pawn'], max: 0, hidden: true, desc: 'Promotes one rank early.', short: 'Promotes early.' },
  };

  static exists(id) {
    return Object.prototype.hasOwnProperty.call(Upgrades.CATALOGUE, id);
  }

  static info(id) {
    return Upgrades.CATALOGUE[id];
  }

  static display_name(id) {
    return String(Upgrades.CATALOGUE[id].name);
  }

  static applies_to(id, kind) {
    return Upgrades.CATALOGUE[id].kinds.includes(kind);
  }

  /** Upgrades a piece of `kind` can still take (under each upgrade's cap), catalogue order. */
  static pool_for(kind, owned) {
    const out = [];
    for (const id of Object.keys(Upgrades.CATALOGUE)) {
      const info = Upgrades.CATALOGUE[id];
      if (Upgrades.applies_to(id, kind) && count(owned, id) < Math.trunc(info.max) && !('hidden' in info)) out.push(id);
    }
    return out;
  }

  /** Upgrades that survive a change of kind (promotion). */
  static carried_over(owned, newKind) {
    const out = [];
    for (const id of owned) if (Upgrades.applies_to(String(id), newKind)) out.push(id);
    return out;
  }
}
