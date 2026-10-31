# A city

A small server to play with, in FiveRunner's own code: citizens move in through an adaptive card, and the database keeps them and their money. They buy food at a shop, carry it in an inventory, and take a car out of a garage, on `E`, as the HUD tells them. Their phone is JavaScript, and carries their messages.

| Resource         | What it has                                                |
| ---------------- | ---------------------------------------------------------- |
| `city`           | Citizens, money, the HUD, and the places that `E` acts in  |
| `city_inventory` | Items, a shop and the page of the inventory, on `I`        |
| `city_garage`    | Cars that the server creates                               |
| `city_phone`     | Messages, in JavaScript, and the page of the phone, on `M` |

Play it in your browser:

```bash
npx fiverunner dev
```

Connect a player, answer the card, and walk with W, A, S and D to the blips of the map. [Its tests](tests/city.test.lua) play it too:

```bash
npx fiverunner test
```
