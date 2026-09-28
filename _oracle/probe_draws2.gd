extends RefCounted
## Oracle probe — does seeding a RandomNumberGenerator, or randomize(), touch the global stream?

func run(_host: Node) -> void:
	seed(7)
	var r := RandomNumberGenerator.new()
	r.seed = 7
	print("ORACLE ", JSON.stringify({"k": "rng.seed = 7", "next": randi()}))
	seed(7)
	var q := RandomNumberGenerator.new()
	q.state = 12345
	print("ORACLE ", JSON.stringify({"k": "rng.state = 12345", "next": randi()}))
	seed(7)
	var w := RandomNumberGenerator.new()
	var _x := w.randi()
	print("ORACLE ", JSON.stringify({"k": "rng.randi()", "next": randi()}))
	seed(7)
	var h := hash("arena-outpost")
	print("ORACLE ", JSON.stringify({"k": "hash()", "next": randi(), "h": h}))
