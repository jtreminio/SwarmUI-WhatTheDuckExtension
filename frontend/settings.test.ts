import { describe, expect, it } from "@jest/globals";
import {
    escapeHtml,
    renderDatadumpStatus,
    renderModifiedPlaceholders,
    renderSettingsForm,
} from "./settings";

describe("settings pure renderers", () => {
    describe("escapeHtml", () => {
        it("escapes HTML-significant characters", () => {
            expect(escapeHtml("<b>&\"'</b>")).toBe(
                "&lt;b&gt;&amp;\"'&lt;/b&gt;",
            );
        });

        it("leaves plain text untouched", () => {
            expect(escapeHtml("season_01.txt")).toBe("season_01.txt");
        });
    });

    describe("renderDatadumpStatus", () => {
        it("reports the indexed count when active", () => {
            expect(renderDatadumpStatus(true, 42)).toBe(
                '<span class="whattheduck-datadump-active">✓ Active - 42 datadump file(s) indexed</span>',
            );
        });

        it("still reports the active state when the count is zero", () => {
            expect(renderDatadumpStatus(true, 0)).toBe(
                '<span class="whattheduck-datadump-active">✓ Active - 0 datadump file(s) indexed</span>',
            );
        });

        it("renders the inactive hint when not active", () => {
            expect(renderDatadumpStatus(false, 0)).toBe(
                '<span class="whattheduck-datadump-inactive">○ Inactive - Enable and set path to activate</span>',
            );
        });
    });

    describe("renderModifiedPlaceholders", () => {
        it("returns an empty string when there is nothing to report", () => {
            expect(renderModifiedPlaceholders([])).toBe("");
            expect(
                renderModifiedPlaceholders(undefined as unknown as string[]),
            ).toBe("");
        });

        it("reports a count of one for a single modified file", () => {
            const html = renderModifiedPlaceholders(["only.txt"]);
            expect(html).toContain("Modified Placeholder Files (1)");
            expect(html).toContain("<code>only.txt</code>");
        });

        it("lists each modified file with the count", () => {
            const html = renderModifiedPlaceholders(["a.txt", "b.txt"]);
            expect(html).toContain("Modified Placeholder Files (2)");
            expect(html).toContain("<code>a.txt</code>");
            expect(html).toContain("<code>b.txt</code>");
        });

        it("escapes file names to prevent HTML injection", () => {
            const html = renderModifiedPlaceholders([
                "<img src=x onerror=alert(1)>.txt",
            ]);
            expect(html).not.toContain("<img src=x");
            expect(html).toContain("&lt;img src=x");
        });
    });

    describe("renderSettingsForm", () => {
        it("checks the checkboxes that are enabled in state", () => {
            const html = renderSettingsForm({
                keyboardNavigationEnabled: true,
                datadumpEnabled: false,
                datadumpFolder: "/data/wildcards",
            });

            const wrapper = document.createElement("div");
            wrapper.innerHTML = html;

            const keyboardNav = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-keyboard-nav",
            );
            const datadumpEnabled = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-datadump-enabled",
            );
            const folder = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-datadump-folder",
            );

            expect(keyboardNav?.checked).toBe(true);
            expect(datadumpEnabled?.checked).toBe(false);
            expect(folder?.value).toBe("/data/wildcards");
        });

        it("checks the inverse set of checkboxes for the opposite state", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                datadumpEnabled: true,
                datadumpFolder: "",
            });

            const keyboardNav = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-keyboard-nav",
            );
            const datadumpEnabled = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-datadump-enabled",
            );
            const folder = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-datadump-folder",
            );

            expect(keyboardNav?.checked).toBe(false);
            expect(datadumpEnabled?.checked).toBe(true);
            expect(folder?.value).toBe("");
        });

        it("includes the containers the controller later populates", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                datadumpEnabled: false,
                datadumpFolder: "",
            });

            expect(wrapper.querySelector("#whattheduck-form")).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-datadump-status"),
            ).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-modified-placeholders"),
            ).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-refresh-datadump"),
            ).not.toBeNull();
        });
    });
});
