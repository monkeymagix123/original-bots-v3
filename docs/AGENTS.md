# Mission

Design and implement high-quality server-side bots for Survev.io that are:

- Fun to play against.
- Useful for training real players.
- Configurable across multiple difficulty levels.
- Believable as human opponents rather than obviously robotic AI.
- Capable of exhibiting different playstyles, strengths, weaknesses, and behavioral quirks.

The system should support multiple bot variants/configurations rather than one universally optimal bot.

The most important objective is **not maximum bot strength**. The objective is to create opponents that behave like plausible human players of different skill levels.

---

# 1. First understand the game

Before making major bot changes, inspect the existing game and server code.

Relevant repositories:

- `github.com/leia-uwu/survev`
- `github.com/NAMERIO/resurviv`
- Files in this folder

Determine:

- How player movement is represented and validated.
- Player acceleration, velocity, collision, and movement-speed rules.
- Weapon mechanics.
- Projectile mechanics.
- Reloading and weapon switching.
- Melee mechanics.
- Obstacles and collision geometry.
- Buildings and doors.
- Loot and inventory systems.
- Healing and boost mechanics.
- Armor.
- The shrinking zone.
- Player visibility and information normally available to clients.
- Server tick/update rates.
- Existing bot code, if any.
- What information a server-side bot has access to that a human player normally would not.

Do not blindly exploit server-side omniscience.

Build a bot perception layer that deliberately restricts what the decision-making AI knows.

---

# 2. Architecture

Separate bot behavior into at least these conceptual layers:

## Perception

Determine what the bot currently "knows."

Examples:

- Visible enemies.
- Recently seen enemies.
- Gunshots or other observable events.
- Nearby loot.
- Nearby cover.
- Obstacles.
- Zone position.
- Current health, armor, boost, ammunition, weapons, and inventory.

The bot may internally use server information to implement perception, but its behavioral layer should receive approximately the information a human player could reasonably possess.

Do not give ordinary bots:

- Perfect knowledge of hidden players.
- Perfect tracking through walls.
- Exact knowledge of unseen enemy movement.
- Automatic awareness of every item on the map.
- Perfect prediction of random events.

Exceptional diagnostic/debug bots may bypass these restrictions, but training bots should not.

## Decision making

Choose what the bot is trying to accomplish.

Possible intents include:

- Loot.
- Explore.
- Rotate toward the safe zone.
- Chase an enemy.
- Disengage.
- Reposition.
- Seek cover.
- Heal.
- Boost.
- Reload.
- Switch weapon.
- Close distance.
- Maintain distance.
- Dodge.
- Hide.
- Third-party an ongoing fight.

Do not make a new strategic decision every server tick. Human players maintain intentions for short periods and revise them when something important changes.

## Movement controller

Convert the desired behavior into actual movement inputs.

The movement system should generate human-like controls rather than simply teleporting or directly steering toward mathematically ideal coordinates.

## Combat controller

Handle:

- Aiming.
- Shooting.
- Burst timing.
- Weapon switching.
- Reloading.
- Melee.
- Dodging.
- Peeking.
- Pursuit.
- Disengagement.

## Personality / skill profile

Parameters controlling how a particular bot behaves.

## Memory

Track imperfect information such as:

- Last known enemy location.
- How long ago an enemy was seen.
- Recently searched areas.
- Threats.
- Recent damage source.
- Recent failed actions.

Memory should decay.

---

# 3. Movement is a first-class problem

Movement quality is one of the main indicators of whether a bot feels human.

Do not implement movement as simply:

`move directly toward target`

Instead, build movement from short-term goals and context.

The controller should understand concepts such as:

- Destination.
- Preferred combat range.
- Cover.
- Line of sight.
- Escape direction.
- Obstacles.
- Choke points.
- Zone pressure.
- Enemy firing direction.
- Other nearby players.

The bot should continuously select an approximate movement intention, then translate that intention into valid player inputs.

Examples:

- Approach.
- Retreat.
- Strafe.
- Orbit.
- Peek.
- Cross open ground quickly.
- Move unpredictably while exposed.
- Hug cover.
- Reposition around an obstacle.
- Stop briefly while looting.
- Change direction after taking fire.

