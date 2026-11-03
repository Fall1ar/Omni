import { createLayoutMount } from "../layout-mount.js";

const app = document.getElementById("classic-shell");

export const themeDefinition = {
    id: "workbench",
    name: "Workbench",
    layout: "workbench",
    description: "Компактная боковая панель и отдельная рабочая область с вкладками.",
    colors: {
        "--bg-primary": "#0b1110",
        "--bg-secondary": "#111b18",
        "--bg-surface": "#192621",
        "--bg-surface-hover": "#24352d",
        "--bg-accent": "#294237",
        "--text-primary": "#e6f2e9",
        "--text-secondary": "#a3b8a8",
        "--text-muted": "#6f8777",
        "--accent": "#b2ed78",
        "--accent-hover": "#c7ff91",
        "--accent-glow": "#b2ed7826",
        "--success": "#79dfa0",
        "--warning": "#f4c66e",
        "--error": "#ff8585",
        "--info": "#7bcaff",
        "--border": "#2a3c32",
        "--border-accent": "#48644f"
    }
};

export const workbenchLayout = createLayoutMount({
    root: document.getElementById("workbench-shell"),
    app,
    moves: [
        [app.querySelector(".header"), document.getElementById("workbench-header")],
        [document.getElementById("tabs-nav"), document.getElementById("workbench-tabs")],
        [app.querySelector('[data-tab-content="console"]'), document.getElementById("workbench-stage")],
        [app.querySelector('[data-tab-content="task-manager"]'), document.getElementById("workbench-stage")],
        [document.getElementById("ui-plugin-tabs"), document.getElementById("workbench-stage")],
        [document.getElementById("toast-container"), document.body],
        [document.getElementById("theme-settings"), document.body]
    ]
});

export function bindWorkbenchActions({ switchTab, openPluginHub, openThemeSettings }) {
    const rail = document.querySelector(".workbench-rail");
    rail.addEventListener("click", event => {
        const button = event.target.closest("[data-workbench-tab]");
        if (!button) return;

        const tab = button.dataset.workbenchTab;
        if (tab === "catalog") openPluginHub();
        else if (tab === "appearance") openThemeSettings();
        else switchTab(tab);
    });
}

export function updateWorkbenchNavigation(currentTab, themeSettingsEl) {
    const activeTab = currentTab === "task-manager"
        ? "task-manager"
        : currentTab === "console" || document.querySelector(`[data-tab-content="${CSS.escape(currentTab)}"]`)
            ? "console"
            : "";
    const selectedTab = !themeSettingsEl.hidden
        ? "appearance"
        : document.querySelector(".plugin-hub-backdrop")
            ? "catalog"
            : activeTab;

    document.querySelectorAll(".workbench-rail [data-workbench-tab]").forEach(button => {
        const isActive = button.dataset.workbenchTab === selectedTab;
        button.classList.toggle("workbench-rail__item--active", isActive);
        button.setAttribute("aria-current", isActive ? "page" : "false");
    });
}
