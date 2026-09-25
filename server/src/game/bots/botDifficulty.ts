export type BotDifficulty =
    | "beginner"
    | "casual"
    | "skilled"
    | "expert"
    | "diagnostic"
    // Backwards-compatible configuration names used by wave maps and old configs.
    | "normal"
    | "hard"
    | "pro";

export interface BotSkillProfile {
    aimAccuracy: number;
    aimSpeed: number;
    reactionSpeed: number;
    movementSkill: number;
    dodgingSkill: number;
    positioningSkill: number;
    tacticalJudgment: number;
    lootEfficiency: number;
    weaponKnowledge: number;
    zoneAwareness: number;
    threatAwareness: number;
    memoryQuality: number;
    aggression: number;
    patience: number;
    adaptability: number;

    reactionTime: [number, number];
    aimErrorRadians: number;
    maxAimSpeed: number;
    memorySeconds: number;
    perceptionRadius: number;
    decisionInterval: [number, number];
    minStateDuration: [number, number];
}

const profiles: Record<
    "beginner" | "casual" | "skilled" | "expert" | "diagnostic",
    BotSkillProfile
> = {
    beginner: {
        aimAccuracy: 0.25,
        aimSpeed: 0.3,
        reactionSpeed: 0.2,
        movementSkill: 0.25,
        dodgingSkill: 0.2,
        positioningSkill: 0.15,
        tacticalJudgment: 0.18,
        lootEfficiency: 0.25,
        weaponKnowledge: 0.2,
        zoneAwareness: 0.2,
        threatAwareness: 0.2,
        memoryQuality: 0.25,
        aggression: 0.5,
        patience: 0.3,
        adaptability: 0.2,
        reactionTime: [0.55, 1.05],
        aimErrorRadians: 0.24,
        maxAimSpeed: 3.2,
        memorySeconds: 1.4,
        perceptionRadius: 25,
        decisionInterval: [0.65, 1.15],
        minStateDuration: [0.65, 1.3],
    },
    casual: {
        aimAccuracy: 0.48,
        aimSpeed: 0.5,
        reactionSpeed: 0.48,
        movementSkill: 0.48,
        dodgingSkill: 0.42,
        positioningSkill: 0.42,
        tacticalJudgment: 0.43,
        lootEfficiency: 0.5,
        weaponKnowledge: 0.48,
        zoneAwareness: 0.5,
        threatAwareness: 0.45,
        memoryQuality: 0.48,
        aggression: 0.5,
        patience: 0.48,
        adaptability: 0.45,
        reactionTime: [0.3, 0.62],
        aimErrorRadians: 0.13,
        maxAimSpeed: 5.5,
        memorySeconds: 2.8,
        perceptionRadius: 31,
        decisionInterval: [0.42, 0.8],
        minStateDuration: [0.48, 1.0],
    },
    skilled: {
        aimAccuracy: 0.72,
        aimSpeed: 0.72,
        reactionSpeed: 0.7,
        movementSkill: 0.72,
        dodgingSkill: 0.7,
        positioningSkill: 0.7,
        tacticalJudgment: 0.7,
        lootEfficiency: 0.73,
        weaponKnowledge: 0.75,
        zoneAwareness: 0.75,
        threatAwareness: 0.7,
        memoryQuality: 0.72,
        aggression: 0.52,
        patience: 0.68,
        adaptability: 0.7,
        reactionTime: [0.18, 0.38],
        aimErrorRadians: 0.07,
        maxAimSpeed: 8,
        memorySeconds: 4.2,
        perceptionRadius: 38,
        decisionInterval: [0.3, 0.58],
        minStateDuration: [0.35, 0.75],
    },
    expert: {
        aimAccuracy: 0.9,
        aimSpeed: 0.9,
        reactionSpeed: 0.88,
        movementSkill: 0.9,
        dodgingSkill: 0.88,
        positioningSkill: 0.9,
        tacticalJudgment: 0.9,
        lootEfficiency: 0.92,
        weaponKnowledge: 0.92,
        zoneAwareness: 0.92,
        threatAwareness: 0.9,
        memoryQuality: 0.9,
        aggression: 0.55,
        patience: 0.85,
        adaptability: 0.9,
        reactionTime: [0.12, 0.25],
        aimErrorRadians: 0.035,
        maxAimSpeed: 11,
        memorySeconds: 5.5,
        perceptionRadius: 44,
        decisionInterval: [0.22, 0.42],
        minStateDuration: [0.28, 0.62],
    },
    diagnostic: {
        aimAccuracy: 1,
        aimSpeed: 1,
        reactionSpeed: 1,
        movementSkill: 1,
        dodgingSkill: 1,
        positioningSkill: 1,
        tacticalJudgment: 1,
        lootEfficiency: 1,
        weaponKnowledge: 1,
        zoneAwareness: 1,
        threatAwareness: 1,
        memoryQuality: 1,
        aggression: 0.7,
        patience: 1,
        adaptability: 1,
        reactionTime: [0, 0],
        aimErrorRadians: 0,
        maxAimSpeed: Infinity,
        memorySeconds: 30,
        perceptionRadius: Infinity,
        decisionInterval: [0.05, 0.05],
        minStateDuration: [0, 0],
    },
};

export function normalizeBotDifficulty(difficulty: BotDifficulty): keyof typeof profiles {
    if (difficulty === "normal") return "casual";
    if (difficulty === "hard") return "skilled";
    if (difficulty === "pro") return "expert";
    return difficulty;
}

export function getBotSkillProfile(difficulty: BotDifficulty): BotSkillProfile {
    return { ...profiles[normalizeBotDifficulty(difficulty)] };
}
