class_name RunMap
extends RefCounted



const STEPS: = 5
const STOP_TYPES: Array[String] = ["merchant", "rest", "unknown"]
const FIGHTS: Array[String] = ["encounter", "elite", "boss"]
const NODE_INFO: = {
	"encounter": {"name": "Encounter", "desc": "A standard fight."}, 
	"elite": {"name": "Elite", "desc": "A harder fight. Win a relic."}, 
	"merchant": {"name": "Merchant", "desc": "Relics, recruits, training and mending."}, 
	"rest": {"name": "Rest", "desc": "Revive a fallen piece, train one, or fortify the army."}, 
	"unknown": {"name": "Unknown", "desc": "Something waits on the road."}, 
	"boss": {"name": "Boss", "desc": "The master of this act."}, 
}


static func generate(rng: RandomNumberGenerator) -> Array:
	return [["encounter"], _stops(rng), ["encounter", "elite"], _stops(rng), ["boss"]]


static func is_fight(node_type: String) -> bool:
	return FIGHTS.has(node_type)


static func _stops(rng: RandomNumberGenerator) -> Array:
	var pool: Array = STOP_TYPES.duplicate()
	for i in range(pool.size() - 1, 0, -1):
		var j: = rng.randi_range(0, i)
		var swap = pool[i]
		pool[i] = pool[j]
		pool[j] = swap
	return pool.slice(0, rng.randi_range(2, 3))
