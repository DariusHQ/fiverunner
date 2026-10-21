--[[
    FiveRunner's lib/MySQL.lua, of the oxmysql that FiveRunner gives
    servers that have none, which resources include as
    @oxmysql/lib/MySQL.lua: the MySQL table of oxmysql, whose methods call
    its exports, as MySQL.query(sql, parameters, cb) and
    MySQL.query.await(sql, parameters) do, with MySQL.Async and MySQL.Sync
    of mysql-async, MySQL.ready and MySQL.startTransaction.
]]

local resource = GetCurrentResourceName()
local oxmysql = exports.oxmysql
local Await = Citizen.Await
local type, error, setmetatable = type, error, setmetatable

-- What the resource's mysql_option entries turn on, such as return_callback_errors.
local options = { return_callback_errors = false }
for i = 0, GetNumResourceMetadata(resource, 'mysql_option') - 1 do
    options[GetResourceMetadata(resource, 'mysql_option', i)] = true
end

-- The queries of MySQL.Async.store, by the numbers it gives them.
local stored = {}

local function isReference(value)
    return type(value) == 'table' and value.__cfx_functionReference ~= nil
end

-- The query, parameters and callback of a call, as oxmysql's library checks
-- them: a number names a stored query, and parameters that are a function
-- are the callback.
local function checkArguments(query, parameters, cb, transaction)
    local queryType = type(query)
    if queryType == 'number' then
        query = stored[query]
        assert(query, 'First argument received invalid query store reference')
    elseif transaction and queryType ~= 'table' then
        error(("First argument expected table, received '%s'"):format(query))
    elseif not transaction and queryType ~= 'string' then
        error(("First argument expected string, received '%s'"):format(query))
    end
    if parameters then
        local parametersType = type(parameters)
        if parametersType ~= 'table' and parametersType ~= 'function' then
            error(("Second argument expected table or function, received '%s'"):format(parameters))
        end
        if parametersType == 'function' or isReference(parameters) then
            cb, parameters = parameters, nil
        end
    end
    if cb and parameters and type(cb) == 'table' and not isReference(cb) then
        error(("Third argument expected function, received '%s'"):format(cb))
    end
    return query, parameters, cb
end

-- Calls an export of oxmysql with a callback that settles a promise, which it awaits.
local function await(export, query, parameters)
    local p = promise.new()
    export(nil, query, parameters, function(result, err)
        if err then
            p:reject(err)
        else
            p:resolve(result)
        end
    end, resource, true)
    return Await(p)
end

MySQL = setmetatable(MySQL or {}, {
    -- Other exports of oxmysql are methods too.
    __index = function(_, name)
        return function(...)
            return oxmysql[name](nil, ...)
        end
    end,
})

local method = {
    __call = function(self, query, parameters, cb)
        query, parameters, cb = checkArguments(query, parameters, cb, self.method == 'transaction')
        return oxmysql[self.method](nil, query, parameters, cb, resource, options.return_callback_errors)
    end,
}

for _, name in ipairs({ 'scalar', 'single', 'query', 'insert', 'update', 'prepare', 'transaction', 'rawExecute' }) do
    MySQL[name] = setmetatable({
        method = name,
        await = function(query, parameters)
            query, parameters = checkArguments(query, parameters, nil, name == 'transaction')
            return await(oxmysql[name], query, parameters)
        end,
    }, method)
end

-- Stores a query, which its number then names, as mysql-async's store does.
local function store(query, cb)
    assert(type(query) == 'string', 'The SQL Query must be a string')
    local number = #stored + 1
    stored[number] = query
    -- What the callback gives, unless it gives nothing.
    return cb and cb(number) or number
end

-- The names of mysql-async's methods, and those of oxmysql's they are.
local aliases = {
    fetchAll = 'query',
    fetchScalar = 'scalar',
    fetchSingle = 'single',
    insert = 'insert',
    execute = 'update',
    transaction = 'transaction',
    prepare = 'prepare',
}

local alias = {
    __index = function(self, key)
        local name = aliases[key]
        if name == nil then
            return nil
        end
        MySQL.Async[key] = MySQL[name]
        MySQL.Sync[key] = MySQL[name].await
        return rawget(self, key)
    end,
}

MySQL.Async = setmetatable({ store = store }, alias)
MySQL.Sync = setmetatable({ store = store }, alias)

-- Waits for oxmysql to start and connect, then calls back.
local function whenReady(cb)
    while GetResourceState('oxmysql') ~= 'started' do
        Wait(50)
    end
    oxmysql.awaitConnection()
    return cb and cb() or true
end

MySQL.ready = setmetatable({ await = whenReady }, {
    __call = function(_, cb)
        Citizen.CreateThreadNow(function()
            whenReady(cb)
        end)
    end,
})

function MySQL.startTransaction(cb)
    return oxmysql:startTransaction(cb, resource)
end