---

# 4. Do not make movement mechanically perfect

Human-like bots require controlled imperfection.

Introduce configurable variation in:

- Reaction time.
- Direction-change delay.
- Path efficiency.
- Strafing precision.
- Dodge frequency.
- Dodge timing.
- Cursor/aim stability.
- Target prediction.
- Commitment to a bad movement decision.
- Time required to recognize danger.

Avoid obvious artificial randomness such as rapidly changing directions every few frames.

Randomness should happen at the **decision level**, not as raw input noise.

Good:

> Bot chooses to strafe left for approximately 500 ms, then reassesses.

Bad:

> Every frame there is a 30% probability of reversing direction.

Human behavior has momentum and intention.

---

# 5. Human-like aiming

Never implement ordinary bots as perfect geometric aim.

Create an aim model with parameters including:

- Reaction latency.
- Initial aim error.
- Tracking error.
- Tracking smoothness.
- Prediction accuracy.
- Maximum angular correction speed.
- Target-switch delay.
- Error under movement.
- Error under pressure.
- Weapon familiarity.
- Distance-dependent accuracy.

The bot should usually move its aim toward the desired point rather than instantly snapping there.

Aim error should also be temporally correlated.

A human does not generate a completely independent random aiming error each frame. Their aim tends to drift around the target and then correct.

For weaker players:

- Larger error.
- Slower correction.
- Poorer prediction.
- Longer reaction time.
- More overshoot.
- Worse performance against erratic targets.

For stronger players:

- Smaller error.
- Faster correction.
- Better target leading.
- Better recoil/weapon handling if applicable.

Even the strongest normal training bots should generally remain physically believable.

---

# 6. Reaction time

Explicitly model reaction time.

Different stimuli can have different delays:

- Enemy first appears.
- Enemy begins shooting.
- Bot takes damage.
- Enemy changes direction.
- Weapon runs empty.
- Zone becomes dangerous.
- Enemy suddenly enters melee range.

Example ranges can be tuned experimentally rather than hard-coded as truth.

A beginner might react substantially slower than an expert.

Do not allow a bot to respond on the exact frame an event becomes known unless the configured profile intentionally represents superhuman/debug behavior.

---

# 7. Combat movement

Bots should understand fighting as a movement problem rather than standing still and shooting.

Possible behaviors include:

- Side strafing.
- Direction changes.
- Maintaining weapon-specific distance.
- Moving behind cover while reloading.
- Brief peeks.
- Repositioning after being hit.
- Closing distance when using close-range weapons.
- Creating distance when using long-range weapons.
- Moving irregularly across exposed terrain.
- Circling obstacles.
- Breaking line of sight to heal.
- Abandoning losing fights.

Avoid one universal dodge pattern.

Create several movement tendencies and parameterize them.

---

# 8. Strategic mistakes are required

Lower-skill bots must not simply be expert bots with worse aim.

Skill should affect the complete decision-making process.

Weak players may:

- Loot for too long.
- Rotate late.
- Fail to recognize bad positioning.
- Cross exposed terrain unnecessarily.
- Chase enemies too aggressively.
- Forget to reload.
- Heal at unsafe times.
- Switch weapons poorly.
- Misjudge effective weapon range.
- Panic after taking damage.
- Tunnel vision on one opponent.
- Fail to notice a third party.
- Repeat predictable strafing.
- Retreat in a poor direction.
- Spend too long deciding what to pick up.

Intermediate players should avoid many obvious mistakes but still make imperfect decisions.

Strong players should:

- Position around cover.
- Manage distance.
- Understand weapon matchups.
- Reposition intelligently.
- Heal during sensible windows.
- Anticipate likely enemy movement.
- Avoid unnecessary fights.
- Recognize third-party opportunities.

Do not make stronger bots omniscient. Improve their interpretation and execution instead.

---

# 9. Create distinct skill dimensions

Do not use only one scalar such as:

`difficulty = 0.7`

Internally represent skill using separate dimensions.

For example:

- Aim accuracy.
- Aim speed.
- Reaction speed.
- Movement skill.
- Dodging skill.
- Positioning skill.
- Tactical judgment.
- Loot efficiency.
- Weapon knowledge.
- Zone awareness.
- Threat awareness.
- Memory quality.
- Aggression.
- Patience.
- Adaptability.

