import { ObjectType } from "../../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import type { Game } from "../game.ts";
import type { Loot } from "../objects/loot.ts";
import type { Player } from "../objects/player.ts";
import type { BotSkillProfile } from "./botDifficulty.ts";

export interface EnemyMemory {
    id: number;
    position: Vec2;
    velocity: Vec2;
    visible: boolean;
    seenAt: number;
    age: number;
    distance: number;
}

export interface BotPerceptionSnapshot {
    time: number;
    visibleEnemies: EnemyMemory[];
    rememberedEnemies: EnemyMemory[];
    nearbyLoot: Loot[];
    coverCandidates: CoverCandidate[];
    outsideZone: boolean;
    zoneCenter: Vec2;
}

export interface CoverCandidate {
    position: Vec2;
    score: number;
    obstacleId: number;
}

/**
 * The only module allowed to inspect global server state on behalf of an ordinary bot.
 * Everything returned is range/line-of-sight limited and unseen positions are snapshots.
 */
export class BotPerception {
    private readonly memory = new Map<number, EnemyMemory>();
    private time = 0;

    constructor(
        private readonly game: Game,
        private readonly player: Player,
        private readonly profile: BotSkillProfile,
        private readonly diagnostic = false,
        private readonly allowBotVsBot = true,
    ) {}

    update(dt: number): BotPerceptionSnapshot {
        this.time += dt;
        const visibleEnemies: EnemyMemory[] = [];
        const observableObjects = this.diagnostic
            ? undefined
            : this.game.grid.intersectCollider(
                collider.createCircle(this.player.pos, this.profile.perceptionRadius),
            );
        const possibleEnemies = this.diagnostic
            ? this.game.playerBarn.livingPlayers
            : observableObjects!.filter(
                (object): object is Player => object.__type === ObjectType.Player,
            );

        for (const candidate of possibleEnemies) {
            if (!this.isEnemy(candidate)) continue;
            const distance = v2.distance(this.player.pos, candidate.pos);
            if (!this.diagnostic && distance > this.profile.perceptionRadius) continue;
            if (!this.diagnostic && !this.hasLineOfSight(candidate)) continue;

            const seen: EnemyMemory = {
                id: candidate.__id,
                position: v2.copy(candidate.pos),
                velocity: v2.copy(candidate.moveVel),
                visible: true,
                seenAt: this.time,
                age: 0,
                distance,
            };
            this.memory.set(candidate.__id, seen);
            visibleEnemies.push(seen);
        }

        const rememberedEnemies: EnemyMemory[] = [];
        for (const [id, memory] of this.memory) {
            const age = this.time - memory.seenAt;
            // An unseen death is not information the bot should receive.
            if (age > this.profile.memorySeconds) {
                this.memory.delete(id);
                continue;
            }
            if (visibleEnemies.some((enemy) => enemy.id === id)) continue;

            // Deliberately do not extrapolate an unseen player's exact movement.
            rememberedEnemies.push({
                ...memory,
                position: v2.copy(memory.position),
                velocity: v2.create(0, 0),
                visible: false,
                age,
                distance: v2.distance(this.player.pos, memory.position),
            });
        }

        const lootRadius = Math.min(this.profile.perceptionRadius, 22);
        const possibleLoot = this.diagnostic
            ? this.game.lootBarn.loots
            : observableObjects!.filter(
                (object): object is Loot => object.__type === ObjectType.Loot,
            );
        const nearbyLoot = possibleLoot.filter(
            (loot) =>
                !loot.destroyed
                && loot.layer === this.player.layer
                && v2.lengthSqr(v2.sub(loot.pos, this.player.pos))
                    <= lootRadius * lootRadius
                && (this.diagnostic || this.hasLineOfSightTo(loot.pos)),
        );

        const zoneCenter = v2.copy(this.game.gas.currentPos);
        const safeRadius = this.game.gas.currentRad;
        const coverCandidates = this.findCoverCandidates(
            visibleEnemies[0],
            zoneCenter,
            safeRadius,
        );
        return {
            time: this.time,
            visibleEnemies,
            rememberedEnemies,
            nearbyLoot,
            coverCandidates,
            outsideZone: v2.distance(this.player.pos, zoneCenter) > safeRadius,
            zoneCenter,
        };
    }

    clear(): void {
        this.memory.clear();
    }

    private isEnemy(candidate: Player): boolean {
        if (candidate === this.player || candidate.dead || candidate.downed) return false;
        if (!this.allowBotVsBot && candidate.isAi) return false;
        if (!this.game.modeManager.isSolo && candidate.teamId === this.player.teamId) {
            return false;
        }
        return true;
    }

    private findCoverCandidates(
        threat: EnemyMemory | undefined,
        zoneCenter: Vec2,
        safeRadius: number,
    ): CoverCandidate[] {
        if (!threat) return [];
        const nearby = this.game.grid.intersectCollider(
            collider.createCircle(this.player.pos, 15),
        );
        const candidates: CoverCandidate[] = [];
        for (const object of nearby) {
            if (
                object.__type !== ObjectType.Obstacle
                || object.dead
                || !object.collidable
                || object.layer !== this.player.layer
            ) {
                continue;
            }
            const bounds = collider.toAabb(object.collider);
            const radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2;
            const awayFromThreat = v2.directionNormalized(threat.position, object.pos);
            const position = v2.add(object.pos, v2.mul(awayFromThreat, radius + 1.35));
            const blocksThreat = collider.intersectSegment(
                object.collider,
                threat.position,
                position,
            );
            if (!blocksThreat) continue;
            const travelDistance = v2.distance(this.player.pos, position);
            const zonePenalty = v2.distance(position, zoneCenter) > safeRadius ? 20 : 0;
            const firingAngleBonus = this.hasLineOfSightTo(threat.position) ? 0.5 : 0;
            candidates.push({
                position,
                obstacleId: object.__id,
                score: 20 - travelDistance - zonePenalty + firingAngleBonus,
            });
        }
        candidates.sort((a, b) => b.score - a.score);
        // Limit downstream decision cost and avoid revealing the whole map.
        return candidates.slice(0, 6);
    }

    private hasLineOfSight(candidate: Player): boolean {
        return (
            candidate.layer === this.player.layer && this.hasLineOfSightTo(candidate.pos)
        );
    }

    private hasLineOfSightTo(position: Vec2): boolean {
        const objects = this.game.grid.intersectLineSegment(this.player.pos, position);
        for (const object of objects) {
            if (object.__type !== ObjectType.Obstacle) continue;
            if (object.dead || !object.collidable || object.layer !== this.player.layer) {
                continue;
            }
            if (collider.intersectSegment(object.collider, this.player.pos, position)) {
                return false;
            }
        }
        return true;
    }
}
