import { createLayoutMount } from "../layout-mount.js";

const app = document.getElementById("classic-shell");

export const themeDefinition = {
    id: "classic",
    name: "Классическая",
    layout: "classic",
    description: "Исходная компоновка Omni без изменений.",
    colors: {
        "--bg-primary": "#0d0f13",
        "--bg-secondary": "#14171e",
        "--bg-surface": "#1a1e28",
        "--bg-surface-hover": "#222738",
        "--bg-accent": "#2d3348",
        "--text-primary": "#e4e6ef",
        "--text-secondary": "#8b90a5",
        "--text-muted": "#565b73",
        "--accent": "#6c7eff",
        "--accent-hover": "#8b99ff",
        "--accent-glow": "#6c7eff26",
        "--success": "#3dd68c",
        "--warning": "#ffc246",
        "--error": "#ff5e6c",
        "--info": "#5eb5ff",
        "--border": "#252a3a",
        "--border-accent": "#3d4460"
    }
};

export const classicLayout = createLayoutMount({
    root: app,
    app,
    moves: []
});
