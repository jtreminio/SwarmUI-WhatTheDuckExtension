export const isEditableElement = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element) {
        return false;
    }
    const tag = element.tagName;
    return (
        element.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
    );
};

export const suppressEvent = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }
};
