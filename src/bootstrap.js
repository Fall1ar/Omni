const layoutNames = ["classic", "workbench", "studio"];
const layoutRoot = document.getElementById("theme-layouts");
const overlayRoot = document.getElementById("theme-overlays");

async function loadMarkup(path, root) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
    }

    const template = document.createElement("template");
    template.innerHTML = await response.text();
    root.append(template.content);
}

try {
    await Promise.all([
        ...layoutNames.map(name => loadMarkup(`themes/${name}/layout.html`, layoutRoot)),
        loadMarkup("themes/shared/overlays.html", overlayRoot)
    ]);
    await import("./main.js");
} catch (error) {
    document.body.textContent = `Не удалось загрузить интерфейс Omni: ${error.message || error}`;
    throw error;
}