Difficulty presets can configure these values, but they should remain independently tunable.

This makes bots much more believable.

A player might have:

- Excellent aim but terrible positioning.
- Weak aim but excellent movement.
- Strong game sense but conservative aggression.
- Strong shotgun mechanics but poor long-range accuracy.

Bots should be able to reproduce these combinations.

---

# 10. Playstyles

Create multiple archetypes independent of difficulty.

Examples include:

### Aggressive

- Seeks fights.
- Pushes damaged enemies.
- Takes shorter routes toward opponents.
- Accepts more risk.
- Frequently closes distance.

### Defensive

- Values cover.
- Disengages earlier.
- Avoids uncertain fights.
- Heals more conservatively.
- Prefers enemies to approach.

### Movement-heavy

- Strafes frequently.
- Repositions often.
- Difficult to track.
- May sacrifice optimal aim while moving.

### Aim-focused

- Strong shooting mechanics.
- Less elaborate movement.
- Holds angles/positions longer.

### Opportunist

- Avoids fair fights when possible.
- Attacks distracted players.
- Third-parties fights.
- Withdraws when advantage disappears.

### Beginner

- Hesitates.
- Makes inefficient paths.
- Has inconsistent aim.
- Occasionally makes surprisingly good plays.
- Often commits too long to simple plans.

Archetype and skill level should be independent.

For example:

- Beginner aggressive.
- Expert aggressive.
- Beginner defensive.
- Expert defensive.

---

# 11. Behavioral variability

Two bots using the same configuration should not behave identically.

At spawn, sample a small set of persistent traits from distributions.

Examples:

- Preferred combat distance.
- Aggressiveness.
- Strafing bias.
- Loot greed.
- Risk tolerance.
- Preferred weapons.
- Reaction speed.
- Aim confidence.
- Chase persistence.

Keep most characteristics reasonably stable throughout a match.

Humans have habits. A bot whose personality changes completely every second will feel more artificial than one with recognizable tendencies.

---

# 12. Short-term state

Use explicit behavioral states or another understandable equivalent.

Possible states:

- `Looting`
- `Traveling`
- `Searching`
- `Engaging`
- `Chasing`
- `Disengaging`
- `Healing`
- `Reloading`
- `TakingCover`
- `ZoneRotating`

Do not switch states continuously without hysteresis.

Use concepts such as:

- Minimum state duration.
- Cooldowns.
- Commitment.
- Significant-event interrupts.

This reduces twitchy robotic behavior.

---

# 13. Navigation

Bots need robust local navigation around:

- Trees.
- Rocks.
- Buildings.
- Walls.
- Furniture/obstacles where relevant.
- Doors.
- Rivers or other terrain restrictions.
- Other collision geometry.

Prefer a hybrid system:

1. Higher-level destination selection.
2. Local obstacle avoidance.
3. Short-horizon movement adjustment.

Do not require every movement decision to compute a globally perfect path.

Humans frequently take approximate paths.

Allow less skilled bots to take slightly inefficient routes without repeatedly getting stuck.

Detect stuck bots using signals such as:

- Desired movement exists.
- Actual displacement remains very low for a period.
- The bot is repeatedly colliding with the same geometry.

Then perform recovery behavior.

---

# 14. Cover reasoning

Represent useful cover candidates around the bot.

For each candidate, estimate:

- Distance.
- Whether it blocks the current threat.
- Exposure while reaching it.
- Whether it allows firing back.
- Escape routes.
- Zone safety.

Bots should not always select the mathematically best cover.

Higher-skill bots can evaluate these factors better.

Lower-skill bots may choose obvious nearby cover even when a better option exists.

---

# 15. Weapon-aware behavior

Movement and tactical behavior should depend on the equipped weapons.

Examples:

Shotgun:
- Close distance.
- Peek around obstacles.
- Avoid extended long-range exchanges.

SMG:
- Favor short-to-medium engagements.
- Pressure enemies when advantageous.

Rifle:
- Maintain useful medium distance.
- Use open sightlines intelligently.

