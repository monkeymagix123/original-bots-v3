import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs.ts";
import type { WaveEntry } from "../../../../shared/defs/mapDefs.ts";
import { GameObjectDefs } from "../../../../shared/defs/register.ts";
import { GameConfig } from "../../../../shared/gameConfig.ts";
import { Config } from "../../config.ts";
import type { Game } from "../game.ts";
import type { Player } from "../objects/player.ts";
import { BotAgent } from "./botAgent.ts";
import { type BotBrainType, type BotPlaystyle, playstyleForBrain } from "./botBrain.ts";
import type { BotDifficulty } from "./botDifficulty.ts";
import { createBotProfile } from "./botProfile.ts";
import { BotRandom } from "./botRandom.ts";
import type { BotTelemetrySnapshot } from "./botTelemetry.ts";

export interface SpawnBotOptions {
    difficulty?: BotDifficulty;
    playstyle?: BotPlaystyle;
    brain?: BotBrainType;
    seed?: number;
    name?: string;
    forcedTeamId?: number;
    diagnostic?: boolean;
}

export class BotManager {
    private readonly agents = new Map<Player, BotAgent>();
    private readonly rng: BotRandom;
    private updateTicker = 0;
    private spawnBudget = 0;
    private spawnedRegular = 0;
    private waveIndex = -1;
    private waveDelay = 0;
    private waveSpawnRemaining = 0;
    private waveEntry?: WaveEntry;
    private waveBrainQueue: BotBrainType[] = [];
    wavesComplete = false;

    constructor(private readonly game: Game) {
        const idSeed = [...game.id].reduce(
            (seed, char) => (seed * 31 + char.charCodeAt(0)) >>> 0,
            2166136261,
        );
        this.rng = new BotRandom(idSeed);
    }

    update(dt: number): void {
        this.removeFinishedAgents();
        this.updateSpawning(dt);

        this.updateTicker -= dt;
        if (this.updateTicker > 0) return;
        const decisionTps = Math.max(1, Config.bots.decisionTps);
        const decisionDt = 1 / decisionTps;
        this.updateTicker += decisionDt;
        for (const agent of this.agents.values()) agent.update(decisionDt);
    }

    spawnBot(options: SpawnBotOptions = {}): Player {
        const seed = options.seed ?? this.rng.int(1, 0x7fffffff);
        const botRng = new BotRandom(seed);
        let difficulty = options.difficulty ?? Config.bots.difficulty;
        if (
            !options.difficulty
            && difficulty !== "diagnostic"
            && botRng.chance(Config.bots.proChance)
        ) {
            difficulty = "expert";
        }
        const requestedPlaystyle = options.playstyle
            ?? Config.bots.playstyle
            ?? (options.brain ? playstyleForBrain(options.brain) : undefined);
        const { profile, personality } = createBotProfile(
            difficulty,
            botRng,
            requestedPlaystyle,
        );
        if (Config.bots.aimSkill !== undefined) {
            profile.aimAccuracy = this.clampSkill(Config.bots.aimSkill);
            // Accuracy drives the persistent tracking error, not just fire timing.
            profile.aimErrorRadians = 0.28 - 0.27 * profile.aimAccuracy;
        }
        if (Config.bots.movementSkill !== undefined) {
            profile.movementSkill = this.clampSkill(Config.bots.movementSkill);
        }
        if (Config.bots.reactionTime !== undefined) {
            const reactionTime = Math.max(0, Config.bots.reactionTime);
            profile.reactionTime = [reactionTime, reactionTime];
        }
        if (Config.bots.aggression !== undefined) {
            personality.aggression = this.clampSkill(Config.bots.aggression);
        }
        const player = this.game.playerBarn.addTestPlayer({
            name: options.name ?? `Bot-${seed.toString(16).slice(-4)}`,
            isAi: true,
            hasClient: false,
            forcedTeamId: options.forcedTeamId,
        });
        this.giveStartingEquipment(player);
        const agent = new BotAgent(this.game, player, {
            profile,
            personality,
            seed,
            diagnostic: options.diagnostic || difficulty === "diagnostic",
            debug: Config.bots.debugCombat,
        });
        this.agents.set(player, agent);
        return player;
    }

    clearInternalBots(): void {
        for (const player of [...this.agents.keys()]) {
            if (this.game.playerBarn.players.includes(player)) {
                this.game.playerBarn.removePlayer(player);
            }
        }
        this.agents.clear();
        this.spawnedRegular = 0;
        this.waveSpawnRemaining = 0;
    }

    getTelemetry(player: Player): Readonly<BotTelemetrySnapshot> | undefined {
        return this.agents.get(player)?.telemetry;
    }

    get botCount(): number {
        let count = 0;
        for (const player of this.agents.keys()) if (!player.dead) count++;
        return count;
    }

