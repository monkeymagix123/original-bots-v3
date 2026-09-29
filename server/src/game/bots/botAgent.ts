import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { BulletDef } from "../../../../shared/defs/gameObjects/bulletDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { GameConfig } from "../../../../shared/gameConfig";
import { InputMsg } from "../../../../shared/net/inputMsg";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import { Config } from "../../config";
import type { Game } from "../game";
import type { Player } from "../objects/player";
import { BotAimController } from "./botAim";
import type { BotPersonality } from "./botBrain";
import { BotDecisionMaker } from "./botDecision";
import type { BotSkillProfile } from "./botDifficulty";
import { BotMovementController } from "./botMovement";
import { BotPerception } from "./botPerception";
import { BotRandom } from "./botRandom";
import { type BotTelemetrySnapshot, createBotTelemetry } from "./botTelemetry";

export interface BotAgentOptions {
    profile: BotSkillProfile;
    personality: BotPersonality;
    seed: number;
    diagnostic?: boolean;
    debug?: boolean;
}

export class BotAgent {
    readonly telemetry: BotTelemetrySnapshot = createBotTelemetry();
    private readonly rng: BotRandom;
    private readonly perception: BotPerception;
    private readonly decisions: BotDecisionMaker;
    private readonly movement: BotMovementController;
    private readonly aim: BotAimController;
    private seq = 0;

    constructor(
        readonly game: Game,
        readonly player: Player,
        readonly options: BotAgentOptions,
    ) {
        this.rng = new BotRandom(options.seed);
        this.perception = new BotPerception(
            game,
            player,
            options.profile,
            options.diagnostic,
            Config.bots.allowBotVsBot,
        );
        this.decisions = new BotDecisionMaker(
            options.profile,
            options.personality,
            this.rng,
        );
        this.movement = new BotMovementController(
            game,
            player,
            options.profile,
            options.personality,
            this.rng,
        );
        this.aim = new BotAimController(options.profile, this.rng, player.dir);
    }

    update(dt: number): void {
        if (this.player.dead || this.player.disconnected) return;
        const perceived = this.perception.update(dt);
        const weapon = this.weaponCharacteristics();
        const decision = this.decisions.update(
            dt,
            this.player,
            perceived,
            weapon.preferredDistance * this.options.personality.preferredCombatDistance,
        );
        const movement = this.movement.update(
            dt,
            decision.movement,
            decision.destination,
        );
        const msg = new InputMsg();
        msg.seq = this.seq++ & 0xff;
        this.applyMovement(msg, movement.direction);

        const visibleTarget = decision.target?.visible ? decision.target : undefined;
        if (visibleTarget) {
            const aim = this.aim.update(
                dt,
                this.player.pos,
                visibleTarget.position,
                visibleTarget.velocity,
                visibleTarget.id,
                weapon.projectileSpeed,
                v2.lengthSqr(movement.direction) > 0,
                this.player.health < 45,
            );
            msg.toMouseDir = aim.direction;
            msg.toMouseLen = Math.min(64, visibleTarget.distance);
            msg.shootStart = decision.wantsToShoot && aim.readyToFire;
            msg.shootHold = msg.shootStart;
            this.telemetry.aimError = aim.errorRadians;
            this.telemetry.reactionRemaining = aim.reactionRemaining;
            this.telemetry.aimPoint = v2.copy(visibleTarget.position);
        } else {
            this.aim.loseTarget();
            msg.toMouseDir = v2.lengthSqr(movement.direction)
                ? movement.direction
                : this.player.dir;
            this.telemetry.aimPoint = undefined;
            this.telemetry.aimError = 0;
            this.telemetry.reactionRemaining = 0;
        }

        if (decision.wantsToReload) msg.addInput(GameConfig.Input.Reload);
        if (decision.switchWeapon === GameConfig.WeaponSlot.Primary) {
            msg.addInput(GameConfig.Input.EquipPrimary);
        } else if (decision.switchWeapon === GameConfig.WeaponSlot.Secondary) {
            msg.addInput(GameConfig.Input.EquipSecondary);
        }
        if (movement.useDoor) msg.addInput(GameConfig.Input.Use);
        if (
            decision.state === "looting" &&
            decision.destination &&
            v2.distance(this.player.pos, decision.destination) < 3.8
        ) {
            msg.addInput(GameConfig.Input.Loot);
        }
        if (decision.useItem) msg.useItem = decision.useItem;

        this.player.handleInput(msg);

        this.telemetry.state = decision.state;
        this.telemetry.targetId = decision.target?.id;
        this.telemetry.destination =
            decision.destination && v2.copy(decision.destination);
        this.telemetry.perceivedThreats =
            perceived.visibleEnemies.length + perceived.rememberedEnemies.length;
        this.telemetry.transitionReason = decision.transitionReason;
        this.telemetry.actionReason = decision.reason;
        this.telemetry.decisions++;
        this.telemetry.damageDealt = this.player.damageDealt;
        this.telemetry.damageTaken = this.player.damageTaken;
        this.telemetry.kills = this.player.kills;
        this.telemetry.survivalTime = this.player.timeAlive;
        if (msg.shootStart) this.telemetry.shotsAttempted++;
        if (visibleTarget) {
            this.telemetry.engagementDistanceSamples++;
            const count = this.telemetry.engagementDistanceSamples;
            this.telemetry.averageEngagementDistance +=
                (visibleTarget.distance - this.telemetry.averageEngagementDistance) /
                count;
        }
        if (movement.changedDirection) this.telemetry.directionChanges++;
        if (movement.stuckRecovered) this.telemetry.stuckEvents++;

        if (this.options.debug) {
            this.game.logger.debug?.(
                `[bot:${this.player.name}] ${decision.state}: ${decision.reason}`,
            );
        }
    }

    private applyMovement(msg: InputMsg, direction: Vec2): void {
        // Axis thresholds make controls look like keyboard input and prevent tiny jitter.
        msg.moveLeft = direction.x < -0.25;
        msg.moveRight = direction.x > 0.25;
        msg.moveDown = direction.y < -0.25;
        msg.moveUp = direction.y > 0.25;
    }

    private weaponCharacteristics(): {
        preferredDistance: number;
        projectileSpeed: number;
    } {
        const def = GameObjectDefs[this.player.activeWeapon];
        if (def?.type === "gun") {
            const gun = def as GunDef;
            const bullet = GameObjectDefs[gun.bulletType] as BulletDef | undefined;
            const maxDistance = bullet?.distance ?? 100;
            let preferredDistance = Math.max(8, Math.min(34, maxDistance * 0.14));
            if (gun.bulletCount > 1) preferredDistance = Math.min(preferredDistance, 11);
            if (gun.fireDelay >= 0.65)
                preferredDistance = Math.max(preferredDistance, 25);
            return {
                preferredDistance,
                projectileSpeed: bullet?.speed ?? 100,
            };
        }
        return { preferredDistance: 2.25, projectileSpeed: 0 };
    }
}
