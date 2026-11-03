export function createLayoutMount({ root, app, moves }) {
    const placeholders = new Map();

    return {
        mount() {
            for (const [element, destination] of moves) {
                if (!element || !destination || placeholders.has(element)) continue;
                const placeholder = document.createComment(`restore ${element.id || element.className}`);
                element.parentNode.insertBefore(placeholder, element);
                placeholders.set(element, placeholder);
                destination.appendChild(element);
            }

            root.hidden = false;
            if (root !== app) app.hidden = true;
        },
        unmount() {
            root.hidden = true;
            for (const [element, placeholder] of placeholders) {
                if (placeholder.parentNode) placeholder.replaceWith(element);
            }
            placeholders.clear();
            if (root !== app) app.hidden = false;
        }
    };
}
