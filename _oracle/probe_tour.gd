extends RefCounted
## Oracle probe — the game's own capture tours (`--capture`, autopilot.gd) made repeatable.
##
## A shipped launch seeds the engine's global random stream from the clock, and three looks of the
## scene draw from it: the wave phase of every banner, the seed of every candle flame and the idle
## phase of every piece (plus the flight of shattered shards). This probe seeds that stream with a
## known number right where a normal launch would still be starting (the first autoload's _ready), so
## the tour becomes a pure function of its arguments; the port seeds its stream the same way
## (`?rngseed=`), and both captures can be compared frame against frame.
##
##   ChainmateOracle.exe --fixed-fps 60 -- --oracle=<this file> --rngseed=7 --capture --out=<folder> [--arena…] [--trace]
##
## tools/capture-original.ps1 builds that command line. With --fixed-fps every frame advances exactly
## 1/60 s, the port's capture clock. The tour ends the engine itself (Autopilot._finish → quit).
##
## --trace prints the state behind the pictures as TRACE lines, read at the start of every frame
## (process_frame, before any _process): every holder of a draw from the global stream the frame it
## appears — cloth `phase` and flame `seed` shader parameters, particle seeds (again after a reseed),
## piece idle phases `_time` — which together fingerprint the stream's schedule; the hovered control
## and the focus owner whenever they change; and at every shot the halos (phase, turn, height, spark
## seed). The port prints the same lines (src/dev/trace.js) and tools/trace-compare.mjs lines the two up.

const DEFAULT_GLOBAL_SEED := 7
const AUTOPILOT_SCRIPT := "res://scripts/presentation/autopilot.gd"
## The shaders whose parameter is a draw of the global stream (arena_props.gd), and that parameter.
const DRAWN_PARAMETERS := {"res://shaders/cloth.gdshader": "phase", "res://shaders/flame.gdshader": "seed"}

var _frame := 0
var _last_shot := -1
var _seen_views := {}
var _seen_draws := {}
var _last_gui := {"hover": "", "focus": ""}


func run(host: Node) -> void:
	# What Settings._ready does on a capture launch; the oracle hook skipped it to run this probe.
	host._register_input()
	host.apply.call_deferred()
	seed(_global_seed())
	print("TOUR global seed %d" % _global_seed())
	# The desktop's own input must not reach the tour: a new window takes the keyboard focus even off
	# screen, and whatever is typed meanwhile would press the game's keys (a board cursor appeared in
	# a reference that way). The autopilot's events go through Viewport.push_input and are unaffected.
	DisplayServer.window_set_input_event_callback(_drop_os_input)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_NO_FOCUS, true)
	var tracing := OS.get_cmdline_user_args().has("--trace")
	if tracing:
		_hook_mouse_enters(host.get_tree())
	# Keep the hook waiting: returning would quit before the tour has even started.
	while true:
		await host.get_tree().process_frame
		if tracing:
			_trace(host.get_tree())


func _drop_os_input(_event: InputEvent) -> void:
	pass


func _autopilot(tree: SceneTree) -> Node:
	var main := tree.current_scene
	if main == null:
		return null
	for child in main.get_children():
		var script: Script = child.get_script()
		if script != null and script.resource_path == AUTOPILOT_SCRIPT:
			return child
	return null


## Every node holding a draw of the global stream, in find_children's preorder, printed once per value.
func _trace_draws(main: Node) -> void:
	for node in main.find_children("*", "", true, false):
		if node is GPUParticles3D:
			var key := "%d:%d" % [node.get_instance_id(), node.seed]
			if not _seen_draws.has(key):
				_seen_draws[key] = true
				print("TRACE draw frame=%d kind=particles path=%s value=%d" % [_frame, main.get_path_to(node), node.seed])
		elif node is GeometryInstance3D and node.material_override is ShaderMaterial and node.material_override.shader != null:
			var parameter: String = DRAWN_PARAMETERS.get(node.material_override.shader.resource_path, "")
			if parameter == "":
				continue
			var key := "%d:%s" % [node.get_instance_id(), parameter]
			if not _seen_draws.has(key):
				_seen_draws[key] = true
				var value: float = node.material_override.get_shader_parameter(parameter)
				print("TRACE draw frame=%d kind=%s path=%s value=%.12f" % [_frame, parameter, main.get_path_to(node), value])


