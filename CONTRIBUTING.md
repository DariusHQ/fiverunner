# Contributing

FiveRunner follows FiveM down to its error messages, so the most useful thing you can send is a resource that behaves differently here than in FiveM.

## Reporting a problem

[Open an issue](https://github.com/DariusHQ/fiverunner/issues/new/choose) with the smallest resource that shows the problem, what FiveM does, and what FiveRunner does. Look at [docs/differences.md](docs/differences.md) first: it lists where FiveRunner differs from FiveM, on purpose or for now.

When a resource calls a native that FiveRunner lacks, FiveRunner prints this once per native:

```
<name> is not implemented in FiveRunner yet: it does nothing and returns zero values.
```

Send that line, with the resource that called it.

## Working on FiveRunner

You need Node 22 or later. Chrome is only for the tests of the dev UI, and the Emscripten SDK only to rebuild `cfxlua.wasm`, which is committed: [native/README.md](native/README.md) tells how.

```bash
git clone https://github.com/DariusHQ/fiverunner.git
cd fiverunner
npm ci
npm test
```

| Command                       | What it does                                      |
| ----------------------------- | ------------------------------------------------- |
| `npm test`                    | Runs the unit tests                               |
| `npm run typecheck`           | Checks the types                                  |
| `npm run format`              | Formats everything with Prettier                  |
| `npm run build`               | Builds the command line tool and the dev UI       |
| `npm run test:e2e`            | Runs the dev UI in headless Chrome, after a build |
| `node dist/fiverunner.js dev` | Runs your build, from the project of a resource   |

The compatibility suites run real frameworks. Each one is a directory of [compat](compat), whose `resources.txt` pins the releases that `compat/fetch.sh` downloads. It needs `curl`, `unzip` and `sha256sum`, which Git Bash has on Windows. None of those releases is in the repository.

```bash
sh compat/fetch.sh qbox
cd compat/qbox
node ../../dist/fiverunner.js test
```

| Directory    | What it holds                                                     |
| ------------ | ----------------------------------------------------------------- |
| `src/core`   | The engine: Lua, natives, the world, the console and the database |
| `src/runner` | What runs tests                                                   |
| `src/cli`    | The command line tool                                             |
| `src/node`   | What only runs in Node: the disk, and the server of the dev UI    |
| `src/dev`    | The dev UI, and the worker that runs the engine in the browser    |
| `native`     | The sources of `cfxlua.wasm`                                      |

## The clean room

FiveRunner has to stay free of code that it has no right to. These rules cover code, tests and docs:

- Never copy code from the FiveM platform. [citizenfx/fivem](https://github.com/citizenfx/fivem) is "all rights reserved", and its `citizen-*` components are LGPL. Read it to learn what FiveM does, then write your own code, with your own names, structure and comments. Only the names that show in errors and stack traces match FiveM's.
- The documentation of natives (citizenfx/natives, alloc8or's nativedb, DurtyFree's dumps, fivem-docs) has no license, so never copy its databases. The hash or the declaration of a single native is a fact, which you may look up. The typings of `@citizenfx/client` and `@citizenfx/server` are ISC, and feed `src/core/natives/catalog`.
- oxmysql and ox_lib are LGPL-3.0, and ESX and Qbox are GPL. Read them to learn how they behave, and never put them in the repository. Tests have SQL of their own.
- Nothing of Rockstar's ships: no map art, no blip icons, no models.

## Sending a change

- Make one coherent change per commit, with its tests, and say why in its message, as in `fix(dev): keep the messages of frames until their pages load`.
- Every commit passes `npm run format:check`, `npm run typecheck` and `npm test`.
- Test what FiveM does, not what your code does.
- Where FiveRunner starts to differ from FiveM, or stops, change [docs/differences.md](docs/differences.md) with it.
