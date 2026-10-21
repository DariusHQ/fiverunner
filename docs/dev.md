# The dev UI

`fiverunner dev` runs your project in your browser: its server, with its console and its resources, and players that connect to it, each with a screen that shows the frames of its NUI. No GTA V, no FXServer.

```bash
npx fiverunner dev
```

It tells you where the dev UI is, which is `http://fiverunner.localhost:30120/` unless that port is taken, then the next free one. Open it in Chrome, Edge or Firefox: browsers that take the names under `localhost` for your machine, as the dev UI and the frames of NUI each have one. Stop it with Ctrl+C.

The project is the same as for [`fiverunner test`](testing.md): a resource, when the directory has an `fxmanifest.lua` or a `__resource.lua`, which the server ensures, or a server, when the directory has a `resources` directory, whose `server.cfg` the server runs. Test files are not part of it.

## Options

| Option             | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `-p`, `--port <n>` | Listens on port `n`, or on the next free one. 30120 by default. |
| `-h`, `--help`     | Shows the help.                                                 |

## The server

The console shows what the server prints, with the colors of `^1` to `^9`, its Lua warnings, and what FiveRunner noticed of how your resources use FiveM. The box under it runs commands on the server console, as FXServer's console runs them: `restart bank`, `ensure bank`, `set` and the commands of your resources. The arrow keys go back through the commands you ran.

The resources list shows each resource of the server and its state, with buttons that start, stop and restart it.

## Events

The events panel shows the events that the server and the clients send each other, as they get them: those of `TriggerServerEvent` and `TriggerClientEvent`, latent ones too, and those that FiveM sends of its own, such as `onPlayerJoining`, each with where it came from, where it went, and its arguments, written as Lua would write them.

The form under it triggers an event as the network would: on the server, as a player does with `TriggerServerEvent`, so that `source` is the player, or on the client of a player, or of every player, as the server does with `TriggerClientEvent`. Give the arguments as a JSON array, such as `[100, "cash"]`. Handlers get the event at the next tick, and only those of `RegisterNetEvent` take it, as in FiveM.

## State bags

The state bags panel shows the state bags of the server that have keys, such as `global`, which `GlobalState` sets, and `player:<id>`, which `Player(id).state` sets, with the values of their keys, as they change.

## Players

**Connect a player** starts a client and connects it to the server with the name in the box. It joins as a FiveM client does: the server's `playerConnecting` handlers and deferrals run, then the client downloads its resources and starts them. While deferrals present an adaptive card, the player shows it, with a box for the JSON that its `Action.Submit` would give, which **Submit card** submits. **Disconnect** quits the client, as the player leaving the game does.

Each player has a console of its own, with what its client prints, and a screen: the game window of the client, 1920 by 1080 pixels, scaled to fit, which pages are laid out in.

## NUI

The screen of a player shows the frames of its resources as FiveM's NUI shows them: one for each resource with a `ui_page`, once its scripts loaded, in the order they came, the focused one on top, each hidden until its page loads.

- `SendNUIMessage` posts messages to the frames, which pages get as `message` events, as in FiveM. Messages sent before a page listens are lost, as they are in FiveM.
- `SetNuiFocus(hasFocus, hasCursor)` gives the frames the keyboard while NUI has the focus, and the mouse while it shows the cursor. Without the cursor, the mouse goes to the game, which there is none of, and `GetNuiCursorPosition` follows it over the screen.
- Pages call callbacks as in FiveM: `fetch('https://<resource>/<callback>', ...)`, with `GetParentResourceName`, reach the callbacks of `RegisterNUICallback`, `RegisterNuiCallback` and `RegisterRawNuiCallback`, which answer them at the end of the next tick of the client. Strict mode, the `Origin` of frames and the headers of responses are FiveM's.
- Pages load the files of their resources by relative URLs, and those of any resource that started at `https://cfx-nui-<resource>/`. Requests to other hosts go to the web, such as those for fonts and libraries of CDNs.

Each frame is at an origin of its own, for each resource and each player, as in FiveM, where each is at `https://cfx-nui-<resource>`: pages keep their storage to themselves, and keep it as the project runs anew.

## Changes

As files of the project change, the dev UI runs the project anew: a new server, with the players it had, who connect again in the order they came. The **Restart** button does the same.

## What it does not do

There is no game: the natives of GTA V that FiveRunner does not implement, such as those of the HUD and of the tasks of peds, do nothing and return zero values, as they do in tests, and FiveRunner tells you of the first time a resource calls each. Clients have the ped of their player, and the server the entities that its scripts create, which stay where scripts put them, as [the differences from FiveM](differences.md#entities) tell. The `PerformHttpRequest` of the server sends real requests, through the dev server, where tests send none.

[differences.md](differences.md) lists where FiveRunner differs from FiveM, the dev UI too.

## How it works

The dev UI runs FiveRunner's engine in a web worker of its page, with the files of the project, which it reads of the dev server as the engine needs them. Each origin of frames has a service worker, which answers the requests of their pages: it asks the engine, through a frame of the origin that the dev UI loads first, for the files of resources and what callbacks answer, and gives the documents of frames what FiveM's NUI gives them before their own scripts, such as `GetParentResourceName`.
