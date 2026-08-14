import { describe, expect, it } from "@jest/globals";
import { escapeAttr, escapeHtml } from "./escape";
import {
    type ArchRowOptions,
    readArchMappings,
    renderArchMappingRows,
    renderMappingSelect,
    renderSettingsForm,
    SERVER_PATH_PLACEHOLDER_FALLBACK,
    serverPathPlaceholder,
} from "./settings";

const ROW_OPTIONS: ArchRowOptions = {
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

    describe("serverPathPlaceholder", () => {
        it("uses the server's base path when it is known", () => {
            expect(serverPathPlaceholder("  /workspace  ")).toBe("/workspace");
        });

        it("falls back when the path is missing or blank", () => {
            expect(serverPathPlaceholder(undefined)).toBe(
                SERVER_PATH_PLACEHOLDER_FALLBACK,
            );
            expect(serverPathPlaceholder("   ")).toBe(
                SERVER_PATH_PLACEHOLDER_FALLBACK,
            );
        });
    });

    describe("renderSettingsForm", () => {
        it("checks keyboard navigation when enabled in state", () => {
            const html = renderSettingsForm({
                keyboardNavigationEnabled: true,
                archFolderMappings: [],
                clipboardPathFrom: "",
                clipboardPathTo: "",
            });

            const wrapper = document.createElement("div");
            wrapper.innerHTML = html;

            const keyboardNav = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-keyboard-nav",
            );
            expect(keyboardNav?.checked).toBe(true);
        });

        it("leaves keyboard navigation unchecked when disabled in state", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [],
                clipboardPathFrom: "",
                clipboardPathTo: "",
            });

            const keyboardNav = wrapper.querySelector<HTMLInputElement>(
                "#whattheduck-keyboard-nav",
            );
            expect(keyboardNav?.checked).toBe(false);
        });

        it("includes the containers the controller later populates", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [],
                clipboardPathFrom: "",
                clipboardPathTo: "",
            });

            expect(wrapper.querySelector("#whattheduck-form")).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-arch-mappings"),
            ).not.toBeNull();
            expect(
                wrapper.querySelector("#whattheduck-arch-add"),
            ).not.toBeNull();
        });

        it("shows the server's own base path as the server-prefix placeholder", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [],
                clipboardPathFrom: "",
                clipboardPathTo: "",
                serverRootPath: "/opt/SwarmUI",
            });

            expect(
                wrapper.querySelector<HTMLInputElement>(
                    "#whattheduck-clipboard-from",
                )?.placeholder,
            ).toBe("/opt/SwarmUI");
        });

        it("falls back to a generic placeholder before the server reports its path", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [],
                clipboardPathFrom: "",
                clipboardPathTo: "",
            });

            expect(
                wrapper.querySelector<HTMLInputElement>(
                    "#whattheduck-clipboard-from",
                )?.placeholder,
            ).toBe(SERVER_PATH_PLACEHOLDER_FALLBACK);
        });

        it("seeds the clipboard path-mapping inputs from state", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [],
                clipboardPathFrom: "/workspace",
                clipboardPathTo: "~/swarm-data",
            });

            expect(
                wrapper.querySelector<HTMLInputElement>(
                    "#whattheduck-clipboard-from",
                )?.value,
            ).toBe("/workspace");
            expect(
                wrapper.querySelector<HTMLInputElement>(
                    "#whattheduck-clipboard-to",
                )?.value,
            ).toBe("~/swarm-data");
        });

        it("seeds the mapping rows from state", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderSettingsForm({
                keyboardNavigationEnabled: false,
                archFolderMappings: [
                    {
                        architectures: ["Anima", "Pony"],
                        checkpointFolder: "anima",
                        loraFolder: "anima/loras",
                    },
                ],
                clipboardPathFrom: "",
                clipboardPathTo: "",
            });

            const row = wrapper.querySelector("[data-wtd-arch-row]");
            expect(row).not.toBeNull();
            const archSelect =
                row?.querySelector<HTMLSelectElement>(".wtd-arch-select");
            expect(
                Array.from(archSelect?.selectedOptions ?? []).map(
                    (o) => o.value,
                ),
            ).toEqual(["Anima", "Pony"]);
            // Folder values not present in the (empty in jsdom) coreModelMap
            // folder lists are injected as options so they still round-trip.
            expect(
                row?.querySelector<HTMLSelectElement>(".wtd-arch-checkpoint")
                    ?.value,
            ).toBe("anima");
            expect(
                row?.querySelector<HTMLSelectElement>(".wtd-arch-lora")?.value,
            ).toBe("anima/loras");
        });
    });

    describe("escapeAttr", () => {
        it("escapes double quotes on top of HTML escaping", () => {
            expect(escapeAttr('a"b<c>&d')).toBe("a&quot;b&lt;c&gt;&amp;d");
        });
    });

    describe("renderMappingSelect", () => {
        it("renders a SwarmUI-styled dropdown with a placeholder and selects the value", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderMappingSelect(
                "wtd-arch-checkpoint",
                "(No checkpoint folder)",
                ["anima", "pony"],
                "pony",
            );
            const select = wrapper.querySelector<HTMLSelectElement>("select");
            expect(select?.classList.contains("auto-dropdown")).toBe(true);
            expect(select?.classList.contains("wtd-arch-checkpoint")).toBe(
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
            wrapper.innerHTML = renderMappingSelect(
                "wtd-arch-lora",
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
            wrapper.innerHTML = renderMappingSelect(
                "wtd-arch-checkpoint",
                "(No checkpoint folder)",
                ["anima"],
                "brand/new-folder",
            );
            const select = wrapper.querySelector<HTMLSelectElement>("select");
            expect(select?.value).toBe("brand/new-folder");
            expect(select?.options.length).toBe(3);
        });

        it("escapes values to prevent markup injection", () => {
            const html = renderMappingSelect(
                "wtd-arch-checkpoint",
                "(No checkpoint folder)",
                [],
                '"><script>alert(1)</script>',
            );
            expect(html).not.toContain("<script>");
            expect(html).toContain("&quot;&gt;&lt;script&gt;");
        });
    });

    describe("arch mapping rows", () => {
        it("round-trips rows through the DOM via readArchMappings", () => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = renderArchMappingRows(
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

            expect(readArchMappings(wrapper)).toEqual([
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
            wrapper.innerHTML = renderArchMappingRows(
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

            expect(readArchMappings(wrapper)).toEqual([
                {
                    architectures: ["Pony"],
                    checkpointFolder: "pony",
                    loraFolder: "",
                },
            ]);
        });
    });
});
