class_name Tactics
extends RefCounted







const VALUE: = {"pawn": 100, "knight": 310, "bishop": 325, "rook": 500, "queen": 900, "king": 0}
const LOSS: = 100000.0
const LEVEL_VALUE: = 30.0
const UPGRADE_VALUE: = 22.0
const WARD_VALUE: = 70.0
const AGGRESSION: = 16.0
const PURSUIT: = 9.0
const THREAT: = 14.0




static func best_move(board: Board, friendly: bool, depth: int, rng: RandomNumberGenerator, noise: = 0.0, allowed: Array = []) -> Dictionary:
	var work: = board.clone()
	var kings: = {true: not work.king(true).is_empty(), false: not work.king(false).is_empty()}
	var candidates: Array[Dictionary] = []
	if allowed.is_empty():
		for piece in work.side(friendly):
			for cell in ChessRules.legal_moves(work, piece):
				candidates.append({"id": piece.id, "to": cell})
	else:
		for entry in allowed:
			candidates.append({"id": str(entry.id), "to": entry.to})
	if candidates.is_empty():
		return {}
	_order(work, candidates)
	var best: = {}
	var best_score: = - INF
	for move in candidates:
		var record: = ChessRules.perform(work, move.id, move.to)
		var score: = - _negamax(work, not friendly, depth - 1, - INF, INF, kings)
		ChessRules.revert(work, record)
		if noise > 0.0:
			score += rng.randf() * noise
		if score > best_score:
			best_score = score
			best = move
	best.score = best_score
	return best





static func evaluate(board: Board, friendly: bool) -> float:
	var score: = 0.0
	var player_king: = board.king(true)
	var enemies: = board.enemies()
	for piece in board.pieces:
		var value: float = VALUE[piece.kind]
		value += int(piece.level) * LEVEL_VALUE + piece.upgrades.size() * UPGRADE_VALUE + int(piece.ward) * WARD_VALUE
		var cell: Vector2i = piece.cell
		if piece.kind == "pawn":
			var advanced: = (Board.SIZE - 2 - cell.y) if piece.friendly else (cell.y - 1)
			value += advanced * 14.0
		elif piece.kind != "king":
			var from_centre: = absf(cell.x - 2.5) + absf(cell.y - 2.5)
			value += (5.0 - from_centre) * 5.0
		if piece.kind != "king":
			if not piece.friendly and not player_king.is_empty():
				value += (Board.SIZE - Board.distance(cell, player_king.cell)) * AGGRESSION
			elif piece.friendly and not enemies.is_empty():
				var nearest: = Board.SIZE
				for enemy in enemies:
					nearest = mini(nearest, Board.distance(cell, enemy.cell))
				value += (Board.SIZE - nearest) * PURSUIT
		match board.tile(cell):
			"corrupted":
				value *= 0.35
			"enchanted":
				value *= 1.1
		for target_cell in ChessRules.attack_cells(board, piece):
			var target: = board.piece_at(target_cell)
			if not target.is_empty() and target.friendly != piece.friendly and target.kind != "king":
				value += THREAT + maxf(0.0, VALUE[target.kind] - VALUE[piece.kind]) * 0.08
		score += value if piece.friendly == friendly else - value
	return score


static func _negamax(board: Board, friendly: bool, depth: int, alpha: float, beta: float, kings: Dictionary) -> float:
	var mine: = board.side(friendly)
	if mine.is_empty() or (kings[friendly] and board.king(friendly).is_empty()):
		return - LOSS - depth
	if board.side( not friendly).is_empty() or (kings[ not friendly] and board.king( not friendly).is_empty()):
		return LOSS + depth
	if depth <= 0:
		return evaluate(board, friendly)
	var moves: Array[Dictionary] = []
	for piece in mine:
		for cell in ChessRules.pseudo_moves(board, piece):
			moves.append({"id": piece.id, "to": cell})


	if kings[friendly] and ChessRules.in_check(board, friendly):
		var answers: Array[Dictionary] = []
		for move in moves:
			var record: = ChessRules.perform(board, move.id, move.to)
			if not ChessRules.in_check(board, friendly):
				answers.append(move)
			ChessRules.revert(board, record)
		if answers.is_empty():
			return - LOSS - depth
		moves = answers
	if moves.is_empty():
		return evaluate(board, friendly)
	_order(board, moves)
	var best: = - INF
	for move in moves:
		var record: = ChessRules.perform(board, move.id, move.to)
		var score: = - _negamax(board, not friendly, depth - 1, - beta, - alpha, kings)
		ChessRules.revert(board, record)
		if score > best:
			best = score
		if score > alpha:
			alpha = score
		if alpha >= beta:
			break
	return best



static func _order(board: Board, moves: Array[Dictionary]) -> void :
	for i in moves.size():
		var move: = moves[i]
		var target: = board.piece_at(move.to)
		move.priority = 0.0 if target.is_empty() else (1000.0 + VALUE[target.kind] + (10000.0 if target.kind == "king" else 0.0))
		move.index = i
	moves.sort_custom( func(a: Dictionary, b: Dictionary) -> bool:
		return a.priority > b.priority or (a.priority == b.priority and a.index < b.index))
