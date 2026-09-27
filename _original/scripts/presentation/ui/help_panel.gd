class_name HelpPanel
extends Modal


const PAGES: = [
	["The run", "Lead your ivory army across three acts: [b]The Moss Ranks[/b], [b]The Sunken Files[/b] and [b]The Back Rank[/b]. Each act is a short road: fights, a choice of stops, an elite or a normal fight, more stops, then a boss. Nine fights in all. Lose one and the run is over."], 
	["Your turn", """Select one of your pieces and make one legal chess move or capture. Blue squares are moves, red squares are captures.
Some abilities let the same piece keep going: [b]Chain Capture[/b] captures again, [b]Momentum[/b] moves again after a quiet move. Take the follow-up, or press [b]End turn[/b]."""], 
	["The enemy", """The obsidian army moves one piece per turn and [b]never retreats[/b]: enemy pieces only move forward or sideways. Your pieces under attack pulse red.
Win by eliminating every enemy piece, or in boss fights by [b]capturing the enemy King[/b]. When a single enemy piece is left and you outmatch it four to one, it [b]flees[/b] and the fight is won. If a fight reaches turn 40, the field goes to the stronger army."""], 
	["Your king", "Your King must never be left in check. If it is attacked and no legal move remains, you are [b]checkmated[/b] and the run ends. Pieces you lose stay lost unless you revive them at a rest or pay a merchant to mend them."], 
	["Growth", """Every capture earns the capturing piece experience. At levels 1, 2 and 3 you choose one of three upgrades for that piece, and it visibly changes: gold trim, then banners and gems, then a late-run glow.
Pawns that reach the far rank become queens for the rest of the run."""], 
	["Relics and stops", "Relics are run-wide powers (up to six), won from elites and bosses or bought from merchants. [b]Merchants[/b] also sell recruits, training and mending. [b]Rests[/b] revive, train or fortify. [b]Unknown[/b] stops hold small stories and choices."], 
	["Terrain", "[b]Frozen[/b] tiles block movement (knights can jump them). [b]Corrupted[/b] tiles destroy a piece left standing on one at the end of its side's turn. [b]Enchanted[/b] tiles shelter your pieces: one of yours standing there cannot be captured. They give the enemy no shelter."], 
	["Controls", """[b]Mouse[/b]: click a piece, then a square. Right-click or Esc clears the selection. Right-drag orbits the camera, the wheel zooms, middle-click resets it.
[b]Keyboard[/b]: arrows or WASD move the board cursor, Space acts on it, Enter ends the turn, Tab cycles your pieces, Q and E orbit, C resets the view, H asks for a hint, F1 opens these rules, Esc pauses.
[b]Controller[/b]: D-pad cursor, A act, X end turn, B back, Y hint, bumpers orbit, Start pause."""], 
]


func _init() -> void :
	super ("How to play", 800.0, 0.6)


func _ready() -> void :
	super ()
	var scroll: = ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(730, 480)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	content.add_child(scroll)
	var column: = UiKit.vbox(14)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(column)
	for page in PAGES:
		column.add_child(UiKit.title(str(page[0]), 22, Palette.GOLD_BRIGHT))
		column.add_child(UiKit.rich(str(page[1]), 20, 700))
	var done: = UiKit.button("Close", close, true, 140)
	var buttons: Array[Button] = [done]
	add_footer(buttons)
	done.grab_focus.call_deferred()
