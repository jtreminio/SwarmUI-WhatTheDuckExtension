/**
 * Per-test scaffolding shared by every WhatTheDuck frontend test.
 *
 * Runs after Jest's framework is loaded (setupFilesAfterEnv) so it can register
 * globalThis-level hooks. Tests build their own DOM fixtures, so we wipe the
 * body between tests to keep them isolated.
 *
 * Note: modules that attach `document`-level listeners (keyboardNavigation,
 * batchCompare, compareShortcuts) latch an internal `attached` flag and are NOT
 * reset here. Tests that exercise those modules should import fresh module
 * state via `jest.isolateModules` / `jest.resetModules` themselves.
 */

afterEach(() => {
    document.body.innerHTML = "";
});
