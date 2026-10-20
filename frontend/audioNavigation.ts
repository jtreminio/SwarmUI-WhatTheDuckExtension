/**
 * Core batch navigation compares thumbnail URLs with the current media URL.
 * Audio tiles use a shared placeholder, so resolve them by the tile's data-src.
 * Return true when this shortcut belongs to an audio batch, including its edges.
 */
export const navigateBatchAudio = (next: boolean): boolean => {
    if (typeof currentImageHelper === "undefined") {
        return false;
    }
    const current = currentImageHelper.getCurrentImage();
    if (
        current?.tagName !== "AUDIO" ||
        current.dataset.batch_id === "history"
    ) {
        return false;
    }
    const expanded = imageFullView.isOpen();
    const active = document.activeElement;
    if (
        !expanded &&
        active?.tagName !== "BODY" &&
        !active?.closest(".current_image, .current_image_batch")
    ) {
        return false;
    }

    const thumbnails = [
        ...document.querySelectorAll<HTMLElement>(
            "#current_image_batch .image-block-img-inner",
        ),
    ].filter((element) => !element.closest(".image-block-placeholder"));
    const source = current.getAttribute("src");
    if (!source) {
        return false;
    }
    const absoluteSource = new URL(source, document.baseURI).href;
    const index = thumbnails.findIndex((thumbnail) => {
        const src = thumbnail.closest<HTMLElement>(".image-block")?.dataset.src;
        return src && new URL(src, document.baseURI).href === absoluteSource;
    });
    if (index < 0) {
        return false;
    }
    const cycleSetting = getUserSetting("ui.imageshiftingcycles", "true");
    const cycle = cycleSetting === "true" || cycleSetting === "only_arrows";
    let targetIndex = index + (next ? 1 : -1);
    if (targetIndex < 0 || targetIndex >= thumbnails.length) {
        if (!cycle) {
            return true;
        }
        targetIndex = (targetIndex + thumbnails.length) % thumbnails.length;
    }
    if (targetIndex === index) {
        return true;
    }
    const thumbnail = thumbnails[targetIndex];
    const block = thumbnail.closest<HTMLElement>(".image-block");
    if (!block?.dataset.src) {
        return false;
    }
    const state = expanded ? imageFullView.copyState() : null;
    const { src, metadata, batch_id: batchId } = block.dataset;
    setCurrentImage(
        src,
        metadata,
        batchId,
        thumbnail.dataset.previewGrow === "true",
    );
    if (expanded) {
        imageFullView.showImage(src, metadata, batchId);
        imageFullView.pasteState(state);
    }
    return true;
};
