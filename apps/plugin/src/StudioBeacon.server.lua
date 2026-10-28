--!nonstrict
-- Studio Beacon — Roblox Studio plugin
-- Sends the current Studio activity to the Studio Beacon desktop app,
-- which mirrors it to Discord Rich Presence.
--
-- The desktop app writes the token and URL into this file when installing,
-- but everything can also be changed in the plugin's Settings widget.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local Selection = game:GetService("Selection")
local StudioService = game:GetService("StudioService")
local UserInputService = game:GetService("UserInputService")

local PLUGIN_VERSION = "1.0.0"
local DEFAULT_URL = "http://127.0.0.1:47831"

-- Replaced by the desktop app at install time.
local BAKED_TOKEN = "__STUDIO_BEACON_TOKEN__"
local BAKED_URL = "__STUDIO_BEACON_URL__"

local SETTING_URL = "StudioBeacon.Url"
local SETTING_TOKEN = "StudioBeacon.Token"
local SETTING_PRIVATE = "StudioBeacon.Private"
local SETTING_IDLE = "StudioBeacon.IdleSeconds"

local MAX_COLLABORATORS = 8
local HEARTBEAT_SECONDS = 10
local LOOP_SECONDS = 2
local DEFAULT_IDLE_SECONDS = 300

----------------------------------------------------------------------
-- helpers
----------------------------------------------------------------------

local function isBaked(value)
	return typeof(value) == "string" and value ~= "" and string.sub(value, 1, 2) ~= "__"
end

local function readSetting(key, fallback)
	local ok, value = pcall(function()
		return plugin:GetSetting(key)
	end)
	if ok and value ~= nil then
		return value
	end
	return fallback
end

local function writeSetting(key, value)
	pcall(function()
		plugin:SetSetting(key, value)
	end)
end

local function trim(value)
	return (string.gsub(value, "^%s*(.-)%s*$", "%1"))
end

local function now()
	return os.clock()
end

local function clip(value, max)
	local text = tostring(value)
	if #text <= max then
		return text
	end
	return string.sub(text, 1, max)
end

----------------------------------------------------------------------
-- configuration
----------------------------------------------------------------------

local storedToken = readSetting(SETTING_TOKEN, nil)
local storedUrl = readSetting(SETTING_URL, nil)
local storedPrivate = readSetting(SETTING_PRIVATE, nil)
local storedIdle = readSetting(SETTING_IDLE, nil)

local config = {
	url = if typeof(storedUrl) == "string" and storedUrl ~= ""
		then storedUrl
		elseif isBaked(BAKED_URL) then BAKED_URL
		else DEFAULT_URL,
	token = if typeof(storedToken) == "string" and storedToken ~= ""
		then storedToken
		elseif isBaked(BAKED_TOKEN) then BAKED_TOKEN
		else "",
	private = storedPrivate == true,
	idleSeconds = tonumber(storedIdle) or DEFAULT_IDLE_SECONDS,
}

local state = {
	connected = false,
	lastError = "",
	sending = false,
	lastSentAt = 0,
	lastSignature = "",
	lastInteraction = now(),
	focused = true,
	viewportSignature = "",
}

----------------------------------------------------------------------
-- activity payload
----------------------------------------------------------------------

local function markInteraction()
	state.lastInteraction = now()
end

local function getPlayState()
	if RunService:IsRunning() then
		local okServer, isServer = pcall(function()
			return RunService:IsServer()
		end)
		if okServer and isServer then
			return "server"
		end
		local okClient, isClient = pcall(function()
			return RunService:IsClient()
		end)
		if okClient and isClient then
			return "client"
		end
		return "play"
	end
	return "edit"
end

local function getScriptInfo()
	local active = StudioService.ActiveScript
	if not active or not active:IsA("LuaSourceContainer") then
		return nil
	end

	local info = {
		path = clip(active:GetFullName(), 300),
		name = clip(active.Name, 120),
		line = 0,
		column = 0,
	}

	local okDoc, doc = pcall(function()
		return ScriptEditorService:FindScriptDocument(active)
	end)
	if not okDoc or not doc then
		return info
	end

	local okSelection, startLine, startCharacter = pcall(function()
		return doc:GetSelection()
	end)
	if okSelection and typeof(startLine) == "number" then
		info.line = startLine
		info.column = startCharacter or 0
	end

	local okViewport, topLine, bottomLine = pcall(function()
		return doc:GetViewport()
	end)
	if okViewport and typeof(topLine) == "number" then
		info.viewportStart = topLine
		info.viewportEnd = bottomLine
	end

	return info
