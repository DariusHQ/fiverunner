# Differences from FiveM

FiveRunner follows FiveM's Windows server and its clients as closely as it can, down to their error messages and their quirks. This page lists where it differs, on purpose or for now.

## Scripts

- Stack traces name FiveRunner's own scripts after it, such as `@fiverunner:/scheduler.lua`, where FiveM names its own, and those frames are not the same as FiveM's.
- NaN prints as `-nan` and `nan`, as the C library of FiveRunner's WebAssembly build writes it, where FiveM's MSVC build writes `-nan(ind)` and `nan`. This goes for `tostring`, `string.format` and `f:write`.
- Where FiveM throws exceptions with MSVC's texts, such as for convars that `std::stof` reads, FiveRunner approximates the texts, and the sign of the NaN that `std::stof` reads.

## Console

- Command lines with surrogates encoded in UTF-8 keep a high and a low surrogate as the one character they spell, where FiveM writes them back to UTF-8 one by one.
- The raw lines of commands are text, so bytes that are not UTF-8 do not come back as they were.
- The wildcards of channel filters and convar change listeners follow JavaScript's regular expressions on line breaks, where FiveM uses `std::regex`.
- A console listener that prints what it hears stops hearing prints after 16 levels, where FiveM recurses until the server crashes.
- KVP lives in memory, not in a database.

## Server

- FiveM's built-in variables are all defined, with their types, flags and defaults, but FiveRunner acts on few of them. It runs GTA V only, with no switch to RDR3 by `gamename`. `citizen_dir` is not defined, `sv_infoVersion` stays 0, there is no `increase_pool_size`, and `version` reads `win32`, as FiveRunner follows FiveM's Windows build throughout.
- `endpoint_add_tcp` and `endpoint_add_udp` listen nowhere and resolve no names. The first TCP endpoint still sets the primary port.
- There are no system resources.
- Directories list in the order of NTFS, for scans of resources as for `io`, whatever order the files of the host have, with upper case as JavaScript has it for each UTF-16 code unit, which can differ from the table of an NTFS volume for a few characters.
- Relative paths of resources use forward slashes, with no doubled slashes.
- Nothing is rate-limited: events, latent events, state bags, commands and HTTP requests.

## Players

- `GetPlayers` lists players in the order they connected.
- Clients download resources at their next tick and start them at the one after. Ping is 0 unless set, and `lastSeen` moves with the ticks of clients.
- A client that fails to start a resource goes on, with a diagnosis, where FiveM's client stops with "Couldn't start resource".
- A client that leaves resets its resources at its next tick, where FiveM's does once its game session ends. A start that the client had pending for a resource that it removed meanwhile does not happen, where FiveM's race would start a destroyed resource.

## Entities

- Nothing moves entities but scripts: there is no game to drive, walk, fall or collide, and no models, so `SetEntityCoords` puts entities where it is told, without lifting them by the sizes of their models.
- The ped of the player of a client starts as `player_zero` at 0, 0, 0, turned to the north, and the handles of the entities of clients come from a pool of their own, so they are not those GTA V would give. Clients calculate the rotations of entities in double precision, then round them to single precision, and take orders of rotations other than 0 to 5 as 2.
- Without OneSync, clients know no other players, where GTA V's sessions have them: `GetActivePlayers` lists the local player alone, at 0.
- Every model but 0 is in FiveRunner's CD image, and loads at the next tick of a client once a script requests it, which it stays. FiveRunner has no list of the models of GTA V, so `IsModelAVehicle` and `IsModelAPed` say true only of the models that scripts created vehicles or peds of, and false of others, with a diagnosis. Vehicles that clients create are automobiles, whatever their models.
- There is no population to take away the entities that scripts no longer need, nor those of resources that stop, which stay, but as mission entities of no script.
- The screens of clients start faded in, and fade in the time of their clients, at the pace that the durations of fades set, from where they are when scripts fade them, which nothing shows. Collision is loaded around every entity, as there is none.
- Servers send each client the entities within 424 metres of the ped of its player, on the ground, as FiveM's culling does by default, and the first client that an entity is near takes it if no client owns it. Owners that are no longer near an entity hand it to the next client near it, and keep it until then if their scripts own it or they did not sync it yet. Players come into the scopes of the clients near them as their entities do. There are no world grids, no culling radii that scripts set, no routing buckets yet, and clients get no control of entities as they ask for it. Servers send what changed as each of their ticks ends, which clients take at their next ticks.
- The entities of clients that drop go with them, where FiveM's server hands those it can to the clients near them.
- The natives of entities, players, peds, weapons, tasks and vehicles that FiveM's server has clients run, such as `SetEntityCoords`, `FreezeEntityPosition`, `SetPedArmour` or `SetVehicleNumberPlateText`, run on the clients that own the entities, as they do with OneSync, but do nothing there when the clients do not implement them yet, with a diagnosis. Clients take every hash that they are given for a model, which they load before they run the native, as FiveRunner's CD image has every model but 0. Those that create entities, `CreateVehicle`, `CreateObject` and `CreatePedInsideVehicle`, have the client whose ped is the nearest to where the entity goes create it, and those as near as others in the order they joined, where FiveM's server takes them in the order of their addresses in its memory. Those of blips are not implemented on servers yet.
- With OneSync, `GetEntityCoords` on servers gives what is no entity at 0, 0, 0, or where `SetEntityCoords` put the entities that clients create for the server until they come, as FiveM's server does, where it gives what its memory holds for the others.
- Clients sync what changed in the entities they network as each of their ticks ends, which their servers take at the start of their next ticks. They write floats as FiveM's server does, truncated to the steps of their bits, where GTA V's clients may round them, and objects sync as vehicles do, by 12 bits in their sectors and quaternions. A client that has no object id left to network an entity with creates nothing, and returns 0 with a diagnosis. Without OneSync, no entity is networked.
- `GetGamePool`, `GetAllVehicles`, `GetAllPeds` and `GetAllObjects` list entities in the order they were created, where FiveM's server lists them in the order of their addresses in its memory, and its clients in the order of the slots of their pools. So do the searches of `FindFirstPed` and the others.
- The ticks of the server stand for those of FiveM's sync thread: an entity that a script deletes exists until the next tick, and goes at its end, after `entityRemoved`, where FiveM's sync thread gets to it a few milliseconds later, whatever the main thread does meanwhile.

