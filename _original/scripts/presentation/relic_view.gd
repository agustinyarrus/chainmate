class_name RelicView
extends Node3D




const SCALE: = 1.6

var id: = ""

var spot: = Vector3.ZERO
var model: Node3D
var _holder: Node3D
var _tween: Tween
var _trigger_tween: Tween


func setup(relic_id: String) -> void :
	id = relic_id
	name = "Relic_" + id
	_holder = Node3D.new()
	_holder.scale = Vector3.ONE * SCALE
	add_child(_holder)
	_holder.add_child(RelicModels.dais(str(Relics.info(id).rarity)))
	model = RelicModels.build(id)
	model.position.y = RelicModels.DAIS_TOP
	_holder.add_child(model)



func top() -> Vector3:
	return global_position + Vector3.UP * 0.45 * SCALE



func drop_in(vfx: Vfx, delay: float) -> void :
	var rest: = spot
	position = rest + Vector3.UP * 1.8
	scale = Vector3.ONE * 0.6
	visible = false
	_restart()
	_tween.tween_interval(delay)
	_tween.tween_callback(show)
	_tween.tween_property(self, "position", rest, Settings.duration(0.5)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	_tween.parallel().tween_property(self, "scale", Vector3.ONE, Settings.duration(0.5))
	_tween.tween_callback( func() -> void :
		vfx.burst(global_position + Vector3.UP * 0.25, Palette.GOLD_BRIGHT, 30, 2.4, 0.07)
		vfx.flash(global_position, Palette.GOLD_BRIGHT, 3.0, 0.6, 2.4)
		vfx.dust(global_position)
		_holder.scale = Vector3(1.18, 0.78, 1.18) * SCALE)
	_tween.tween_property(_holder, "scale", Vector3.ONE * SCALE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)



func trigger(vfx: Vfx, color: Color) -> void :
	if _trigger_tween:
		_trigger_tween.kill()
	model.position.y = RelicModels.DAIS_TOP
	model.rotation.y = 0.0
	vfx.burst(top(), color, 20, 1.8, 0.06)
	vfx.flash(global_position, color, 2.6, 0.5, 2.2)
	_trigger_tween = create_tween()
	var rise: = Settings.duration(0.18)
	_trigger_tween.tween_property(model, "position:y", RelicModels.DAIS_TOP + 0.12, rise).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	if not Settings.get_value("reduced_motion"):
		_trigger_tween.parallel().tween_property(model, "rotation:y", TAU, Settings.duration(0.5)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_trigger_tween.tween_property(model, "position:y", RelicModels.DAIS_TOP, Settings.duration(0.32)).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	_trigger_tween.tween_callback( func() -> void : model.rotation.y = 0.0)



func slide_to(to: Vector3) -> void :
	spot = to
	_restart()
	_tween.tween_property(self, "position", to, Settings.duration(0.45)).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)



func place(at: Vector3) -> void :
	if _tween:
		_tween.kill()
	spot = at
	position = at
	scale = Vector3.ONE
	visible = true
	_holder.scale = Vector3.ONE * SCALE



func sink() -> void :
	_restart()
	_tween.tween_property(self, "scale", Vector3(0.01, 0.01, 0.01), Settings.duration(0.35)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
	_tween.tween_callback(queue_free)


func _restart() -> void :
	if _tween:
		_tween.kill()
	_tween = create_tween()
