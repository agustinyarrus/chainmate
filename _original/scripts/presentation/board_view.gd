class_name BoardView
extends Node3D



enum Mark{NONE, MOVE, CAPTURE, CHAIN, SELECTED, HOVER, HINT, CURSOR, REACH, DANGER}

const TILE_TOP: = 0.06
const TILE_SIZE: = 0.965
const TILE_HEIGHT: = 0.16
const STATE_INDEX: = {"": 0, "enchanted": 1, "corrupted": 2, "frozen": 3}

var _tile_materials: Dictionary = {}
var _marks: Dictionary = {}
var _cursors: Dictionary = {}
var _arc_mesh: MeshInstance3D
var _arc_material: ShaderMaterial
var _tint_tweens: Dictionary = {}


static func cell_to_world(cell: Vector2i, height: = TILE_TOP) -> Vector3:
	return Vector3(cell.x - (Board.SIZE - 1) * 0.5, height, cell.y - (Board.SIZE - 1) * 0.5)


static func world_to_cell(point: Vector3) -> Vector2i:
	return Vector2i(floori(point.x + Board.SIZE * 0.5), floori(point.z + Board.SIZE * 0.5))


func _ready() -> void :
	var tile_shader: Shader = load("res://shaders/tile.gdshader")
	var mark_shader: Shader = load("res://shaders/highlight.gdshader")
	var tile_mesh: = Arena.tile_mesh()
	var quad: = PlaneMesh.new()
	quad.size = Vector2(TILE_SIZE, TILE_SIZE)
	for y in Board.SIZE:
		for x in Board.SIZE:
			var cell: = Vector2i(x, y)
			var light: = (x + y) % 2 == 0
			var tile: = MeshInstance3D.new()
			tile.mesh = tile_mesh
			tile.position = cell_to_world(cell, TILE_TOP - TILE_HEIGHT * 0.5)
			var material: = ShaderMaterial.new()
			material.shader = tile_shader
			material.set_shader_parameter("base_color", Palette.TILE_LIGHT if light else Palette.TILE_DARK)
			material.set_shader_parameter("roughness_base", 0.78 if light else 0.62)
			material.set_shader_parameter("variation", fposmod(sin(float(x * 13 + y * 7) * 12.9898) * 43758.5453, 1.0))
			material.set_shader_parameter("tile_state", 0)
			tile.material_override = material
			add_child(tile)
			_tile_materials[cell] = material
			_marks[cell] = _overlay(quad, mark_shader, cell, 0.004, (x * 7 + y * 3) * 0.37)
			_cursors[cell] = _overlay(quad, mark_shader, cell, 0.007, 0.0)
	_arc_mesh = MeshInstance3D.new()
	_arc_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_arc_material = ShaderMaterial.new()
	_arc_material.shader = load("res://shaders/route.gdshader")
	_arc_mesh.material_override = _arc_material
	_arc_mesh.visible = false
	add_child(_arc_mesh)


func _overlay(quad: PlaneMesh, shader: Shader, cell: Vector2i, lift: float, phase: float) -> ShaderMaterial:
	var node: = MeshInstance3D.new()
	node.mesh = quad
	node.position = cell_to_world(cell, TILE_TOP + lift)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material: = ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("mode", Mark.NONE)
	material.set_shader_parameter("phase", phase)
	node.material_override = material
	add_child(node)
	return material



func cell_from_ray(origin: Vector3, direction: Vector3) -> Vector2i:
	if absf(direction.y) < 0.0001:
		return Vector2i(-1, -1)
	var distance: = (TILE_TOP - origin.y) / direction.y
	if distance < 0.0:
		return Vector2i(-1, -1)
	var cell: = world_to_cell(origin + direction * distance)
	return cell if Board.in_bounds(cell) else Vector2i(-1, -1)



func show_terrain(board: Board) -> void :
	for cell in _tile_materials:
		_tile_materials[cell].set_shader_parameter("tile_state", STATE_INDEX[board.tile(cell)])


func clear_marks() -> void :
	for cell in _marks:
		_marks[cell].set_shader_parameter("mode", Mark.NONE)


func mark(cell: Vector2i, mode: Mark, color: Color, strength: = 1.0) -> void :
	var material: ShaderMaterial = _marks[cell]
	var contrast: bool = Settings.get_value("high_contrast")
	material.set_shader_parameter("mode", mode)
	material.set_shader_parameter("color", color)
	material.set_shader_parameter("accent", Palette.THREAT)
	material.set_shader_parameter("strength", strength * (1.35 if contrast else 1.0))
	material.set_shader_parameter("glow", 2.1 if contrast else 1.6)


func set_cursor(cell: Vector2i, mode: Mark, color: Color) -> void :
	clear_cursor()
	if Board.in_bounds(cell):
		var material: ShaderMaterial = _cursors[cell]
		material.set_shader_parameter("mode", mode)
		material.set_shader_parameter("color", color)
		material.set_shader_parameter("strength", 1.0)


func clear_cursor() -> void :
	for cell in _cursors:
		_cursors[cell].set_shader_parameter("mode", Mark.NONE)



func show_arc(from: Vector2i, to: Vector2i, jump: bool, color: Color) -> void :
	var start: = cell_to_world(from, TILE_TOP + 0.03)
	var end: = cell_to_world(to, TILE_TOP + 0.03)
	var height: = 0.7 if jump else 0.18
	var samples: = 18
	var points: = PackedVector3Array()
	for s in samples + 1:
		var t: = float(s) / samples
		var point: = start.lerp(end, t)
		point.y += sin(PI * t) * height
		points.append(point)
	_arc_mesh.mesh = MeshKit.ribbon(points, 0.12)
	_arc_material.set_shader_parameter("color", color)
	_arc_mesh.visible = true


func hide_arc() -> void :
	_arc_mesh.visible = false



func pulse_tile(cell: Vector2i, color: Color, strength: = 0.55, duration: = 0.6) -> void :
	var material: ShaderMaterial = _tile_materials[cell]
	if _tint_tweens.has(cell) and _tint_tweens[cell].is_valid():
		_tint_tweens[cell].kill()
	material.set_shader_parameter("tint_color", color)
	var tween: = create_tween()
	tween.tween_method( func(v: float) -> void : material.set_shader_parameter("tint_strength", v), strength, 0.0, duration).set_ease(Tween.EASE_OUT)
	_tint_tweens[cell] = tween
