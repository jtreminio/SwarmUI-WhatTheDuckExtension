/** HTML-escape arbitrary text by round-tripping it through a detached element. */
export const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
};

/** Escape text for interpolation into a double-quoted HTML attribute. */
export const escapeAttr = (text: string): string =>
    escapeHtml(text).replaceAll('"', "&quot;");