end

local function getViewportSignature()
	local info = getScriptInfo()
	if not info then
		return ""
	end
	return string.format("%s:%s:%s", info.path, tostring(info.viewportStart), tostring(info.viewportEnd))
end

local function getSelectionInfo()
	local selected = Selection:Get()
	if #selected == 0 then
		return nil
	end
	local first = selected[1]
	if not first then
		return nil
	end
	return {
		name = clip(first.Name, 120),
		className = clip(first.ClassName, 80),
		path = clip(first:GetFullName(), 300),
	}
end

-- Team Create exposes the other people in the session as Player instances,
-- with Players.LocalPlayer being the person editing right now.
local function getCollaborators()
	local list = {}
	if config.private then
		return list
	end

	local selfId = 0
	local okSelf, player = pcall(function()
		return Players.LocalPlayer
	end)
	if okSelf and player then
		selfId = player.UserId
	end
	if selfId == 0 then
		local okUser, userId = pcall(function()
			return plugin:GetStudioUserId()
		end)
		if okUser and typeof(userId) == "number" then
			selfId = userId
		end
	end

	local okPlayers, players = pcall(function()
		return Players:GetPlayers()
	end)
	if not okPlayers then
		return list
	end

	for _, other in ipairs(players) do
		if other.UserId ~= selfId and other ~= player then
			local display = other.DisplayName
			if typeof(display) ~= "string" or display == "" then
				display = other.Name
			end
			table.insert(list, {
				name = clip(display, 64),
				username = clip(other.Name, 64),
			})
			if #list >= MAX_COLLABORATORS then
				break
			end
		end
	end

	return list
end

local function buildPayload()
	local creatorType = "User"
	local okCreator, value = pcall(function()
		return game.CreatorType
	end)
	if okCreator and value then
		creatorType = value.Name
	end

	local studioUserId = 0
	local okUser, userId = pcall(function()
		return plugin:GetStudioUserId()
	end)
	if okUser and typeof(userId) == "number" then
		studioUserId = userId
	end

	local idleFor = now() - state.lastInteraction

	return {
		pluginVersion = PLUGIN_VERSION,
		studioUserId = studioUserId,
		project = {
			name = clip(game.Name, 120),
			placeId = game.PlaceId,
			gameId = game.GameId,
			creatorId = game.CreatorId,
			creatorType = creatorType,
		},
		script = getScriptInfo(),
		selection = getSelectionInfo(),
		collaborators = getCollaborators(),
		play = {
			state = getPlayState(),
			isRunning = RunService:IsRunning(),
		},
		idle = (idleFor >= config.idleSeconds) or (not state.focused),
		focused = state.focused,
		privacy = if config.private then "private" else "public",
	}
end

----------------------------------------------------------------------
-- sending
----------------------------------------------------------------------

local setStatusUi -- forward declaration, assigned with the widget

local function setStatus(connected, message)
	local changed = state.connected ~= connected or state.lastError ~= message
	state.connected = connected
	state.lastError = message or ""
	if changed and setStatusUi then
		setStatusUi()
	end
end

local function send(force)
	if state.sending then
		return
	end
	if config.token == "" then
		setStatus(false, "No plugin token — open Settings")
		return
	end

	local okBuild, payload = pcall(buildPayload)
	if not okBuild then
		setStatus(false, "Could not read Studio state")
		return
	end

	local okEncode, signature = pcall(function()
		return HttpService:JSONEncode(payload)
	end)
	if not okEncode then
		setStatus(false, "Could not encode activity")
		return
	end

	local isHeartbeat = (now() - state.lastSentAt) >= HEARTBEAT_SECONDS
	if not force and signature == state.lastSignature and not isHeartbeat then
		return
	end

	payload.sentAt = DateTime.now().UnixTimestampMillis
	local body = HttpService:JSONEncode(payload)

	state.sending = true
	local okRequest, response = pcall(function()
		return HttpService:RequestAsync({
			Url = config.url .. "/ingest",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				Authorization = "Bearer " .. config.token,
			},
			Body = body,
		})
	end)
	state.sending = false

	if okRequest and response and response.Success then
		state.lastSignature = signature
		state.lastSentAt = now()
		setStatus(true, "")
		-- The desktop app owns the idle preference; mirror it locally.
		local okBody, body = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)
		if okBody and typeof(body) == "table" and typeof(body.idleSeconds) == "number" then
			config.idleSeconds = math.clamp(body.idleSeconds, 30, 3600)
		end
		return
	end

	local message
	if not okRequest then
		local detail = tostring(response)
		if string.find(detail, "HTTP requests are not enabled") then
			message = "Enable HTTP requests in Game Settings → Security"
		else
			message = "Studio Beacon is not running"
		end
	elseif response.StatusCode == 401 then
		message = "Invalid plugin token"
	elseif response.StatusCode == 429 then
		message = "Too many updates, slowing down"
	else
		message = string.format("Studio Beacon answered HTTP %d", response.StatusCode)
	end
	setStatus(false, message)
