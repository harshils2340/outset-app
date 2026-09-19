import { prunePageCache } from "../src/scrape/fetch.ts";

/**
 * The shared page cache lives on the same 5 GB disk as the database, so it is held to a cap rather than left
 * to grow. Oldest out first, and anything past its life goes whatever the size.
 */
const r = prunePageCache();
console.log(`page cache: ${r.kept.toLocaleString()} pages kept (${(r.bytes / 1024 / 1024).toFixed(0)} MB), ${r.removed.toLocaleString()} removed`);
