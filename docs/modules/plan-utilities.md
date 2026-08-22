Given the utilities you already uploaded, you have a strong low-level geometry foundation. You already have `Vec2` operations such as distance, normalization, dot products, perpendiculars, and rotation, which covers most steering math.    You also already have interpolation/clamping and angle helpers in `math.ts`.  

For a bot, I would add a separate `bot/utils/` layer roughly like this:

```text
bot/utils/
├── botMath.ts
├── random.ts
├── perception.ts
├── targeting.ts
├── ballistics.ts
├── navigation.ts
├── steering.ts
├── positionScoring.ts
├── threat.ts
├── timing.ts
├── inventory.ts
├── weapons.ts
├── spatialQuery.ts
├── debug.ts
└── profiler.ts
```

### `botMath.ts`

This should contain AI-specific math rather than duplicating your generic `math.ts`.

Useful functions:

```ts
angleBetween(a, b)
signedAngle(a, b)

distanceToSegment(pos, a, b)

closestPointOnSegment(pos, a, b)

projectPosition(pos, velocity, time)

approach(current, target, delta)

approachAngle(current, target, delta)

expDecay(current, target, decay, dt)

smoothDamp(...)

inverseLerp(...)
```

You already have the basic vector primitives required for these. 

I would especially add `smoothDamp` / exponential interpolation because it is useful for humanized aim and movement.

---

### `random.ts`

Your existing `util` already provides random ranges, random integers, random positions, and a seeded PRNG. 

For bots, extend that with distributions rather than just uniform random numbers:

```ts
normal(mean, stdDev)

truncatedNormal(mean, stdDev, min, max)

chance(probability)

weightedChoice(items)

sampleWithoutReplacement(items, count)

randomDirection()

randomUnitVector()

noise1D(time, frequency)

reactionTime(profile)
```

`normal()` is particularly important.

Instead of:

```ts
reactionTime = random(100, 500);
```

use something like:

```ts
reactionTime = normal(240, 45);
```

because actual player behavior tends to cluster around typical values rather than being uniformly distributed.

---

### `perception.ts`

This is one of the biggest missing utility layers.

Functions like:

```ts
canSee(bot, object)

hasLineOfSight(from, to, layer)

getVisiblePlayers(bot)

getVisibleLoot(bot)

getAudibleThreats(bot)

visibilityScore(bot, target)

timeSinceSeen(target)

estimateEnemyPosition(memory, now)
```

You already have much of the hard geometry necessary for line-of-sight checks. `collisionHelpers.intersectSegment()` searches obstacle intersections along a segment, and it already understands obstacle properties such as collision state, height, windows, and layers.  

So something like this becomes straightforward:

```ts
function hasLineOfSight(
    from: Vec2,
    to: Vec2,
    obstacles: Obstacle[],
    layer: number
) {
    const delta = v2.sub(to, from);
    const distance = v2.length(delta);

    if (distance <= 0.001) return true;

    const dir = v2.div(delta, distance);

    return collisionHelpers.intersectSegment(
        obstacles,
        from,
        dir,
        distance,
        0,
        layer,
        false
    ) === null;
}
```

---

### `spatialQuery.ts`

This could become one of the most important performance utilities.

Don't make every bot repeatedly do:

```ts
for (const player of allPlayers)
for (const obstacle of allObstacles)
for (const loot of allLoot)
```

Instead expose things like:

```ts
getPlayersInRadius(pos, radius)

getObstaclesInRadius(pos, radius)

getLootInRadius(pos, radius)

getProjectilesInRadius(pos, radius)

getObjectsInAabb(aabb)

getNearestPlayer(pos)

getNearestLoot(pos, filter)
```

Eventually back this with a:

```text
spatial hash
quadtree
uniform grid
```

For Surviv.io-style maps, I'd favor a **uniform spatial hash/grid** because it is simple and the world is fundamentally 2D.

This becomes much more important if you're running dozens of bots simultaneously.

---

### `navigation.ts`

Your current collision utilities can tell you whether geometry intersects. For instance, you already support circles/AABBs and segment collision tests.  Your collider abstraction can also transform and convert geometry. 

But the bot still needs higher-level navigation helpers:

```ts
isWalkable(pos, radius)

canWalkDirectly(from, to, radius)

findPath(from, to)

findNearestWalkable(pos)

simplifyPath(points)

pathLength(points)

isPathBlocked(path)

findEscapeDirection(pos, threats)

findPathAroundObstacle(...)
```

A particularly useful utility is:

```ts
canWalkDirectly(a, b, playerRadius)
```

because then you don't need pathfinding constantly:

```text
if direct route clear:
    move directly
else:
    pathfind
```