end

----------------------------------------------------------------------
-- settings widget
----------------------------------------------------------------------

local toolbar = plugin:CreateToolbar("Studio Beacon")
local settingsButton = toolbar:CreateButton(
	"Settings",
	"Configure Studio Beacon",
	"",
	""
)
settingsButton.ClickableWhenViewportHidden = true

local refreshButton = toolbar:CreateButton(
	"Refresh",
	"Send the current Studio activity right now",
	"",
	""
)
refreshButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,
	false,
	360,
	320,
	320,
	260
)
local widget = plugin:CreateDockWidgetPluginGui("StudioBeaconSettings", widgetInfo)
widget.Title = "Studio Beacon"
widget.Name = "Studio Beacon"

local function make(className, properties, parent)
	local instance = Instance.new(className)
	for key, value in properties do
		instance[key] = value
	end
	instance.Parent = parent
	return instance
end

local root = make("Frame", {
	BackgroundColor3 = Color3.fromRGB(20, 22, 27),
	BorderSizePixel = 0,
	Size = UDim2.fromScale(1, 1),
}, widget)

make("UIPadding", {
	PaddingTop = UDim.new(0, 14),
	PaddingBottom = UDim.new(0, 14),
	PaddingLeft = UDim.new(0, 14),
	PaddingRight = UDim.new(0, 14),
}, root)

make("UIListLayout", {
	FillDirection = Enum.FillDirection.Vertical,
	HorizontalAlignment = Enum.HorizontalAlignment.Left,
	Padding = UDim.new(0, 8),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, root)

make("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	LayoutOrder = 1,
	Size = UDim2.new(1, 0, 0, 24),
	Text = "Studio Beacon",
	TextColor3 = Color3.fromRGB(240, 244, 248),
	TextSize = 18,
	TextXAlignment = Enum.TextXAlignment.Left,
}, root)

local statusRow = make("Frame", {
	BackgroundTransparency = 1,
	LayoutOrder = 2,
	Size = UDim2.new(1, 0, 0, 18),
}, root)

make("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	Padding = UDim.new(0, 8),
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, statusRow)

local statusDot = make("Frame", {
	BackgroundColor3 = Color3.fromRGB(255, 120, 100),
	BorderSizePixel = 0,
	Size = UDim2.fromOffset(8, 8),
}, statusRow)

make("UICorner", { CornerRadius = UDim.new(1, 0) }, statusDot)

local statusLabel = make("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	Size = UDim2.new(1, -16, 1, 0),
	Text = "Not connected",
	TextColor3 = Color3.fromRGB(170, 178, 190),
	TextSize = 13,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextTruncate = Enum.TextTruncate.AtEnd,
}, statusRow)

local function makeFieldLabel(text, order)
	return make("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		LayoutOrder = order,
		Size = UDim2.new(1, 0, 0, 16),
		Text = text,
		TextColor3 = Color3.fromRGB(150, 158, 170),
		TextSize = 12,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, root)
end

