class_name ChessRules
extends RefCounted



const KINDS: Array[String] = ["pawn", "knight", "bishop", "rook", "queen", "king"]
const ROYAL: Array[String] = ["queen", "king"]
const MATERIAL: = {"pawn": 1, "knight": 3, "bishop": 3, "rook": 5, "queen": 9, "king": 0}


const PIECE_INFO: = {
	"pawn": {"name": "Pawn", "move": "Forward one (two from home). Captures diagonally forward.", "flavor": "Small steps change everything."}, 
	"rook": {"name": "Rook", "move": "Any distance in a straight line.", "flavor": "Hold the line."}, 
	"knight": {"name": "Knight", "move": "L-shaped (2, 1), jumping over pieces.", "flavor": "Find another way."}, 
	"bishop": {"name": "Bishop", "move": "Any distance diagonally.", "flavor": "See further."}, 
	"queen": {"name": "Queen", "move": "Any distance in any straight line.", "flavor": "Make it happen."}, 
	"king": {"name": "King", "move": "One square in any direction.", "flavor": "Keep going."}, 
}

const KNIGHT_JUMPS: Array[Vector2i] = [
	Vector2i(1, 2), Vector2i(2, 1), Vector2i(2, -1), Vector2i(1, -2), 
	Vector2i(-1, -2), Vector2i(-2, -1), Vector2i(-2, 1), Vector2i(-1, 2), 
]
const LONG_JUMPS: Array[Vector2i] = [
	Vector2i(1, 3), Vector2i(3, 1), Vector2i(3, -1), Vector2i(1, -3), 
	Vector2i(-1, -3), Vector2i(-3, -1), Vector2i(-3, 1), Vector2i(-1, 3), 
]
const EIGHT_WAYS: Array[Vector2i] = [
	Vector2i(0, -1), Vector2i(1, -1), Vector2i(1, 0), Vector2i(1, 1), 
	Vector2i(0, 1), Vector2i(-1, 1), Vector2i(-1, 0), Vector2i(-1, -1), 
]
const ORTHOGONAL: Array[Vector2i] = [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]
const DIAGONAL: Array[Vector2i] = [Vector2i(1, -1), Vector2i(1, 1), Vector2i(-1, 1), Vector2i(-1, -1)]


static func forward(friendly: bool) -> int:
	return -1 if friendly else 1


static func pawn_home_row(friendly: bool) -> int:
	return Board.SIZE - 2 if friendly else 1


static func promotion_row(piece: Dictionary) -> int:
	var early: bool = piece.upgrades.has("early_promotion")
	if piece.friendly:
		return 1 if early else 0
	return Board.SIZE - 2 if early else Board.SIZE - 1


static func enterable(board: Board, cell: Vector2i) -> bool:
	return Board.in_bounds(cell) and board.tile(cell) != "frozen"




static func sheltered(board: Board, cell: Vector2i, friendly: bool) -> bool:
	return friendly and board.tile(cell) == "enchanted"


static func can_capture(board: Board, piece: Dictionary, target: Dictionary) -> bool:
	return not target.is_empty() and target.friendly != piece.friendly and not sheltered(board, target.cell, target.friendly)



static func pseudo_moves(board: Board, piece: Dictionary, quiet: = true, captures: = true) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var upgrades: Array = piece.upgrades
	var piercing: = upgrades.has("piercing")
	match piece.kind:
		"knight":
			_steps(board, piece, KNIGHT_JUMPS, out, quiet, captures)
			if upgrades.has("extended_range"):
				_steps(board, piece, LONG_JUMPS, out, quiet, captures)
		"king":
			_rays(board, piece, EIGHT_WAYS, 2 if upgrades.has("royal_stride") else 1, false, out, quiet, captures)
		"rook":
			_rays(board, piece, ORTHOGONAL, Board.SIZE, piercing, out, quiet, captures)
			if upgrades.has("siege_step"):
				_steps(board, piece, DIAGONAL, out, quiet, captures)
		"bishop":
			_rays(board, piece, DIAGONAL, Board.SIZE, piercing, out, quiet, captures)
			if upgrades.has("side_step"):
				_steps(board, piece, ORTHOGONAL, out, quiet, captures)
		"queen":
			_rays(board, piece, EIGHT_WAYS, Board.SIZE, piercing, out, quiet, captures)
		"pawn":
			_pawn(board, piece, out, quiet, captures)
	if piece.kind == "king":
		var safe: Array[Vector2i] = []
		for cell in out:
			if board.tile(cell) != "corrupted":
				safe.append(cell)
		out = safe
	if marches(piece):
		return _no_retreat(piece, out)
	return out




