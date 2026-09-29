import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { collider } from "../../../../shared/utils/collider";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import type { Game } from "../game";
import type { Player } from "../objects/player";
import type { BotPersonality } from "./botBrain";
import type { MovementIntent } from "./botDecision";
import type { BotSkillProfile } from "./botDifficulty";
import type { BotRandom } from "./botRandom";

export interface MovementResult {
    direction: Vec2;
    stuckRecovered: boolean;
    changedDirection: boolean;
    useDoor: boolean;
}

export class BotMovementController {
    private strafeDirection: -1 | 1;
    private strafeTime = 0;
    private lastDirection = v2.create(0, 0);
    private lastPosition: Vec2;
    private stuckTime = 0;
    private recoveryTime = 0;
    private recoveryDirection = v2.create(0, 0);
    private useDoor = false;

    constructor(
        private readonly game: Game,
        private readonly player: Player,
        private readonly profile: BotSkillProfile,
        private readonly personality: BotPersonality,
        private readonly rng: BotRandom,
    ) {
        this.strafeDirection = personality.strafingBias;
        this.lastPosition = v2.copy(player.pos);
    }

    update(dt: number, intent: MovementIntent, destination?: Vec2): MovementResult {
        this.useDoor = false;
        const desiredMovement = intent !== "hold" && !!destination;
        const displacement = v2.distance(this.player.pos, this.lastPosition);
        this.lastPosition = v2.copy(this.player.pos);
        if (desiredMovement && displacement < 0.025) this.stuckTime += dt;
        else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);

        let stuckRecovered = false;
        if (this.stuckTime > 0.7) {
            const base = destination
                ? v2.directionNormalized(this.player.pos, destination)
                : v2.create(1, 0);
            const side = this.rng.chance(0.5) ? 1 : -1;
            this.recoveryDirection = v2.normalizeSafe(
                v2.add(v2.mul(v2.perp(base), side), v2.mul(base, -0.25)),
            );
            this.recoveryTime = this.rng.range(0.45, 0.9);
            this.stuckTime = 0;
            stuckRecovered = true;
        }

        let direction = v2.create(0, 0);
        if (this.recoveryTime > 0) {
            this.recoveryTime -= dt;
            direction = this.recoveryDirection;
        } else if (destination) {
            const toward = v2.directionNormalized(this.player.pos, destination);
            switch (intent) {
                case "retreat":
                    direction = v2.neg(toward);
                    break;
                case "strafe":
                    this.strafeTime -= dt;
                    if (this.strafeTime <= 0) {
                        // Reversal is a decision held for hundreds of milliseconds.
                        const styleReversal =
                            this.personality.playstyle === "movement-heavy"
                                ? 0.2
                                : this.personality.playstyle === "aim-focused"
                                  ? -0.2
                                  : 0;
                        if (
                            this.rng.chance(
                                0.35 + this.profile.dodgingSkill * 0.35 + styleReversal,
                            )
                        ) {
                            this.strafeDirection = this.strafeDirection === 1 ? -1 : 1;
                        }
                        const styleDuration =
                            this.personality.playstyle === "movement-heavy" ? 0.8 : 1;
                        this.strafeTime = this.rng.range(0.42, 1.05) * styleDuration;
                    }
                    direction = v2.normalizeSafe(
                        v2.add(
                            v2.mul(v2.perp(toward), this.strafeDirection),
                            v2.mul(toward, 0.12 * (this.personality.aggression - 0.5)),
                        ),
                    );
                    break;
                default:
                    direction = toward;
            }
            direction = this.avoidImmediateObstacle(direction);
        }

        const changedDirection =
            v2.lengthSqr(direction) > 0 &&
            v2.lengthSqr(this.lastDirection) > 0 &&
            v2.dot(direction, this.lastDirection) < 0.35;
        this.lastDirection = direction;
        return { direction, stuckRecovered, changedDirection, useDoor: this.useDoor };
    }

    private avoidImmediateObstacle(direction: Vec2): Vec2 {
        const lookAhead = 2.2 + this.profile.movementSkill * 2.3;
        const end = v2.add(this.player.pos, v2.mul(direction, lookAhead));
        const objects = this.game.grid.intersectLineSegment(this.player.pos, end);
        for (const object of objects) {
            if (
                object.__type !== ObjectType.Obstacle ||
                object.dead ||
                !object.collidable ||
                object.layer !== this.player.layer ||
                !collider.intersectSegment(object.collider, this.player.pos, end)
            ) {
                continue;
            }
            if (
                object.isDoor &&
                object.interactable &&
                v2.distance(this.player.pos, object.pos) <=
                    object.interactionRad + this.player.rad
            ) {
                this.useDoor = true;
                return direction;
            }
            const away = v2.directionNormalized(object.pos, this.player.pos);
            const side = v2.mul(v2.perp(away), this.personality.strafingBias);
            return v2.normalizeSafe(v2.add(v2.mul(away, 0.75), side));
        }
        return direction;
    }
}
