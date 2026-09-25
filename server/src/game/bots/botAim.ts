import { type Vec2, v2 } from "../../../../shared/utils/v2";
import type { BotSkillProfile } from "./botDifficulty";
import type { BotRandom } from "./botRandom";

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
    private errorVelocity = 0;
    private targetId?: number;
    private reactionRemaining = 0;

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
        if (targetId !== this.targetId) {
            this.targetId = targetId;
            this.reactionRemaining = this.rng.range(...this.profile.reactionTime);
            this.error += this.rng.normal() * this.profile.aimErrorRadians;
        }
        this.reactionRemaining = Math.max(0, this.reactionRemaining - dt);

        const distance = v2.distance(shooterPosition, targetPosition);
        const leadQuality = this.profile.weaponKnowledge * this.profile.aimAccuracy;
        const flightTime = projectileSpeed > 0 ? distance / projectileSpeed : 0;
        const predicted = v2.add(
            targetPosition,
            v2.mul(targetVelocity, flightTime * leadQuality),
        );
        const idealAngle = Math.atan2(
            predicted.y - shooterPosition.y,
            predicted.x - shooterPosition.x,
        );

        // A damped wandering error produces drift and correction, not frame-wise noise.
        const pressureScale = 1 + (moving ? 0.45 : 0) + (underPressure ? 0.5 : 0);
        const desiredSigma = this.profile.aimErrorRadians * pressureScale;
        this.errorVelocity += this.rng.normal() * desiredSigma * dt * 2.2;
        this.errorVelocity -= this.errorVelocity * Math.min(1, dt * 4.5);
        this.error += this.errorVelocity * dt;
        this.error -= this.error * Math.min(1, dt * (1.2 + this.profile.aimAccuracy * 4));

        const desiredAngle = idealAngle + this.error;
        const delta = wrapAngle(desiredAngle - this.angle);
        const maxCorrection =
            this.profile.maxAimSpeed * (0.55 + this.profile.aimSpeed * 0.45) * dt;
        this.angle += Math.max(-maxCorrection, Math.min(maxCorrection, delta));
        this.angle = wrapAngle(this.angle);

        const currentError = Math.abs(wrapAngle(idealAngle - this.angle));
        const fireTolerance = 0.05 + (1 - this.profile.aimAccuracy) * 0.2;
        return {
            direction: v2.create(Math.cos(this.angle), Math.sin(this.angle)),
            readyToFire: this.reactionRemaining <= 0 && currentError <= fireTolerance,
            errorRadians: currentError,
            reactionRemaining: this.reactionRemaining,
        };
    }

    loseTarget(): void {
        this.targetId = undefined;
    }
}
