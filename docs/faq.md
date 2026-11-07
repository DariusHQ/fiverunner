# Questions

## Is it a way to play FiveM without GTA V?

No. FiveRunner runs the scripts of FiveM resources so that you can develop and test them. It has no game, no 3D world and no physics, and nobody can join a FiveM server with it. Its players are test players, who walk and drive on a 2D map. To play, you need GTA V and FiveM.

## Does it contain FiveM's code?

No. It is a clean-room implementation: none of the code of the FiveM platform is in it. It follows how FiveM behaves, from its documentation and from what scripts do on it. The Lua that FiveM ships, CfxLua, is MIT-licensed, and FiveRunner builds it from its sources. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists everything that it includes.

## Will my scripts run on it?

Most do:

- The recipes of Qbox, QBCore and ESX for txAdmin boot in its CI on every change, and their tests pass.
- Of the 80 most starred FiveM repositories of GitHub, 69 had resources that FiveRunner could lay out. 53 of those pass the tests that `fiverunner init` writes, which start the server, connect a player, log it in with a character where the server runs Qbox, QBCore or ESX, and fail on any script error.

Try yours in the [playground](https://dariushq.github.io/fiverunner/) with `?gh=owner/repo`. If it does not run, [tell us](https://github.com/DariusHQ/fiverunner/issues/new?template=compatibility.yml).

## What does it not run?

- Resources in C#.
- Scripts under asset escrow, which it skips with a message that says so.
- Anything that needs the game itself: collisions, shooting, physics, the models of the world.

[docs/differences.md](differences.md) lists every difference from FiveM.

## Does it replace a test server?

No. It is where a change runs in seconds, where tests run in CI, and where you find what breaks before your players do. What needs the game, such as how a car drives or how an animation looks, you still try on a server.

## What does it need?

Node 22 or later: no FXServer, no MySQL, no Docker. oxmysql's exports run on a database in memory that speaks MariaDB's SQL and starts with the tables of your `.sql` files.

## Does it send anything anywhere?

No. FiveRunner has no telemetry. In tests and audits, scripts send no HTTP requests. In `fiverunner dev`, scripts send theirs, as they would on a server. The playground reads repositories from GitHub, in your browser. When GitHub refuses to list one, as it does once your address used its hour, the playground asks [ungh.cc](https://github.com/unjs/ungh), a public proxy of GitHub's API, for the list of its files, which tells ungh.cc the name of the repository.

## Why does the playground say I used my 60 repositories of the hour?

GitHub lets a visitor list 60 repositories an hour without signing in, and the playground reads each repository that a link needs through it. A link to Qbox reads about six. Addresses that many people share, such as those of VPNs, use the hour up fast. The playground then lists the repositories through [ungh.cc](https://github.com/unjs/ungh), a public proxy of GitHub's API, and reads their files from GitHub at the commit that it listed, so it says this only when ungh.cc cannot list them either. Try again in the hour that it tells you.

## Is `fiverunner audit` an anti-cheat?

No. It finds the events of your server that trust what clients send, so you can fix them before cheaters find them. It runs your server in FiveRunner, not your live server, and catches nobody. [docs/audit.md](audit.md) tells how it works.

## Can AI assistants use it?

Yes, and it is what they lack: they cannot run FiveM, so they guess what the code they write does. `fiverunner mcp` lets Claude Code, Codex, Cursor and VS Code run your server while they work on it: they connect players, trigger events, run your tests and read what broke, then fix it and check again. [docs/mcp.md](mcp.md) tells how to set it up in each.

## How can I help?

Star the repository, so that others find it. Tell us what breaks, with a link that shows it. Read [CONTRIBUTING.md](../CONTRIBUTING.md) if you want to change something yourself.
