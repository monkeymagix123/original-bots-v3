# Bot development workflow
See `docs/AGENTS.md` for goals.

When modifying bot behavior, use three separate roles:

1. Profile Evaluator
2. Human-Likeness Critic
3. Implementer

The Profile Evaluator and Human-Likeness Critic MUST NOT modify production bot code.

## Profile Evaluator

The Profile Evaluator evaluates whether the current implementation matches the intended bot profile.

Its main question is:

> Does this bot behave like the intended skill level and playstyle?

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
- survival time
- damage dealt / received
- win rate where meaningful

Also evaluate whether differences between profiles are meaningful.

For example, check whether:

- lower-skill bots make more mistakes than higher-skill bots
- reaction times differ appropriately by skill level
- aim quality differs appropriately by skill level
- tactical decision quality differs appropriately
- aggression differs where intended by playstyle
- different profiles do not converge toward the same behavior
- difficulty is not implemented only through accuracy or raw combat strength

The Profile Evaluator should output:

1. Intended profile
2. Observed behavior
3. Metrics
4. Biggest mismatches
5. Likely causes
6. Recommended changes

Do not change code.

## Human-Likeness Critic

The Human-Likeness Critic independently evaluates whether the bot exhibits behavior that would be implausible or obviously artificial for a human player.

Its main question is:

> Could this behavior plausibly come from a human player of the specified skill level and playstyle?

Do not judge primarily by whether the bot wins or loses.

Look for non-human signatures including:

- instantaneous reactions
- reaction times that are unrealistically consistent
- perfect tracking
- instantaneous aim corrections
- excessive aim micro-corrections
- excessive oscillation
- robotic fixed timing intervals
- deterministic strafing patterns
- repeated movement cycles
- impossible knowledge
- reacting to information before it should be perceptible
- identical behavior across matches
- identical opening sequences
- excessive path optimization
- unrealistically optimal positioning
- perfect weapon-selection timing
- perfect distance management
- never hesitating
- never making low-cost mistakes
- repeated deterministic action sequences
- unnaturally synchronized movement, aiming, and firing

Also check for artificial attempts to appear human, including:

- random movement without tactical purpose
- exaggerated aim wobble
- intentionally nonsensical mistakes
- arbitrary delays that do not correspond to perception or decision-making
- excessive randomness that makes behavior less coherent rather than more human

Human-like behavior should contain variation without becoming random.

Where possible, inspect behavior across many matches rather than judging a single match.

For each issue report:

1. Observed behavior
2. Why it appears human-like or non-human
3. Evidence or metrics
4. Severity
5. Which profiles are affected
6. Likely cause
7. Recommended behavioral change

Do not modify code.

Do not claim that behavior is statistically representative of real human players unless supported by actual human gameplay data.

## Implementer

The Implementer receives both:

- the Profile Evaluator report
- the Human-Likeness Critic report

Its job is to modify the implementation to address the highest-impact mismatches while preserving existing correct behavior.

Prioritize issues in this order unless there is a strong reason not to:

1. Clearly broken or impossible behavior
2. Strong non-human behavioral signatures
3. Failure to match intended skill level
4. Failure to match intended playstyle
5. Minor tuning issues

Prefer fixing underlying behavioral logic over adding arbitrary randomness.

After modifying code:

- run existing tests
- add tests where appropriate
- run reproducible simulations
- summarize changes
- report which evaluator findings were addressed
- identify any remaining uncertainty

Do not declare behavioral success yourself.

Behavioral success must be determined by re-evaluation.

## Iteration loop

For bot-behavior work:

1. Establish a baseline.
2. Run the Profile Evaluator on the baseline.
3. Run the Human-Likeness Critic on the baseline.
4. Combine both reports.
5. Identify the highest-impact issues.
6. Implementer makes targeted changes.
7. Run the Profile Evaluator again.
8. Run the Human-Likeness Critic again.
9. Compare before/after results.
10. Repeat only if material behavioral failures remain.

The two evaluators should evaluate independently before their findings are combined.

Do not let one evaluator's conclusions bias the other before evaluation.

Avoid changing many unrelated behavioral systems in one iteration.

Prefer small, measurable changes so regressions can be attributed to specific modifications.

Stop when:
- acceptance criteria are satisfied, OR
- two iterations fail to produce meaningful improvement.

If progress stalls, report:

- the unresolved behavior
- available evidence
- likely causes
- what was already attempted
- what additional instrumentation or data would help

Do not repeatedly tweak parameters without evidence that the changes are improving behavior.