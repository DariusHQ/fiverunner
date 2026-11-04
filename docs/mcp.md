# AI assistants

`fiverunner mcp` serves the [Model Context Protocol](https://modelcontextprotocol.io), so AI assistants such as Claude Code, Codex, Cursor and VS Code can run your FiveM project in FiveRunner while they work on it. They can run its tests, try Lua against a fresh server of it, see what started and what failed, and audit its events. They see what your scripts really do, with no GTA V, no FXServer and nothing for you to click.

## Setting it up

It runs the project of the folder that the assistant starts it in: a resource, or a server with its resources directory.

Claude Code, in the folder of the project:

```bash
claude mcp add fiverunner -- npx -y fiverunner mcp
```

On Windows, Claude Code starts `npx` through `cmd`:

```bash
claude mcp add fiverunner -- cmd /c npx -y fiverunner mcp
```

Cursor, in `.cursor/mcp.json` of the project:

```json
{
  "mcpServers": {
    "fiverunner": { "command": "npx", "args": ["-y", "fiverunner", "mcp"] }
  }
}
```

VS Code, in `.vscode/mcp.json` of the project:

```json
{
  "servers": {
    "fiverunner": { "type": "stdio", "command": "npx", "args": ["-y", "fiverunner", "mcp"] }
  }
}
```

Codex, started in the folder of the project:

```bash
codex mcp add fiverunner -- npx -y fiverunner mcp
```

Codex waits 10 seconds for a server to start and 60 for a tool, which the first download of FiveRunner, the tests of a big server or an audit can take longer than. Give it more in `~/.codex/config.toml`, or in `.codex/config.toml` of a project that Codex trusts:

```toml
[mcp_servers.fiverunner]
command = "npx"
args = ["-y", "fiverunner", "mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 600
```

It runs the project of the folder that Codex starts in, or of the folder that `cwd` names. On Windows, if Codex cannot start `npx`, start it through `cmd`: `command = "cmd"` and `args = ["/c", "npx", "-y", "fiverunner", "mcp"]`.

## Its tools

- **describe_project** tells whether the project is a resource or a server, and the resources that its server started, with their states. It also gives what they printed as they started, such as script errors, and the test files.
- **run_tests** runs the `*.test.lua` files of the project, or those in the paths that it gets, as `fiverunner test` does. It tells which passed and failed, with what the server and players printed for each failure.
- **run_lua** runs Lua code as the body of a test, in a fresh server of the project. It tells whether the code failed, at its own lines, and what the server and players printed. The code has [the API of tests](testing.md): it connects players, triggers events from their clients, calls NUI callbacks, reads what they received and printed, mocks natives and checks values with `expect`. `Wait` takes no real time.
- **audit** triggers the events of the server that clients may trigger, as [`fiverunner audit`](audit.md) does. It tells how far it got through the progress notifications of the protocol, as servers of many resources take minutes.

For example, an assistant that wrote a shop can check what happens when a player buys something, instead of guessing:

```lua
while GetGameTimer() < 3000 do Wait(100) end
local ann = fiverunner.connect({ name = 'Ann' })
ann:emit('shop:buy', 'water')
Wait(100)
print(json.encode(ann:received('shop:bought')))
```

The tools run one at a time, each in servers of its own, which start the project anew. What one tool does, the next does not see. Everything runs on your machine, and scripts send no HTTP requests.