Sniper / long-range weapon:
- Prefer spacing.
- Avoid unnecessary close-range pushes.
- Reposition when rushed.

Melee:
- Commit only under plausible circumstances.
- Use cover and movement while closing distance.

Derive the exact behavior from the game's actual weapon statistics rather than assumptions.

---

# 16. Training-oriented difficulty presets

Create several useful presets.

For example:

### Beginner

Designed for inexperienced players.

Characteristics:

- Slow reactions.
- Large aim error.
- Simple strafing.
- Poor tactical decisions.
- Weak threat awareness.
- Frequently punishable mistakes.

The bot should still move and fight enough to teach the player basic mechanics.

### Casual

Represents an ordinary imperfect human opponent.

Characteristics:

- Moderate aim.
- Basic dodging.
- Understands healing and cover.
- Makes positioning mistakes.
- Occasionally makes good plays.

### Skilled

Represents an experienced player.

Characteristics:

- Good aim.
- Strong movement.
- Good weapon usage.
- Good cover use.
- Reasonable tactical decisions.
- Smaller but meaningful errors.

### Expert

Represents a very strong human-like opponent.

Characteristics:

- Fast but believable reactions.
- Strong predictive aiming.
- Good movement.
- Good positioning.
- Efficient inventory management.
- Strong tactical judgment.

Still avoid perfect knowledge and physically impossible mechanics.

Optionally create a separate:

### Perfect / Diagnostic

This may use near-perfect information and mechanics.

This mode is for:

- Testing.
- Balance analysis.
- Stress testing.

It should **not** be treated as the human-like training bot.

---

# 17. Training behaviors

The bot system should be useful for deliberate practice.

Allow configuration of scenarios such as:

- Close-range duel.
- Shotgun duel.
- Long-range tracking.
- Dodging practice.
- Fighting around cover.
- Chasing.
- Being chased.
- Multiple-enemy awareness.
- Low-health fights.
- Weapon-specific fights.

Expose useful bot parameters so trainers can deliberately configure opponents.

Where practical, support commands/configuration such as:

`botDifficulty`

`botPlaystyle`

`botAimSkill`

`botMovementSkill`

`botReactionTime`

`botAggression`

`botPreferredWeapon`

`botCount`

Exact interfaces should follow the existing server architecture.

---

# 18. Instrument everything

Add debug telemetry so bot behavior can be understood.

Useful information includes:

- Current behavioral state.
- Current target.
- Current destination.
- Current perceived threats.
- Current cover target.
- Aim point.
- Aim error.
- Reaction timer.
- Reason for state transition.
- Reason for choosing an action.

When feasible, create server-side metrics for:

- Accuracy.
- Damage dealt.
- Damage taken.
- Survival time.
- Kills.
- Average engagement distance.
- Direction changes.
- Time spent exposed.
- Healing success.
- Stuck events.
- Reaction delay.
- Player-vs-bot outcome.

Human-likeness cannot be tuned effectively if behavior is opaque.

---

# 19. Evaluate human-likeness separately from strength

Do not consider a bot good simply because it wins.

Evaluate at least three separate dimensions:

### Mechanical competence

Can it move, aim, loot, fight, and navigate?

### Difficulty

How challenging is it to defeat?

### Human-likeness

Does it behave in ways that resemble a human player?

A strong but obviously robotic bot has failed one of the primary objectives.

---

# 20. Testing methodology

There is currently very little representative human gameplay data from this private server. The available players are largely the development team, while online Surviv/Survev videos may disproportionately represent skilled or edited gameplay. Do not treat that material as a representative distribution of ordinary player behavior.

Therefore use iterative behavioral testing rather than attempting to train directly on the available data.

For each bot version:

1. Play repeated matches against it.
2. Record encounters.
3. Identify moments where behavior appears robotic.
4. Categorize the cause:
   - Aim.
   - Movement.
   - Navigation.
   - Tactical decision.
   - Reaction time.
   - Information advantage.
   - Repetition.
5. Fix the underlying behavioral model rather than adding arbitrary noise.
6. Compare multiple difficulty levels.
7. Compare multiple playstyles.

Where possible, conduct blind tests:

