import { describe, expect, test } from "vitest";
import { BotAgent } from "../../server/src/game/bots/botAgent";
import { BotAimController } from "../../server/src/game/bots/botAim";
import { BotDecisionMaker } from "../../server/src/game/bots/botDecision";
import { getBotSkillProfile } from "../../server/src/game/bots/botDifficulty";
import { BotMovementController } from "../../server/src/game/bots/botMovement";
import {
    BotPerception,
    type BotPerceptionSnapshot,
} from "../../server/src/game/bots/botPerception";
import { createBotProfile } from "../../server/src/game/bots/botProfile";
import { BotRandom } from "../../server/src/game/bots/botRandom";
import { GameConfig, TeamMode } from "../../shared/gameConfig";
import { ObjectType } from "../../shared/net/objectSerializeFns";
import { v2 } from "../../shared/utils/v2";
import { createGame } from "./gameTestHelpers";

describe("training bot profiles", () => {
    test("skill presets improve more than aim while preserving human reaction time", () => {
        const beginner = getBotSkillProfile("beginner");
        const expert = getBotSkillProfile("expert");

        expect(expert.aimAccuracy).toBeGreaterThan(beginner.aimAccuracy);
        expect(expert.movementSkill).toBeGreaterThan(beginner.movementSkill);
        expect(expert.tacticalJudgment).toBeGreaterThan(beginner.tacticalJudgment);
        expect(expert.memoryQuality).toBeGreaterThan(beginner.memoryQuality);
        expect(expert.reactionTime[0]).toBeGreaterThan(0);
        expect(beginner.reactionTime[0]).toBeGreaterThan(expert.reactionTime[1]);
    });

    test("seeded personalities are repeatable and playstyle is independent of difficulty", () => {
        const first = createBotProfile("beginner", new BotRandom(42), "defensive");
        const replay = createBotProfile("beginner", new BotRandom(42), "defensive");
        const expert = createBotProfile("expert", new BotRandom(42), "defensive");

        expect(first).toEqual(replay);
        expect(first.personality.playstyle).toBe("defensive");
        expect(expert.personality.playstyle).toBe("defensive");
        expect(expert.profile.aimAccuracy).toBeGreaterThan(first.profile.aimAccuracy);
    });
});

describe("human-like aim", () => {
    test("does not fire on first sight and rotates instead of snapping", () => {
        const profile = getBotSkillProfile("casual");
        const aim = new BotAimController(profile, new BotRandom(9), v2.create(1, 0));
        const first = aim.update(
            0.01,
            v2.create(0, 0),
            v2.create(0, 20),
            v2.create(0, 0),
            12,
            100,
            false,
            false,
        );

        expect(first.readyToFire).toBe(false);
        expect(first.reactionRemaining).toBeGreaterThan(0);
        expect(first.direction.x).toBeGreaterThan(0.9);
        expect(first.direction.y).toBeLessThan(0.1);
    });

    test("aim error evolves continuously rather than becoming independent frame noise", () => {
        const profile = getBotSkillProfile("beginner");
        const aim = new BotAimController(profile, new BotRandom(123), v2.create(1, 0));
        const directions = Array.from(
            { length: 20 },
            () =>
                aim.update(
                    0.02,
                    v2.create(0, 0),
                    v2.create(20, 0),
                    v2.create(0, 0),
                    1,
                    80,
                    true,
                    false,
                ).direction,
        );
        const largestStep = directions.slice(1).reduce((largest, direction, index) => {
            const previous = directions[index];
            return Math.max(
                largest,
                Math.acos(Math.max(-1, Math.min(1, v2.dot(previous, direction)))),
            );
        }, 0);

        expect(largestStep).toBeLessThanOrEqual(profile.maxAimSpeed * 0.02 + 1e-8);
    });

    test("settled beginner aim remains less accurate than expert aim", () => {
        const averageError = (difficulty: "beginner" | "expert") => {
            const aim = new BotAimController(
                getBotSkillProfile(difficulty),
                new BotRandom(123),
                v2.create(1, 0),
            );
            let error = 0;
            for (let i = 0; i < 1000; i++) {
                const result = aim.update(
                    0.1,
                    v2.create(0, 0),
                    v2.create(20, 0),
                    v2.create(0, 0),
                    1,
                    100,
                    false,
                    false,
                );
                if (i >= 500) error += result.errorRadians;
            }
            return error / 500;
        };

        expect(averageError("beginner")).toBeGreaterThan(0.07);
        expect(averageError("expert")).toBeLessThan(0.025);
    });
});

