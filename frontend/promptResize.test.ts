import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let init: () => void;
let prompt: HTMLTextAreaElement;
let negative: HTMLTextAreaElement;
let autoSize: ReturnType<typeof jest.fn>;

beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `<textarea id="alt_prompt_textbox"></textarea>
        <textarea id="alt_negativeprompt_textbox"></textarea>`;
    prompt = document.getElementById(
        "alt_prompt_textbox",
    ) as HTMLTextAreaElement;
    negative = document.getElementById(
        "alt_negativeprompt_textbox",
    ) as HTMLTextAreaElement;
    autoSize = jest.fn<typeof dynamicSizeTextBox>((element) => {
        element.style.height = "min(10rem, 50px)";
    });
    globalThis.dynamicSizeTextBox = autoSize;
    ({ initPromptResize: init } = await import("./promptResize"));
    init();
    autoSize.mockClear();
});

describe("generate prompt resizing", () => {
    it("keeps automatic sizing until the prompt is manually resized", () => {
        globalThis.dynamicSizeTextBox(prompt, 15, null);
        globalThis.dynamicSizeTextBox(prompt, 15, null);
        expect(autoSize).toHaveBeenCalledTimes(2);
        expect(autoSize).toHaveBeenLastCalledWith(prompt, 15, null);
        expect(prompt.style.minHeight).toBe("min(10rem, 50px)");
    });

    it("preserves manual height across layout updates and further resizing", () => {
        prompt.style.height = "240px";
        globalThis.dynamicSizeTextBox(prompt);
        expect(prompt.style.height).toBe("240px");
        prompt.style.height = "120px";
        globalThis.dynamicSizeTextBox(prompt);
        expect(prompt.style.height).toBe("120px");
        expect(prompt.style.minHeight).toBe("min(10rem, 50px)");
        expect(autoSize).toHaveBeenCalledTimes(2);
    });

    it("updates the minimum for longer and shorter prompts while retaining manual height", () => {
        prompt.style.height = "240px";
        autoSize.mockImplementationOnce((element: HTMLElement) => {
            element.style.height = "min(10rem, 120px)";
        });
        globalThis.dynamicSizeTextBox(prompt);
        expect(prompt.style.minHeight).toBe("min(10rem, 120px)");
        expect(prompt.style.height).toBe("240px");
        autoSize.mockImplementationOnce((element: HTMLElement) => {
            element.style.height = "min(10rem, 30px)";
        });
        globalThis.dynamicSizeTextBox(prompt);
        expect(prompt.style.minHeight).toBe("min(10rem, 30px)");
        expect(prompt.style.height).toBe("240px");
    });

    it("clears the previous minimum before Swarm measures the prompt", () => {
        prompt.style.minHeight = "240px";
        autoSize.mockImplementationOnce((element: HTMLElement) => {
            expect(element.style.minHeight).toBe("");
            element.style.height = "min(10rem, 50px)";
        });
        globalThis.dynamicSizeTextBox(prompt);
        expect(prompt.style.minHeight).toBe("min(10rem, 50px)");
    });

    it("keeps negative prompt sizing and avoids installing twice", () => {
        negative.style.height = "240px";
        globalThis.dynamicSizeTextBox(negative, 32, 50);
        expect(autoSize).toHaveBeenCalledWith(negative, 32, 50);
        expect(negative.style.height).toBe("min(10rem, 50px)");
        const installed = globalThis.dynamicSizeTextBox;
        init();
        expect(globalThis.dynamicSizeTextBox).toBe(installed);
    });
});
