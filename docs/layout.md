Directory: server/src/game/bots

Bots
- Modules
    - Combat
        - Aiming, cover, reload
    - Loot
        - Ranking loot types & sources
    - Navigation
        - Getting from 1 location to another
- Utilities (for ones not already in shared/utils)
    - Random
    - Check if line segment through 2 points intersects an active object
    - Interpolate
- main.ts
    - Calls Modules to help with specific actions
- load-bots.ts: adds bots to the game.