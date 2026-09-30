# Starting perks

Edit the root `game-config.json` to set starting perks for human players and internal AI bots independently:

```json
{
  "player": {
    "defaultItems": {
      "perks": [{ "type": "full_adrenaline", "droppable": false }]
    },
    "botStartingPerks": [
      { "type": "full_adrenaline", "droppable": false }
    ]
  }
}
```

The example shows the two fields; keep the other `defaultItems` fields already in `game-config.json`. Set either list independently. `full_adrenaline` starts boost at 100 without changing player size. `leadership` remains a separate perk and still changes size. Each list accepts up to four distinct, valid perk IDs. The checked-in lists retain the existing starting perks for both groups.
