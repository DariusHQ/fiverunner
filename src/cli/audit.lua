-- FiveRunner's audit, which `fiverunner audit` runs as a test of the project:
-- it triggers each event of the server that clients may trigger, from a
-- player, with the arguments that cheaters give, and tells what each changed
-- of what the player has, of the database and of the world, as lines of JSON.

local MARK = 'fiverunner:audit '

--- Tells `fiverunner audit` of something, as a line of JSON.
local function tell(record)
    print(MARK .. json.encode(record))
end

local function started(name)
    return GetResourceState(name) == 'started'
end

-- The framework that logs players in, and the inventory that holds their items.
local framework = started('qbx_core') and 'qbx' or started('qb-core') and 'qb' or started('es_extended') and 'esx' or nil
local oxInventory = started('ox_inventory')

local CHARINFO = { firstname = 'Audit', lastname = 'Player', birthdate = '1990-01-01', gender = 0, nationality = 'Romania' }

local core

--- The shared object of QBCore or ESX, which exports copy whole, so once.
local function coreOf()
    if core == nil then
        if framework == 'qb' then core = exports['qb-core']:GetCoreObject() end
        if framework == 'esx' then core = exports.es_extended:getSharedObject() end
    end
    return core
end

--- The object of the framework for a player, once it logged in.
local function frameworkPlayer(id)
    local ok, found = pcall(function()
        if framework == 'qbx' then return exports.qbx_core:GetPlayer(id) end
        if framework == 'qb' then return coreOf().Functions.GetPlayer(id) end
        if framework == 'esx' then return coreOf().GetPlayerFromId(id) end
    end)
    return ok and found or nil
end

--- Whether the client of `player` sent the page of `resource` a message of `action`.
local function sent(player, resource, action)
    for _, message in ipairs(player:nuiMessages(resource)) do
        if message.action == action then return true end
    end
    return false
end

local joined = 0

--- Connects a player and logs it in with a new character, as the framework of the server has players do.
local function join()
    joined = joined + 1
    local player, why = fiverunner.connect({ name = 'audit' .. joined })
    if not player then return nil, why end
    pcall(function()
        if framework == 'qbx' then
            exports.qbx_core:Login(player.id, nil, { charinfo = CHARINFO })
        elseif framework == 'qb' and started('qb-multicharacter') then
            fiverunner.waitFor(function() return sent(player, 'qb-multicharacter', 'ui') end, 10000)
            player:nuiCallback('qb-multicharacter', 'createNewCharacter', {
                firstname = 'Audit', lastname = 'Player', nationality = 'Romania', birthdate = '1990-01-01', gender = 'Male', cid = 1,
            })
        elseif framework == 'qb' then
            coreOf().Player.Login(player.id, false, { charinfo = CHARINFO })
        end
    end)
    if framework then
        pcall(fiverunner.waitFor, function() return frameworkPlayer(player.id) end, 10000)
    end
    return player
end

--- Whether `player` is still on the server, and still logged in to its framework.
local function present(player)
    if GetPlayerName(player.id) == nil then return false end
    return framework == nil or frameworkPlayer(player.id) ~= nil
end

--- What `player` has: money by account, items by name, job, gang, group, and whether it may run every command.
local function holdings(player)
    local held = { money = {}, items = {}, admin = IsPlayerAceAllowed(player.id, 'command') }
    local found = frameworkPlayer(player.id)
    pcall(function()
        if found and framework == 'esx' then
            for account, money in pairs(found.getAccounts(true)) do held.money[account] = money end
            if not oxInventory then
                for name, count in pairs(found.getInventory(true)) do held.items[name] = count end
            end
            local job = found.getJob()
            held.job = ('%s %s'):format(job.name, job.grade)
            held.group = found.getGroup()
        elseif found then
            local data = found.PlayerData
            for account, money in pairs(data.money or {}) do held.money[account] = money end
            if not oxInventory then
                for _, item in pairs(data.items or {}) do
                    held.items[item.name] = (held.items[item.name] or 0) + (item.amount or item.count or 0)
                end
            end
            if data.job then held.job = ('%s %s'):format(data.job.name, data.job.grade and data.job.grade.level) end
            if data.gang then held.gang = ('%s %s'):format(data.gang.name, data.gang.grade and data.gang.grade.level) end
        end
    end)
    if oxInventory then
        pcall(function()
            for _, item in pairs(exports.ox_inventory:GetInventoryItems(player.id) or {}) do
                held.items[item.name] = (held.items[item.name] or 0) + item.count
            end
        end)
    end
    return held
end

local function byText(a, b)
    return a.text < b.text
end