local function makeTextBox(placeholder, order)
	local box = make("TextBox", {
		BackgroundColor3 = Color3.fromRGB(31, 34, 41),
		BorderSizePixel = 0,
		ClearTextOnFocus = false,
		Font = Enum.Font.Code,
		LayoutOrder = order,
		PlaceholderColor3 = Color3.fromRGB(110, 118, 130),
		PlaceholderText = placeholder,
		Size = UDim2.new(1, 0, 0, 32),
		Text = "",
		TextColor3 = Color3.fromRGB(235, 240, 245),
		TextSize = 13,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, root)
	make("UICorner", { CornerRadius = UDim.new(0, 6) }, box)
	make("UIPadding", {
		PaddingLeft = UDim.new(0, 8),
		PaddingRight = UDim.new(0, 8),
	}, box)
	return box
end

makeFieldLabel("Server URL", 3)
local urlBox = makeTextBox(DEFAULT_URL, 4)
urlBox.Text = config.url

makeFieldLabel("Plugin token", 5)
local tokenBox = makeTextBox("Paste the token from the desktop app", 6)
tokenBox.Text = config.token

local buttons = make("Frame", {
	BackgroundTransparency = 1,
	LayoutOrder = 7,
	Size = UDim2.new(1, 0, 0, 34),
}, root)

make("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	Padding = UDim.new(0, 8),
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, buttons)

local function makeButton(text, order, primary)
	local button = make("TextButton", {
		AutoButtonColor = true,
		BackgroundColor3 = if primary then Color3.fromRGB(182, 255, 60) else Color3.fromRGB(44, 48, 57),
		BorderSizePixel = 0,
		Font = Enum.Font.GothamMedium,
		LayoutOrder = order,
		Size = UDim2.fromOffset(if primary then 110 else 100, 32),
		Text = text,
		TextColor3 = if primary then Color3.fromRGB(12, 14, 18) else Color3.fromRGB(220, 226, 234),
		TextSize = 13,
	}, buttons)
	make("UICorner", { CornerRadius = UDim.new(0, 6) }, button)
	return button
end

local saveButton = makeButton("Save", 1, true)
local privateButton = makeButton("Private: off", 2, false)

local hint = make("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	LayoutOrder = 8,
	Size = UDim2.new(1, 0, 0, 44),
	Text = "Tip: the desktop app fills the URL and token automatically when it installs this plugin. Reinstall it after regenerating the token.",
	TextColor3 = Color3.fromRGB(120, 128, 140),
	TextSize = 12,
	TextWrapped = true,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
}, root)

local function updatePrivateButton()
	privateButton.Text = if config.private then "Private: on" else "Private: off"
	privateButton.BackgroundColor3 = if config.private
		then Color3.fromRGB(120, 96, 220)
		else Color3.fromRGB(44, 48, 57)
	privateButton.TextColor3 = Color3.fromRGB(235, 240, 245)
end

setStatusUi = function()
	if state.connected then
		statusDot.BackgroundColor3 = Color3.fromRGB(120, 230, 140)
		statusLabel.Text = "Connected — Discord is being updated"
		statusLabel.TextColor3 = Color3.fromRGB(150, 200, 160)
	else
		statusDot.BackgroundColor3 = Color3.fromRGB(255, 120, 100)
		statusLabel.Text = if state.lastError ~= "" then state.lastError else "Not connected"
		statusLabel.TextColor3 = Color3.fromRGB(190, 160, 155)
	end
end

updatePrivateButton()
setStatusUi()

saveButton.Activated:Connect(function()
	config.url = trim(urlBox.Text)
	if config.url == "" then
		config.url = DEFAULT_URL
	end
	config.token = trim(tokenBox.Text)
	writeSetting(SETTING_URL, config.url)
	writeSetting(SETTING_TOKEN, config.token)
	markInteraction()
	state.lastSignature = ""
	send(true)
end)

privateButton.Activated:Connect(function()
	config.private = not config.private
	writeSetting(SETTING_PRIVATE, config.private)
	updatePrivateButton()
	state.lastSignature = ""
	send(true)
end)

settingsButton.Clicked:Connect(function()
	widget.Enabled = not widget.Enabled
end)

refreshButton.Clicked:Connect(function()
	markInteraction()
	send(true)
end)

----------------------------------------------------------------------
-- live updates
----------------------------------------------------------------------

UserInputService.InputBegan:Connect(markInteraction)
UserInputService.InputChanged:Connect(markInteraction)

UserInputService.WindowFocused:Connect(function()
	state.focused = true
	markInteraction()
	state.lastSignature = ""
	send(true)
end)

UserInputService.WindowFocusReleased:Connect(function()
	state.focused = false
end)

Selection.SelectionChanged:Connect(function()
	markInteraction()
	send(false)
end)

StudioService:GetPropertyChangedSignal("ActiveScript"):Connect(function()
	markInteraction()
	send(false)
end)

task.spawn(function()
	while true do
		task.wait(LOOP_SECONDS)
		local ok, signature = pcall(getViewportSignature)
		if ok and signature ~= state.viewportSignature then
			state.viewportSignature = signature
			markInteraction()
		end
		pcall(send, false)
	end
end)

markInteraction()
send(true)
