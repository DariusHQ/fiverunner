--[[
    FiveRunner's oxmysql: the exports of oxmysql, which this script gives in
    place of oxmysql's JavaScript, as FiveRunner runs only Lua.

    Each export hands what it gets to FiveRunner, which runs its queries as
    oxmysql's JavaScript runs them, at the next tick, and gives their results
    back with the event __fiverunner_internal:oxmysqlResponse, with the token
    the export got, once it has them, or as the export starts, when what it
    got fails before oxmysql would await. The exports call back as oxmysql's
    do, and those
    that oxmysql gives as promises, the _async and Sync ones, give what
    promises of JavaScript give the runtimes that call them: a table whose
    __cfx_async_retval takes a callback, which they call with their results
    once they have them.

    The exports oxmysql gives as those of mysql-async and ghmattimysql, which
    it provides, are here too.
]]

local call = FiverunnerOxmysql
local msgpack_pack_args = msgpack.pack_args
local GetInvokingResource = GetInvokingResource
local type, rawget, pcall, tostring = type, rawget, pcall, tostring

-- The callbacks of operations that FiveRunner runs, by their tokens.
local pending = {}

-- Calls back with the result of an operation: what it gave, or nil and the message of its error.
local function respond(callback, ok, value)
    -- oxmysql ignores the errors of callbacks, which their own runtimes report.
    if ok then
        pcall(callback, value)
    else
        pcall(callback, nil, value)
    end
end

-- Starts an operation with its arguments, nils too, which calls back with
-- its result once it has it, or at once when it had it as it started.
local function start(callback, method, ...)
    local started = call(method, msgpack_pack_args(...))
    if callback == nil then
        return
    end
    if started[2] then
        pending[started[1]] = callback
    elseif started[3] ~= nil then
        respond(callback, started[3], started[4])
    end
end

-- Whether a value is a function, as JavaScript has functions of other runtimes.
local function isFunction(value)
    return type(value) == 'function' or (type(value) == 'table' and rawget(value, '__cfx_functionReference') ~= nil)
end

AddEventHandler('__fiverunner_internal:oxmysqlResponse', function(token, ok, value)
    local callback = pending[token]
    if callback == nil then
        return
    end
    pending[token] = nil
    respond(callback, ok, value)
end)

-- What a promise of JavaScript gives other runtimes: a function that takes a
-- callback, which gets the results, or nil and the message of the error.
-- `run` starts what the promise awaits, with a function that settles it.
local function promise(run)
    local settled, listener
    local function settle(ok, value)
        if settled then
            return
        end
        settled = { ok, value }
        if listener then
            if ok then
                listener({ value }, nil)
            else
                listener(nil, value)
            end
        end
    end
    local ok, err = pcall(run, settle)
    if not ok then
        settle(false, tostring(err))
    end
    return {
        __cfx_async_retval = function(callback)
            listener = callback
            if settled then
                local done = settled
                settled = nil
                settle(done[1], done[2])
            end
        end,
    }
end

--[[ Connecting ]]

local ready = false
local awaiting = {}

Citizen.SetTimeout(0, function()
    start(function()
        ready = true
        for _, settle in ipairs(awaiting) do
            settle(true, true)
        end
        awaiting = {}
    end, 'connect')
end)

--[[ The exports ]]

local MySQL = {}

MySQL.isReady = function()
    return ready
end