--- What `player` gained from `before` to `after`, as { kind, text }, with
--- kind money, item or field, and the money that it lost, as words.
local function diff(before, after)
    local gained, lost = {}, {}
    for account, money in pairs(after.money) do
        local was = before.money[account] or 0
        if type(money) == 'number' and type(was) == 'number' then
            if money > was then
                gained[#gained + 1] = { kind = 'money', text = ('%s +%s'):format(account, money - was) }
            elseif money < was then
                lost[#lost + 1] = ('%s -%s'):format(account, was - money)
            end
        end
    end
    for name, count in pairs(after.items) do
        local was = before.items[name] or 0
        if count > was then gained[#gained + 1] = { kind = 'item', text = ('item %s +%s'):format(name, count - was) } end
    end
    for _, field in ipairs({ 'job', 'gang', 'group' }) do
        if after[field] ~= before[field] and after[field] ~= nil then
            gained[#gained + 1] = { kind = 'field', text = ('%s %s'):format(field, after[field]) }
        end
    end
    if after.admin and not before.admin then gained[#gained + 1] = { kind = 'field', text = 'every command' } end
    table.sort(gained, byText)
    table.sort(lost)
    return gained, lost
end

--- Whether `changes` has any of `kind`.
local function has(changes, kind)
    for _, change in ipairs(changes) do
        if change.kind == kind then return true end
    end
    return false
end

--- What `player` holds once it stays the same for `reads` reads, half a
--- second apart, within 10 seconds: 4 after it logs in, as frameworks give
--- new characters their starter items a moment after, such as QBCore once
--- its other resources had a second to load the player.
local function settled(player, reads)
    local before, stable = holdings(player), 0
    for _ = 1, 20 do
        Wait(500)
        local now = holdings(player)
        local gained, lost = diff(before, now)
        stable = (#gained == 0 and #lost == 0) and stable + 1 or 0
        if stable == (reads or 4) then return now end
        before = now
    end
    return before
end

--- The rows of each table of the database, as JSON, by the names of the tables.
local function tables()
    local rows = {}
    if not started('oxmysql') then return rows end
    pcall(function()
        for _, row in ipairs(exports.oxmysql:query_async('SHOW TABLES') or {}) do
            local _, name = next(row)
            rows[name] = json.encode(exports.oxmysql:query_async(('SELECT * FROM `%s`'):format(name)))
        end
    end)
    return rows
end

--- The tables whose rows differ from `before` to `after`.
local function changed(before, after)
    local found = {}
    for name, rows in pairs(after) do
        if before[name] ~= rows then found[#found + 1] = name end
    end
    table.sort(found)
    return found
end

local function entities()
    return #GetAllVehicles() + #GetAllPeds() + #GetAllObjects()
end

--- An item that the server knows of, for arguments that name items.
local function anItem()
    local name
    pcall(function()
        if oxInventory then
            name = next(exports.ox_inventory:Items())
        elseif framework == 'qb' then
            name = next(coreOf().Shared.Items)
        elseif framework == 'esx' then
            name = next(coreOf().Items)
        end
    end)
    return name or 'water'
end

it('audits the events that clients may trigger', function()
    while GetGameTimer() < 3000 do Wait(100) end
    local events = fiverunner.events()

    -- Which events clients may trigger. Each resource that handles one but not
    -- for net refuses it from clients, saying so, so a scout triggers them all at
    -- once, and those that every resource of theirs refused are closed. The scout
    -- leaves, so that what the events did to it is nothing of the player's.
    local scout, why = fiverunner.connect({ name = 'scout' })
    if not scout then
        tell({ type = 'refused', reason = why })
        return
    end
    local names = {}
    for _, event in ipairs(events) do
        if event.name ~= '*' then names[#names + 1] = event.name end
    end
    local from = #fiverunner.output() + 1
    scout:run('for _, name in ipairs(...) do TriggerServerEvent(name) end', names)
    Wait(500)
    local refusals = {}
    for _, line in ipairs(fiverunner.output(from)) do
        local name = line:match('[Ee]vent (.-) was not safe for net')
        if name then refusals[name] = (refusals[name] or 0) + 1 end
    end
    if GetPlayerName(scout.id) ~= nil then scout:disconnect() end

    local player
    player, why = join()
    if not player then
        tell({ type = 'refused', reason = why })
        return
    end
    local item = anItem()
    local payloads = {
        {},
        { 1000000 },
        { -1000000 },
        { 'money', 1000000 },
        { 'bank', 1000000 },
        { item, 100 },
        { 'police', 4 },
        { player.id, 1000000 },
        { { amount = 1000000, count = 100, item = item, money = 1000000, price = -1000000 } },
    }
    local openEvents = 0
    for _, event in ipairs(events) do
        if event.name ~= '*' and (refusals[event.name] or 0) < #event.resources then openEvents = openEvents + 1 end
    end
    tell({ type = 'start', framework = framework, events = #events, open = openEvents, loggedIn = frameworkPlayer(player.id) ~= nil })
    local RANK = { low = 1, medium = 2, high = 3 }

    local held, rows, count = settled(player), tables(), entities()
    local seen = #fiverunner.output()
    for _, event in ipairs(events) do
        local name, resources = event.name, event.resources
        local open = name ~= '*' and (refusals[name] or 0) < #resources
        -- What the arguments that did the most did, of all that the event got.
        local worst
        for _, payload in ipairs(open and payloads or {}) do
            player:emit(name, table.unpack(payload))
            Wait(100)
            local errors = {}
            -- Only what the server printed since it last read, which may be long.
            local output = fiverunner.output(seen + 1)
            for _, line in ipairs(output) do
                if line:find('SCRIPT ERROR', 1, true) and not line:find(MARK, 1, true) then
                    errors[#errors + 1] = line
                end
            end
            seen = seen + #output
            local effects, severity = {}, nil
            local stayed = present(player)
            if stayed then
                local now = holdings(player)
                local gained, lost = diff(held, now)
                held = now
                -- Money that comes at once may be pay that comes on its own, such as
                -- paychecks, so it counts only when the same arguments bring more.
                if has(gained, 'money') then
                    player:emit(name, table.unpack(payload))
                    Wait(100)
                    stayed = present(player)
                    local again = stayed and holdings(player) or now
                    if not has((diff(now, again)), 'money') then
                        for i = #gained, 1, -1 do
                            if gained[i].kind == 'money' then table.remove(gained, i) end
                        end
                    end
                    held = again
                end
                for _, gain in ipairs(gained) do effects[#effects + 1] = gain.text end
                if #gained > 0 then
                    -- What the player paid for, such as an item of a shop, is a trade.
                    severity = #lost > 0 and 'medium' or 'high'
                    for _, loss in ipairs(lost) do effects[#effects + 1] = loss end
                end
            end
            local nowCount = entities()
            if nowCount > count then
                effects[#effects + 1] = ('%d entities'):format(nowCount - count)
                severity = severity or 'medium'
            end
            count = nowCount
            if #errors > 0 then
                effects[#effects + 1] = 'error: ' .. errors[1]
                severity = severity or 'low'
            end
            if severity and (worst == nil or RANK[severity] > RANK[worst.severity]) then
                worst = { severity = severity, args = payload, effects = effects }
            end
            if not stayed then
                tell({ type = 'dropped', event = name, resources = resources, args = payload })
                player = join()
                if not player then return end
                payloads[8][1] = player.id
                -- What joining did is no effect of the event, whose other arguments
                -- would only drop the new player, such as by a ban, as anti-cheats do.
                held, rows, count = settled(player), tables(), entities()
                seen = seen + #fiverunner.output(seen + 1)
                break
            end
        end
        -- What comes after the last arguments, such as items that a loop of the
        -- event gives one by one with waits, is the event's, not the next one's.
        -- Money that comes then may be pay that comes on its own, such as
        -- paychecks, so only the rest counts.
        if open and present(player) then
            local later = settled(player, 2)
            local gained, lost = diff(held, later)
            held = later
            local effects = {}
            for _, gain in ipairs(gained) do
                if gain.kind ~= 'money' then effects[#effects + 1] = 'later: ' .. gain.text end
            end
            if #effects > 0 then
                local severity = #lost > 0 and 'medium' or 'high'
                for _, loss in ipairs(lost) do effects[#effects + 1] = 'later: ' .. loss end
                if worst and RANK[worst.severity] >= RANK[severity] then
                    for _, effect in ipairs(effects) do worst.effects[#worst.effects + 1] = effect end
                else
                    -- Which arguments it came of is not known: the event's, as a whole.
                    for _, effect in ipairs(worst and worst.effects or {}) do effects[#effects + 1] = effect end
                    worst = { severity = severity, effects = effects }
                end
            end
        end
        -- The rows of the database, once all the arguments went, as reading them
        -- takes far longer than the rest: whichever changed them, the event writes
        -- what clients send.
        if open then
            local nowRows = tables()
            local tablesChanged = changed(rows, nowRows)
            rows = nowRows
            if #tablesChanged > 0 then
                local effect = 'database: ' .. table.concat(tablesChanged, ', ')
                if worst and RANK[worst.severity] >= RANK.medium then
                    worst.effects[#worst.effects + 1] = effect
                else
                    worst = { severity = 'medium', effects = { effect, table.unpack(worst and worst.effects or {}) } }
                end
            end
        end
        if worst then
            tell({ type = 'finding', event = name, resources = resources, args = worst.args, severity = worst.severity, effects = worst.effects })
        end
        tell({ type = 'event', event = name, resources = resources, open = open })
        -- What the event left behind, such as copies of the objects of frameworks,
        -- is garbage that generational collection lets grow on servers of many resources.
        collectgarbage()
    end
    tell({ type = 'end' })
end, 3600000)