## A control as the path of its child indices under the scene (internal children left out, -1 for an
## internal one) and its text, spaces as underscores: the same string in both builds.
func _describe(control: Control, main: Node) -> String:
	if control == null:
		return "-"
	var steps: Array[String] = []
	var node: Node = control
	while node != null and node != main:
		var parent := node.get_parent()
		steps.push_front(str(parent.get_children().find(node)) if parent != null else "0")
		node = parent
	var text := ""
	if "text" in control:
		text = str(control.get("text")).strip_edges()
	return "%s:%s" % ["/".join(steps), text.replace(" ", "_").replace("\n", "_")]


func _rect(control: Control) -> String:
	var r := control.get_global_rect()
	return "%.1f,%.1f,%.1f,%.1f" % [r.position.x, r.position.y, r.size.x, r.size.y]


## Every Control that the mouse enters, at that very moment (inside the input event, before any
## deferred layout): its global rect; for the one now hovered, its siblings' rects too.
func _hook_mouse_enters(tree: SceneTree) -> void:
	tree.node_added.connect(func(node: Node) -> void:
		if node is Control:
			node.mouse_entered.connect(_on_mouse_entered.bind(node)))


func _on_mouse_entered(control: Control) -> void:
	var tree := control.get_tree()
	var main := tree.current_scene
	print("TRACE enter frame=%d control=%s rect=%s" % [_frame, _describe(control, main), _rect(control)])
	if control != tree.root.gui_get_hovered_control() or control.get_parent() == null:
		return
	for sibling in control.get_parent().get_children():
		if sibling is Control:
			print("TRACE sibling frame=%d control=%s rect=%s" % [_frame, _describe(sibling, main), _rect(sibling)])


## The hovered control and the focus owner, whenever either changes.
func _trace_gui(tree: SceneTree) -> void:
	var main := tree.current_scene
	for what in ["hover", "focus"]:
		var control: Control = tree.root.gui_get_hovered_control() if what == "hover" else tree.root.gui_get_focus_owner()
		var described := _describe(control, main)
		if described != _last_gui[what]:
			_last_gui[what] = described
			print("TRACE gui frame=%d what=%s control=%s" % [_frame, what, described])


func _trace(tree: SceneTree) -> void:
	_frame += 1
	var pilot := _autopilot(tree)
	if pilot == null:
		return
	_trace_draws(tree.current_scene)
	_trace_gui(tree)
	var views: Array = tree.current_scene.pieces_root.get_children()
	for view in views:
		var key: int = view.get_instance_id()
		if not _seen_views.has(key):
			_seen_views[key] = true
			print("TRACE spawn frame=%d id=%s time=%.12f" % [_frame, view.piece_id, view._time])
	if pilot._index == _last_shot:
		return
	_last_shot = pilot._index
	print("TRACE shot frame=%d index=%d" % [_frame, pilot._index])
	for view in views:
		if view._halo == null or view.is_queued_for_deletion():
			continue
		var sparks: GPUParticles3D = null
		for child in view._halo.get_children():
			if child is GPUParticles3D:
				sparks = child
		print("TRACE halo id=%s time=%.12f turn=%.9f height=%.9f seed=%d" % [view.piece_id, view._time, view._halo.rotation.y, view._halo.position.y, sparks.seed])


func _global_seed() -> int:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--rngseed="):
			return int(arg.trim_prefix("--rngseed="))
	return DEFAULT_GLOBAL_SEED