MySQL.awaitConnection = function()
    return promise(function(settle)
        if ready then
            settle(true, true)
        else
            awaiting[#awaiting + 1] = settle
        end
    end)
end

-- An export of a kind of query, as oxmysql's rawQuery runs them.
local function query(kind)
    return function(sql, parameters, cb, invokingResource, isPromise)
        local callback = (isFunction(cb) and cb) or (isFunction(parameters) and parameters) or nil
        start(callback, 'query', kind, invokingResource or GetInvokingResource(), sql, parameters, callback ~= nil, isPromise)
    end
end

MySQL.query = query(nil)
MySQL.single = query('single')
MySQL.scalar = query('scalar')
MySQL.update = query('update')
MySQL.insert = query('insert')

MySQL.transaction = function(queries, parameters, cb, invokingResource, isPromise)
    local callback = (isFunction(cb) and cb) or (isFunction(parameters) and parameters) or nil
    start(callback, 'transaction', invokingResource or GetInvokingResource(), queries, parameters, callback ~= nil, isPromise)
end

-- The exports of prepared statements, which prepare unpacks as rawExecute does not.
local function execute(unpack)
    return function(sql, parameters, cb, invokingResource, isPromise)
        local callback = (isFunction(cb) and cb) or (isFunction(parameters) and parameters) or nil
        start(callback, 'execute', invokingResource or GetInvokingResource(), sql, parameters, callback ~= nil, isPromise, unpack)
    end
end

MySQL.prepare = execute(true)
MySQL.rawExecute = execute(false)

-- Runs a transaction that a function of the caller gives the queries of,
-- with a function that runs them, as oxmysql's startTransaction does: it
-- commits unless the function gives false, fails or takes over 30 seconds.
MySQL.startTransaction = function(transactions, invokingResource)
    invokingResource = invokingResource or GetInvokingResource()
    return promise(function(settle)
        start(function(transaction, err)
            if err ~= nil then
                settle(true, false)
                return
            end
            local closed = false
            Citizen.SetTimeout(30000, function()
                closed = true
            end)
            local function runQuery(sql, values)
                return promise(function(settleQuery)
                    start(function(result, failure)
                        if failure ~= nil then
                            settleQuery(false, failure)
                        else
                            settleQuery(true, result)
                        end
                    end, 'transactionQuery', transaction, closed, sql, values)
                end)
            end
            Citizen.CreateThread(function()
                local ok, commit = pcall(transactions, runQuery)
                local failure
                if not ok then
                    failure = tostring(commit)
                elseif closed then
                    failure = 'Transaction has timed out after 30 seconds.'
                end
                closed = true
                start(function(response)
                    settle(true, response)
                end, 'end', transaction, commit ~= false, failure)
            end)
        end, 'begin', invokingResource)
    end)
end

MySQL.store = function(sql, cb)
    if not isFunction(cb) then
        error('cb is not a function', 0)
    end
    cb(sql)
end

MySQL.execute = MySQL.query
MySQL.fetch = MySQL.query

-- An export of oxmysql's as a promise, as its _async and Sync exports are.
local function async(exported)
    return function(sql, parameters, invokingResource)
        invokingResource = invokingResource or GetInvokingResource()
        return promise(function(settle)
            exported(sql, parameters or {}, function(result, err)
                if err then
                    settle(false, err)
                else
                    settle(true, result)
                end
            end, invokingResource, true)
        end)
    end
end

-- The names oxmysql gives its exports as those of ghmattimysql and mysql-async.
local ghmattimysql = { query = 'execute', scalar = 'scalar', transaction = 'transaction', store = 'store' }
local mysqlAsync = {
    update = 'mysql_execute',
    insert = 'mysql_insert',
    query = 'mysql_fetch_all',
    scalar = 'mysql_fetch_scalar',
    transaction = 'mysql_transaction',
    store = 'mysql_store',
}

local function provide(resource, name, fn)
    AddEventHandler(('__cfx_export_%s_%s'):format(resource, name), function(setCB)
        setCB(fn)
    end)
end

for _, name in ipairs({
    'isReady',
    'awaitConnection',
    'query',
    'single',
    'scalar',
    'update',
    'insert',
    'transaction',
    'startTransaction',
    'prepare',
    'rawExecute',
    'store',
    'execute',
    'fetch',
}) do
    local exported = MySQL[name]
    local asynchronous = async(exported)
    exports(name, exported)
    exports(name .. '_async', asynchronous)
    exports(name .. 'Sync', asynchronous)
    if ghmattimysql[name] then
        provide('ghmattimysql', ghmattimysql[name], exported)
        provide('ghmattimysql', ghmattimysql[name] .. 'Sync', asynchronous)
    end
    if mysqlAsync[name] then
        provide('mysql-async', mysqlAsync[name], exported)
    end
end
