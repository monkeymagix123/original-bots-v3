import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import { GameConfig } from "../../../../shared/gameConfig";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import type { Loot } from "../objects/loot";
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
    switchWeapon?: number;
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

function lootValue(player: Player, loot: Loot): number {
    if (loot.ownerId !== 0 && loot.ownerId !== player.__id) return 0;
    const def = GameObjectDefs[loot.type];
    if (!def) return 0;
    switch (def.type) {
        case "gun":
            // A free slot is useful; replacing a gun needs a separate comparison.
            return player.weapons[GameConfig.WeaponSlot.Primary].type === "" ||
                player.weapons[GameConfig.WeaponSlot.Secondary].type === ""
                ? 9
                : 0;
        case "ammo":
        case "heal":
        case "boost":
        case "scope":
        case "throwable":
            if (!player.invManager.isValid(loot.type)) return 0;
            if (
                player.invManager.get(loot.type) >=
                player.invManager.getMaxCapacity(loot.type)
            )
                return 0;
            if (def.type === "heal") return player.health < 80 ? 8 : 4;
            if (def.type === "ammo") {
                const activeDef = GameObjectDefs[player.activeWeapon];
                return activeDef?.type === "gun" && activeDef.ammo === loot.type ? 7 : 2;
            }
            return def.type === "boost" ? 5 : 3;
        case "helmet":
        case "chest":
        case "backpack":
            return player.getGearLevel(loot.type) > player.getGearLevel(player[def.type])
                ? 8
                : 0;
        case "melee":
            return player.weapons[GameConfig.WeaponSlot.Melee].type === "fists" ? 4 : 0;
        default:
            return 0;
    }
}

// At the normal 12-unit/s move speed, this radius lets a new destination be
// chosen before keyboard movement repeatedly crosses the old point.
const SEARCH_ARRIVAL_RADIUS = 1.5;
// Allow the movement controller's stuck detection and short recovery to run
// before replacing a goal that has made no meaningful progress.
const SEARCH_PROGRESS_DISTANCE = 0.5;
const SEARCH_STALL_SECONDS = 1.8;
const COVER_ARRIVAL_RADIUS = 1.5;
const COVER_PROGRESS_DISTANCE = 0.5;
const COVER_STALL_SECONDS = 1.8;
const COVER_REENTRY_COOLDOWN = 1.5;
const LOOT_PROGRESS_DISTANCE = 0.5;
const LOOT_STALL_SECONDS = 3.5;
const LOOT_ARRIVAL_RADIUS = 2.5;
const LOOT_PICKUP_DWELL_SECONDS = 1.2;
const LOOT_RETRY_SECONDS = 4;
const LOOT_UPGRADE_MARGIN = 2.5;

