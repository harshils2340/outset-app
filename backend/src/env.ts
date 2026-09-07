import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load backend/.env before any other module reads process.env. Import this first. */
const envFile = join(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
