extends RefCounted
## Oracle probe — which engine constructors draw from the global random stream (seed(7) first).

func _stream_after(label: String, make: Callable) -> void:
	seed(7)
	var before := randi()
	seed(7)
	var made: Variant = make.call()
	var after := randi()
	var extra := {}
	if made is GPUParticles3D:
		extra["seed"] = made.seed
	print("ORACLE ", JSON.stringify({"k": label, "first_draw": before, "next_after": after, "extra": extra}))
	if made is Node:
		made.free()


func run(_host: Node) -> void:
	_stream_after("nothing", func() -> Variant: return null)
	_stream_after("RandomNumberGenerator", func() -> Variant: return RandomNumberGenerator.new())
	_stream_after("GPUParticles3D", func() -> Variant: return GPUParticles3D.new())
	_stream_after("ParticleProcessMaterial", func() -> Variant: return ParticleProcessMaterial.new())
	_stream_after("MeshInstance3D", func() -> Variant: return MeshInstance3D.new())
	_stream_after("OmniLight3D", func() -> Variant: return OmniLight3D.new())
	_stream_after("Label3D", func() -> Variant: return Label3D.new())
	_stream_after("Timer", func() -> Variant: return Timer.new())
