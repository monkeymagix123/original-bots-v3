import { GameConfig } from "../../../../shared/gameConfig";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import type { Player } from "../objects/player";
import type { BotPersonality } from "./botBrain";
import type { BotSkillProfile } from "./botDifficulty";
import type { BotPerceptionSnapshot, EnemyMemory } from "./botPerception";
import type { BotRandom } from "./botRandom";

export type BotState =
    | "looting"
    | "traveling"
    | "searching"
    | "engaging"
    | "chasing"
    | "disengaging"
    | "healing"
    | "reloading"
    | "taking-cover"
    | "zone-rotating";

export type MovementIntent =
    | "hold"
    | "approach"
    | "retreat"
    | "strafe"
    | "travel"
    | "take-cover";

export interface BotDecision {
    state: BotState;
    movement: MovementIntent;
    target?: EnemyMemory;
    destination?: Vec2;
    wantsToShoot: boolean;
    wantsToReload: boolean;
    useItem?: string;
    reason: string;
    transitionReason: string;
}

function nearest(enemies: EnemyMemory[]): EnemyMemory | undefined {
    let result: EnemyMemory | undefined;
    for (const enemy of enemies) {
        if (!result || enemy.distance < result.distance) result = enemy;
    }
    return result;
}

/** Slow, hysteretic utility decision maker. It is intentionally not called every game tick. */
export class BotDecisionMaker {
    state: BotState = "searching";
    private stateAge = 0;
    private minStateTime = 0;
    private decisionCooldown = 0;
    private lastDecision: BotDecision = {
        state: "searching",
        movement: "hold",
        wantsToShoot: false,
        wantsToReload: false,
        reason: "observing spawn area",
        transitionReason: "spawned",
    };

    constructor(
        private readonly profile: BotSkillProfile,
        private readonly personality: BotPersonality,
        private readonly rng: BotRandom,
    ) {
        this.resetStateCommitment();
    }

    update(
        dt: number,
        player: Player,
        perception: BotPerceptionSnapshot,
        preferredDistance: number,
    ): BotDecision {
        this.stateAge += dt;
        this.decisionCooldown -= dt;

        const urgent =
            perception.outsideZone ||
            player.health < 28 ||
            (perception.visibleEnemies.length > 0 && this.state !== "engaging");
        if (this.decisionCooldown > 0 && !urgent) return this.lastDecision;
        this.decisionCooldown = this.rng.range(...this.profile.decisionInterval);

        const visible = nearest(perception.visibleEnemies);
        const remembered = nearest(perception.rememberedEnemies);
        const target = visible ?? remembered;
        const lowHealth = player.health < 52;
        const hasHealing =
            player.invManager.has("bandage") || player.invManager.has("healthkit");
        const activeWeapon = player.weapons[player.curWeapIdx];
        const isGun =
            player.curWeapIdx === GameConfig.WeaponSlot.Primary ||
            player.curWeapIdx === GameConfig.WeaponSlot.Secondary;
        const emptyGun = isGun && activeWeapon.ammo <= 0;

        let nextState = this.state;
        let movement: MovementIntent = "hold";
        let destination: Vec2 | undefined;
        let wantsToShoot = false;
        let wantsToReload = false;
        let useItem: string | undefined;
        let reason = "maintaining current intent";
        let transitionReason = this.lastDecision.transitionReason;

        if (
            perception.outsideZone &&
            this.profile.zoneAwareness > this.rng.next() * 0.9
        ) {
            nextState = "zone-rotating";
            movement = "travel";
            destination = perception.zoneCenter;
            reason = "moving toward the observed safe zone";
        } else if (
            lowHealth &&
            hasHealing &&
            (!visible || visible.distance > preferredDistance * 1.4) &&
            this.profile.tacticalJudgment > this.rng.next() * 0.85
        ) {
            nextState = "healing";
            movement = visible ? "retreat" : "hold";
            destination = visible ? visible.position : undefined;
            useItem =
                player.health <= 40 && player.invManager.has("healthkit")
                    ? "healthkit"
                    : "bandage";
            reason = "using a plausible low-threat healing window";
        } else if (emptyGun) {
            nextState = "reloading";
            movement = visible ? "retreat" : "hold";
            destination = target?.position;
            wantsToReload = true;
            reason = "magazine empty; creating space while reloading";
        } else if (
            visible &&
            perception.coverCandidates.length > 0 &&
            (player.health < 62 || this.state === "reloading") &&
            this.profile.positioningSkill > this.rng.next()
        ) {
            const candidateIndex = Math.floor(
                (1 - this.profile.positioningSkill) *
                    this.rng.next() *
                    perception.coverCandidates.length,
            );
            const cover = perception.coverCandidates[candidateIndex];
            nextState = "taking-cover";
            movement = "take-cover";
            destination = cover.position;
            wantsToShoot = false;
            reason = "moving behind nearby cover that blocks the current threat";
        } else if (visible) {
            const badlyLosing =
                player.health < 34 && this.personality.riskTolerance < 0.75;
            if (badlyLosing) {
                nextState = "disengaging";
                movement = "retreat";
                destination = visible.position;
                reason = "disengaging from a losing fight";
            } else {
                nextState = "engaging";
                destination = visible.position;
                wantsToShoot = true;
                if (visible.distance > preferredDistance * 1.2) {
                    movement = "approach";
                    reason = "closing to the equipped weapon's useful range";
                } else if (visible.distance < preferredDistance * 0.65) {
                    movement = "retreat";
                    reason = "creating weapon-appropriate spacing";
                } else {
                    movement = "strafe";
                    reason = "holding range with a committed strafe";
                }
            }
        } else if (
            remembered &&
            this.personality.chasePersistence >
                remembered.age / this.profile.memorySeconds
        ) {
            nextState = "chasing";
            movement = "travel";
            destination = remembered.position;
            reason = "checking the last seen position without tracking through cover";
        } else if (
            perception.nearbyLoot.length > 0 &&
            this.personality.lootGreed > this.rng.next() * 0.9
        ) {
            const loot = perception.nearbyLoot.reduce((best, candidate) =>
                v2.distance(player.pos, candidate.pos) < v2.distance(player.pos, best.pos)
                    ? candidate
                    : best,
            );
            nextState = "looting";
            movement = "travel";
            destination = v2.copy(loot.pos);
            reason = "moving to locally visible loot";
        } else {
            nextState = "searching";
            movement = "travel";
            // Search destinations are local and approximate, avoiding global omniscient scans.
            const angle = this.rng.range(-Math.PI, Math.PI);
            const distance = this.rng.range(7, 17 + this.profile.movementSkill * 9);
            destination = v2.add(
                player.pos,
                v2.create(Math.cos(angle) * distance, Math.sin(angle) * distance),
            );
            reason = "exploring a nearby unsearched direction";
        }

        const canInterrupt = urgent || this.stateAge >= this.minStateTime;
        if (nextState !== this.state && !canInterrupt) return this.lastDecision;
        if (nextState !== this.state) {
            transitionReason = reason;
            this.state = nextState;
            this.stateAge = 0;
            this.resetStateCommitment();
        }

        this.lastDecision = {
            state: this.state,
            movement,
            target,
            destination,
            wantsToShoot,
            wantsToReload,
            useItem,
            reason,
            transitionReason,
        };
        return this.lastDecision;
    }

    private resetStateCommitment(): void {
        this.minStateTime = this.rng.range(...this.profile.minStateDuration);
    }
}