static func marches(piece: Dictionary) -> bool:
	return not piece.friendly


static func _no_retreat(piece: Dictionary, cells: Array[Vector2i]) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for cell in cells:
		if cell.y >= piece.cell.y:
			out.append(cell)
	return out



static func attack_cells(board: Board, piece: Dictionary) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var upgrades: Array = piece.upgrades
	match piece.kind:
		"pawn":
			var dy: = forward(piece.friendly)
			var offsets: Array[Vector2i] = [Vector2i(-1, dy), Vector2i(1, dy)]
			if upgrades.has("rebellion"):
				offsets.append_array([Vector2i(-1, - dy), Vector2i(1, - dy)])
			for offset in offsets:
				var cell: Vector2i = piece.cell + offset
				if enterable(board, cell):
					out.append(cell)
		"knight":
			for offset in KNIGHT_JUMPS:
				_attack_step(board, piece.cell + offset, out)
			if upgrades.has("extended_range"):
				for offset in LONG_JUMPS:
					_attack_step(board, piece.cell + offset, out)
		"king":
			_attack_rays(board, piece, EIGHT_WAYS, 2 if upgrades.has("royal_stride") else 1, false, out)
		"rook":
			_attack_rays(board, piece, ORTHOGONAL, Board.SIZE, upgrades.has("piercing"), out)
			if upgrades.has("siege_step"):
				for offset in DIAGONAL:
					_attack_step(board, piece.cell + offset, out)
		"bishop":
			_attack_rays(board, piece, DIAGONAL, Board.SIZE, upgrades.has("piercing"), out)
			if upgrades.has("side_step"):
				for offset in ORTHOGONAL:
					_attack_step(board, piece.cell + offset, out)
		"queen":
			_attack_rays(board, piece, EIGHT_WAYS, Board.SIZE, upgrades.has("piercing"), out)
	var reachable: Array[Vector2i] = []
	var retreat_limit: int = piece.cell.y if marches(piece) else -1
	for cell in out:
		if sheltered(board, cell, not piece.friendly) or (piece.kind == "king" and board.tile(cell) == "corrupted") or cell.y < retreat_limit:
			continue
		reachable.append(cell)
	return reachable


static func is_attacked(board: Board, cell: Vector2i, by_friendly: bool) -> bool:
	for piece in board.pieces:
		if piece.friendly == by_friendly and attack_cells(board, piece).has(cell):
			return true
	return false


static func in_check(board: Board, friendly: bool) -> bool:
	var king: = board.king(friendly)
	return not king.is_empty() and is_attacked(board, king.cell, not friendly)




static func legal_moves(board: Board, piece: Dictionary, quiet: = true, captures: = true) -> Array[Vector2i]:
	var candidates: = pseudo_moves(board, piece, quiet, captures)
	if not piece.friendly or board.king(true).is_empty():
		return candidates
	var out: Array[Vector2i] = []
	for cell in candidates:
		var record: = perform(board, piece.id, cell)
		var safe: = not in_check(board, piece.friendly)
		revert(board, record)
		if safe:
			out.append(cell)
	return out


static func has_legal_move(board: Board, friendly: bool) -> bool:
	for piece in board.side(friendly):
		if not legal_moves(board, piece).is_empty():
			return true
	return false




static func perform(board: Board, id: String, to: Vector2i, shielded: = false) -> Dictionary:
	var piece: = board.piece_by_id(id)
	var record: = {
		"id": id, 
		"friendly": piece.friendly, 
		"kind": piece.kind, 
		"from": piece.cell, 
		"to": to, 
		"captured": {}, 
		"bounced": false, 
		"shielded": false, 
		"promoted": false, 
		"upgrades_before": piece.upgrades.duplicate(), 
	}
	var target: = board.piece_at(to)
	if not target.is_empty():
		if shielded:
			record.bounced = true
			record.shielded = true
			record.target_id = target.id
			return record
		if int(target.ward) > 0:
			target.ward = int(target.ward) - 1
			record.bounced = true
			record.target_id = target.id
			return record
		var captured: Dictionary = target.duplicate()
		captured.upgrades = target.upgrades.duplicate()
		record.captured = captured
		record.captured_index = board.index_of(target.id)
		board.remove(target.id)
	board.move(id, to)
	if piece.kind == "pawn" and to.y == promotion_row(piece):
		piece.kind = "queen"
		piece.upgrades = Upgrades.carried_over(piece.upgrades, "queen")
		record.promoted = true
	return record


