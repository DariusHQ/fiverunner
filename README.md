<p align="center">
  <img src="src/dev/public/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">FiveRunner</h1>

<p align="center">Run FiveM resources in your browser and in CI.<br>No GTA V, no FXServer, no restarts.</p>

> **Status:** early development. `npx fiverunner test` runs the Lua tests of FiveM resources in Node, and `npx fiverunner dev` runs resources and their NUI in your browser. Watch the repository to follow along.

![The appearance editor of illenium-appearance on the screen of a player, over a cartoon meadow where her little character wears what the editor picks](docs/media/appearance.png)

**[Watch the demo](https://github.com/DariusHQ/fiverunner/releases/download/v0.9.0/fiverunner.mp4)** (122 seconds, with sound): the whole Stable recipe of Qbox for txAdmin, tested, then in the dev UI, where a player registers a character, dresses her in illenium-appearance, opens ox_inventory and the bank of Renewed-Banking, and is dragged across the map to a garage, where she takes her car out.

```bash
npx fiverunner test
npx fiverunner dev
```

- **Real resources, as they are released.** The 43 resources of the Stable recipe of Qbox start on your machine in seconds: its core, its inventory, its garages, its bank.
- **Real NUIs.** Your pages run in a browser, and talk to your callbacks as they do in FiveM: the appearance editor, the inventory and the bank of the recipe work as players use them.
- **Tests in CI.** Each test gets a server of its own, players, and a database in memory, and time moves as fast as it can.
- **A world to look at.** Under the frames of NUI, the screen of each player shows the world round their ped, as a cartoon or in the style of GTA V, and the cartoon dresses them as your scripts do.

## Testing resources

Start with a test that your resource or server starts without script errors, and a GitHub workflow that runs it on each push:

```bash
npx fiverunner init
```

Write tests in files whose names end in `.test.lua`, next to your resource:

```lua
describe('bank', function()
    it('takes deposits', function()
        local ann = fiverunner.connect({ name = 'Ann' })
        ann:emit('bank:deposit', 100)
        expect(exports.bank:balance(ann.id)).toBe(600)
    end)
end)
```

Then run them, on your machine or in GitHub Actions:

```bash
npx fiverunner test
```

![The tests of QBox, passing in a terminal](docs/media/tests.png)

Each test gets a server of its own, with your resources started, and players whose clients run your client scripts. Resources that use oxmysql get a database of their own, in memory, that speaks MariaDB's SQL and starts with the tables of your `.sql` files. Time moves as fast as it can, so tests that wait take no time. [docs/testing.md](docs/testing.md) tells all that tests can do, and [examples/bank](examples/bank) is a resource with tests.

## Developing resources

Run your project in your browser:

```bash
npx fiverunner dev
```

The dev UI has the console of your server, where you run commands, its resources, which you start, stop and restart, the events that the server and the players send each other, which you trigger too, its state bags, and a map of its entities and of the blips of the players, classic, as a cartoon or in the style of GTA V, where you drag players to move them. Connect players, whose clients run your client scripts, each with a screen that shows the frames of its NUI over the world round their ped: click through your pages, which talk to your callbacks as they do in FiveM. As you save files, the dev UI restarts the resources that they belong to, and the players stay. [docs/dev.md](docs/dev.md) tells all that it does.

![The Stable recipe of Qbox in the dev UI: the console of its server, the events that its player sent, its resources and state bags, and the map of its world](docs/media/dev-ui.png)

![The map of the dev UI in the style of the pause menu of GTA V: the blips that the resources of Qbox put on the map of a player, with its header, a legend and its buttons](docs/media/map-gta.png)

![The map of the dev UI as a cartoon: the blips of Qbox as the tokens of a board game, on a meadow with trees](docs/media/map-cartoon.png)

## Frameworks

QBox and ESX run on FiveRunner: CI runs qbx_core, ox_lib, ox_inventory, qbx_vehicles and es_extended, as they are released, on every change, with players who log in, earn money, carry items, get jobs and are saved as they leave. [docs/compatibility.md](docs/compatibility.md) lists what passes.

So does the whole Stable recipe of Qbox for txAdmin, with its 43 resources: they start without errors but those of npwd, whose phone is JavaScript, which FiveRunner does not run. A player takes a car out of a garage of qbx_garages, picks clothes in illenium-appearance, and opens ox_inventory and the bank of Renewed-Banking, as [its tests](compat/qbox-stable/tests/recipe.test.lua) check, which CI runs on every change on all of its resources but npwd and screencapture.

![The character registration of QBox, from the NUI of ox_lib, on the screen of a player in the dev UI](docs/media/qbox-registration.png)

![The Motel Parking of qbx_garages, from the NUI of ox_lib, with the car of the player and E - Open Garage, on the screen of a player in the dev UI](docs/media/garage.png)

![The inventory of ox_inventory on the screen of a player, with the pictures of her money and her phone](docs/media/inventory.png)

![The bank of Renewed-Banking on the screen of a player, with her personal account and her balance](docs/media/bank.png)

## Planned

- A playground in the browser, which runs resources without installing anything.

## How it works

Your scripts run on CfxLua, the Lua 5.4 runtime FiveM ships, compiled to WebAssembly: the same syntax extensions, vectors and quaternions, `json` and `msgpack`. Each resource gets its own Lua state, one per side and per player, the same isolation FiveM gives you. On top of that, FiveRunner reimplements the Cfx scripting runtime: events with `source` and net-safety, exports, function references, state bags, threads and `Wait`, and the natives API.

Servers also get FiveM's own `io` and `os` libraries, its VFS and file permissions, its HTTP client and server, its server variables and its console, and oxmysql, whose exports run on SQLite, which FiveRunner teaches MariaDB's SQL.

## Differences from FiveM

FiveRunner follows FiveM's Windows server and its clients down to their error messages and their quirks. Where it differs, on purpose or for now, [docs/differences.md](docs/differences.md) says so.

## Clean room

FiveRunner's scripting runtime is a clean-room implementation and contains no code from the FiveM platform. CfxLua and its libraries are open source; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). FiveRunner is not affiliated with or endorsed by Cfx.re, Rockstar Games or Take-Two Interactive.

## License

[MIT](LICENSE)
