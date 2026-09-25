export type BotPlaystyle =
    | "aggressive"
    | "defensive"
    | "movement-heavy"
    | "aim-focused"
    | "opportunist"
    | "beginner";

export type BotBrainType = "practice" | "realistic" | "competitive";

export interface BrainMixConfig {
    weights?: Partial<Record<BotBrainType, number>>;
    force?: BotBrainType;
}

export interface BotPersonality {
    playstyle: BotPlaystyle;
    preferredCombatDistance: number;
    aggression: number;
    strafingBias: -1 | 1;
    lootGreed: number;
    riskTolerance: number;
    reactionMultiplier: number;
    aimConfidence: number;
    chasePersistence: number;
}

export const playstyleModifiers: Record<
    BotPlaystyle,
    {
        distanceMultiplier: number;
        aggressionMultiplier: number;
        riskMultiplier: number;
    }
> = {
    aggressive: {
        distanceMultiplier: 0.72,
        aggressionMultiplier: 1.45,
        riskMultiplier: 1.35,
    },
    defensive: {
        distanceMultiplier: 1.15,
        aggressionMultiplier: 0.65,
        riskMultiplier: 0.55,
    },
    "movement-heavy": {
        distanceMultiplier: 0.95,
        aggressionMultiplier: 1,
        riskMultiplier: 1,
    },
    "aim-focused": {
        distanceMultiplier: 1.2,
        aggressionMultiplier: 0.9,
        riskMultiplier: 0.75,
    },
    opportunist: {
        distanceMultiplier: 1.05,
        aggressionMultiplier: 0.8,
        riskMultiplier: 0.45,
    },
    beginner: { distanceMultiplier: 0.8, aggressionMultiplier: 1.1, riskMultiplier: 1.4 },
};

export function playstyleForBrain(brain: BotBrainType): BotPlaystyle {
    switch (brain) {
        case "practice":
            return "beginner";
        case "competitive":
            return "movement-heavy";
        default:
            return "opportunist";
    }
}
