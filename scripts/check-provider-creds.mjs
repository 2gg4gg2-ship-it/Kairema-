import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
const envText = fs.readFileSync(envPath, "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const REQUIRED = ["OPENROUTER_API_KEY", "ORCAROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "API_KEY_DOTS3", "ZENMUX_API_KEY"];
const missing = REQUIRED.filter((k) => !process.env[k]);

console.log(`CREDENTIALS_PRESENT: ${REQUIRED.length - missing.length}/${REQUIRED.length}`);
if (missing.length > 0) {
  console.error(`MISSING: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("ALL_CREDENTIALS_PRESENT");
