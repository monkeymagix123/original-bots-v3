import hjson from "hjson";
import fs from "node:fs";
import path from "node:path";
import { configFileName } from "../../../config.ts";
import type { PartialConfig } from "../../../configType.ts";
import { util } from "../../../shared/utils/util.ts";

export function saveConfig(dir: string, config: PartialConfig) {
    try {
        const dirname = path.resolve(import.meta.dirname, process.env.NODE_ENV === "production" ? "../.." : "../../..");

        const configPath = path.join(dirname, dir, configFileName);

        const configText = fs.readFileSync(configPath).toString();
        const localConfig = hjson.parse(configText);

        const finalConfig = util.mergeDeep({}, localConfig, config);

        fs.writeFileSync(
            configPath,
            hjson.stringify(finalConfig, { bracesSameLine: true }),
        );
        console.log("Saved config file");
    } catch (err) {
        console.error("Failed saving config", err);
    }
}
