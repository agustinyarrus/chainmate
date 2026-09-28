extends RefCounted
## Oracle probe — GPUParticles3D bookkeeping the port reproduces: how many draws of the global random
## stream each emitter takes, its seed, and whether a one-shot burst made like vfx.gd's announces
## `finished`.

func run(host: Node) -> void:
	seed(7)
	var reference := RandomNumberGenerator.new()
	reference.seed = 7
	var first := GPUParticles3D.new()
	var after_new := reference.randi()
	print("ORACLE ", JSON.stringify({"k": "new", "seed": first.seed, "draw": after_new, "next_global": randi()}))
	# A burst like Vfx.burst: one_shot, then emitting = true once in the tree.
	var burst := GPUParticles3D.new()
	var seed_before := burst.seed
	burst.one_shot = true
	burst.explosiveness = 0.95
	burst.amount = 8
	burst.lifetime = 0.3
	burst.process_material = ParticleProcessMaterial.new()
	burst.draw_pass_1 = QuadMesh.new()
	host.add_child(burst)
	burst.emitting = true
	var finished := [false]
	burst.finished.connect(func() -> void: finished[0] = true)
	print("ORACLE ", JSON.stringify({"k": "burst", "seed_changed": burst.seed != seed_before, "emitting_after_set": burst.emitting}))
	for i in 90:
		await host.get_tree().process_frame
	print("ORACLE ", JSON.stringify({"k": "burst_later", "finished": finished[0], "emitting": burst.emitting}))
	# The same, but emitting switched off first: a real restart of the one-shot cycle.
	var again := GPUParticles3D.new()
	again.one_shot = true
	again.lifetime = 0.3
	again.process_material = ParticleProcessMaterial.new()
	again.draw_pass_1 = QuadMesh.new()
	host.add_child(again)
	again.emitting = false
	var before := again.seed
	again.emitting = true
	var finished_again := [false]
	again.finished.connect(func() -> void: finished_again[0] = true)
	for i in 90:
		await host.get_tree().process_frame
	print("ORACLE ", JSON.stringify({"k": "restarted", "seed_changed": again.seed != before, "finished": finished_again[0]}))