## Events and state bags

- Latent events arrive by a deadline: the end of the sender's tick, plus the latency in whole milliseconds for each fragment after the first. Nothing is acknowledged or sent again, and pending events have no limit: `sv_netEventReassemblyMaxPendingEvents` is defined but not enforced.
- The packets of state bags have no size limit, and arrive at the start of the other side's next tick. Clients send what they set of the bags of the entities that they create before their servers took them, the first value of each key, as FiveM's do, but in the order they set them, where FiveM's clients send them in the order of a hash map.

## HTTP

- `PerformHttpRequest` sends requests with `fetch` by default. Header names come back in lower case, repeated headers are joined but `Set-Cookie`, GET and HEAD send no body, TLS certificates are verified, which FiveM does not do, requests use HTTP/1.1 only, and curl's error texts are approximated. Browsers also hide redirects. `PerformHttpRequestInternal`, the JSON variant, is not implemented.
- The HTTP server listens nowhere by itself: embedders hand it requests through `HttpServer.request`. Of FiveM's own endpoints, only `/` exists, with no `/info.json`, `/players.json`, `/dynamic.json`, `/client`, `/files/` or `/perf/`. Requests come whole, so FiveM's loss of chunked bodies sent before `setDataHandler` does not happen. The server speaks HTTP/1.1 only, leaves `Date` and `Connection` to the transport, and writes nothing after a response ends, where FiveM writes past it.

## NUI

- Clients keep the frames of NUI, its focus and its callbacks, but show no pages themselves: embedders show frames, hand the requests of pages to `Nui.request` and `Nui.file`, and pass messages on. `ui_page_preload` changes nothing.
- There is no loading screen, so `SendLoadingScreenMessage` always fails, as it does in FiveM once the loading screen shut down. There is no DUI: `CreateDui` and the other DUI natives do nothing, as natives FiveRunner does not implement do.
- Pages get 404 for manifests and for client scripts that no `file` entry names, where FiveM serves the game's `gameconfig.xml` in their place.
- Callbacks that answer with what FiveM fails to convert leave their requests unanswered, with a diagnosis, where FiveM throws.
- Requests and files of resources whose names differ only in case go to the one added last, where FiveM's pick follows the order of its hash map of resources.

## The dev UI

- Pages run in the browser that shows the dev UI, rather than in FiveM's Chromium, at `http://<host>.c<player>.<tab>.fiverunner.localhost:<port>`, where FiveM has them at `https://cfx-nui-<resource>` or `nui://<resource>`, which `location` tells pages.
- The names of the headers of the requests of pages come capitalized word by word, as in `Content-Type`, as browsers do not tell service workers their case. Requests carry the `Origin` of their frames whatever their methods and schemes.
- Responses with statuses outside 200 to 599, which browsers do not take, fail their requests.
- Absolute `nui://` URLs in pages do not load, and frames in pages at `https://cfx-nui-` URLs load from the web, which has no such hosts: pages load the files of their own resources by relative URLs.
- Pages at URLs of the web, which `ui_page` can name, load from the web, as do their requests to resources.
- There is no game view: `CfxGameViewRenderer` and `application/x-cfx-game-view` objects are not there.
- As files change, the whole project runs anew, with its players, rather than the resources that changed restarting.

## os and io (servers)

- Names of local time zones come from `Intl`, which can differ from Windows' names for `%Z`.
- `os.rdtsc` and `os.rdtscp` read no real time stamp counter: they count 3 ticks for each nanosecond of the steady clock.
- Paths know only the mounts of resources, `@name/`, and the server's own files: none of FiveM's `citizen:/`, `cache:/`, `kvs:/` and `memory:` devices, nor absolute paths of the host.
- Where FiveM reports `errno` as earlier calls left it, for `io.flush`, `io.tmpfile`, failed `f:write` and `f:flush`, and failed `io.popen`, FiveRunner reports 0, "No error".
- `f:read` with a count above 2^31 - 1 fails with "not enough memory", where FiveM fails or not by what it can allocate.
- Files are shared as FiveM's own handles share them, with no other processes or antivirus locks.

The rest of FiveM's VFS rules, the 64 KiB read-ahead of `f:lines`, the quirks of `f:read`, the cutting of files after writes and the 32-bit seeks of `SetFilePointer` are emulated as FiveM has them.
