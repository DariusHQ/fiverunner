# Compatibility

FiveRunner's CI runs real frameworks, as they are released, on every change. Each suite in [compat](../compat) is a server: its `server.cfg`, the tests that FiveRunner runs on it, and the releases of the resources it runs, which [compat/fetch.sh](../compat/fetch.sh) downloads and checks against their SHA-256. None of them is in this repository.

This page lists only what passes.

## QBox

| Resource     | Version |
| ------------ | ------- |
| qbx_core     | 1.24.0  |
| ox_lib       | 3.40.3  |
| ox_inventory | 2.48.0  |
| qbx_vehicles | 1.4.2   |

[The tests](../compat/qbox/tests/qbox.test.lua) check that:

- the resources start without script errors, on the server and on the client of a player;
- players log in with characters that the database keeps;
- cash is the money of the inventory, as ox_inventory keeps it;
- items are given and taken;
- players get jobs;
- the characters of players that leave are saved.

## ESX

| Resource                                         | Version |
| ------------------------------------------------ | ------- |
| es_extended and its `legacy.sql`                 | 1.16.4  |
| esx_lib, cron, esx_context                       | 1.16.4  |
| esx_menu_default, esx_menu_dialog, esx_menu_list | 1.16.4  |
| esx_notify, esx_progressbar, esx_textui          | 1.16.4  |
| skinchanger, esx_skin                            | 1.16.4  |

It runs ESX without esx_multicharacter and esx_identity, whose pages no test drives yet, as ESX runs when they are missing: players load as they join. [The tests](../compat/esx/tests/esx.test.lua) check that:

- the resources start without script errors, on the server and on the client of a player;
- players load, and the database keeps them;
- money is given and taken, in cash and in the bank;
- items are given and taken;
- players get jobs;
- players that leave are saved.

## Running a suite

Run a suite on your machine, from the root of the repository, with `curl`, `sha256sum` and `unzip`:

```bash
sh compat/fetch.sh qbox
```

```bash
npm run build && cd compat/qbox && node ../../dist/fiverunner.js test
```
