import { createLayoutMount } from "../layout-mount.js";

const app = document.getElementById("classic-shell");

export const themeDefinition = {
    id: "studio",
    name: "Studio",
    layout: "studio",
    description: "Отдельная навигация, главная панель и быстрый обзор плагинов.",
    colors: {
        "--bg-primary": "#101218",
        "--bg-secondary": "#171a23",
        "--bg-surface": "#202531",
        "--bg-surface-hover": "#2a3241",
        "--bg-accent": "#30384a",
        "--text-primary": "#eef0f6",
        "--text-secondary": "#a0a8ba",
        "--text-muted": "#6f788c",
        "--accent": "#8f9cff",
        "--accent-hover": "#a8b2ff",
        "--accent-glow": "#8f9cff26",
        "--success": "#55d6a1",
        "--warning": "#f0bf67",
        "--error": "#f17883",
        "--info": "#70baff",
        "--border": "#2d3442",
        "--border-accent": "#505c73"
    }
};

export const studioLayout = createLayoutMount({
    root: document.getElementById("studio-shell"),
    app,
    moves: [
        [app.querySelector('[data-tab-content="console"]'), document.getElementById("studio-stage")],
        [app.querySelector('[data-tab-content="task-manager"]'), document.getElementById("studio-stage")],
        [document.getElementById("ui-plugin-tabs"), document.getElementById("studio-stage")],
        [document.getElementById("toast-container"), document.body],
        [document.getElementById("theme-settings"), document.body]
    ]
});

export function bindStudioActions({ switchTab, openPluginHub, openThemeSettings, refreshPlugins, getPlugins, startPlugin, stopPlugin }) {
    const nav = document.getElementById("studio-nav");
    const home = document.getElementById("studio-home");

    nav.addEventListener("click", event => {
        const pluginButton = event.target.closest("[data-studio-plugin]");
        if (pluginButton) {
            switchTab(pluginButton.dataset.studioPlugin);
            return;
        }

        const button = event.target.closest("[data-studio-tab]");
        if (!button) return;

        const tab = button.dataset.studioTab;
        if (tab === "catalog") openPluginHub();
        else if (tab === "appearance") openThemeSettings();
        else switchTab(tab);
    });

    home.addEventListener("click", event => {
        if (event.target.closest("[data-studio-tab='console']")) switchTab("console");
        if (event.target.closest("[data-studio-empty-catalog]")) openPluginHub();
    });

    document.getElementById("studio-open-plugins").addEventListener("click", () => switchTab("console"));
    document.getElementById("studio-open-catalog").addEventListener("click", openPluginHub);
    document.getElementById("studio-refresh").addEventListener("click", refreshPlugins);
    document.getElementById("studio-open-themes").addEventListener("click", openThemeSettings);
    document.getElementById("studio-plugin-grid").addEventListener("click", event => {
        const button = event.target.closest("[data-studio-action]");
        if (!button) return;

        const plugin = getPlugins().find(item => item.name === button.dataset.studioName);
        if (!plugin) return;
        if (button.dataset.studioAction === "start") startPlugin(plugin.name);
        if (button.dataset.studioAction === "stop") stopPlugin(plugin.name);
    });
}

