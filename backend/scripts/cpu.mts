import { measureIdle, MIN_IDLE } from "../src/scrape/cpu.ts";

const idle = await measureIdle();
const ok = idle >= MIN_IDLE;
console.log(JSON.stringify({ idle: Math.round(idle * 10) / 10, floor: MIN_IDLE, ok }));
process.exit(ok ? 0 : 2);
