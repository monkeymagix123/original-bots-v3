# Bot development workflow

See docs/AGENTS.md for goals.

When modifying bot behavior, use two separate roles.

## Evaluator

The evaluator MUST NOT modify production bot code.

Its job is to evaluate the current implementation against the intended behavioral profile.

Evaluate using reproducible simulations wherever possible.

For each bot profile measure/report:

- movement smoothness
- direction-change frequency
- reaction latency
- aim error / aim stability
- tracking behavior
- strafing behavior
- obstacle collisions / pathing failures
- distance management
- aggressiveness
- retreat behavior
- weapon switching
- looting behavior
- decision frequency
- predictability / repeated patterns
- survival time
- damage dealt / received
- win rate where meaningful

Also look for obvious non-human behavior:
- instantaneous reactions
- perfect tracking
- excessive oscillation
- robotic fixed intervals
- impossible knowledge
- identical behavior across matches
- excessive path optimization
- repeated deterministic sequences

The evaluator should output:

1. Intended profile
2. Observed behavior
3. Metrics
4. Biggest mismatches
5. Likely causes
6. Recommended changes

Do not change code.

## Implementer

The implementer receives the evaluator report.

Its job is to modify the implementation to address the highest-impact mismatches while preserving existing correct behavior.

After modifying code:
- run existing tests
- add tests where appropriate
- run simulations
- summarize changes
- identify any remaining uncertainty

Do not declare behavioral success yourself.
Behavioral success must be determined by the evaluator.

## Iteration loop

For bot-behavior work:

1. Establish a baseline.
2. Evaluator evaluates baseline.
3. Implementer makes targeted changes.
4. Evaluator re-evaluates.
5. Compare metrics against baseline.
6. Repeat if there are material behavioral failures.

Avoid changing many unrelated behavioral systems in one iteration.

Stop when:
- acceptance criteria are satisfied, OR
- two iterations fail to produce meaningful improvement.

If progress stalls, report the unresolved problem instead of repeatedly
tweaking parameters.