That saves a lot of CPU.

---

### `steering.ts`

Navigation says where you should go.

Steering says what direction you should press **right now**.

Something like:

```ts
seek(position, target)

arrive(position, target, slowingRadius)

avoidObstacles(...)

separation(neighbors)

strafe(target)

circle(target)

flee(target)

combineSteering(forces)
```

Then:

```ts
const movement =
    seek(bot.pos, desiredPos)
        + obstacleAvoidance(...)
        + projectileAvoidance(...);
```

Normalize that into your actual movement input.

This lets movement remain smooth instead of following waypoints like a robot.

---

### `positionScoring.ts`

This is probably the most valuable utility for making the bot actually *good*.

Have generic candidate evaluation:

```ts
interface PositionScore {
    position: Vec2;

    cover: number;
    exposure: number;
    enemyDistance: number;
    zoneSafety: number;
    lootValue: number;
    escapeValue: number;
    grenadeDanger: number;

    total: number;
}
```

And utilities:

```ts
samplePositionsAround(pos, radius, count)

scoreCover(pos, enemies)

scoreExposure(pos, enemies)

scoreEngagementDistance(pos, target, weapon)

scoreZoneSafety(pos)

scoreEscapeRoutes(pos)

scorePosition(pos, context)

choosePosition(candidates, skill)
```

Then practically every combat behavior can reuse it.

---

### `targeting.ts`

Keep target-selection logic reusable:

```ts
scoreTarget(bot, enemy)

chooseTarget(bot, enemies)

shouldSwitchTarget(current, candidate)

targetPriority(...)

estimateTargetVelocity(...)

estimateTargetDirection(...)
```

For example:

```ts
score =
    threat * 2
    + vulnerability
    + proximity
    + recentDamage
    - cover
    - switchingPenalty;
```

The `switchingPenalty` is important because otherwise bots constantly bounce between targets.

---

### `ballistics.ts`

I would definitely keep projectile prediction isolated.

Something like:

```ts
solveIntercept(
    shooterPos,
    targetPos,
    targetVelocity,
    projectileSpeed
): Vec2 | null
```

Along with:

```ts
travelTime(distance, projectileSpeed)

leadTarget(...)

estimateHitChance(...)

calculateSpread(...)

isShotClear(...)

effectiveWeaponRange(...)
```

The important distinction is:

```text
perfectIntercept
```

versus

```text
humanizedIntercept
```

The former gives the theoretically correct shot.

The latter modifies it based on the bot's prediction skill.

For example:

```ts
const perfect = solveIntercept(...);

const predicted = v2.lerp(
    target.pos,
    perfect,
    profile.predictionSkill
);
```

with some smooth error added afterward.

---

### `threat.ts`

You want one central place to quantify danger:

```ts
scoreEnemyThreat(enemy)

scoreProjectileThreat(projectile)

scoreZoneThreat(pos)

scoreGrenadeThreat(pos)

getMostDangerousThreat(bot)

estimateTimeToDanger(...)
```

This means your decision system doesn't need to understand exactly how grenades, bullets, zone damage, etc. work.

It just receives:

```ts
{
    type: "grenade",
    danger: 0.91,
    direction: ...,
    timeToImpact: 0.55
}
```

---

### `timing.ts`

This sounds minor, but it's important for believable bots.

Useful helpers:

```ts
Cooldown
Timer
ReactionTimer
PeriodicTask
RandomInterval
DelayedAction
```

For example:

```ts
class RandomInterval {
    next: number;

    reset(now: number, min: number, max: number) {
        this.next = now + random(min, max);
    }

    ready(now: number) {
        return now >= this.next;
    }
}
```

Then different bot systems can update at different rates:

```text
movement     60 Hz
aim          60 Hz
perception   10–30 Hz
targeting    5–15 Hz
strategy     2–5 Hz
loot search  1–3 Hz
pathfinding  only when necessary
```

This helps both performance **and** humanization.

---

### `weapons.ts`

This would expose AI-friendly information about weapons:

```ts
getWeaponRange(weapon)

getIdealRange(weapon)

getProjectileSpeed(weapon)

getDps(weapon)

getBurstDamage(weapon)

getReloadPenalty(weapon)

getAmmoUrgency(weapon)

getWeaponScore(weapon, context)

chooseBestWeapon(...)
```

You don't want combat AI scattered with things like:

```ts
if (weapon.type === "mosin")
```

Instead:

```ts
const idealRange = botWeapons.getIdealRange(weapon);
```

---

### `inventory.ts`

Likewise:

