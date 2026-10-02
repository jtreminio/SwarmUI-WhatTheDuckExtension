declare global {
    var dynamicSizeTextBox: (
        element: HTMLElement,
        min?: number,
        altMax?: number | null,
    ) => void;
}

let started = false;

export function initPromptResize(): void {
    const prompt = document.getElementById("alt_prompt_textbox");
    if (started || !prompt || typeof dynamicSizeTextBox !== "function") return;
    started = true;
    const original = dynamicSizeTextBox;
    globalThis.dynamicSizeTextBox = function (element, ...args) {
        if (element !== prompt) {
            original.call(this, element, ...args);
            return;
        }
        // Native dragging writes a pixel height; Swarm's auto-sizer writes a
        // calc/min expression. Keep the manual height after measuring the text.
        const height = element.style.height;
        const manuallyResized =
            height.endsWith("px") && Number.parseFloat(height) > 0;
        // Let Swarm measure the current text without the previous minimum
        // affecting scrollHeight. Its normal height becomes the resize floor.
        element.style.minHeight = "";
        original.call(this, element, ...args);
        element.style.minHeight = element.style.height;
        if (manuallyResized) element.style.height = height;
    };
    globalThis.dynamicSizeTextBox(prompt);
}

export const promptResize = { init: initPromptResize };