describe("bot decisions", () => {
    const emptySnapshot = (): BotPerceptionSnapshot => ({
        time: 0,
        visibleEnemies: [],
        rememberedEnemies: [],
        nearbyLoot: [],
        coverCandidates: [],
        outsideZone: false,
        zoneCenter: v2.create(0, 0),
    });

    test("holds a selected cover goal through routine decision reviews", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(41),
            "defensive",
        );
        profile.reactionTime = [0, 0];
        profile.decisionInterval = [0.1, 0.1];
        profile.minStateDuration = [0, 0];
        profile.positioningSkill = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(41));
        const player = {
            pos: v2.create(0, 0),
            health: 55,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const threat = {
            ...emptySnapshot(),
            visibleEnemies: [
                {
                    id: 2,
                    position: v2.create(12, 0),
                    velocity: v2.create(0, 0),
                    visible: true,
                    seenAt: 0,
                    age: 0,
                    distance: 12,
                },
            ],
            coverCandidates: [
                { position: v2.create(-4, 3), score: 10, obstacleId: 1 },
                { position: v2.create(-5, -3), score: 9, obstacleId: 2 },
            ],
        };

        const first = decisions.update(0.1, player as never, threat, 12);
        expect(first.state).toBe("taking-cover");
        const goal = first.destination;
        for (let i = 0; i < 10; i++) {
            const decision = decisions.update(0.1, player as never, threat, 12);
            expect(decision.state).toBe("taking-cover");
            expect(decision.destination).toBe(goal);
        }
        expect(decisions.update(0.9, player as never, threat, 12).state).toBe("engaging");
        expect(decisions.update(0.1, player as never, threat, 12).state).toBe("engaging");
        const newThreat = {
            ...threat,
            visibleEnemies: [
                ...threat.visibleEnemies,
                {
                    ...threat.visibleEnemies[0],
                    id: 3,
                    position: v2.create(8, 0),
                    distance: 8,
                },
            ],
        };
        expect(decisions.update(0.1, player as never, newThreat, 12).target?.id).toBe(3);
    });

    test("moves toward chosen cover and resumes combat on arrival", () => {
        const { profile, personality } = createBotProfile(
            "skilled",
            new BotRandom(42),
            "defensive",
        );
        profile.reactionTime = [0, 0];
        profile.decisionInterval = [0.1, 0.1];
        profile.minStateDuration = [0, 0];
        profile.positioningSkill = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(42));
        const player = {
            pos: v2.create(0, 0),
            health: 55,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const cover = v2.create(-4, 3);
        const threat = {
            ...emptySnapshot(),
            visibleEnemies: [
                {
                    id: 2,
                    position: v2.create(12, 0),
                    velocity: v2.create(0, 0),
                    visible: true,
                    seenAt: 0,
                    age: 0,
                    distance: 12,
                },
            ],
            coverCandidates: [{ position: cover, score: 10, obstacleId: 1 }],
        };

        expect(decisions.update(0.1, player as never, threat, 12).state).toBe(
            "taking-cover",
        );
        while (v2.distance(player.pos, cover) > 1.5) {
            const direction = v2.directionNormalized(player.pos, cover);
            v2.set(player.pos, v2.add(player.pos, v2.mul(direction, 0.4)));
            if (v2.distance(player.pos, cover) > 1.5) {
                const decision = decisions.update(0.1, player as never, threat, 12);
                expect(decision.state).toBe("taking-cover");
                expect(decision.destination).toBe(cover);
            }
        }
        expect(decisions.update(0.1, player as never, threat, 12).state).toBe("engaging");
    });

    test.each([
        "beginner",
        "casual",
        "skilled",
        "expert",
    ] as const)("%s search goals persist during seeded travel", (difficulty) => {
        let goalChanges = 0;
        let sharpTurns = 0;
        for (let seed = 1; seed <= 100; seed++) {
            const { profile, personality } = createBotProfile(
                difficulty,
                new BotRandom(seed),
                "aggressive",
            );
            const decisions = new BotDecisionMaker(
                profile,
                personality,
                new BotRandom(seed + 2000),
            );
            const player = {
                pos: v2.create(0, 0),
                health: 100,
                curWeapIdx: GameConfig.WeaponSlot.Primary,
                weapons: [
                    { type: "mp5", ammo: 20 },
                    { type: "", ammo: 0 },
                ],
                invManager: { has: () => false },
            };
            let previousGoal: ReturnType<typeof v2.create> | undefined;
            let previousDirection: ReturnType<typeof v2.create> | undefined;
            for (let tick = 0; tick < 300; tick++) {
                const decision = decisions.update(
                    0.1,
                    player as never,
                    emptySnapshot(),
                    12,
                );
                expect(decision.state).toBe("searching");
                expect(decision.destination).toBeDefined();
                const goal = decision.destination!;
                if (previousGoal && v2.distance(previousGoal, goal) > 0.001) {
                    goalChanges++;
                }
                const direction = v2.directionNormalized(player.pos, goal);
                if (previousDirection && v2.dot(previousDirection, direction) < 0) {
                    sharpTurns++;
                }
                previousGoal = v2.copy(goal);
                previousDirection = direction;
                // 4 units/s models imperfect travel through open ground.
                v2.set(player.pos, v2.add(player.pos, v2.mul(direction, 0.4)));
            }
        }
        expect(goalChanges / 100).toBeLessThan(15);
        expect(sharpTurns / 100).toBeLessThan(10);
    });

    test("search replaces a blocked goal after sustained lack of progress", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(34),
            "aggressive",
        );
        profile.decisionInterval = [0.1, 0.1];
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(34));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const first = decisions.update(0.1, player as never, emptySnapshot(), 12);
        const firstGoal = v2.copy(first.destination!);
        for (let i = 0; i < 10; i++) {
            const decision = decisions.update(0.1, player as never, emptySnapshot(), 12);
            expect(decision.destination).toEqual(firstGoal);
        }
        const recovered = decisions.update(0.9, player as never, emptySnapshot(), 12);
        expect(recovered.destination).not.toEqual(firstGoal);
    });

    test.each([
        "beginner",
        "casual",
        "skilled",
        "expert",
    ] as const)("%s waits for recognition before changing movement on first sight", (difficulty) => {
        const { profile, personality } = createBotProfile(
            difficulty,
            new BotRandom(31),
            "aggressive",
        );
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(31));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const seen = {
            ...emptySnapshot(),
            visibleEnemies: [
                {
                    id: 2,
                    position: v2.create(12, 0),
                    velocity: v2.create(0, 0),
                    visible: true,
                    seenAt: 0,
                    age: 0,
                    distance: 12,
                },
            ],
        };
        const step = 0.02;
        let reactionSeconds = 0;
        let decision = decisions.update(step, player as never, seen, 12);
        reactionSeconds += step;
        expect(decision.state).toBe("searching");
        expect(decision.movement).toBe("hold");
        expect(decision.wantsToShoot).toBe(false);

        while (decision.state !== "engaging" && reactionSeconds < 2) {
            decision = decisions.update(step, player as never, seen, 12);
            reactionSeconds += step;
        }
        expect(decision.state).toBe("engaging");
        expect(reactionSeconds).toBeGreaterThanOrEqual(profile.reactionTime[0]);
        expect(reactionSeconds).toBeLessThanOrEqual(profile.reactionTime[1] + step);
    });

    test("zone danger still interrupts a pending sight reaction", () => {
        const { profile, personality } = createBotProfile(
            "beginner",
            new BotRandom(32),
            "aggressive",
        );
        profile.zoneAwareness = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(32));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const danger = {
            ...emptySnapshot(),
            outsideZone: true,
            zoneCenter: v2.create(10, 0),
            visibleEnemies: [
                {
                    id: 2,
                    position: v2.create(12, 0),
                    velocity: v2.create(0, 0),
                    visible: true,
                    seenAt: 0,
                    age: 0,
                    distance: 12,
                },
            ],
        };

        const decision = decisions.update(0.02, player as never, danger, 12);
        expect(decision.state).toBe("zone-rotating");
        expect(decision.destination).toEqual(danger.zoneCenter);
    });

    test.each([
        ["beginner", 1.2, 2.1],
        ["casual", 0.7, 1.3],
        ["skilled", 0.3, 0.7],
        ["expert", 0.05, 0.3],
    ] as const)("%s recognizes zone pressure once, then keeps rotating", (difficulty, earliestMean, latestMean) => {
        const danger = {
            ...emptySnapshot(),
            outsideZone: true,
            zoneCenter: v2.create(100, 0),
        };
        let firstRotationSeconds = 0;
        for (let seed = 1; seed <= 100; seed++) {
            const { profile, personality } = createBotProfile(
                difficulty,
                new BotRandom(seed),
                "defensive",
            );
            const decisions = new BotDecisionMaker(
                profile,
                personality,
                new BotRandom(seed + 2000),
            );
            const player = {
                pos: v2.create(0, 0),
                health: 100,
                curWeapIdx: GameConfig.WeaponSlot.Primary,
                weapons: [
                    { type: "mp5", ammo: 20 },
                    { type: "", ammo: 0 },
                ],
                invManager: { has: () => false },
            };
            let firstTick = -1;
            for (let tick = 0; tick < 100; tick++) {
                const decision = decisions.update(0.1, player as never, danger, 12);
                if (decision.state === "zone-rotating" && firstTick < 0) {
                    firstTick = tick;
                }
                if (firstTick >= 0) expect(decision.state).toBe("zone-rotating");
            }
            expect(firstTick).toBeGreaterThanOrEqual(0);
            firstRotationSeconds += firstTick * 0.1;
        }
        const mean = firstRotationSeconds / 100;
        expect(mean).toBeGreaterThan(earliestMean);
        expect(mean).toBeLessThan(latestMean);
    });

    test("leaves zone rotation on safety and handles critical threat before zone recognition", () => {
        const { profile, personality } = createBotProfile(
            "beginner",
            new BotRandom(35),
            "defensive",
        );
        personality.riskTolerance = 0.5;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(35));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const danger = {
            ...emptySnapshot(),
            outsideZone: true,
            zoneCenter: v2.create(100, 0),
        };
        expect(decisions.update(0.1, player as never, danger, 12).state).toBe(
            "searching",
        );
        player.health = 20;
        const threatened = {
            ...danger,
            visibleEnemies: [
                {
                    id: 2,
                    position: v2.create(12, 0),
                    velocity: v2.create(0, 0),
                    visible: true,
                    seenAt: 0,
                    age: 0,
                    distance: 12,
                },
            ],
        };
        expect(decisions.update(0.1, player as never, threatened, 12).state).toBe(
            "disengaging",
        );
        player.health = 100;
        expect(decisions.update(2, player as never, danger, 12).state).toBe(
            "zone-rotating",
        );
        player.health = 20;
        expect(decisions.update(0.1, player as never, threatened, 12).state).toBe(
            "disengaging",
        );
        player.health = 100;
        expect(decisions.update(0.1, player as never, danger, 12).state).toBe(
            "zone-rotating",
        );
        expect(decisions.update(0.1, player as never, emptySnapshot(), 12).state).toBe(
            "searching",
        );
    });

    test("a brief glimpse does not trigger an immediate chase through cover", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(33),
            "aggressive",
        );
        profile.reactionTime = [0.5, 0.5];
        personality.chasePersistence = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(33));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const enemy = {
            id: 2,
            position: v2.create(12, 0),
            velocity: v2.create(0, 0),
            visible: true,
            seenAt: 0,
            age: 0,
            distance: 12,
        };

        decisions.update(
            0.1,
            player as never,
            { ...emptySnapshot(), visibleEnemies: [enemy] },
            12,
        );
        const memory = {
            ...emptySnapshot(),
            rememberedEnemies: [{ ...enemy, visible: false, age: 0.1 }],
        };
        expect(decisions.update(0.1, player as never, memory, 12).movement).toBe("hold");
        expect(decisions.update(0.31, player as never, memory, 12).state).toBe("chasing");
    });

    test("uses an owned healthkit when no bandage is available", () => {
        const { profile, personality } = createBotProfile(
            "expert",
            new BotRandom(8),
            "defensive",
        );
        profile.tacticalJudgment = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(8));
        const player = {
            pos: v2.create(0, 0),
            health: 45,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: (item: string) => item === "healthkit" },
        };

        const result = decisions.update(2, player as never, emptySnapshot(), 15);
        expect(result.state).toBe("healing");
        expect(result.useItem).toBe("healthkit");
    });

    test("drops a firing decision as soon as the target leaves view", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(9),
            "aggressive",
        );
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(9));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const visible = {
            id: 2,
            position: v2.create(12, 0),
            velocity: v2.create(0, 0),
            visible: true,
            seenAt: 0,
            age: 0,
            distance: 12,
        };
        const seen = { ...emptySnapshot(), visibleEnemies: [visible] };
        expect(decisions.update(1, player as never, seen, 12).wantsToShoot).toBe(true);

        const lost = {
            ...emptySnapshot(),
            rememberedEnemies: [{ ...visible, visible: false, age: 0.1 }],
        };
        const result = decisions.update(0.1, player as never, lost, 12);
        expect(result.wantsToShoot).toBe(false);
        expect(result.target?.visible).toBe(false);
    });

    test("ignores full ammo stacks and moves toward useful healing loot", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(15),
            "beginner",
        );
        personality.lootGreed = 1;
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(15));
        const player = {
            __id: 1,
            pos: v2.create(0, 0),
            health: 90,
            activeWeapon: "mp5",
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: {
                has: () => false,
                isValid: () => true,
                get: (item: string) => (item === "9mm" ? 100 : 0),
                getMaxCapacity: (item: string) => (item === "9mm" ? 100 : 5),
            },
        };
        const snapshot = emptySnapshot();
        snapshot.nearbyLoot = [
            { type: "9mm", pos: v2.create(2, 0), ownerId: 0 },
            { type: "bandage", pos: v2.create(5, 0), ownerId: 0 },
        ] as never;

        const result = decisions.update(2, player as never, snapshot, 15);
        expect(result.state).toBe("looting");
        expect(result.destination).toEqual(v2.create(5, 0));
    });

    test("keeps moving to selected loot until it is picked up or lost", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(51),
            "defensive",
        );
        personality.lootGreed = 1;
        profile.decisionInterval = [0.1, 0.1];
        profile.minStateDuration = [0, 0];
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(51));
        const player = {
            __id: 1,
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const loot = { type: "m870", pos: v2.create(8, 0), ownerId: 0 };
        const sighted = { ...emptySnapshot(), nearbyLoot: [loot] as never };
        expect(decisions.update(0.1, player as never, sighted, 12).state).toBe("looting");

        while (v2.distance(player.pos, loot.pos) > 1) {
            const decision = decisions.update(0.1, player as never, sighted, 12);
            expect(decision.state).toBe("looting");
            expect(decision.destination).toEqual(loot.pos);
            const direction = v2.directionNormalized(player.pos, loot.pos);
            v2.set(player.pos, v2.add(player.pos, v2.mul(direction, 0.4)));
        }
        // A successful pickup removes the item from local perception.
        expect(decisions.update(0.1, player as never, emptySnapshot(), 12).state).toBe(
            "searching",
        );
    });

    test("releases blocked loot and avoids immediately retrying it", () => {
        const { profile, personality } = createBotProfile(
            "skilled",
            new BotRandom(52),
            "defensive",
        );
        personality.lootGreed = 1;
        profile.decisionInterval = [0.1, 0.1];
        profile.minStateDuration = [0, 0];
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(52));
        const player = {
            __id: 1,
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const loot = { type: "m870", pos: v2.create(8, 0), ownerId: 0 };
        const sighted = { ...emptySnapshot(), nearbyLoot: [loot] as never };
        expect(decisions.update(0.1, player as never, sighted, 12).state).toBe("looting");
        for (let i = 0; i < 30; i++) {
            expect(decisions.update(0.1, player as never, sighted, 12).state).toBe(
                "looting",
            );
        }
        let released = false;
        for (let i = 0; i < 10; i++) {
            if (decisions.update(0.1, player as never, sighted, 12).state !== "looting") {
                released = true;
                break;
            }
        }
        expect(released).toBe(true);
        for (let i = 0; i < 20; i++) {
            expect(decisions.update(0.1, player as never, sighted, 12).state).toBe(
                "searching",
            );
        }
    });

    test("switches loot target for a clearly better nearby item", () => {
        const { profile, personality } = createBotProfile(
            "expert",
            new BotRandom(53),
            "defensive",
        );
        personality.lootGreed = 1;
        profile.decisionInterval = [0.1, 0.1];
        profile.minStateDuration = [0, 0];
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(53));
        const player = {
            __id: 1,
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 20 },
                { type: "", ammo: 0 },
            ],
            invManager: { has: () => false },
        };
        const far = { type: "m870", pos: v2.create(18, 0), ownerId: 0 };
        const near = { type: "m870", pos: v2.create(2, 0), ownerId: 0 };
        expect(
            decisions.update(
                0.1,
                player as never,
                { ...emptySnapshot(), nearbyLoot: [far] as never },
                12,
            ).destination,
        ).toEqual(far.pos);
        expect(
            decisions.update(
                0.1,
                player as never,
                { ...emptySnapshot(), nearbyLoot: [far, near] as never },
                12,
            ).destination,
        ).toEqual(near.pos);
    });

    test("switches to a loaded secondary gun under pressure", () => {
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(16),
            "aggressive",
        );
        const decisions = new BotDecisionMaker(profile, personality, new BotRandom(16));
        const player = {
            pos: v2.create(0, 0),
            health: 100,
            curWeapIdx: GameConfig.WeaponSlot.Primary,
            weapons: [
                { type: "mp5", ammo: 0 },
                { type: "m870", ammo: 5 },
            ],
            invManager: { has: () => false },
        };
        const snapshot = emptySnapshot();
        snapshot.visibleEnemies = [
            {
                id: 2,
                position: v2.create(10, 0),
                velocity: v2.create(0, 0),
                visible: true,
                seenAt: 0,
                age: 0,
                distance: 10,
            },
        ];

        const result = decisions.update(1, player as never, snapshot, 15);
        expect(result.switchWeapon).toBe(GameConfig.WeaponSlot.Secondary);
        expect(result.wantsToReload).toBe(false);
    });
});

