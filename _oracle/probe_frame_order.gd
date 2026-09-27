extends RefCounted
## Oracle probe — the order in which the shipped engine runs one frame: the process_frame signal,
## deferred calls, _process, queued frees, timers, tweens, coroutine resumption and frame_post_draw.
## Each scenario is started from a precise phase and logs where its callbacks land, frame by frame.
## The port's SceneTree replays the same scenarios and must produce the same sequence.

var notes: Array = []
var base_frame := -1
var tree: SceneTree
var host_node: Node


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func note(what: String) -> void:
	notes.append([Engine.get_process_frames() - base_frame, what])


class Worker extends Node:
	var probe
	var ticks := 0

	func _process(_delta: float) -> void:
		ticks += 1
		probe.note("process %d" % ticks)
		if ticks == 1:
			probe.start_from_process(self)


func run(host: Node) -> void:
	host_node = host
	tree = host.get_tree()
	tree.process_frame.connect(func() -> void: note("process_frame"))
	RenderingServer.frame_post_draw.connect(func() -> void: note("post_draw"))
	var worker := Worker.new()
	worker.probe = self
	base_frame = Engine.get_process_frames() + 1
	host.add_child(worker)
	for i in 6:
		await tree.process_frame
	worker.queue_free()
	for i in 2:
		await tree.process_frame
	for entry in notes:
		_emit({"k": "note", "f": entry[0], "what": entry[1]})


## Everything below starts inside Worker._process on its first tick.
func start_from_process(worker: Node) -> void:
	(func() -> void: note("deferred from process")).call_deferred()
	var victim := Node.new()
	victim.tree_exiting.connect(func() -> void: note("victim freed (queued in process)"))
	worker.add_child(victim)
	victim.queue_free()
	tree.create_timer(0.0).timeout.connect(func() -> void: _on_timer_from_process(worker))
	tree.create_timer(0.0).timeout.connect(func() -> void: note("second timer from process"))
	var tween := worker.create_tween()
	tween.tween_callback(func() -> void: _on_tween_from_process(worker))
	tween.finished.connect(func() -> void: note("tween from process finished"))
	_coroutine_timer()
	_coroutine_frame()
	_coroutine_nested()
	note("process tick 1 done")


func _on_timer_from_process(worker: Node) -> void:
	note("timer from process")
	tree.create_timer(0.0).timeout.connect(func() -> void: note("timer from timer"))
	var tween := worker.create_tween()
	tween.tween_callback(func() -> void: note("tween from timer"))
	var victim := Node.new()
	victim.tree_exiting.connect(func() -> void: note("victim freed (queued in timer)"))
	worker.add_child(victim)
	victim.queue_free()
	(func() -> void: note("deferred from timer")).call_deferred()


func _on_tween_from_process(worker: Node) -> void:
	note("tween from process")
	var tween := worker.create_tween()
	tween.tween_callback(func() -> void: note("tween from tween"))
	tree.create_timer(0.0).timeout.connect(func() -> void: note("timer from tween"))
	(func() -> void: note("deferred from tween")).call_deferred()


func _coroutine_timer() -> void:
	note("coroutine timer: start")
	await tree.create_timer(0.0).timeout
	note("coroutine timer: resumed")
	await tree.create_timer(0.0).timeout
	note("coroutine timer: resumed again")


func _coroutine_frame() -> void:
	note("coroutine frame: start")
	await tree.process_frame
	note("coroutine frame: resumed")


func _coroutine_nested() -> void:
	note("coroutine nested: start")
	await _inner()
	note("coroutine nested: after inner")
	var tween := host_node.create_tween()
	tween.tween_interval(0.0)
	await tween.finished
	note("coroutine nested: after tween")


func _inner() -> void:
	note("inner: start")
	await tree.create_timer(0.0).timeout
	note("inner: resumed")
