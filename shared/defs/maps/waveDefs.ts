import { MapId } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import type { DeepPartial } from "../../utils/util.ts";
import type { MapDef } from "../mapDefs.ts";
import { Main } from "./baseDefs.ts";

const mapDef: DeepPartial<MapDef> = {
    mapId: MapId.Wave,
    isWave: true,
    wave: {
        interWaveDelay: 3,
        waves: [
            {
                count: 4,
                brains: { practice: 2, realistic: 2 },
            },
            {
                count: 6,
                brains: { realistic: 4, competitive: 2 },
            },
            {
                count: 8,
                brains: { practice: 1, realistic: 4, competitive: 3 },
            },
            {
                count: 10,
                brains: { competitive: 10 },
            },
        ],
    },
    desc: {
        name: "Wave",
        icon: "img/gui/star.svg", // SHOULD CHANGE THIS
        buttonCss: "",
    },
    assets: {
        atlases: ["loadout", "shared", "main"],
    },
    gameMode: {
        maxPlayers: 100,
        factionMode: true,
        factions: 2,
    },
};

export const Wave = util.mergeDeep({}, Main, mapDef) as MapDef;
