import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every address this project hands a person has to name the path the app is actually served at.
 *
 * Until 3 October 2026 the guest app was the site root, so a listing was `https://onoutset.com/#o=<id>`, a
 * claim link `#claim=`, a Stripe return `#paid=` and an outreach take-it-down link `#remove=`. That day the
 * root became the Otto page, which sells an AI front desk to operators, and the marketplace moved to
 * /activities with the operator side at /operators. The app's own `src/lib/site.ts` was moved with it; the
 * API, the mail and the scripts were not, and went on minting root hashes that only work because the Otto
 * page carries a script that forwards them. That script is the net under the links already in the wild, not
 * the address new mail and new Stripe sessions should carry: with it, a claim link and a paid return are a
 * marketing page that replaces itself, and without JavaScript they are a sales page and nothing else.
 *
 * So: no source file here may build a URL out of a site root and a hash. The sweep is over the text rather
 * than over any one module because there are nine separate `SITE` constants and the next one will be a tenth.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "data" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|mts)$/.test(name)) out.push(full);
  }
  return out;
}

/** `${SITE}#o=`, `SITE + "#claim="`, `"https://onoutset.com/#paid="`: a root and a hash, however it is spelled. */
const ROOT_HASH = /(\$\{\s*SITE\w*\s*\}|SITE\w*\s*\+\s*"|onoutset\.com\/)#(o|claim|remove|paid|wallet|ask|safe|demo|payouts|admin)\b/;

test("no backend source sends a person to the site root, which is the Otto page now", () => {
  const offenders: string[] = [];
  for (const file of [...sources(join(root, "src")), ...sources(join(root, "scripts"))]) {
    if (file.includes("__tests__")) continue;
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      // Prose, not a link: several comments here recount the old root address on purpose.
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
      if (ROOT_HASH.test(line)) offenders.push(`${relative(root, file)}:${i + 1}: ${code.slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], "these build a URL from the site root and a hash:\n" + offenders.join("\n"));
});
