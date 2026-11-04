---@meta

-- What the tests of FiveRunner have, for the Lua language server:
-- https://github.com/DariusHQ/fiverunner/blob/main/docs/testing.md

---@class Identity
---@field name? string
---@field guid? string
---@field endpoint? string
---@field identifiers? string[]
---@field tokens? string[]
---@field card? table What the player answers the adaptive cards of deferrals with

---@class Player
---@field id integer The id of the player on the server, its source
---@field name string
local Player = {}

--- Runs Lua code in the client of the player, with `...` as its arguments, and returns what it returns.
---@param code string
---@param ... any
---@return any ...
function Player:run(code, ...) end

--- Triggers an event on the server from the client, and returns once the server got it.
---@param event string
---@param ... any
function Player:emit(event, ...) end

--- The arguments of each `event` that the client got from the server, in the order they came.
---@param event string
---@return any[][]
function Player:received(event) end

--- What the client printed, line by line, as `[channel] text`, without colors, from line `from` on, when given.
---@param from? integer
---@return string[]
function Player:output(from) end

--- Disconnects the player, and returns once the server dropped it.
---@param reason? string
function Player:disconnect(reason) end

--- What the client sent the NUI frame of `resource` with SendNUIMessage, in the order it sent them.
---@param resource string
---@return table[]
function Player:nuiMessages(resource) end

--- Calls a NUI callback, as the page of the resource does, and returns what it answered, and the status.
---@param resource string
---@param name string
---@param data? table
---@return any answer
---@return integer status
function Player:nuiCallback(resource, name, data) end

--- Whether NUI has the focus on the client, and whether it shows the cursor.
---@return boolean focused
---@return boolean cursor
function Player:nuiFocus() end

--- Has a key of the keyboard of the client, such as `E` or `LMENU`, go down.
---@param key string
function Player:keyDown(key) end

--- Has a key of the keyboard of the client go up.
---@param key string
function Player:keyUp(key) end

--- Has a key go down, and up a frame later.
---@param key string
function Player:press(key) end

--- Mocks a native on the client, for the rest of the test.
---@param name string
---@param fn function
function Player:mock(name, fn) end

---@class Expectation
---@field never Expectation Negates the matchers
---@field toBe fun(expected: any)
---@field toEqual fun(expected: any)
---@field toBeTruthy fun()
---@field toBeFalsy fun()
---@field toBeNil fun()
---@field toBeGreaterThan fun(n: number)
---@field toBeGreaterThanOrEqual fun(n: number)
---@field toBeLessThan fun(n: number)
---@field toBeLessThanOrEqual fun(n: number)
---@field toBeCloseTo fun(n: number, digits?: integer)
---@field toContain fun(item: any)
---@field toContainEqual fun(item: any)
---@field toHaveLength fun(n: integer)
---@field toMatch fun(pattern: string)
---@field toThrow fun(text?: string)

---@class fiverunnerlib
fiverunner = {}

--- Connects a player, and returns it once its client started the resources of the server, or nil and why the server refused it.
---@param identity? Identity
---@return Player? player
---@return string? reason
function fiverunner.connect(identity) end

--- What the server printed, line by line, as `[channel] text`, without colors, from line `from` on, when given.
---@param from? integer
---@return string[]
function fiverunner.output(from) end

--- The events that the resources of the server handle, in the order they first registered for them, those of tests left out.
---@return { name: string, resources: string[] }[]
function fiverunner.events() end

--- Calls `check` at each tick until it returns something truthy, and returns that.
---@generic T
---@param check fun(): T
---@param timeout? integer In milliseconds
---@return T
function fiverunner.waitFor(check, timeout) end

--- Has `fn` run in place of a native on the server, for every resource, for the rest of the test.
---@param name string
---@param fn function
function fiverunner.mock(name, fn) end

--- Groups tests.
---@param name string
---@param fn fun()
function describe(name, fn) end

--- Adds a test, which fails if it does not end within `timeout` milliseconds: 5000 unless given.
---@param name string
---@param fn fun()
---@param timeout? integer
function it(name, fn, timeout) end

--- Adds a test.
---@param name string
---@param fn fun()
---@param timeout? integer
function test(name, fn, timeout) end

--- Adds a hook that runs before each test of the describe it is in, or of the file.
---@param fn fun()
function beforeEach(fn) end

--- Adds a hook that runs after each test of the describe it is in, or of the file.
---@param fn fun()
function afterEach(fn) end

--- Checks a value with a matcher, which is called with a dot.
---@param value any
---@return Expectation
function expect(value) end