static func revert(board: Board, record: Dictionary) -> void :
	if record.bounced:
		if not record.shielded:
			var target: = board.piece_by_id(str(record.target_id))
			target.ward = int(target.ward) + 1
		return
	var piece: = board.piece_by_id(str(record.id))
	piece.kind = record.kind
	piece.upgrades = record.upgrades_before.duplicate()
	board.move(str(record.id), record.from)
	if not record.captured.is_empty():
		var restored: Dictionary = record.captured.duplicate()
		restored.upgrades = record.captured.upgrades.duplicate()
		board.insert(restored, int(record.captured_index))


static func _steps(board: Board, piece: Dictionary, offsets: Array[Vector2i], out: Array[Vector2i], quiet: bool, captures: bool) -> void :
	for offset in offsets:
		var cell: Vector2i = piece.cell + offset
		if not enterable(board, cell):
			continue
		var other: = board.piece_at(cell)
		if other.is_empty():
			if quiet:
				out.append(cell)
		elif captures and can_capture(board, piece, other):
			out.append(cell)


static func _rays(board: Board, piece: Dictionary, directions: Array[Vector2i], reach: int, piercing: bool, 
		out: Array[Vector2i], quiet: bool, captures: bool) -> void :
	for direction in directions:
		var cell: Vector2i = piece.cell + direction
		var travelled: = 0
		var pierced: = false
		while travelled < reach and enterable(board, cell):
			travelled += 1
			var other: = board.piece_at(cell)
			if other.is_empty():
				if quiet and not pierced:
					out.append(cell)
			else:
				if captures and can_capture(board, piece, other):
					out.append(cell)
				if piercing and not pierced:
					pierced = true
				else:
					break
			cell += direction


static func _pawn(board: Board, piece: Dictionary, out: Array[Vector2i], quiet: bool, captures: bool) -> void :
	var dy: = forward(piece.friendly)
	var upgrades: Array = piece.upgrades
	if quiet:
		var one: Vector2i = piece.cell + Vector2i(0, dy)
		if enterable(board, one) and board.is_free(one):
			out.append(one)
			var two: Vector2i = piece.cell + Vector2i(0, dy * 2)
			var may_double: bool = piece.cell.y == pawn_home_row(piece.friendly) or upgrades.has("vanguard")
			if may_double and enterable(board, two) and board.is_free(two):
				out.append(two)
		if upgrades.has("rebellion"):
			for dx in [-1, 1]:
				var beside: Vector2i = piece.cell + Vector2i(dx, 0)
				if enterable(board, beside) and board.is_free(beside):
					out.append(beside)
	if captures:
		var offsets: Array[Vector2i] = [Vector2i(-1, dy), Vector2i(1, dy)]
		if upgrades.has("rebellion"):
			offsets.append_array([Vector2i(-1, - dy), Vector2i(1, - dy)])
		for offset in offsets:
			var cell: Vector2i = piece.cell + offset
			if enterable(board, cell) and can_capture(board, piece, board.piece_at(cell)):
				out.append(cell)


static func _attack_step(board: Board, cell: Vector2i, out: Array[Vector2i]) -> void :
	if enterable(board, cell):
		out.append(cell)


static func _attack_rays(board: Board, piece: Dictionary, directions: Array[Vector2i], reach: int, piercing: bool, out: Array[Vector2i]) -> void :
	for direction in directions:
		var cell: Vector2i = piece.cell + direction
		var travelled: = 0
		var pierced: = false
		while travelled < reach and enterable(board, cell):
			travelled += 1
			var other: = board.piece_at(cell)
			if not pierced or not other.is_empty():
				out.append(cell)
			if not other.is_empty():
				if piercing and not pierced:
					pierced = true
				else:
					break
			cell += direction
