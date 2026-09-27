/**
 * Relics — port of scripts/core/relics.gd (catalogue order drives relic offers).
 */
export class Relics {
  static MAX_EQUIPPED = 6;
  static PRICE = { common: 9, uncommon: 13, rare: 18 };
  static RARITY_WEIGHT = { common: 6, uncommon: 3, rare: 1 };

  static CATALOGUE = {
    desperado_ribbon: { name: 'Desperado Ribbon', rarity: 'rare', icon: 'ribbon', desc: 'After a capture, the same piece may move again (once per turn).', flavor: 'Take what you can on the way out.' },
    kibitzers_whisper: { name: "Kibitzer's Whisper", rarity: 'common', icon: 'eye', desc: 'Moves onto squares the enemy attacks are marked, and hovering an enemy shows its reach.', flavor: 'Someone behind you always sees it first.' },
    appearance_fee: { name: 'Appearance Fee', rarity: 'common', icon: 'coin', desc: 'Gain 2 gold after each encounter.', flavor: 'Paid just for turning up.' },
    brilliancy_prize: { name: 'Brilliancy Prize', rarity: 'uncommon', icon: 'laurel', desc: 'Pieces gain 1 extra XP from every capture.', flavor: 'Awarded for the most beautiful move.' },
    fortress_stone: { name: 'Fortress Stone', rarity: 'uncommon', icon: 'shield', desc: 'The first capture against your army each encounter fails.', flavor: 'Some positions cannot be broken.' },
    clockmakers_key: { name: "Clockmaker's Key", rarity: 'rare', icon: 'key', desc: 'Once per encounter, take an extra turn before the enemy moves.', flavor: 'Wind your clock. Stop theirs.' },
    ransom_ledger: { name: 'Ransom Ledger', rarity: 'uncommon', icon: 'crown', desc: 'Capturing a queen or king grants 5 gold.', flavor: 'Every crown has a price.' },
    knights_tour_chart: { name: "Knight's Tour Chart", rarity: 'uncommon', icon: 'spur', desc: 'Your knights have Momentum.', flavor: 'Every square, once.' },
    fianchetto_glass: { name: 'Fianchetto Glass', rarity: 'uncommon', icon: 'lens', desc: 'Your bishops have Piercing.', flavor: 'The long diagonal sees everything.' },
    castling_deed: { name: 'Castling Deed', rarity: 'common', icon: 'seal', desc: 'Your rooks begin each encounter warded.', flavor: "The tower keeps the king's title." },
    queening_charter: { name: 'Queening Charter', rarity: 'uncommon', icon: 'banner', desc: 'Your pawns promote one rank early.', flavor: 'Signed in advance.' },
    salt_horn: { name: 'Salt Horn', rarity: 'common', icon: 'salt', desc: 'Corrupted tiles no longer destroy your pieces.', flavor: 'A pinch against the rot.' },
    forfeit_slip: { name: 'Forfeit Slip', rarity: 'common', icon: 'scroll', desc: 'Each encounter begins with one enemy pawn removed.', flavor: 'One of theirs failed to report.' },
    opening_book: { name: 'Worn Opening Book', rarity: 'common', icon: 'tome', desc: 'Your first turn of each encounter grants an extra move.', flavor: 'The first moves are already written.' },
    annotators_quill: { name: "Annotator's Quill", rarity: 'common', icon: 'quill', desc: 'Level-ups offer four choices instead of three.', flavor: '!? Worth a second look.' },
    patrons_chit: { name: "Patron's Chit", rarity: 'common', icon: 'chit', desc: 'Merchant prices are 25% lower.', flavor: "Put it on the club's account." },
    sealed_move: { name: 'Sealed Move', rarity: 'rare', icon: 'envelope', desc: 'Once per act, your first fallen piece returns after the encounter.', flavor: 'Adjourned, not lost.' },
    grandmaster_norm: { name: 'Grandmaster Norm', rarity: 'uncommon', icon: 'medal', desc: 'Pieces level up sooner (at 1, 3 and 6 XP).', flavor: 'One step closer to the title.' },
  };

  static exists(id) {
    return Object.prototype.hasOwnProperty.call(Relics.CATALOGUE, id);
  }

  static info(id) {
    return Relics.CATALOGUE[id];
  }

  static display_name(id) {
    return String(Relics.CATALOGUE[id].name);
  }

  static price(id, discounted = false) {
    const base = Relics.PRICE[Relics.CATALOGUE[id].rarity];
    return discounted ? Math.trunc(Math.ceil(base * 0.75)) : base;
  }

  static ids() {
    return Object.keys(Relics.CATALOGUE);
  }
}