describe("intentional movement", () => {
    test("holds a strafe choice instead of reversing with per-frame noise", () => {
        const rng = new BotRandom(71);
        const { profile, personality } = createBotProfile(
            "casual",
            new BotRandom(71),
            "movement-heavy",
        );
        const player = { pos: v2.create(0, 0), layer: 0 };
        const game = { grid: { intersectLineSegment: () => [] } };
        const movement = new BotMovementController(
            game as never,
            player as never,
            profile,
            personality,
            rng,
        );
        const signs = new Set<number>();
        for (let i = 0; i < 6; i++) {
            const result = movement.update(0.05, "strafe", v2.create(10, 0));
            signs.add(Math.sign(result.direction.y));
            v2.set(player.pos, v2.add(player.pos, v2.mul(result.direction, 0.2)));
        }

        expect(signs.size).toBe(1);
    });
});

describe("perception and memory", () => {
    test("keeps only a decaying snapshot after an enemy leaves view", () => {
        const self = {
            __id: 1,
            __type: ObjectType.Player,
            pos: v2.create(0, 0),
            moveVel: v2.create(0, 0),
            layer: 0,
            teamId: 1,
            dead: false,
            downed: false,
        };
        const enemy = {
            __id: 2,
            __type: ObjectType.Player,
            pos: v2.create(10, 0),
            moveVel: v2.create(3, 0),
            layer: 0,
            teamId: 2,
            dead: false,
            downed: false,
        };
        const livingPlayers = [self, enemy];
        const game = {
            playerBarn: { livingPlayers },
            modeManager: { isSolo: true },
            grid: {
                intersectLineSegment: () => [],
                intersectCollider: () => livingPlayers,
            },
            lootBarn: { loots: [] },
            gas: { currentPos: v2.create(0, 0), currentRad: 100 },
        };
        const profile = getBotSkillProfile("casual");
        profile.memorySeconds = 1;
        const perception = new BotPerception(game as never, self as never, profile);

        const seen = perception.update(0.1);
        expect(seen.visibleEnemies).toHaveLength(1);

        livingPlayers.splice(1, 1);
        enemy.pos.x = 50;
        enemy.dead = true;
        const remembered = perception.update(0.2);
        expect(remembered.visibleEnemies).toHaveLength(0);
        expect(remembered.rememberedEnemies[0].position).toEqual(v2.create(10, 0));
        expect(remembered.rememberedEnemies[0].velocity).toEqual(v2.create(0, 0));
        expect("player" in remembered.rememberedEnemies[0]).toBe(false);

        expect(perception.update(1).rememberedEnemies).toHaveLength(0);
    });
});

