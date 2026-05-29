/**
 * Jest global setup (runs once per test file, before the framework loads).
 *
 * Modeled on SwarmUI-VideoStages' jest.setup.js. WhatTheDuck's runtime leans on
 * a handful of SwarmUI browser globals that live in wwwroot/js:
 *
 *   - getMediaType(src)            util.js   (batchCompare)
 *   - genericRequest(...)          site.js   (settings load/save/refresh)
 *   - registerNewTool(id, name)    genpage/main.js (settings.init)
 *   - showError / imageCompareHelper / mainGenHandler  (various)
 *
 * The current test suite only exercises PURE helpers (HTML string builders,
 * DOM predicates) that need nothing beyond jsdom, so we do not eval any SwarmUI
 * script here yet. When we begin testing the controller flows that call the
 * globals above, load the real implementations with `loadSwarmScript(...)` (the
 * same indirect-eval trick VideoStages uses) instead of hand-mocking them.
 */

const fs = require("node:fs");
const path = require("node:path");

const SWARM_JS_DIR = path.resolve(__dirname, "..", "..", "..", "wwwroot", "js");

// biome-ignore lint/security/noGlobalEval: Indirect eval runs trusted local SwarmUI scripts in the global scope so their sloppy-mode declarations reach window.
const indirectEval = eval;

/**
 * Evaluate a SwarmUI wwwroot/js script in the global scope so its top-level
 * `function`/`let` declarations attach to globalThis / window under jsdom.
 * Currently unused (see the file header); kept file-local and ready for the
 * controller tests that will call it once they need the real SwarmUI globals.
 */
// biome-ignore lint/correctness/noUnusedVariables: Helper kept ready for controller-flow tests (see file header).
const loadSwarmScript = (relativePath) => {
    const absolutePath = path.join(SWARM_JS_DIR, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    indirectEval(source);
};
