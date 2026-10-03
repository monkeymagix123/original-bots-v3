import { type BotPersonality, type BotPlaystyle, playstyleModifiers } from "./botBrain.ts";
import { type BotDifficulty, type BotSkillProfile, getBotSkillProfile } from "./botDifficulty.ts";
import type { BotRandom } from "./botRandom.ts";

const playstyles: readonly BotPlaystyle[] = [
    "aggressive",
    "defensive",
    "movement-heavy",
    "aim-focused",
    "opportunist",
    "beginner",
];

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function createBotProfile(
    difficulty: BotDifficulty,
    rng: BotRandom,
    requestedPlaystyle?: BotPlaystyle,
): { profile: BotSkillProfile; personality: BotPersonality } {
    const profile = getBotSkillProfile(difficulty);
    const playstyle = requestedPlaystyle ?? rng.pick(playstyles);
    const modifiers = playstyleModifiers[playstyle];

    // Small match-long skill variance keeps a preset recognizable while avoiding clones.
    const skillKeys: Array<keyof BotSkillProfile> = [
        "aimAccuracy",
        "aimSpeed",
        "reactionSpeed",
        "movementSkill",
        "dodgingSkill",
        "positioningSkill",
        "tacticalJudgment",
        "lootEfficiency",
        "weaponKnowledge",
        "zoneAwareness",
        "threatAwareness",
        "memoryQuality",
        "aggression",
        "patience",
        "adaptability",
    ];
    for (const key of skillKeys) {
        const value = profile[key] as number;
        (profile[key] as number) = clamp01(value + rng.normal() * 0.045);
    }

    const reactionMultiplier = rng.range(0.9, 1.12);
    profile.reactionTime = [
        profile.reactionTime[0] * reactionMultiplier,
        profile.reactionTime[1] * reactionMultiplier,
    ];

    const aggression = clamp01(
        profile.aggression * modifiers.aggressionMultiplier * rng.range(0.88, 1.12),
    );
    const personality: BotPersonality = {
        playstyle,
        preferredCombatDistance: modifiers.distanceMultiplier * rng.range(0.9, 1.1),
        aggression,
        strafingBias: rng.chance(0.5) ? -1 : 1,
        lootGreed: clamp01(profile.lootEfficiency * rng.range(0.75, 1.25)),
        riskTolerance: clamp01(
            (0.35 + aggression * 0.55) * modifiers.riskMultiplier * rng.range(0.85, 1.15),
        ),
        reactionMultiplier,
        aimConfidence: clamp01(profile.aimAccuracy * rng.range(0.85, 1.15)),
        chasePersistence: clamp01((0.3 + aggression * 0.65) * rng.range(0.82, 1.18)),
    };
    return { profile, personality };
}
