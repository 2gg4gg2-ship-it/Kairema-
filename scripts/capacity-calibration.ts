import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCapacityCalibration } from "../server/capacity-calibration";

const outputPath = resolve(process.cwd(), "reports/evidence/data/capacity-calibration-simulation-2026-08.json");
const result = runCapacityCalibration();
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.info(JSON.stringify({ outputPath, deterministic: result.deterministic, network: result.network, populationProjections: result.populationProjections.length }));
