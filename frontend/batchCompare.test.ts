import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { isComparable } from "./batchCompare";

// isComparable() consults SwarmUI's global getMediaType(). Stub it by file
// extension so the media-type branch is exercised with realistic values.
const stubMediaType = (src: string): string => {
    if (src.endsWith(".mp4")) {
        return "video";
    }
    if (src.endsWith(".png") || src.endsWith(".jpg")) {
        return "image";
    }
    if (src.endsWith(".mp3")) {
        return "audio";
    }
    return "";
};

/** Build an `.image-block` tile; attach it to the body unless `detached`. */
const makeBlock = (
    options: { src?: string; classes?: string[]; detached?: boolean } = {},
): HTMLElement => {
    const block = document.createElement("div");
    block.className = ["image-block", ...(options.classes ?? [])].join(" ");
    if (options.src !== undefined) {
        block.dataset.src = options.src;
    }
    if (!options.detached) {
        document.body.appendChild(block);
    }
    return block;
};

describe("batchCompare isComparable", () => {
    beforeEach(() => {
        globalThis.getMediaType = stubMediaType;
    });

    afterEach(() => {
        delete (globalThis as { getMediaType?: unknown }).getMediaType;
    });

    it("returns false for null", () => {
        expect(isComparable(null)).toBe(false);
    });

    it("returns false for a block detached from the document", () => {
        const block = makeBlock({ src: "a.png", detached: true });
        expect(isComparable(block)).toBe(false);
    });

    it("returns false when the block has no data-src", () => {
        expect(isComparable(makeBlock({}))).toBe(false);
    });

    it("returns false for a placeholder tile", () => {
        const block = makeBlock({
            src: "a.png",
            classes: ["image-block-placeholder"],
        });
        expect(isComparable(block)).toBe(false);
    });

    it("returns false for a failed tile", () => {
        const block = makeBlock({
            src: "a.png",
            classes: ["image-block-failed"],
        });
        expect(isComparable(block)).toBe(false);
    });

    it("returns true for a finished image tile", () => {
        expect(isComparable(makeBlock({ src: "result.png" }))).toBe(true);
    });

    it("returns true for a finished video tile", () => {
        expect(isComparable(makeBlock({ src: "result.mp4" }))).toBe(true);
    });

    it("returns false for an unsupported media type", () => {
        expect(isComparable(makeBlock({ src: "result.mp3" }))).toBe(false);
    });
});
