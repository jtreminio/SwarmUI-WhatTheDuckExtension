/** SwarmUI's Auto image layout uses 30 * 16 pixels of remaining width. */
export const DEFAULT_METADATA_COLUMN_MIN_WIDTH = 480;
export const MIN_METADATA_COLUMN_WIDTH = 160;
export const MAX_METADATA_COLUMN_WIDTH = 960;

let minimumWidth = DEFAULT_METADATA_COLUMN_MIN_WIDTH;
let installed = false;

export const validMetadataColumnWidth = (value: number): boolean =>
    Number.isInteger(value) &&
    value >= MIN_METADATA_COLUMN_WIDTH &&
    value <= MAX_METADATA_COLUMN_WIDTH;

/** Apply the configured Auto threshold after SwarmUI has laid out the image. */
export const applyMetadataColumnWidth = (width = minimumWidth): void => {
    const extras = document.querySelector<HTMLElement>(
        "#current_image .current-image-extras-wrapper",
    );
    if (
        width === DEFAULT_METADATA_COLUMN_MIN_WIDTH ||
        getUserSetting("ImageMetadataFormat", "auto") !== "auto"
    ) {
        if (extras) {
            extras.style.minWidth = "";
        }
        return;
    }

    const imageArea = document.getElementById("current_image");
    const image = currentImageHelper.getCurrentImage() as HTMLElement | null;
    const imageContainer = currentImageHelper.getCurrentImageContainer();
    if (!imageArea || !image || !imageContainer || !extras) {
        return;
    }

    const dimensions =
        image instanceof HTMLVideoElement
            ? [image.videoWidth, image.videoHeight]
            : image instanceof HTMLImageElement
              ? [image.naturalWidth, image.naturalHeight]
              : [];
    const [naturalWidth, naturalHeight] = dimensions;
    if (!naturalWidth || !naturalHeight) {
        return;
    }

    const scale = image.dataset.previewGrow === "true" ? 8 : 1;
    const imageWidth = naturalWidth * scale;
    const imageHeight = naturalHeight * scale;
    const renderedHeight = Math.min(imageHeight, imageArea.offsetHeight);
    const renderedWidth = Math.min(
        imageWidth,
        renderedHeight * (imageWidth / imageHeight),
    );
    const remainingWidth = imageArea.clientWidth - renderedWidth - 30;

    if (remainingWidth >= width) {
        imageArea.classList.remove("current_image_small");
        imageArea.classList.add("current_image_sideblock");
        extras.classList.add("extras-wrapper-sideblock");
        extras.style.display = "inline-block";
        extras.style.width = `${remainingWidth}px`;
        extras.style.maxWidth = `${remainingWidth}px`;
        extras.style.minWidth = "0px";
        imageContainer.style.maxHeight = "calc(max(15rem, 100%))";
    } else {
        imageArea.classList.add("current_image_small");
        imageArea.classList.remove("current_image_sideblock");
        extras.classList.remove("extras-wrapper-sideblock");
        extras.style.display = "block";
        extras.style.width = "100%";
        extras.style.maxWidth = "100%";
        extras.style.minWidth = "";
        imageContainer.style.maxHeight = "calc(max(15rem, 100% - 5.1rem))";
    }
};

export const setMetadataColumnMinWidth = (width: number): void => {
    if (!validMetadataColumnWidth(width)) {
        return;
    }
    minimumWidth = width;
    if (installed) {
        alignImageDataFormat();
    }
};

/** Core calls this function on image load and after every panel resize. */
export const initMetadataColumnWidth = (): void => {
    if (installed || typeof alignImageDataFormat !== "function") {
        return;
    }
    const original = alignImageDataFormat;
    globalThis.alignImageDataFormat = () => {
        original();
        applyMetadataColumnWidth();
    };
    installed = true;
};
