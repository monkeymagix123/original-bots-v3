import { describe, expect, test } from "vitest";
import { BotAimController } from "../../server/src/game/bots/botAim";
import { getBotSkillProfile } from "../../server/src/game/bots/botDifficulty";
import { BotMovementController } from "../../server/src/game/bots/botMovement";
import { BotPerception } from "../../server/src/game/bots/botPerception";
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
        const remembered = perception.update(0.2);
        expect(remembered.visibleEnemies).toHaveLength(0);
        expect(remembered.rememberedEnemies[0].position).toEqual(v2.create(10, 0));
        expect(remembered.rememberedEnemies[0].velocity).toEqual(v2.create(0, 0));
        expect(remembered.rememberedEnemies[0].player).toBeUndefined();

        expect(perception.update(1).rememberedEnemies).toHaveLength(0);
    });
});

describe("server integration", () => {
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
