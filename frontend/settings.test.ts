import { describe, expect, it } from "@jest/globals";
import { escapeAttr, escapeHtml } from "./escape";
import {
    type CivitaiRowOptions,
    readCivitaiMappings,
    renderCivitaiMappingRows,
    renderCivitaiSelect,
    renderDatadumpStatus,
    renderModifiedPlaceholders,
    renderSettingsForm,
} from "./settings";

const ROW_OPTIONS: CivitaiRowOptions = {
    architectures: ["Anima", "Pony", "SDXL 1.0"],
    checkpointFolders: ["anima", "pony"],
    loraFolders: ["anima", "anima/loras", "pony"],
};

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
                civitaiFolderMappings: [],
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
                civitaiFolderMappings: [],
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
                civitaiFolderMappings: [],
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
            expect(
                wrapper.querySelector("#whattheduck-civitai-mappings"),
            ).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-civitai-add"),
            ).not.toBeNull();
        });

        it("seeds the civitai mapping rows from state", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                datadumpEnabled: false,
                datadumpFolder: "",
                civitaiFolderMappings: [
                    {
                        architectures: ["Anima", "Pony"],
                        checkpointFolder: "anima",
                        loraFolder: "anima/loras",
                    },
                ],
            });

            const row = wrapper.querySelector("[data-wtd-civitai-row]");
            expect(row).not.toBeNull();
            const archSelect =
                row?.querySelector<HTMLSelectElement>(".wtd-civitai-arch");
            expect(
                Array.from(archSelect?.selectedOptions ?? []).map(
                    (o) => o.value,
                ),
            ).toEqual(["Anima", "Pony"]);
            // Folder values not present in the (empty in jsdom) coreModelMap
            // folder lists are injected as options so they still round-trip.
            expect(
                row?.querySelector<HTMLSelectElement>(".wtd-civitai-checkpoint")
                    ?.value,
            ).toBe("anima");
            expect(
                row?.querySelector<HTMLSelectElement>(".wtd-civitai-lora")
                    ?.value,
            ).toBe("anima/loras");
        });
    });

    describe("escapeAttr", () => {
        it("escapes double quotes on top of HTML escaping", () => {
            expect(escapeAttr('a"b<c>&d')).toBe("a&quot;b&lt;c&gt;&amp;d");
        });
    });

    describe("renderCivitaiSelect", () => {
        it("renders a SwarmUI-styled dropdown with a placeholder and selects the value", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderCivitaiSelect(
                "wtd-civitai-checkpoint",
                "(No checkpoint folder)",
                ["anima", "pony"],
                "pony",
            );
            const select = wrapper.querySelector<HTMLSelectElement>("select");
            expect(select?.classList.contains("auto-dropdown")).toBe(true);
            expect(select?.classList.contains("wtd-civitai-checkpoint")).toBe(
                true,
            );
            expect(select?.value).toBe("pony");
            expect(select?.options[0]?.value).toBe("");
            expect(select?.options[0]?.textContent).toBe(
                "(No checkpoint folder)",
            );
            expect(select?.options.length).toBe(3);
        });

        it("defaults to the empty placeholder when no value is set", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderCivitaiSelect(
                "wtd-civitai-lora",
                "(No LoRA folder)",
                ["anima"],
                "",
            );
            expect(
                wrapper.querySelector<HTMLSelectElement>("select")?.value,
            ).toBe("");
        });

        it("injects an unknown value as an extra option so it round-trips", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderCivitaiSelect(
                "wtd-civitai-checkpoint",
                "(No checkpoint folder)",
                ["anima"],
                "brand/new-folder",
            );
            const select = wrapper.querySelector<HTMLSelectElement>("select");
            expect(select?.value).toBe("brand/new-folder");
            expect(select?.options.length).toBe(3);
        });

        it("escapes values to prevent markup injection", () => {
            const html = renderCivitaiSelect(
                "wtd-civitai-checkpoint",
                "(No checkpoint folder)",
                [],
                '"><script>alert(1)</script>',
            );
            expect(html).not.toContain("<script>");
            expect(html).toContain("&quot;&gt;&lt;script&gt;");
        });
    });

    describe("civitai mapping rows", () => {
        it("round-trips rows through the DOM via readCivitaiMappings", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderCivitaiMappingRows(
                [
                    {
                        architectures: ["Anima", "SDXL 1.0"],
                        checkpointFolder: "anima",
                        loraFolder: "anima",
                    },
                    {
                        architectures: ["Pony"],
                        checkpointFolder: "",
                        loraFolder: "pony",
                    },
                ],
                ROW_OPTIONS,
            );

            expect(readCivitaiMappings(wrapper)).toEqual([
                {
                    architectures: ["Anima", "SDXL 1.0"],
                    checkpointFolder: "anima",
                    loraFolder: "anima",
                },
                {
                    architectures: ["Pony"],
                    checkpointFolder: "",
                    loraFolder: "pony",
                },
            ]);
        });

        it("drops incomplete rows when reading back", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderCivitaiMappingRows(
                [
                    {
                        architectures: [],
                        checkpointFolder: "x",
                        loraFolder: "",
                    },
                    {
                        architectures: ["Anima"],
                        checkpointFolder: "",
                        loraFolder: "",
                    },
                    {
                        architectures: ["Pony"],
                        checkpointFolder: "pony",
                        loraFolder: "",
                    },
                ],
                ROW_OPTIONS,
            );

            expect(readCivitaiMappings(wrapper)).toEqual([
                {
                    architectures: ["Pony"],
                    checkpointFolder: "pony",
                    loraFolder: "",
                },
            ]);
        });
    });
});
