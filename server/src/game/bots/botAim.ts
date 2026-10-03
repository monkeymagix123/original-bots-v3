import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import type { BotSkillProfile } from "./botDifficulty.ts";
import type { BotRandom } from "./botRandom.ts";

export interface AimResult {
    direction: Vec2;
    readyToFire: boolean;
    errorRadians: number;
    reactionRemaining: number;
}

function wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Smooth aim with reaction latency and temporally correlated error. */
export class BotAimController {
    private angle = 0;
    private error = 0;
    private targetId?: number;
    private reactionRemaining = 0;
    private recognizedVelocity?: Vec2;
    private pendingVelocity?: Vec2;
    private velocityReactionRemaining = 0;
    private velocityChangePending = false;

    constructor(
        private readonly profile: BotSkillProfile,
        private readonly rng: BotRandom,
        initialDirection: Vec2,
    ) {
        this.angle = Math.atan2(initialDirection.y, initialDirection.x);
    }

    update(
        dt: number,
        shooterPosition: Vec2,
        targetPosition: Vec2,
        targetVelocity: Vec2,
        targetId: number,
        projectileSpeed: number,
        moving: boolean,
        underPressure: boolean,
    ): AimResult {
        let newVelocityChange = false;
        if (targetId !== this.targetId) {
            this.targetId = targetId;
            this.reactionRemaining = this.rng.range(...this.profile.reactionTime);
            this.error = this.rng.normal() * this.profile.aimErrorRadians;
            this.recognizedVelocity = v2.copy(targetVelocity);
            this.pendingVelocity = undefined;
            this.velocityReactionRemaining = 0;
            this.velocityChangePending = false;
        } else if (this.recognizedVelocity) {
            // A direction or speed change needs to remain visible briefly before
            // it changes projectile lead. Small motion noise can still be tracked.
            const change = v2.distance(targetVelocity, this.recognizedVelocity);
            const meaningfulChange = Math.max(
                4,
                v2.length(this.recognizedVelocity) * 0.4,
            );
            if (change < meaningfulChange) {
                this.recognizedVelocity = v2.copy(targetVelocity);
                this.pendingVelocity = undefined;
                this.velocityReactionRemaining = 0;
                this.velocityChangePending = false;
            } else if (this.velocityChangePending) {
                const pendingChange = this.pendingVelocity
                    ? v2.distance(targetVelocity, this.pendingVelocity)
                    : 0;
                const meaningfulPendingChange = Math.max(
                    4,
                    v2.length(this.pendingVelocity ?? targetVelocity) * 0.4,
                );
                if (pendingChange >= meaningfulPendingChange) {
                    // If the old maneuver has already persisted through its
                    // recognition window, accept it before starting the new one.
                    if (
                        this.velocityReactionRemaining <= dt + 1e-9
                        && this.pendingVelocity
                    ) {
                        this.recognizedVelocity = v2.copy(this.pendingVelocity);
                    }
                    // A different maneuver must earn its own recognition time.
                    newVelocityChange = true;
                    this.pendingVelocity = v2.copy(targetVelocity);
                } else {
                    this.velocityReactionRemaining = this.velocityReactionRemaining <= dt + 1e-9
                        ? 0
                        : this.velocityReactionRemaining - dt;
                    if (this.velocityReactionRemaining === 0) {
                        this.recognizedVelocity = v2.copy(targetVelocity);
                        this.pendingVelocity = undefined;
                        this.velocityChangePending = false;
                    }
                }
            } else {
                newVelocityChange = true;
                this.pendingVelocity = v2.copy(targetVelocity);
            }
        }
        this.reactionRemaining = Math.max(0, this.reactionRemaining - dt);

        // Seeing a new target does not let an ordinary bot begin correcting on the
        // same input update. Keep the previous cursor direction during reaction.
        if (this.reactionRemaining > 0) {
            if (newVelocityChange) this.startVelocityRecognition(dt);
            return {
                direction: v2.create(Math.cos(this.angle), Math.sin(this.angle)),
                readyToFire: false,
                errorRadians: Math.abs(this.error),
                reactionRemaining: Math.max(
                    this.reactionRemaining,
                    this.velocityReactionRemaining,
                ),
            };
        }

        const distance = v2.distance(shooterPosition, targetPosition);
        const leadQuality = this.profile.weaponKnowledge * this.profile.aimAccuracy;
        const flightTime = projectileSpeed > 0 ? distance / projectileSpeed : 0;
        const predicted = v2.add(
            targetPosition,
            v2.mul(this.recognizedVelocity ?? targetVelocity, flightTime * leadQuality),
        );
        const idealAngle = Math.atan2(
            predicted.y - shooterPosition.y,
            predicted.x - shooterPosition.x,
        );

        // Mean-reverting drift retains a nonzero skill-dependent error even after
        // tracking a stationary target for a long time. The variance is stable
        // across different input update rates.
        const pressureScale = 1 + (moving ? 0.45 : 0) + (underPressure ? 0.5 : 0);
        const distanceScale = 0.65 + Math.min(distance, 45) / 45;
        const desiredSigma = this.profile.aimErrorRadians * 0.45 * pressureScale * distanceScale;
        const decay = Math.exp(-2.4 * dt);
        this.error = this.error * decay
            + this.rng.normal() * desiredSigma * Math.sqrt(1 - decay * decay);

        const desiredAngle = idealAngle + this.error;
        const delta = wrapAngle(desiredAngle - this.angle);
        const maxCorrection = this.profile.maxAimSpeed * (0.55 + this.profile.aimSpeed * 0.45) * dt;
        this.angle += Math.max(-maxCorrection, Math.min(maxCorrection, delta));
        this.angle = wrapAngle(this.angle);

        const currentError = Math.abs(wrapAngle(idealAngle - this.angle));
        const fireTolerance = 0.05 + (1 - this.profile.aimAccuracy) * 0.2;
        if (newVelocityChange) {
            // Sample after the frame's aim noise so an unseen change cannot alter
            // this update's cursor via a different random draw.
            this.startVelocityRecognition(dt);
        }
        return {
            direction: v2.create(Math.cos(this.angle), Math.sin(this.angle)),
            readyToFire: this.reactionRemaining <= 0 && currentError <= fireTolerance,
            errorRadians: currentError,
            reactionRemaining: Math.max(
                this.reactionRemaining,
                this.velocityReactionRemaining,
            ),
        };
    }

    loseTarget(): void {
        this.targetId = undefined;
        this.recognizedVelocity = undefined;
        this.pendingVelocity = undefined;
        this.velocityReactionRemaining = 0;
        this.velocityChangePending = false;
    }

    private startVelocityRecognition(dt: number): void {
        this.velocityReactionRemaining = Math.max(
            0,
            this.rng.range(...this.profile.reactionTime) - dt,
        );
        this.velocityChangePending = true;
    }
}
