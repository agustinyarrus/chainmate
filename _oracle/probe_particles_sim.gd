extends RefCounted
## Oracle probe — the particle simulation itself. Three systems like the game's (a capture burst, a
## halo's ring of sparks, the unused candle flame), each with a fixed seed, at the scene's origin in
## front of the menu camera; after every frame, GPUParticles3D.capture_aabb(): the box of every
## particle that has started, read back from the GPU (grown by the quad's size). The port's
## simulation must draw the same boxes (test/particles.test.mjs).
##
##   node tools/oracle.mjs particles_sim --windowed --fixed-fps 60

const FRAMES := 120
const SETTLE_FRAMES := 30


func run(host: Node) -> void:
	for i in SETTLE_FRAMES:
		await host.get_tree().process_frame
	var scene := host.get_tree().current_scene
	var systems := {"burst": _burst(), "halo": _halo(), "flame": _flame()}
	for name in systems:
		scene.add_child(systems[name])
	systems["burst"].emitting = true
	for frame in range(1, FRAMES + 1):
		await host.get_tree().process_frame
		var row := {"k": "frame", "frame": frame}
		for name in systems:
			var box: AABB = systems[name].capture_aabb()
			row[name] = [box.position.x, box.position.y, box.position.z, box.size.x, box.size.y, box.size.z]
		print("ORACLE ", JSON.stringify(row))


func _quad(size: float) -> QuadMesh:
	var quad := QuadMesh.new()
	quad.size = Vector2(size, size)
	return quad


func _burst() -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.use_fixed_seed = true
	particles.seed = 12345
	particles.one_shot = true
	particles.explosiveness = 0.95
	particles.amount = 28
	particles.lifetime = 0.8
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	process.emission_sphere_radius = 0.15
	process.direction = Vector3.UP
	process.spread = 75.0
	process.initial_velocity_min = 1.6
	process.initial_velocity_max = 3.2
	process.gravity = Vector3(0, -6.5, 0)
	process.damping_min = 1.0
	process.damping_max = 2.5
	process.scale_min = 0.5
	process.scale_max = 1.2
	particles.process_material = process
	particles.draw_pass_1 = _quad(0.09)
	return particles


func _halo() -> GPUParticles3D:
	var sparks := GPUParticles3D.new()
	sparks.use_fixed_seed = true
	sparks.seed = 777
	sparks.amount = 14
	sparks.lifetime = 1.6
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	process.emission_ring_axis = Vector3.UP
	process.emission_ring_radius = 0.38
	process.emission_ring_inner_radius = 0.3
	process.emission_ring_height = 0.05
	process.direction = Vector3.UP
	process.spread = 25.0
	process.initial_velocity_min = 0.08
	process.initial_velocity_max = 0.25
	process.gravity = Vector3(0, 0.05, 0)
	process.scale_min = 0.5
	process.scale_max = 1.0
	sparks.process_material = process
	sparks.draw_pass_1 = _quad(0.05)
	return sparks


func _flame() -> GPUParticles3D:
	var flame := GPUParticles3D.new()
	flame.use_fixed_seed = true
	flame.seed = 4242
	flame.amount = 36
	flame.lifetime = 0.9
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	process.emission_sphere_radius = 0.14
	process.direction = Vector3.UP
	process.spread = 12.0
	process.initial_velocity_min = 0.45
	process.initial_velocity_max = 0.85
	process.gravity = Vector3(0, 0.7, 0)
	process.scale_min = 0.7
	process.scale_max = 1.25
	flame.process_material = process
	flame.draw_pass_1 = _quad(0.32)
	return flame
