import type { BulletDef } from "../../../../shared/defs/gameObjects/bulletDefs.ts";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs.ts";
import type { MeleeDef } from "../../../../shared/defs/gameObjects/meleeDefs.ts";
import { PerkProperties } from "../../../../shared/defs/gameObjects/perkDefs.ts";
import { GameObjectDefs } from "../../../../shared/defs/register.ts";
import { GameConfig } from "../../../../shared/gameConfig.ts";
import { InputMsg } from "../../../../shared/net/inputMsg.ts";
import { ObjectType } from "../../../../shared/net/objectSerializeFns.ts";
import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import { Config } from "../../config.ts";
import type { Game } from "../game.ts";
import type { Player } from "../objects/player.ts";
import { BotAimController } from "./botAim.ts";
import type { BotPersonality } from "./botBrain.ts";
import { BotDecisionMaker } from "./botDecision.ts";
import type { BotSkillProfile } from "./botDifficulty.ts";
import { BotMovementController } from "./botMovement.ts";
import { BotPerception } from "./botPerception.ts";
import { BotRandom } from "./botRandom.ts";
import { type BotTelemetrySnapshot, createBotTelemetry } from "./botTelemetry.ts";

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
            weapon.maxDistance,
        );
        const movement = this.movement.update(
            dt,
            decision.movement,
            decision.destination,
        );
        const msg = new InputMsg();
        msg.seq = this.seq++ & 0xff;
        this.applyMovement(msg, movement.direction);

        // Begin aim recognition as soon as a target is visibly perceived, even
        // while the decision maker keeps its previous movement intention.
        // Use current perception so a lost target cannot be aimed at or shot.
        let visibleTarget = perceived.visibleEnemies.find(
            (enemy) => enemy.id === decision.target?.id,
        );
        if (!visibleTarget) {
            for (const enemy of perceived.visibleEnemies) {
                if (!visibleTarget || enemy.distance < visibleTarget.distance) {
                    visibleTarget = enemy;
                }
            }
        }
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
            const towardTarget = v2.normalizeSafe(
                v2.sub(visibleTarget.position, this.player.pos),
                aim.direction,
            );
            const projectedBarrel = weapon.barrelLength * Math.max(0, v2.dot(aim.direction, towardTarget));
            const triggerReach = weapon.triggerReach - weapon.barrelLength + projectedBarrel;
            const targetObject = this.game.objectRegister?.getById(visibleTarget.id);
            const targetRadius = targetObject?.__type === ObjectType.Player
                ? targetObject.rad
                : GameConfig.player.radius;
            let inReach = visibleTarget.distance <= triggerReach;
            if (weapon.meleeDef) {
                const offset = v2.add(
                    weapon.meleeDef.attack.offset,
                    v2.create((this.player.scale ?? 1) - 1, 0),
                );
                const meleeCenter = v2.add(
                    this.player.pos,
                    v2.rotate(offset, Math.atan2(aim.direction.y, aim.direction.x)),
                );
                inReach = v2.distance(meleeCenter, visibleTarget.position)
                    <= weapon.meleeDef.attack.rad + targetRadius;
            }
            msg.shootStart = decision.wantsToShoot
                && decision.target?.id === visibleTarget.id
                && inReach
                && aim.readyToFire;
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

        if (
            this.player.actionType === GameConfig.Action.UseItem
            && decision.state !== "healing"
            && visibleTarget
            && visibleTarget.distance <= weapon.maxDistance
        ) {
            msg.addInput(GameConfig.Input.Cancel);
        }
        if (decision.wantsToReload) msg.addInput(GameConfig.Input.Reload);
        if (decision.switchWeapon === GameConfig.WeaponSlot.Primary) {
            msg.addInput(GameConfig.Input.EquipPrimary);
        } else if (decision.switchWeapon === GameConfig.WeaponSlot.Secondary) {
            msg.addInput(GameConfig.Input.EquipSecondary);
        }
        if (movement.useDoor) msg.addInput(GameConfig.Input.Use);
        if (
            decision.state === "looting"
            && decision.destination
            && v2.distance(this.player.pos, decision.destination) < 3.8
        ) {
            msg.addInput(GameConfig.Input.Loot);
        }
        if (decision.useItem) msg.useItem = decision.useItem;

        this.player.handleInput(msg);

        this.telemetry.state = decision.state;
        this.telemetry.targetId = decision.target?.id;
        this.telemetry.destination = decision.destination && v2.copy(decision.destination);
        this.telemetry.perceivedThreats = perceived.visibleEnemies.length + perceived.rememberedEnemies.length;
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
                (visibleTarget.distance - this.telemetry.averageEngagementDistance)
                / count;
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
        maxDistance: number;
        triggerReach: number;
        barrelLength: number;
        meleeDef?: MeleeDef;
    } {
        const def = GameObjectDefs.typeToDefSafe(this.player.activeWeapon);
        if (def?.type === "gun") {
            const gun = def as GunDef;
            const bullet = GameObjectDefs.typeToDefSafe(gun.bulletType) as BulletDef | undefined;
            const maxDistance = bullet?.distance ?? 100;
            let distanceMult = 1;
            if (gun.ammo === "9mm" && this.player.hasPerk?.("bonus_9mm")) {
                distanceMult *= PerkProperties.bonus_9mm.distanceMult;
            }
            if (this.player.hasPerk?.("high_velocity")) {
                distanceMult *= PerkProperties.high_velocity.distanceMult;
            }
            const explosion = bullet?.onHit ? GameObjectDefs.typeToDefSafe(bullet.onHit) : undefined;
            const splashReach = explosion?.type === "explosion" ? explosion.rad.max : 0;
            // The bullet starts at the muzzle, ahead of the player's center.
            // Collision radius and bullet distance jitter allow near-edge hits.
            const triggerReach = maxDistance * distanceMult * (1 + Math.max(0, bullet?.variance ?? 0))
                + (bullet?.noDistAdj ? 0 : 1)
                + gun.barrelLength
                + GameConfig.player.radius
                + splashReach;
            let preferredDistance = Math.max(8, Math.min(34, maxDistance * 0.14));
            if (gun.bulletCount > 1) preferredDistance = Math.min(preferredDistance, 11);
            if (gun.fireDelay >= 0.65) {
                preferredDistance = Math.max(preferredDistance, 25);
            }
            return {
                preferredDistance,
                projectileSpeed: bullet?.speed ?? 100,
                maxDistance,
                triggerReach,
                barrelLength: gun.barrelLength,
            };
        }
        if (def?.type === "melee") {
            const offset = v2.add(
                def.attack.offset,
                v2.create((this.player.scale ?? 1) - 1, 0),
            );
            const maxDistance = v2.length(offset) + def.attack.rad + GameConfig.player.radius;
            return {
                preferredDistance: 2.25,
                projectileSpeed: 0,
                maxDistance,
                triggerReach: maxDistance,
                barrelLength: 0,
                meleeDef: def,
            };
        }
        return {
            preferredDistance: 2.25,
            projectileSpeed: 0,
            maxDistance: 2.25,
            triggerReach: Infinity,
            barrelLength: 0,
        };
    }
}