export function updateStudioNavigation(currentTab, themeSettingsEl, plugins) {
    const nav = document.getElementById("studio-nav");
    const activeTab = currentTab === "task-manager" || currentTab === "studio-home" || currentTab === "console"
        ? currentTab
        : plugins.some(plugin => plugin.name === currentTab)
            ? "console"
            : "";
    const overlayTab = themeSettingsEl.hidden
        ? document.querySelector(".plugin-hub-backdrop") ? "catalog" : ""
        : "appearance";
    const selectedTab = overlayTab || activeTab;
    const pluginNav = document.getElementById("studio-plugin-nav");
    const appPlugins = plugins.filter(plugin =>
        plugin.type === "app" && ["ready", "spawned", "busy"].includes(plugin.state)
    );
    pluginNav.replaceChildren(...appPlugins.map(plugin => {
        const button = document.createElement("button");
        button.className = "studio-nav__plugin";
        button.type = "button";
        button.dataset.studioPlugin = plugin.name;
        button.classList.toggle("studio-nav__plugin--active", currentTab === plugin.name);
        button.setAttribute("aria-current", currentTab === plugin.name ? "page" : "false");
        button.textContent = plugin.display_name || plugin.name;
        return button;
    }));

    nav.querySelectorAll("[data-studio-tab]").forEach(button => {
        const isActive = button.dataset.studioTab === selectedTab;
        button.classList.toggle("studio-nav__item--active", isActive);
        button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    const title = selectedTab === "studio-home" ? "Обзор"
        : selectedTab === "task-manager" ? "Задачи"
            : selectedTab === "catalog" ? "Каталог"
                : selectedTab === "appearance" ? "Внешний вид"
                    : plugins.find(plugin => plugin.name === currentTab)?.display_name || "Плагины";
    document.getElementById("studio-page-title").textContent = title;
}

export function renderStudioHome({ plugins, logOutputEl, isPluginRunning, formatPluginName, getPluginIcon, escapeHtml, escapeAttr, themeSettingsEl, currentTab }) {
    const home = document.getElementById("studio-home");
    const runningPlugins = plugins.filter(isPluginRunning);
    home.querySelector("[data-studio-total]").textContent = String(plugins.length);
    home.querySelector("[data-studio-running]").textContent = String(runningPlugins.length);
    home.querySelector("[data-studio-stopped]").textContent = String(plugins.length - runningPlugins.length);
    document.querySelector("[data-studio-nav-status]").textContent = runningPlugins.length
        ? `${runningPlugins.length} активно`
        : "Нет активных процессов";

    const grid = document.getElementById("studio-plugin-grid");
    if (plugins.length === 0) {
        grid.innerHTML = `
            <div class="studio-empty">
                <span aria-hidden="true">◈</span>
                <strong>Плагины появятся здесь</strong>
                <span>Импортируй плагин в каталоге или обнови список.</span>
                <button class="btn btn--ghost btn--small" type="button" data-studio-empty-catalog>Открыть каталог</button>
            </div>`;
    } else {
        grid.innerHTML = plugins.slice(0, 4).map(plugin => {
            const running = isPluginRunning(plugin);
            const name = plugin.display_name || formatPluginName(plugin.name);
            return `
                <article class="studio-plugin">
                    <span class="studio-plugin__icon">${getPluginIcon(plugin)}</span>
                    <span class="studio-plugin__info">
                        <strong title="${escapeAttr(name)}">${escapeHtml(name)}</strong>
                        <small>${escapeHtml(plugin.type || "worker")} · ${escapeHtml(plugin.state)}</small>
                    </span>
                    <button class="studio-plugin__action ${running ? "studio-plugin__action--running" : ""}"
                        type="button"
                        data-studio-action="${running ? "stop" : "start"}"
                        data-studio-name="${escapeAttr(plugin.name)}"
                        title="${running ? "Остановить" : "Запустить"}"
                        aria-label="${running ? "Остановить" : "Запустить"} ${escapeAttr(name)}">${running ? "■" : "▶"}</button>
                </article>`;
        }).join("");
    }

    const activity = document.getElementById("studio-activity");
    const entries = Array.from(logOutputEl.children).slice(-5).reverse();
    activity.innerHTML = entries.length
        ? entries.map(entry => {
            const time = entry.querySelector(".log-entry__time")?.textContent || "";
            const message = entry.textContent.replace(time, "").trim();
            const level = Array.from(entry.classList).find(name => name.startsWith("log-entry--") && name !== "log-entry--system");
            return `
                <article class="studio-activity__item">
                    <span class="studio-activity__marker ${escapeAttr(level || "")}"></span>
                    <span class="studio-activity__message" title="${escapeAttr(message)}">${escapeHtml(message)}</span>
                    <time>${escapeHtml(time)}</time>
                </article>`;
        }).join("")
        : '<div class="studio-activity__empty">Событий пока нет.</div>';

    updateStudioNavigation(currentTab, themeSettingsEl, plugins);
}