```ts
compareWeapons(a, b)

scoreLoot(item, inventory)

shouldPickup(item)

shouldSwap(item)

shouldReload(...)

shouldHeal(...)

bestHealingItem(...)

ammoDesired(...)

inventoryNeeds(...)
```

Your existing `loadout.ts` is concerned with validating cosmetic/loadout data rather than combat inventory decisions. It validates things such as outfit, melee, heal/boost effects, crosshair, and emotes.  So I would keep bot inventory evaluation completely separate.

---

### `cover.ts`

I'd possibly make this its own utility rather than hiding it in positioning.

```ts
findCover(bot, enemy)

isBehindCover(position, enemy)

coverQuality(position, enemy)

getCoverEdge(obstacle, enemy)

findPeekPosition(cover, enemy)

findRetreatSide(cover, enemy)
```

Your segment/collider functions make this feasible without introducing a whole new geometry system.

For example:

```text
Enemy -------- Tree -------- Candidate
```

If a ray from enemy → candidate intersects the tree, that candidate has cover.

Then test small positions to either side of the collider to identify peek positions.

---

### `humanization.ts`

This could expose reusable imperfection functions:

```ts
applyReactionDelay(...)

applyAimNoise(...)

applyPredictionError(...)

applyDecisionError(...)

applyMovementError(...)

applyAttentionDelay(...)

applyHesitation(...)

applySkillVariance(...)
```

The key design is that it shouldn't make decisions itself.

Instead:

```ts
perfectAim = targeting.calculateAim(...);

actualAim =
    humanization.applyAimError(
        perfectAim,
        profile
    );
```

Likewise:

```ts
bestPosition = positionScoring.best(...);

chosenPosition =
    humanization.chooseImperfectly(
        candidates,
        profile
    );
```

---

### `debug.ts`

I would add this **very early**, not after the AI is finished.

Your `scanCollider` utility already accommodates debug-ray output, which is exactly the kind of instrumentation you'll want. 

Have bot debug drawing for:

```text
red line       target
green line     desired movement
yellow line    aim direction
blue circles   candidate positions
red circles    danger
green circles  cover
white polyline current path
text           current goal
```

And show:

```text
Goal: ATTACK
Target: Player 382
Threat: 0.73
Aim confidence: 0.82
Desired distance: 14.0
Path nodes: 3
```

Debug visualization will save you an enormous amount of time.

---

### `botProfiler.ts`

Also useful if you're going to have many bots:

```ts
beginSection("perception")
endSection()

beginSection("navigation")
endSection()
```

Track:

```text
perception:       0.08 ms
navigation:       0.31 ms
position scoring: 0.22 ms
aim:              0.01 ms
decision:         0.04 ms
```

Then you can immediately see what becomes expensive at 50–100 bots.

Your existing logger already has categorized info/debug/warn/error output, so bot profiling/logging can build on it rather than needing another logging implementation.  

### What I think you already have vs. still need

Based on these files, I would classify it like this:

| Utility                          | Status                 |
| -------------------------------- | ---------------------- |
| Vector math                      | ✅ Already good         |
| Generic math                     | ✅ Already good         |
| Collider representation          | ✅ Already good         |
| Collision tests                  | ✅ Already good         |
| Ray/segment obstruction          | ✅ Already good         |
| Layer handling                   | ✅ Already present      |
| Generic RNG                      | ✅ Present              |
| Seeded RNG                       | ✅ Present              |
| Map collider helpers             | ✅ Present              |
| Splines / terrain geometry       | ✅ Present              |
| Bot perception                   | ❌ Add                  |
| Spatial indexing/query           | ❌ Add                  |
| Navigation                       | ❌ Add                  |
| Steering                         | ❌ Add                  |
| Cover analysis                   | ❌ Add                  |
| Position scoring                 | ❌ Add                  |
| Target scoring                   | ❌ Add                  |
| Ballistic prediction             | ❌ Add                  |
| Threat scoring                   | ❌ Add                  |
| Humanized randomness             | ❌ Add                  |
| Bot timers/schedulers            | ❌ Add                  |
| Weapon evaluation                | ❌ Add                  |
| Inventory evaluation             | ❌ Add                  |
| Bot-specific debug visualization | ⚠️ Partially supported |
| Bot profiling                    | ❌ Add                  |

If I were implementing it, the **first six new utilities** I'd build would be:

```text
spatialQuery.ts
perception.ts
navigation.ts
steering.ts
ballistics.ts
positionScoring.ts
```

Then build the bot's basic movement/combat loop on those. After that I'd add `threat.ts`, `humanization.ts`, `weapons.ts`, and the higher-level decision modules.

The notable thing is that you **do not need another collision or vector system**. The uploaded code already gives you enough low-level primitives to build the AI layer on top of it.
