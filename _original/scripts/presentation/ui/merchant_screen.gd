class_name MerchantScreen
extends Modal


signal changed
signal leave

var _gs: GameState
var _body: VBoxContainer
var _gold: Label


func _init() -> void :
	super ("The Merchant", 1120.0, 0.45)
	dismissable = false


func setup(gs: GameState) -> void :
	_gs = gs
	var purse: = UiKit.hbox(8)
	purse.alignment = BoxContainer.ALIGNMENT_CENTER
	purse.add_child(Hud.IconBox.make("coin", 26))
	_gold = UiKit.number("", 26, Palette.GOLD_BRIGHT)
	purse.add_child(_gold)
	content.add_child(purse)
	_body = UiKit.vbox(16)
	content.add_child(_body)
	var go: = UiKit.button("Leave", func() -> void :
		leave.emit()
		queue_free(), true, 160)
	add_footer([go])
	refresh()


func refresh() -> void :
	_gold.text = "%d gold" % _gs.gold
	for child in _body.get_children():
		child.queue_free()
	var shelf: = UiKit.hbox(16)
	shelf.alignment = BoxContainer.ALIGNMENT_CENTER
	for i in _gs.shop.relics.size():
		var id: = str(_gs.shop.relics[i])
		if id == "":
			var sold: = UiKit.panel(Color(0.04, 0.05, 0.08, 0.6), Palette.PANEL_EDGE, Vector4(18, 16, 18, 16))
			sold.custom_minimum_size = Vector2(230, 300)
			var text: = UiKit.caption("Sold", Palette.FAINT, 13)
			text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			text.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			sold.add_child(text)
			shelf.add_child(sold)
			continue
		var info: = Relics.info(id)
		var price: = _gs.shop_relic_price(i)
		var card: = ChoiceCard.make(str(info.icon), str(info.name), str(info.desc), "Buy · %d" % price, str(info.rarity))
		card.chosen.connect(_buy_relic.bind(i))
		if _gs.relics.size() >= Relics.MAX_EQUIPPED:
			card.set_enabled(false, "All six relic slots are full.")
		elif _gs.gold < price:
			card.set_enabled(false, "Not enough gold.")
		shelf.add_child(card)
	for i in _gs.shop.recruits.size():
		var kind: = str(_gs.shop.recruits[i])
		if kind == "":
			continue
		var price: = _gs.recruit_price(kind)
		var card: = ChoiceCard.make("", "Recruit a %s" % UiKit.piece_name(kind).to_lower(), "Joins your army for the rest of the run.", "Hire · %d" % price, "", kind)
		card.chosen.connect(_recruit.bind(i))
		if _gs.army.size() >= GameState.MAX_ARMY:
			card.set_enabled(false, "Your army is at full strength.")
		elif _gs.gold < price:
			card.set_enabled(false, "Not enough gold.")
		shelf.add_child(card)
	_body.add_child(shelf)

	var services: = UiKit.hbox(30)
	services.alignment = BoxContainer.ALIGNMENT_CENTER
	var train: = UiKit.vbox(8)
	train.add_child(UiKit.caption("Training · %d gold · +1 level" % _gs.service_price(GameState.TRAIN_PRICE), Palette.MUTED, 12))
	var trainees: = PiecePicker.make(_gs.army, func(entry: Dictionary) -> bool:
		return int(entry.level) < GameState.MAX_LEVEL and _gs.gold >= _gs.service_price(GameState.TRAIN_PRICE))
	trainees.picked.connect( func(index: int) -> void :
		if _gs.train(str(_gs.army[index].id)):
			Sfx.play(&"train")
		changed.emit()
		refresh())
	train.add_child(trainees)
	services.add_child(train)
	if not _gs.fallen.is_empty():
		var mend: = UiKit.vbox(8)
		mend.add_child(UiKit.caption("Mending · %d gold · revive a fallen piece" % _gs.service_price(GameState.MEND_PRICE), Palette.MUTED, 12))
		var fallen: = PiecePicker.make(_gs.fallen, func(_entry: Dictionary) -> bool:
			return _gs.gold >= _gs.service_price(GameState.MEND_PRICE) and _gs.army.size() < GameState.MAX_ARMY)
		fallen.picked.connect( func(index: int) -> void :
			if _gs.mend(index):
				Sfx.play(&"purchase")
			changed.emit()
			refresh())
		mend.add_child(fallen)
		services.add_child(mend)
	_body.add_child(services)


func _buy_relic(index: int) -> void :
	if _gs.buy_relic(index):
		Sfx.play(&"purchase")
	changed.emit()
	refresh()


func _recruit(index: int) -> void :
	if _gs.buy_recruit(index):
		Sfx.play(&"purchase")
	changed.emit()
	refresh()
