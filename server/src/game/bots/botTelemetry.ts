import type { Vec2 } from "../../../../shared/utils/v2";
import type { BotState } from "./botDecision";

export interface BotTelemetrySnapshot {
    state: BotState;
    targetId?: number;
    destination?: Vec2;
    perceivedThreats: number;
    aimPoint?: Vec2;
    aimError: number;
    reactionRemaining: number;
    transitionReason: string;
    actionReason: string;
    directionChanges: number;
    stuckEvents: number;
    decisions: number;
    damageDealt: number;
    damageTaken: number;
    kills: number;
    survivalTime: number;
    shotsAttempted: number;
    averageEngagementDistance: number;
    engagementDistanceSamples: number;
}

export function createBotTelemetry(): BotTelemetrySnapshot {
    return {
        state: "searching",
        perceivedThreats: 0,
        aimError: 0,
        reactionRemaining: 0,
        transitionReason: "spawned",
        actionReason: "initializing",
        directionChanges: 0,
        stuckEvents: 0,
        decisions: 0,
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
        survivalTime: 0,
        shotsAttempted: 0,
        averageEngagementDistance: 0,
        engagementDistanceSamples: 0,
    };
}
