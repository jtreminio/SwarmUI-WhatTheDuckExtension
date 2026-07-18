/**
 * Sync the civitai base-model (architecture) list into
 * data/civitai-base-models.json.
 *
 * The JSON file is the single source of truth for the "Civitai Auto-Folders"
 * architecture dropdown: frontend/civitaiFolders.ts imports it at build time,
 * so after running this script, rebuild the bundle (`npm run build`) to ship
 * the updated list.
 *
 * Values are merged as a union across three sources and NEVER removed once
 * known (a value civitai stops returning may still exist in a user's saved
 * settings):
 *
 * 1. The current data/civitai-base-models.json, if present.
 * 2. Civitai's own source constants (`baseModelConfig` in
 *    src/shared/constants/base-model.constants.ts on GitHub).
 * 3. Live sampling of civitai's public API. This matters because the
 *    production enum runs ahead of the GitHub file - e.g. "Krea 2" was live
 *    on the site while still absent from the repo.
 *
 * No dependencies (Node 20+ built-ins only). Usage:
 *
 *     npm run fetch:basemodels
 *
 * Exits non-zero if BOTH remote sources fail (the file is left untouched).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const dataFile = path.join(projectRoot, "data", "civitai-base-models.json");

const githubConstantsUrl =
    "https://raw.githubusercontent.com/civitai/civitai/main/src/shared/constants/base-model.constants.ts";
const apiUrl = "https://civitai.com/api/v1/models";
// A spread of listings so niche-but-active architectures show up: newest and
// most-downloaded, overall and per relevant model type.
const apiQueries = [
    "limit=100&sort=Newest",
    "limit=100&sort=Most%20Downloaded",
    "limit=100&types=Checkpoint&sort=Newest",
    "limit=100&types=Checkpoint&sort=Most%20Downloaded",
    "limit=100&types=LORA&sort=Newest",
    "limit=100&types=LORA&sort=Most%20Downloaded",
];
const apiRequestDelayMs = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpGetText(url, timeoutMs = 30000) {
    const response = await fetch(url, {
        headers: { "User-Agent": "WhatTheDuck-basemodel-sync/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
}

async function namesFromExistingFile() {
    if (!existsSync(dataFile)) {
        return new Set();
    }
    const data = JSON.parse(await readFile(dataFile, "utf-8"));
    const names = Array.isArray(data.baseModels) ? data.baseModels : [];
    return new Set(names.filter((name) => typeof name === "string"));
}

/**
 * Extract every `name:` from the baseModelConfig array in civitai's source.
 *
 * The extraction is strictly bounded to the baseModelConfig array: the file
 * contains several OTHER structures with `name:` entries (group display
 * names, family names, generation configs) that are NOT valid API enum
 * values. If the array's boundaries can't be found (civitai refactored the
 * file), fail this source entirely rather than over-matching - values are
 * never removed from the union, so pollution would be permanent.
 */
async function namesFromGithub() {
    const text = await httpGetText(githubConstantsUrl);
    const match = text.match(/^const baseModelConfig = \[(.*?)^\] as const/ms);
    if (!match) {
        throw new Error(
            "could not locate the baseModelConfig array; civitai may have restructured the constants file",
        );
    }
    return new Set(
        Array.from(match[1].matchAll(/\{\s*name:\s*'([^']+)'/g), (m) => m[1]),
    );
}

async function namesFromApi() {
    const names = new Set();
    for (const query of apiQueries) {
        const url = `${apiUrl}?${query}`;
        let data;
        try {
            data = JSON.parse(await httpGetText(url));
        } catch (error) {
            console.error(`warning: API query failed (${url}): ${error}`);
            continue;
        }
        for (const model of data.items ?? []) {
            for (const version of model.modelVersions ?? []) {
                const baseModel = version.baseModel;
                if (typeof baseModel === "string" && baseModel.trim()) {
                    names.add(baseModel.trim());
                }
            }
        }
        await sleep(apiRequestDelayMs);
    }
    return names;
}

async function main() {
    const existing = await namesFromExistingFile();

    let github = new Set();
    try {
        github = await namesFromGithub();
    } catch (error) {
        console.error(`warning: GitHub constants fetch failed: ${error}`);
    }

    const api = await namesFromApi();

    if (github.size === 0 && api.size === 0) {
        console.error("error: both remote sources failed; file left untouched");
        return 1;
    }

    const byLowercase = (a, b) =>
        a.toLowerCase() < b.toLowerCase()
            ? -1
            : a.toLowerCase() > b.toLowerCase()
              ? 1
              : 0;
    const merged = [...new Set([...existing, ...github, ...api])].sort(
        byLowercase,
    );
    const added = [...new Set([...github, ...api])]
        .filter((name) => !existing.has(name))
        .sort(byLowercase);

    const payload = {
        $comment:
            "Generated by scripts/fetch-civitai-basemodels.mjs - do not edit " +
            "by hand. Consumed by frontend/civitaiFolders.ts; rebuild the " +
            "bundle (npm run build) after updating.",
        updatedAt: new Date().toISOString().slice(0, 10),
        sources: [githubConstantsUrl, apiUrl],
        baseModels: merged,
    };
    await mkdir(path.dirname(dataFile), { recursive: true });
    await writeFile(dataFile, `${JSON.stringify(payload, null, 4)}\n`, "utf-8");

    console.log(
        `github source: ${github.size} names, api sample: ${api.size} names`,
    );
    if (existing.size > 0) {
        console.log(
            `added ${added.length}: ${added.length ? added.join(", ") : "(none)"}`,
        );
    }
    console.log(
        `wrote ${merged.length} base models to ${path.relative(process.cwd(), dataFile)}`,
    );
    return 0;
}

process.exitCode = await main();