/** Slow, hysteretic utility decision maker. It is intentionally not called every game tick. */
export class BotDecisionMaker {
    state: BotState = "searching";
    private stateAge = 0;
    private minStateTime = 0;
    private decisionCooldown = 0;
    private sawVisibleEnemy = false;
    private sightReactionRemaining = 0;
    private healingThreatReactionRemaining?: number;
    private searchBestDistance = Infinity;
    private searchNoProgressTime = 0;
    private readonly previouslyVisibleEnemyIds = new Set<number>();
    private coverBestDistance = Infinity;
    private coverNoProgressTime = 0;
    private coverReentryRemaining = 0;
    private zoneRecognitionRemaining?: number;
    private lootTarget?: Loot;
    private lootBestDistance = Infinity;
    private lootNoProgressTime = 0;
    private lootArrivalTime = 0;
    private blockedLoot?: Loot;
    private blockedLootRemaining = 0;
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
        attackRange = Infinity,
    ): BotDecision {
        this.stateAge += dt;
        this.decisionCooldown -= dt;
        this.coverReentryRemaining = Math.max(0, this.coverReentryRemaining - dt);
        this.blockedLootRemaining = Math.max(0, this.blockedLootRemaining - dt);

        const currentSearchGoal =
            this.state === "searching" ? this.lastDecision.destination : undefined;
        const searchDistance = currentSearchGoal
            ? v2.distance(player.pos, currentSearchGoal)
            : Infinity;
        if (searchDistance < this.searchBestDistance - SEARCH_PROGRESS_DISTANCE) {
            this.searchBestDistance = searchDistance;
            this.searchNoProgressTime = 0;
        } else if (currentSearchGoal) {
            this.searchNoProgressTime += dt;
        }
        const searchGoalReached = searchDistance <= SEARCH_ARRIVAL_RADIUS;
        const searchGoalStalled =
            !!currentSearchGoal && this.searchNoProgressTime >= SEARCH_STALL_SECONDS;

        const currentCoverGoal =
            this.state === "taking-cover" ? this.lastDecision.destination : undefined;
        const coverDistance = currentCoverGoal
            ? v2.distance(player.pos, currentCoverGoal)
            : Infinity;
        if (coverDistance < this.coverBestDistance - COVER_PROGRESS_DISTANCE) {
            this.coverBestDistance = coverDistance;
            this.coverNoProgressTime = 0;
        } else if (currentCoverGoal) {
            this.coverNoProgressTime += dt;
        }
        const coverGoalReached = coverDistance <= COVER_ARRIVAL_RADIUS;
        const coverGoalStalled =
            !!currentCoverGoal && this.coverNoProgressTime >= COVER_STALL_SECONDS;
        const coverGoalInvalid =
            !!currentCoverGoal &&
            !perception.coverCandidates.some(
                (cover) =>
                    v2.distance(cover.position, currentCoverGoal) <= COVER_ARRIVAL_RADIUS,
            );

        const currentLoot = this.state === "looting" ? this.lootTarget : undefined;
        const lootStillUseful =
            !!currentLoot &&
            !currentLoot.destroyed &&
            perception.nearbyLoot.includes(currentLoot) &&
            lootValue(player, currentLoot) > 0;
        const lootDistance = lootStillUseful
            ? v2.distance(player.pos, currentLoot.pos)
            : Infinity;
        if (lootDistance < this.lootBestDistance - LOOT_PROGRESS_DISTANCE) {
            this.lootBestDistance = lootDistance;
            this.lootNoProgressTime = 0;
        } else if (lootStillUseful) {
            this.lootNoProgressTime += dt;
        }
        this.lootArrivalTime =
            lootStillUseful && lootDistance <= LOOT_ARRIVAL_RADIUS
                ? this.lootArrivalTime + dt
                : 0;
        const lootGoalLost = !!currentLoot && !lootStillUseful;
        const lootGoalStalled =
            lootStillUseful && this.lootNoProgressTime >= LOOT_STALL_SECONDS;
        const lootPickupTimedOut =
            lootStillUseful && this.lootArrivalTime >= LOOT_PICKUP_DWELL_SECONDS;

        // A zone boundary is noticed once, after a skill-dependent delay.
        // Re-rolling awareness every tick would undo an established rotation.
        let zoneRecognitionCompleted = false;
        if (perception.outsideZone) {
            if (this.zoneRecognitionRemaining === undefined) {
                const noticeDelay =
                    this.profile.reactionTime[1] === 0
                        ? 0
                        : (1 - this.profile.zoneAwareness) * this.rng.range(1.5, 2.5);
                this.zoneRecognitionRemaining = noticeDelay;
                zoneRecognitionCompleted = noticeDelay === 0;
            }
            if (this.zoneRecognitionRemaining > 0) {
                this.zoneRecognitionRemaining = Math.max(
                    0,
                    this.zoneRecognitionRemaining - dt,
                );
                zoneRecognitionCompleted = this.zoneRecognitionRemaining === 0;
            }
        } else {
            this.zoneRecognitionRemaining = undefined;
        }
        const zoneRecognized =
            perception.outsideZone && this.zoneRecognitionRemaining === 0;
        const reachedSafety = !perception.outsideZone && this.state === "zone-rotating";

        const lostTarget =
            this.lastDecision.target?.visible &&
            !perception.visibleEnemies.some(
                (enemy) => enemy.id === this.lastDecision.target?.id,
            );
        const targetableThreat = perception.visibleEnemies.some(
            (enemy) => enemy.distance <= attackRange,
        );
        let healingThreatRecognized = false;
        if (this.state === "healing" && targetableThreat) {
            if (this.healingThreatReactionRemaining === undefined) {
                this.healingThreatReactionRemaining = this.rng.range(
                    ...this.profile.reactionTime,
                );
            }
            this.healingThreatReactionRemaining = Math.max(
                0,
                this.healingThreatReactionRemaining - dt,
            );
            healingThreatRecognized = this.healingThreatReactionRemaining === 0;
        } else {
            this.healingThreatReactionRemaining = undefined;
        }

        // Keep the current intention briefly on first sight. Aim has its own
        // reaction delay, but combat movement also needs recognition time.
        const seesEnemy = perception.visibleEnemies.length > 0;
        const newVisibleThreat = perception.visibleEnemies.some(
            (enemy) => !this.previouslyVisibleEnemyIds.has(enemy.id),
        );
        this.previouslyVisibleEnemyIds.clear();
        for (const enemy of perception.visibleEnemies) {
            this.previouslyVisibleEnemyIds.add(enemy.id);
        }
        if (seesEnemy && !this.sawVisibleEnemy && this.sightReactionRemaining <= 0) {
            this.sightReactionRemaining = this.rng.range(...this.profile.reactionTime);
        }
        this.sawVisibleEnemy = seesEnemy;
        let sightReactionCompleted = false;
        if (this.sightReactionRemaining > 0) {
            this.sightReactionRemaining = Math.max(0, this.sightReactionRemaining - dt);
            sightReactionCompleted = this.sightReactionRemaining === 0;
            if (
                this.sightReactionRemaining > 0 &&
                !perception.outsideZone &&
                !reachedSafety &&
                player.health >= 28 &&
                !lostTarget
            ) {
                return this.lastDecision;
            }
        }
        if (
            this.healingThreatReactionRemaining !== undefined &&
            this.healingThreatReactionRemaining > 0 &&
            !perception.outsideZone &&
            player.health >= 28 &&
            !lostTarget
        ) {
            return this.lastDecision;
        }

        const urgent =
            zoneRecognitionCompleted ||
            reachedSafety ||
            player.health < 28 ||
            lostTarget ||
            sightReactionCompleted ||
            healingThreatRecognized ||
            searchGoalReached ||
            searchGoalStalled ||
            coverGoalReached ||
            coverGoalStalled ||
            coverGoalInvalid ||
            lootGoalLost ||
            lootGoalStalled ||
            lootPickupTimedOut ||
            newVisibleThreat;
        if (this.decisionCooldown > 0 && !urgent) return this.lastDecision;
        this.decisionCooldown = this.rng.range(...this.profile.decisionInterval);

        const visible = nearest(perception.visibleEnemies);
        const remembered = nearest(perception.rememberedEnemies);
        const target = visible ?? remembered;
        const lowHealth = player.health < 52;
        const hasHealing =
            player.invManager.has("bandage") || player.invManager.has("healthkit");
        const usefulLoot = perception.nearbyLoot
            .map((loot) => ({ loot, value: lootValue(player, loot) }))
            .filter(
                (candidate) =>
                    candidate.value > 0 &&
                    (this.blockedLootRemaining <= 0 ||
                        candidate.loot !== this.blockedLoot),
            );
        const lootScore = (candidate: (typeof usefulLoot)[number]): number =>
            candidate.value - v2.distance(player.pos, candidate.loot.pos) * 0.2;
        const bestLoot = usefulLoot.reduce<(typeof usefulLoot)[number] | undefined>(
            (best, candidate) =>
                !best || lootScore(candidate) > lootScore(best) ? candidate : best,
            undefined,
        );
        const selectedLoot = usefulLoot.find(
            (candidate) => candidate.loot === currentLoot,
        );
        const activeWeapon = player.weapons[player.curWeapIdx];
        const isGun =
            player.curWeapIdx === GameConfig.WeaponSlot.Primary ||
            player.curWeapIdx === GameConfig.WeaponSlot.Secondary;
        const emptyGun = isGun && activeWeapon.ammo <= 0;
        const otherGunSlot =
            player.curWeapIdx === GameConfig.WeaponSlot.Primary
                ? GameConfig.WeaponSlot.Secondary
                : GameConfig.WeaponSlot.Primary;
        const otherGun = player.weapons[otherGunSlot];

        let nextState = this.state;
        let movement: MovementIntent = "hold";
        let destination: Vec2 | undefined;
        let wantsToShoot = false;
        let wantsToReload = false;
        let switchWeapon: number | undefined;
        let useItem: string | undefined;
        let chosenLoot: Loot | undefined;
        let reason = "maintaining current intent";
        let transitionReason = this.lastDecision.transitionReason;

        // Immediate visible danger at critical health can interrupt a zone run.
        // With no active threat, keep the committed rotation until safety.
        if (zoneRecognized && !(player.health < 28 && visible)) {
            nextState = "zone-rotating";
            movement = "travel";
            destination = perception.zoneCenter;
            reason = "moving toward the observed safe zone";
        } else if (
            lowHealth &&
            hasHealing &&
            !targetableThreat &&
            (!visible || visible.distance > preferredDistance * 1.4) &&
            this.profile.tacticalJudgment > this.rng.next() * 0.85
        ) {
            nextState = "healing";
            movement = visible ? "retreat" : "hold";
            destination = visible ? visible.position : undefined;
            useItem =
                player.health <= 40 && player.invManager.has("healthkit")
                    ? "healthkit"
                    : player.invManager.has("bandage")
                      ? "bandage"
                      : "healthkit";
            reason = "using a plausible low-threat healing window";
        } else if (emptyGun) {
            nextState = "reloading";
            movement = visible ? "retreat" : "hold";
            destination = target?.position;
            if (visible && otherGun.type && otherGun.ammo > 0) {
                switchWeapon = otherGunSlot;
                reason = "switching to a loaded weapon under pressure";
            } else {
                wantsToReload = true;
                reason = "magazine empty; creating space while reloading";
            }
        } else if (
            currentCoverGoal &&
            visible &&
            visible.id === this.lastDecision.target?.id &&
            !perception.outsideZone &&
            player.health >= 28 &&
            !newVisibleThreat &&
            !coverGoalReached &&
            !coverGoalStalled &&
            !coverGoalInvalid
        ) {
            nextState = "taking-cover";
            movement = "take-cover";
            destination = currentCoverGoal;
            reason = "continuing toward chosen cover";
        } else if (
            visible &&
            perception.coverCandidates.length > 0 &&
            this.coverReentryRemaining <= 0 &&
            !coverGoalReached &&
            !coverGoalStalled &&
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
            bestLoot &&
            !lootGoalStalled &&
            !lootPickupTimedOut &&
            (selectedLoot || this.personality.lootGreed > this.rng.next() * 0.9)
        ) {
            const loot =
                selectedLoot &&
                lootScore(selectedLoot) + LOOT_UPGRADE_MARGIN >= lootScore(bestLoot)
                    ? selectedLoot.loot
                    : bestLoot.loot;
            chosenLoot = loot;
            nextState = "looting";
            movement = "travel";
            destination = v2.copy(loot.pos);
            reason =
                loot === currentLoot
                    ? "continuing toward chosen loot"
                    : "moving to locally visible loot";
        } else {
            nextState = "searching";
            movement = "travel";
            if (currentSearchGoal && !searchGoalReached && !searchGoalStalled) {
                destination = currentSearchGoal;
                reason = "continuing toward a local search destination";
            } else {
                // Search destinations are local and approximate, avoiding global omniscient scans.
                const angle = this.rng.range(-Math.PI, Math.PI);
                const distance = this.rng.range(7, 17 + this.profile.movementSkill * 9);
                destination = v2.add(
                    player.pos,
                    v2.create(Math.cos(angle) * distance, Math.sin(angle) * distance),
                );
                reason = "exploring a nearby unsearched direction";
            }
        }

        const canInterrupt = urgent || this.stateAge >= this.minStateTime;
        if (nextState !== this.state && !canInterrupt) return this.lastDecision;
        if (nextState !== this.state) {
            if (this.state === "taking-cover") {
                this.coverReentryRemaining = COVER_REENTRY_COOLDOWN;
            }
            transitionReason = reason;
            this.state = nextState;
            this.stateAge = 0;
            this.resetStateCommitment();
        }
        if (this.state === "looting") {
            if (chosenLoot !== this.lootTarget) {
                this.lootTarget = chosenLoot;
                this.lootBestDistance = chosenLoot
                    ? v2.distance(player.pos, chosenLoot.pos)
                    : Infinity;
                this.lootNoProgressTime = 0;
                this.lootArrivalTime = 0;
            }
        } else {
            if ((lootGoalStalled || lootPickupTimedOut) && currentLoot) {
                this.blockedLoot = currentLoot;
                this.blockedLootRemaining = LOOT_RETRY_SECONDS;
            }
            this.lootTarget = undefined;
            this.lootBestDistance = Infinity;
            this.lootNoProgressTime = 0;
            this.lootArrivalTime = 0;
        }
        if (
            this.state === "searching" &&
            destination &&
            destination !== currentSearchGoal
        ) {
            this.searchBestDistance = v2.distance(player.pos, destination);
            this.searchNoProgressTime = 0;
        } else if (this.state !== "searching") {
            this.searchBestDistance = Infinity;
            this.searchNoProgressTime = 0;
        }
        if (
            this.state === "taking-cover" &&
            destination &&
            destination !== currentCoverGoal
        ) {
            this.coverBestDistance = v2.distance(player.pos, destination);
            this.coverNoProgressTime = 0;
        } else if (this.state !== "taking-cover") {
            this.coverBestDistance = Infinity;
            this.coverNoProgressTime = 0;
        }

        this.lastDecision = {
            state: this.state,
            movement,
            target,
            destination,
            wantsToShoot,
            wantsToReload,
            switchWeapon,
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