Show a developer short gameplay clips without identifying whether the player is a bot or human and ask them to classify the player.

Use misclassification rate as one useful human-likeness signal, while recognizing that it is not a complete metric.

---

# 21. Prefer interpretable systems initially

Do not jump immediately to reinforcement learning or imitation learning.

Because representative human gameplay data is limited, begin with:

- Utility scoring.
- State machines.
- Behavior trees.
- Parameterized controllers.
- Short-horizon geometric reasoning.
- Explicit perception and memory.

Build clean interfaces so learned components can later replace particular modules.

Possible future learned components:

- Movement imitation.
- Aim behavior.
- Tactical decision selection.
- Player-style clustering.

But the first implementation should be debuggable and tunable.

---

# 22. Avoid these common bot failures

Actively test for and eliminate:

- Perfect aim.
- Instant target snapping.
- Zero reaction delay.
- Tracking through walls.
- Knowing unseen player positions.
- Repeating a fixed strafe pattern.
- Oscillating left/right every few frames.
- Walking directly at enemies regardless of weapon.
- Standing still while reloading.
- Selecting mathematically perfect actions every time.
- Identical behavior across bots.
- Changing intentions every frame.
- Getting caught indefinitely on obstacles.
- Unnaturally precise pathing.
- Superhuman threat awareness.
- Perfect loot knowledge.
- Difficulty implemented only through aim accuracy.

---

# 23. Code quality requirements

When implementing:

- Reuse existing game constants rather than duplicating them.
- Do not modify core game behavior merely to accommodate bots unless necessary.
- Keep bot-only logic isolated where practical.
- Make parameters configurable.
- Avoid unexplained magic numbers.
- Comment the reasoning behind behavioral constants.
- Keep decision-making deterministic when given a seeded RNG where feasible.
- Add diagnostic logging behind a debug flag.
- Avoid expensive global searches every server tick.
- Profile bot CPU cost with multiple simultaneous bots.

Bots must remain practical to run server-side at meaningful counts.

---

# 24. Development order

Implement incrementally.

Recommended order:

1. Inspect and document existing player movement and bot architecture.
2. Implement reliable movement/input control.
3. Implement local obstacle avoidance and stuck recovery.
4. Implement perception and visibility restrictions.
5. Implement enemy tracking and memory.
6. Implement imperfect aiming and reaction delays.
7. Implement basic combat movement.
8. Implement weapon-aware spacing.
9. Implement cover reasoning.
10. Implement healing/reloading/retreat behavior.
11. Implement skill profiles.
12. Implement playstyle profiles.
13. Add persistent behavioral variation.
14. Add telemetry/debug visualization.
15. Playtest and tune human-likeness.
16. Only then consider more advanced learning approaches.

At every stage, leave the game in a runnable state.

---

# 25. How to work on this task

Do not only describe what should be done.

Inspect the repository, identify the exact files/classes/functions involved, and implement the system incrementally.

Before editing a subsystem:

1. Read the relevant code.
2. Explain briefly how the existing system works.
3. Identify the smallest appropriate integration point.
4. Implement the change.
5. Check for obvious regressions or type/build errors.
6. Explain what changed and why.
7. Identify parameters that should later be tuned through playtesting.

Prefer small, understandable patches over rewriting large portions of the codebase unnecessarily.

If the existing architecture differs substantially from the architecture proposed above, adapt these concepts to the codebase rather than forcing an inappropriate design.

---

# Definition of done

The bot system is successful when a developer can configure several bots at different skill levels and playstyles and observe opponents that:

- Move competently around the map.
- Do not frequently get stuck.
- Fight using plausible human inputs.
- React with believable latency.
- Aim imperfectly according to skill.
- Use cover and weapon ranges appropriately.
- Make different kinds of mistakes at different skill levels.
- Have recognizable but non-deterministic playstyles.
- Lack unfair omniscient knowledge.
- Remain challenging at high difficulty without obviously cheating.
- Provide useful practice for real players.
- Do not all behave identically.
- Can be debugged and tuned through exposed parameters and telemetry.

When choosing between "more optimal" and "more plausibly human," prefer plausibly human unless implementing the explicit diagnostic/perfect bot mode.