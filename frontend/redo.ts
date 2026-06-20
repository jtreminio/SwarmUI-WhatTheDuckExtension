const BUTTON_NAME = "Redo";
const BUTTON_TITLE =
    "Generate a new image with a fresh random seed, reusing every other setting " +
    "from this image (including the already-finalized prompt — wildcards and " +
    "MagicPrompt are not re-rolled).";

let registered = false;

const NON_PARAM_KEYS = new Set<string>(["swarm_version"]);

interface SwarmMetadata {
    sui_image_params?: Record<string, unknown>;
    sui_extra_data?: Record<string, unknown>;
}

export const parseSwarmMetadata = (
    raw: string | null | undefined,
): SwarmMetadata | null => {
    if (!raw) {
        return null;
    }
    let jsonStr: string | null = null;
    try {
        jsonStr = interpretMetadata(raw);
    } catch {
        jsonStr = null;
    }
    if (!jsonStr) {
        jsonStr = raw;
    }
    try {
        const obj = JSON.parse(jsonStr) as SwarmMetadata;
        if (obj && typeof obj === "object" && obj.sui_image_params) {
            return obj;
        }
        return null;
    } catch {
        return null;
    }
};

export const buildRedoInput = (
    meta: SwarmMetadata,
): Record<string, unknown> => {
    const params = meta.sui_image_params ?? {};
    const input: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
        if (NON_PARAM_KEYS.has(key)) {
            continue;
        }
        input[key] = value;
    }
    input.seed = -1;
    input.images = 1;
    input.batchsize = 1;

    const extra = meta.sui_extra_data ?? {};
    const extraMetadata: Record<string, unknown> = {};
    if (typeof extra.original_prompt === "string") {
        extraMetadata.original_prompt = extra.original_prompt;
    }
    if (typeof extra.original_negativeprompt === "string") {
        extraMetadata.original_negativeprompt = extra.original_negativeprompt;
    }
    if (Object.keys(extraMetadata).length > 0) {
        input.extra_metadata = extraMetadata;
    }
    return input;
};

export const onRedoClick = (): void => {
    const el = currentImageHelper.getCurrentImage();
    const raw = el?.dataset?.metadata || currentMetadataVal;
    const meta = parseSwarmMetadata(raw);
    if (!meta) {
        showError("No image parameters available to redo.");
        return;
    }
    const redoInput = buildRedoInput(meta);
    mainGenHandler.doGenerate(
        {},
        {},
        (actualInput: Record<string, unknown>) => {
            for (const key of Object.keys(actualInput)) {
                delete actualInput[key];
            }
            Object.assign(actualInput, redoInput);
        },
    );
};

const init = (): void => {
    if (registered) {
        return;
    }
    if (typeof registerMediaButton !== "function") {
        return;
    }
    registered = true;
    registerMediaButton(
        BUTTON_NAME,
        onRedoClick,
        BUTTON_TITLE,
        ["image", "video"],
        false,
        true,
    );
};

export const redo = {
    init,
    run: onRedoClick,
};
