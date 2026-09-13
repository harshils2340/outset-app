import { copyFileSync, mkdirSync } from "node:fs";

/**
 * The operator dashboard is served at /operators, so the built index has to exist at that path too.
 *
 * This was `mkdir -p dist/operators && cp ...` inline in the build script, which is fine on Render and
 * fails on Windows: `mkdir -p` is not a thing in cmd, so the step errored while the overall build still
 * exited 0. A local build therefore produced a dist with no /operators entry point, and deploying that
 * would 404 the dashboard. Node does the same job on every platform.
 */
mkdirSync("dist/operators", { recursive: true });
copyFileSync("dist/index.html", "dist/operators/index.html");
console.log("copied dist/index.html to dist/operators/index.html");
