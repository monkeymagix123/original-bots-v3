import { expect, test } from "vitest";
import { Config } from "../../server/src/config.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

test("offline bot count configures and clears internal bots without network clients", () => {
    const original = { ...Config.bots };
    try {
        const game = createGame(TeamMode.Solo, "test_normal");
        game.playerBarn.addTestPlayer({});
        game.setDesiredBotCount(3);
        game.step(1);
        expect(game.botManager.botCount).toBe(3);
        expect(game.clientBarn.clients).toHaveLength(1);
        game.setDesiredBotCount(0);
        expect(game.botManager.botCount).toBe(0);
        expect(game.playerBarn.players).toHaveLength(1);
        expect(game.clientBarn.clients).toHaveLength(1);
    } finally {
        Object.assign(Config.bots, original);
    }
});

test("waves wait between rounds and award the human team a win after the last wave", () => {
    const game = createGame(TeamMode.Solo, "wave");
    game.map.mapDef = {
        ...game.map.mapDef,
        wave: { interWaveDelay: 0.3, waves: [{ count: 1 }, { count: 1 }] },
    };
    const human = game.playerBarn.addTestPlayer({ forcedTeamId: 1 });
    game.step(0.3);
    expect(game.started).toBe(true);
    const first = game.playerBarn.livingPlayers.find(p => p.isAi)!;
    expect(first).toBeDefined();
    expect(first.teamId).toBe(2);
    expect(human.teamId).toBe(1);
    first.damage({ amount: 999, damageType: GameConfig.DamageType.Gas, dir: v2.create(1, 0) });
    expect(game.over).toBe(false);
    game.step(0.1);
    expect(game.over).toBe(false);
    game.step(0.3);
    const second = game.playerBarn.livingPlayers.find(p => p.isAi)!;
    expect(second).toBeDefined();
    second.damage({ amount: 999, damageType: GameConfig.DamageType.Gas, dir: v2.create(1, 0) });
    game.step(0.1);
    expect(game.botManager.wavesComplete).toBe(true);
    expect(game.over).toBe(true);
    expect(game.winningTeamId).toBe(1);
});

test("waves end with the bot team winning when the last human dies", () => {
    const game = createGame(TeamMode.Solo, "wave2");
    const human = game.playerBarn.addTestPlayer({ forcedTeamId: 1 });
    game.step(0.1);
    human.damage({ amount: 999, damageType: GameConfig.DamageType.Gas, dir: v2.create(1, 0) });
    expect(game.over).toBe(true);
    expect(game.winningTeamId).toBe(2);
});