describe("server integration", () => {
    test("aim and movement recognition overlap without firing at a lost target", async () => {
        const game = await createGame(TeamMode.Solo, "main");
        const human = game.playerBarn.addTestPlayer({ name: "human" });
        const bot = game.botManager.spawnBot({
            difficulty: "casual",
            playstyle: "aggressive",
            seed: 101,
            diagnostic: true,
        });
        v2.set(human.pos, v2.add(bot.pos, v2.create(0, 10)));
        const { personality } = createBotProfile(
            "casual",
            new BotRandom(101),
            "aggressive",
        );
        const profile = getBotSkillProfile("casual");
        profile.reactionTime = [0.4, 0.4];
        const agent = new BotAgent(game, bot, {
            profile,
            personality,
            seed: 101,
            diagnostic: true,
        });

        agent.update(0.1);
        expect(agent.telemetry.state).toBe("searching");
        expect(agent.telemetry.reactionRemaining).toBeCloseTo(0.3);
        expect(agent.telemetry.shotsAttempted).toBe(0);

        for (let i = 0; i < 4; i++) agent.update(0.1);
        expect(agent.telemetry.state).toBe("engaging");
        expect(agent.telemetry.reactionRemaining).toBe(0);

        human.dead = true;
        agent.update(0.1);
        expect(agent.telemetry.aimPoint).toBeUndefined();
        expect(bot.shootStart).toBe(false);
        game.botManager.clearInternalBots();
    });

    test("creates a clientless AI player and drives normal player inputs", async () => {
        const game = await createGame(TeamMode.Solo, "main");
        const human = game.playerBarn.addTestPlayer({ name: "human" });
        const bot = game.botManager.spawnBot({
            difficulty: "casual",
            playstyle: "aggressive",
            seed: 99,
            diagnostic: true,
        });
        const spawnDistance = v2.distance(bot.pos, human.pos);
        v2.set(human.pos, v2.add(bot.pos, v2.create(10, 0)));

        game.botManager.update(0.1);

        expect(bot.isAi).toBe(true);
        expect(bot.hasClient).toBe(false);
        expect(bot.activeWeapon).toBe("mp5");
        expect(spawnDistance).toBeGreaterThanOrEqual(GameConfig.player.minSpawnRad);
        expect(game.map.canPlayerSpawn(bot.pos)).toBe(true);
        const telemetry = game.botManager.getTelemetry(bot);
        expect(telemetry?.decisions).toBe(1);
        expect(telemetry?.perceivedThreats).toBeGreaterThan(0);

        game.botManager.clearInternalBots();
    });
});
