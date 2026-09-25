/** A small deterministic RNG so a bot can be replayed from its spawn seed. */
export class BotRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0 || 0x6d2b79f5;
    }

    next(): number {
        // Mulberry32 is fast enough to give every bot its own stream.
        let value = (this.state += 0x6d2b79f5);
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1));
    }

    chance(probability: number): boolean {
        return this.next() < probability;
    }

    normal(): number {
        // Box-Muller; clamp away from zero so log remains finite.
        const u = Math.max(this.next(), Number.EPSILON);
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
    }

    pick<T>(values: readonly T[]): T {
        return values[this.int(0, values.length - 1)];
    }
}