    private updateSpawning(dt: number): void {
        if (this.game.map.mapDef.isWave) {
            this.updateWaves(dt);
            return;
        }
        // The match starts as soon as the first opponent joins. Finish the requested
        // population while joins remain open, using spawnedRegular to prevent refills.
        if (!Config.bots.enabled || (this.game.started && !this.game.canJoin)) return;
        const humans = this.countHumans();
        if (humans < Config.bots.minHumansToEnable) return;
        const capacity = Math.max(
            0,
            this.game.map.mapDef.gameMode.maxPlayers - Config.bots.reserveSlots - humans,
        );
        const target = Math.min(Config.bots.maxBots ?? capacity, capacity);
        const remaining = target - this.spawnedRegular;
        if (remaining <= 0) return;

        this.spawnBudget += dt * Math.max(0.1, Config.bots.spawnPerSecond);
        const amount = Math.min(remaining, Math.floor(this.spawnBudget));
        for (let i = 0; i < amount; i++) {
            this.spawnBot();
            this.spawnedRegular++;
            this.spawnBudget--;
        }
    }

    private updateWaves(dt: number): void {
        const waveConfig = this.game.map.mapDef.wave;
        if (!waveConfig || !this.game.started || this.wavesComplete) return;
        const aliveWaveBots = [...this.agents.keys()].some((player) => !player.dead);
        if (this.waveSpawnRemaining === 0 && aliveWaveBots) return;

        if (this.waveSpawnRemaining === 0 && !aliveWaveBots) {
            if (this.waveIndex >= waveConfig.waves.length - 1) {
                if (this.waveIndex >= 0) this.wavesComplete = true;
                return;
            }
            this.waveDelay -= dt;
            if (this.waveDelay > 0) return;
            this.waveEntry = waveConfig.waves[++this.waveIndex];
            this.waveSpawnRemaining = this.waveEntry.count;
            this.waveBrainQueue = this.buildWaveBrainQueue(this.waveEntry);
        }

        this.spawnBudget += dt * Math.max(0.1, Config.bots.spawnPerSecond);
        while (this.waveSpawnRemaining > 0 && this.spawnBudget >= 1) {
            const brain = this.waveBrainQueue.shift() ?? this.pickWaveBrain(this.waveEntry!);
            this.spawnBot({
                brain,
                difficulty: this.waveEntry!.difficulty ?? Config.bots.difficulty,
                forcedTeamId: this.game.map.factionMode ? 2 : undefined,
                name: `Wave-${this.waveIndex + 1}-${this.waveEntry!.count - this.waveSpawnRemaining + 1}`,
            });
            this.waveSpawnRemaining--;
            this.spawnBudget--;
        }
        if (this.waveSpawnRemaining === 0) {
            this.waveDelay = waveConfig.interWaveDelay ?? 3;
        }
    }

    private pickWaveBrain(entry: WaveEntry): BotBrainType {
        if (Config.bots.brainMix.force) return Config.bots.brainMix.force;
        const weights = entry.brains
            ?? Config.bots.brainMix.weights ?? {
            practice: 0.15,
            realistic: 0.8,
            competitive: 0.05,
        };
        const choices: BotBrainType[] = ["practice", "realistic", "competitive"];
        const total = choices.reduce(
            (sum, key) => sum + Math.max(0, weights[key] ?? 0),
            0,
        );
        if (total <= 0) return "realistic";
        let roll = this.rng.range(0, total);
        for (const choice of choices) {
            roll -= Math.max(0, weights[choice] ?? 0);
            if (roll <= 0) return choice;
        }
        return "realistic";
    }

    private buildWaveBrainQueue(entry: WaveEntry): BotBrainType[] {
        if (Config.bots.brainMix.force) {
            return Array.from({ length: entry.count }, () => Config.bots.brainMix.force!);
        }
        const queue: BotBrainType[] = [];
        if (entry.brains) {
            for (const brain of ["practice", "realistic", "competitive"] as const) {
                const count = Math.max(0, Math.floor(entry.brains[brain] ?? 0));
                for (let i = 0; i < count && queue.length < entry.count; i++) {
                    queue.push(brain);
                }
            }
        }
        while (queue.length < entry.count) queue.push(this.pickWaveBrain(entry));
        for (let i = queue.length - 1; i > 0; i--) {
            const j = this.rng.int(0, i);
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
        return queue;
    }

    private countHumans(): number {
        return this.game.playerBarn.livingPlayers.filter(
            (player) => !player.isAi && !player.bot && !player.disconnected,
        ).length;
    }

    private removeFinishedAgents(): void {
        for (const player of this.agents.keys()) {
            if (!this.game.playerBarn.players.includes(player)) {
                this.agents.delete(player);
            }
        }
    }

    private giveStartingEquipment(player: Player): void {
        if (!Config.bots.giveStartingWeapons) return;
        const requestedWeapon = Config.bots.preferredWeapon ?? "mp5";
        const requestedDef = GameObjectDefs.typeToDefSafe(requestedWeapon);
        const weaponType = requestedDef?.type === "gun" ? requestedWeapon : "mp5";
        const gun = GameObjectDefs.typeToDefSafe(weaponType) as GunDef;
        player.weaponManager.setWeapon(
            GameConfig.WeaponSlot.Primary,
            weaponType,
            gun.maxClip,
        );
        if (player.invManager.isValid(gun.ammo)) {
            player.invManager.give(gun.ammo, gun.ammoSpawnCount);
        }
        player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
    }

    private clampSkill(value: number): number {
        return Math.max(0, Math.min(1, value));
    }
}
