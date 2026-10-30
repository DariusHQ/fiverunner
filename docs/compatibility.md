# Compatibility

FiveRunner's CI runs real frameworks, as they are released, on every change. Each suite in [compat](../compat) is a server: its `server.cfg`, the tests that FiveRunner runs on it, and the releases, or the commits, of the resources it runs, which [compat/fetch.sh](../compat/fetch.sh) downloads and checks against their SHA-256. None of them is in this repository.

This page lists only what passes.

## QBox

| Resource     | Version |
| ------------ | ------- |
| qbx_core     | 1.24.0  |
| ox_lib       | 3.41.0  |
| ox_inventory | 2.48.0  |
| qbx_vehicles | 1.4.2   |

[The tests](../compat/qbox/tests/qbox.test.lua) check that:

- the resources start without script errors, on the server and on the client of a player;
- players log in with characters that the database keeps;
- cash is the money of the inventory, as ox_inventory keeps it;
- items are given and taken;
- players get jobs;
- the characters of players that leave are saved.

## Qbox Stable

The Stable recipe of Qbox for txAdmin, as it deploys a server, but npwd and screencapture, which are JavaScript, and the items of ox_inventory that it writes over those of its release. ox_lib comes with cfxlua-require.

| Resource               | Version        |
| ---------------------- | -------------- |
| mapmanager             | commit c6afa39 |
| spawnmanager           | commit c6afa39 |
| baseevents             | commit c6afa39 |
| qbox.sql of the recipe | commit 0a12aa7 |
| ox_lib                 | 3.41.0         |
| oxmysql                | 2.14.3         |
| ox_target              | 1.18.1         |
| ox_doorlock            | 1.23.0         |
| ox_inventory           | 2.48.1         |
| ox_fuel                | commit 84f93ba |
| qbx_core               | 1.24.0         |
| qbx_vehicles           | 1.4.2          |
| qbx_radio              | 1.0.0          |
| qbx_management         | 1.4.0          |
| qbx_diving             | 1.1.1          |
| qbx_divegear           | 1.0.1          |
| qbx_binoculars         | 1.1.1          |
| qbx_truckrobbery       | 1.1.1          |
| qbx_garages            | 1.1.4          |
| qbx_smallresources     | 0.2.0          |
| qbx_density            | 1.0.1          |
| qbx_adminmenu          | 0.1.0          |
| qbx_hud                | 0.1.0          |
| qbx_spawn              | 0.1.1          |
| qbx_customs            | 0.1.0          |
| bob74_ipl              | commit 037dd6c |
| safecracker            | commit 9252ee8 |
| mhacking               | commit 3b7013a |
| scully_emotemenu       | commit 8d22fa5 |
| ultra-voltlab          | commit f673755 |
| MugShotBase64          | commit 9fac1e8 |
| Renewed-Banking        | 2.1.4          |
| Renewed-Weathersync    | 1.1.8          |
| illenium-appearance    | 5.7.0          |
| loadscreen             | 2.2.1          |
| mana_audio             | 1.1.1          |
| xt-prison              | 1.4.9          |
| vehiclehandler         | 1.4.7          |
| pma-voice              | commit 6c9d96e |

[The tests](../compat/qbox-stable/tests/recipe.test.lua) check that:

- the resources start without script errors;
- a player who logs in walks up to the Motel Parking of qbx_garages, which ox_lib tells to press E, presses E, chooses the car of the character in the menu of ox_lib, and takes it out, which qbx_garages spawns where the garage has its cars come out;
- the appearance editor of illenium-appearance gives a freemode character clothes and colours to pick from;
- a player who logs in opens the inventory of ox_inventory on the key that binds it, and the bank of Renewed-Banking, with the accounts of the character.

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
