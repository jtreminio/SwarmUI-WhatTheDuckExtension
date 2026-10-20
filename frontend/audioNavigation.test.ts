import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { initKeyboardNavigation } from "./keyboardNavigation";

describe("A/D navigation from batch audio", () => {
    const first = "Output/first track.mp3";
    const second = "Output/second track.wav";
    const picture = "Output/picture.webp";
    const setCurrent = jest.fn();
    const showImage = jest.fn();
    const pasteState = jest.fn();
    const arrows = jest.fn();
    const onKey = (event: KeyboardEvent): void => {
        if (event.key.startsWith("Arrow")) arrows(event.key);
    };
    let cycle = "true";
    let expanded = false;
    let current: HTMLElement;
    const state = { zoom: 2, panX: 10 };

    const press = (key: string, target: EventTarget = document): void => {
        target.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
        );
    };

    beforeEach(() => {
        cycle = "true";
        expanded = false;
        document.body.innerHTML = `
            <div class="current_image"><audio id="current_image_img"></audio></div>
            <div id="current_image_batch" class="current_image_batch">
                <div class="image-block" data-src="${first}" data-batch_id="one">
                    <img class="image-block-img-inner" src="imgs/audio_placeholder.jpg">
                </div>
                <div class="image-block image-block-placeholder" data-src="pending.webp">
                    <img class="image-block-img-inner" src="imgs/model_placeholder.jpg">
                </div>
                <div class="image-block" data-src="${second}" data-batch_id="two" data-metadata="audio metadata">
                    <img class="image-block-img-inner" src="imgs/audio_placeholder.jpg">
                </div>
                <div class="image-block" data-src="${picture}" data-batch_id="three" data-metadata="image metadata">
                    <img class="image-block-img-inner" src="${picture}" data-preview-grow="true">
                </div>
            </div>`;
        current = document.getElementById("current_image_img") as HTMLElement;
        // Current media exposes an absolute, escaped URL; tile data-src is relative.
        current.setAttribute("src", new URL(first, document.baseURI).href);
        current.dataset.batch_id = "one";
        Object.assign(globalThis, {
            currentImageHelper: { getCurrentImage: () => current },
            imageFullView: {
                isOpen: () => expanded,
                copyState: () => state,
                showImage,
                pasteState,
            },
            getUserSetting: () => cycle,
            setCurrentImage: setCurrent,
        });
        window.addEventListener("keydown", onKey);
        initKeyboardNavigation();
    });

    afterEach(() => {
        window.removeEventListener("keydown", onKey);
    });

    it("moves between distinct audio files sharing a thumbnail and skips pending tiles", () => {
        press("d");
        expect(setCurrent).toHaveBeenLastCalledWith(
            second,
            "audio metadata",
            "two",
            false,
        );
        current.setAttribute("src", new URL(second, document.baseURI).href);
        press("a");
        expect(setCurrent).toHaveBeenLastCalledWith(
            first,
            undefined,
            "one",
            false,
        );
        expect(arrows).not.toHaveBeenCalled();
    });

    it("moves from audio to an image, forwarding its metadata and preview size", () => {
        current.setAttribute("src", second);
        press("D");
        expect(setCurrent).toHaveBeenCalledWith(
            picture,
            "image metadata",
            "three",
            true,
        );
    });

    it.each([
        "true",
        "only_arrows",
    ])("wraps backwards when cycling is %s", (setting) => {
        cycle = setting;
        press("A");
        expect(setCurrent).toHaveBeenCalledWith(
            picture,
            "image metadata",
            "three",
            true,
        );
    });

    it("stays at the edge when cycling is disabled", () => {
        cycle = "false";
        press("a");
        expect(setCurrent).not.toHaveBeenCalled();
        expect(arrows).not.toHaveBeenCalled();
    });

    it("does not reopen the only batch item", () => {
        document
            .querySelectorAll("#current_image_batch .image-block")
            .forEach((block, index) => {
                if (index > 0) block.remove();
            });
        press("d");
        expect(setCurrent).not.toHaveBeenCalled();
        expect(arrows).not.toHaveBeenCalled();
    });

    it("keeps fullscreen open with its previous view state", () => {
        expanded = true;
        press("d");
        expect(showImage).toHaveBeenCalledWith(second, "audio metadata", "two");
        expect(pasteState).toHaveBeenCalledWith(state);
    });

    it("leaves history navigation to core", () => {
        current.dataset.batch_id = "history";
        press("d");
        expect(arrows).toHaveBeenCalledWith("ArrowRight");
        expect(setCurrent).not.toHaveBeenCalled();
    });

    it("leaves image navigation to core", () => {
        current = document.createElement("img");
        press("a");
        expect(arrows).toHaveBeenCalledWith("ArrowLeft");
        expect(setCurrent).not.toHaveBeenCalled();
    });

    it("does not navigate while typing", () => {
        const input = document.createElement("input");
        document.body.append(input);
        input.focus();
        press("d", input);
        expect(setCurrent).not.toHaveBeenCalled();
        expect(arrows).not.toHaveBeenCalled();
    });

    it("preserves core focus restrictions outside the preview", () => {
        const button = document.createElement("button");
        document.body.append(button);
        button.focus();
        press("d", button);
        expect(setCurrent).not.toHaveBeenCalled();
        expect(arrows).toHaveBeenCalledWith("ArrowRight");
    });
});
