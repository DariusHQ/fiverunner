# Auditing servers

Cheaters run code in their clients, and their first trick is to trigger the events of the server with arguments of their own: a payment of a million, an item that the shop never sold, the job of police. `fiverunner audit` does the same to your server, in FiveRunner, and tells you what each event let any client do.

```bash
npx fiverunner audit
```

It runs the project in the directory it runs in, as `fiverunner test` does: a resource, or a server with its `server.cfg`. A player joins, and logs in with a new character when Qbox, QBCore or ESX runs: through `Login` of qbx_core, the page of qb-multicharacter or `QBCore.Player.Login`, or ESX as it logs players in. Then the player triggers each event that a resource of the server handles, with each of these arguments:

- none
- `1000000`, then `-1000000`
- `'money', 1000000` and `'bank', 1000000`
- an item of the server, from ox_inventory or the framework, with `100`
- `'police', 4`
- the id of the player, with `1000000`
- a table of `amount`, `count`, `item`, `money` and `price`

First, a scout triggers every event at once and leaves: the events that no resource registered with `RegisterNetEvent` are left out, as FiveM refuses them from clients, and say so. The player logs in after it, and the audit waits until what the player holds stops changing, as frameworks give new characters their starter items a moment after they log in.

## What it tells

Here is ESX with a resource whose events trust their clients: `exploit:pay` pays what it is asked, `exploit:safe` checks that the amount is between 0 and 100, which still pays any client 100 as often as it likes, and `exploit:crash` expects a table:

```text
The server runs the framework esx, with a character for the player.

High: what any client gains
  exploit  exploit:pay(1000000)  money +1000000
  exploit  exploit:safe(2, 1000000)  money +2

Low: errors on what clients send
  exploit  exploit:crash()  error: [script:exploit] SCRIPT ERROR: @exploit/server.lua:22: attempt to index a nil value (local 'data')

Events: 111, of which clients may trigger 19. Findings: 2 high, 0 medium, 1 low.
```

For each event, it tells the arguments that did the most, and what they did:

- **High**: the player gained money of an account, items, a job, a gang or a group of its framework, or the right to run every command, and paid nothing. Any client can do the same on your server. Money counts only when the same arguments bring more again, as pay that comes on its own, such as paychecks, would come at the time of some event, so a bonus that comes once does not show. What an event gives after it waited, such as items that a loop gives one by one, counts for that event once the player holds the same for a second, as `later:`, rather than for the next event.
- **Medium**: the player gained something and paid money for it, such as an item of a shop, rows of the database changed, or the server created entities. Many events do this on purpose, such as those that save a character, but they take what clients send. The audit reads the database once all the arguments of an event went, as reading it takes long, so it tells no arguments for a change of the database.
- **Low**: a script failed on the arguments. A client can make the event fail as often as it likes.

What drops the player, or logs it out, is told too. Such an event gets no more arguments, as anti-cheats ban whoever triggers it, and a new player logs in for the events after it.

It exits with 1 when it found anything of high severity, and 0 otherwise, so a workflow fails on a new exploit. `--json` writes what it found as JSON instead. How far it got goes to stderr, as servers with many resources take minutes.

## What it cannot tell

It finds what its arguments reveal, so no finding is no proof that an event is safe:

- An event that wants other arguments, such as the name of a shop and an index in it, keeps its exploit from these.
- It reads what players hold through Qbox, QBCore, ESX and ox_inventory. Money of a resource of its own shows only as a change of the database, once the resource saves it.
- It triggers events from one player, so what one player does to others, such as fining them or teleporting them, does not show.

Everything runs in FiveRunner, on your machine: no event reaches your server, and scripts send no HTTP requests.

## What it finds in the resources of others

Tell their authors privately first, and give them time to fix it before anyone talks about it in public, as [SECURITY.md](../SECURITY.md) says.
