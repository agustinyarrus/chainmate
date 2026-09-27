class_name Events
extends RefCounted






const CATALOGUE: = {
	"blunted_rack": {"title": "The Blunted Rack", 
		"text": "A weapon rack of notched blades, all dull but one. That one still takes an edge.", 
		"choices": [
			{"label": "Hone the blade", "desc": "A random piece gains a level.", "effect": "train_random", "requires": ""}, 
			{"label": "Sell the steel", "desc": "Gain 14 gold.", "effect": "gold", "amount": 14, "requires": ""}, 
		]}, 
	"horse_for_hire": {"title": "A Horse for Hire", 
		"text": "A knight in unmarked barding offers her lance to whoever pays first.", 
		"choices": [
			{"label": "Hire her", "desc": "Pay 12 gold. A knight joins your army.", "effect": "recruit", "kind": "knight", "cost": 12, "requires": "gold"}, 
			{"label": "Send her on", "desc": "Nothing happens.", "effect": "none", "requires": ""}, 
		]}, 
	"exchange_altar": {"title": "The Exchange Altar", 
		"text": "An altar carved as a chessboard. It takes a pawn, and gives back more than a pawn.", 
		"choices": [
			{"label": "Offer a pawn", "desc": "Lose a pawn. Two random pieces gain a level.", "effect": "sacrifice_pawn", "requires": "pawn"}, 
			{"label": "Bow and leave", "desc": "Your pieces are warded in the next encounter.", "effect": "fortify", "requires": ""}, 
		]}, 
	"rematch_well": {"title": "The Rematch Well", 
		"text": "Drop a coin, name the fallen, and the well offers a rematch.", 
		"choices": [
			{"label": "Call back the fallen", "desc": "Your most recently fallen piece returns.", "effect": "revive", "requires": "fallen"}, 
			{"label": "Fish out the coins", "desc": "Gain 8 gold.", "effect": "gold", "amount": 8, "requires": ""}, 
		]}, 
	"endgame_archive": {"title": "The Endgame Archive", 
		"text": "Shelves of endgame studies, the margins crowded with a dead master's notes.", 
		"choices": [
			{"label": "Study the endgames", "desc": "Every piece gains 1 XP.", "effect": "xp_all", "amount": 1, "requires": ""}, 
			{"label": "Take the rarest folio", "desc": "Gain a random relic.", "effect": "relic_random", "requires": ""}, 
		]}, 
	"blitz_hustler": {"title": "The Blitz Hustler", 
		"text": "A hustler slaps the clock. Ten gold says you cannot beat him in a minute.", 
		"choices": [
			{"label": "Play him for 10 gold", "desc": "Even odds: win 25 gold or lose the stake.", "effect": "gamble", "cost": 10, "win": 25, "requires": "gold"}, 
			{"label": "Walk past", "desc": "Nothing happens.", "effect": "none", "requires": ""}, 
		]}, 
	"turncoat_pawn": {"title": "The Turncoat Pawn", 
		"text": "An obsidian pawn has thrown down its spear and asks to change colours.", 
		"choices": [
			{"label": "Take it in", "desc": "A pawn joins your army.", "effect": "recruit", "kind": "pawn", "cost": 0, "requires": ""}, 
			{"label": "Turn it in", "desc": "Gain 6 gold.", "effect": "gold", "amount": 6, "requires": ""}, 
		]}, 
}


static func ids() -> Array[String]:
	var out: Array[String] = []
	for id in CATALOGUE:
		out.append(id)
	return out


static func info(id: String) -> Dictionary:
	return CATALOGUE[id]
