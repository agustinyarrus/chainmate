class_name Upgrades
extends RefCounted


const ALL: Array[String] = ["pawn", "knight", "bishop", "rook", "queen", "king"]
const NOT_KING: Array[String] = ["pawn", "knight", "bishop", "rook", "queen"]



const CATALOGUE: = {
	"chain": {"name": "Chain Capture", "kinds": ALL, "max": 2, 
		"desc": "After capturing, this piece may capture again.", "short": "Capture again after a capture."}, 
	"momentum": {"name": "Momentum", "kinds": ALL, "max": 1, 
		"desc": "After moving to an empty square, this piece may move again.", "short": "Move again after a quiet move."}, 
	"ward": {"name": "Ward", "kinds": NOT_KING, "max": 1, 
		"desc": "The first capture against this piece each encounter fails.", "short": "Survives one capture per encounter."}, 
	"veteran": {"name": "Veteran", "kinds": ALL, "max": 1, 
		"desc": "Gains 1 extra XP from every capture.", "short": "+1 XP per capture."}, 
	"extended_range": {"name": "Extended Range", "kinds": ["knight"], "max": 1, 
		"desc": "Also jumps three and one, as well as two and one.", "short": "Also jumps (3, 1)."}, 
	"charge": {"name": "Charge", "kinds": ["knight"], "max": 1, 
		"desc": "After capturing, may make one more move to an empty square.", "short": "Strike, then reposition."}, 
	"piercing": {"name": "Piercing", "kinds": ["rook", "bishop", "queen"], "max": 1, 
		"desc": "Captures may pass through one piece in the line.", "short": "Capture through one piece."}, 
	"siege_step": {"name": "Siege Step", "kinds": ["rook"], "max": 1, 
		"desc": "Also steps one square diagonally.", "short": "Adds diagonal steps."}, 
	"side_step": {"name": "Side Step", "kinds": ["bishop"], "max": 1, 
		"desc": "Also steps one square orthogonally.", "short": "Adds straight steps."}, 
	"rebellion": {"name": "Rebellion", "kinds": ["pawn"], "max": 1, 
		"desc": "Captures diagonally forward and backward, and may step sideways.", "short": "Captures in all diagonals."}, 
	"vanguard": {"name": "Vanguard", "kinds": ["pawn"], "max": 1, 
		"desc": "May always advance two squares.", "short": "Always double-steps."}, 
	"royal_stride": {"name": "Royal Stride", "kinds": ["king"], "max": 1, 
		"desc": "Moves up to two squares in a straight line.", "short": "King moves two squares."}, 
	"early_promotion": {"name": "Pawn Storm", "kinds": ["pawn"], "max": 0, "hidden": true, 
		"desc": "Promotes one rank early.", "short": "Promotes early."}, 
}


static func exists(id: String) -> bool:
	return CATALOGUE.has(id)


static func info(id: String) -> Dictionary:
	return CATALOGUE[id]


static func display_name(id: String) -> String:
	return str(CATALOGUE[id].name)


static func applies_to(id: String, kind: String) -> bool:
	return Array(CATALOGUE[id].kinds).has(kind)



static func pool_for(kind: String, owned: Array) -> Array[String]:
	var out: Array[String] = []
	for id in CATALOGUE:
		if applies_to(id, kind) and owned.count(id) < int(CATALOGUE[id].max) and not CATALOGUE[id].has("hidden"):
			out.append(id)
	return out



static func carried_over(owned: Array, new_kind: String) -> Array:
	var out: = []
	for id in owned:
		if applies_to(str(id), new_kind):
			out.append(id)
	return out
