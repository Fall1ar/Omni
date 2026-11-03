// main.js — UI logic for Omni Plugin Manager

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── DOM ───────────────────────────────────────────────────────────────────────

const pluginListEl = document.getElementById("plugin-list");
const logOutputEl = document.getElementById("log-output");
const btnRefresh = document.getElementById("btn-refresh");
const btnClearLog = document.getElementById("btn-clear-log");
const btnTaskManager = document.getElementById("btn-task-manager");
const btnPluginHub = document.getElementById("btn-plugin-hub");
const btnThemeSettings = document.getElementById("btn-theme-settings");
const themeSettingsEl = document.getElementById("theme-settings");

// Tabs
const tabsNavEl = document.querySelector(".tabs-nav");
const uiPluginTabsEl = document.getElementById("ui-plugin-tabs");
const studioNavEl = document.getElementById("studio-nav");
const studioHomeEl = document.getElementById("studio-home");

// Send panel
const sendPanelEl = document.getElementById("send-panel");
const sendPanelTitleEl = document.getElementById("send-panel-title");
const schemaFormEl = document.getElementById("schema-form");
const schemaFieldsEl = document.getElementById("schema-fields");
const btnSchemaSubmit = document.getElementById("btn-schema-submit");

// ── State ─────────────────────────────────────────────────────────────────────

let plugins = [];
let currentWorkerPlugin = null; // Currently selected worker plugin with ui_schema
let currentTab = "console";
let uiPluginInstances = {};
let pluginStartTimes = {}; // Track when plugins were started
let taskManagerQuery = "";
let taskManagerSort = "state";
let activeThemeId = "classic";
let activeTheme = null;
let customThemes = [];
let customThemeSequence = 0;
let previousThemeFocus = null;
const scriptRunnerRequests = new Map();
const scriptRunnerEarlyResults = new Map();

const THEME_STORAGE_KEY = "omni.theme-settings.v1";
const THEME_COLOR_KEYS = [
    "--bg-primary",
    "--bg-secondary",
    "--bg-surface",
    "--bg-surface-hover",
    "--bg-accent",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--accent",
    "--accent-hover",
    "--accent-glow",
    "--success",
    "--warning",
    "--error",
    "--info",
    "--border",
    "--border-accent"
];

const BUILT_IN_THEMES = [
    {
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
    },
    {
        id: "workbench",
        name: "Workbench",
        layout: "workbench",
        description: "Рабочая консоль с панелями, вкладками и новым оформлением.",
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
    },
    {
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
    }
];

function normalizeThemeDefinition(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("Тема должна быть JSON-объектом.");
    }

    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new Error("Название темы должно содержать от 1 до 40 символов.");
    }
    const layout = candidate.layout || candidate.appearance;
    if (!BUILT_IN_THEMES.some(theme => theme.layout === layout)) {
        throw new Error('Поле "layout" должно быть "classic", "workbench" или "studio".');
    }

    const colors = candidate.colors || {};
    if (typeof colors !== "object" || Array.isArray(colors)) {
        throw new Error('Поле "colors" должно быть объектом.');
    }

    const unknownColor = Object.keys(colors).find(key => !THEME_COLOR_KEYS.includes(key));
    if (unknownColor) {
        throw new Error(`Неизвестный параметр цвета: ${unknownColor}`);
    }

    const baseTheme = BUILT_IN_THEMES.find(theme => theme.layout === layout);
    const normalizedColors = { ...baseTheme.colors };
    for (const key of THEME_COLOR_KEYS) {
        const value = colors[key] ?? normalizedColors[key];
        if (typeof value !== "string" || !/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(value)) {
            throw new Error(`Цвет "${key}" должен быть HEX-кодом #RRGGBB или #RRGGBBAA.`);
        }
        normalizedColors[key] = value;
    }

    return {
        name,
        layout,
        colors: normalizedColors
    };
}

function findThemeById(id) {
    return BUILT_IN_THEMES.find(theme => theme.id === id)
        || customThemes.find(theme => theme.id === id)
        || BUILT_IN_THEMES[0];
}

function persistThemeSettings() {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
            activeThemeId,
            customThemes: customThemes.map(({ id, name, layout, colors }) => ({
                id,
                name,
                layout,
                colors
            }))
        }));
    } catch (error) {
        Omni.toast.error(`Не удалось сохранить тему: ${error.message || error}`);
    }
}

function applyTheme(theme, { persist = true, notify = false } = {}) {
    activeTheme = theme;
    activeThemeId = theme.id;
    document.body.dataset.theme = theme.layout;

    for (const key of THEME_COLOR_KEYS) {
        if (theme.id === "classic") {
            document.documentElement.style.removeProperty(key);
        } else {
            document.documentElement.style.setProperty(key, theme.colors[key]);
        }
    }

    if (theme.layout === "studio" && currentTab !== "studio-home") {
        switchTab("studio-home");
    } else if (theme.layout !== "studio" && currentTab === "studio-home") {
        switchTab("console");
    }

    if (persist) persistThemeSettings();
    renderThemeChoices();
    renderStudioHome();

    if (notify) Omni.toast.success(`Тема «${theme.name}» применена`);
}

function loadThemeSettings() {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (!saved) {
            applyTheme(BUILT_IN_THEMES[2], { persist: false });
            return;
        }

        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.customThemes)) {
            throw new Error("Формат сохранённых настроек темы повреждён.");
        }

        customThemes = parsed.customThemes.slice(0, 20).map((theme, index) => {
            const normalized = normalizeThemeDefinition(theme);
            return {
                id: typeof theme.id === "string" ? theme.id : `custom-restored-${index}`,
                ...normalized
            };
        });

        const selected = findThemeById(parsed.activeThemeId);
        applyTheme(selected, { persist: false });
    } catch (error) {
        customThemes = [];
        applyTheme(BUILT_IN_THEMES[0], { persist: false });
        Omni.toast.warning(`Не удалось загрузить сохранённую тему: ${error.message || error}`);
    }
}

function createThemeChoice(theme) {
    const card = document.createElement("article");
    const isSelected = theme.id === activeThemeId;
    card.className = `theme-choice${isSelected ? " theme-choice--selected" : ""}`;

    const selectButton = document.createElement("button");
    selectButton.className = "theme-choice__select";
    selectButton.type = "button";
    selectButton.setAttribute("aria-pressed", String(isSelected));
    selectButton.setAttribute("aria-label", `Выбрать тему ${theme.name}`);

    const preview = document.createElement("span");
    preview.className = `theme-choice__preview theme-choice__preview--${theme.layout}`;
    preview.setAttribute("aria-hidden", "true");
    for (const className of ["theme-choice__preview-sidebar", "theme-choice__preview-main", "theme-choice__preview-accent"]) {
        const shape = document.createElement("span");
        shape.className = className;
        if (className.endsWith("sidebar")) shape.style.backgroundColor = theme.colors["--bg-secondary"];
        if (className.endsWith("main")) shape.style.backgroundColor = theme.colors["--bg-surface"];
        if (className.endsWith("accent")) shape.style.backgroundColor = theme.colors["--accent"];
        preview.appendChild(shape);
    }
    preview.style.backgroundColor = theme.colors["--bg-primary"];
    preview.style.borderColor = theme.colors["--border"];

    const copy = document.createElement("span");
    copy.className = "theme-choice__copy";
    const title = document.createElement("strong");
    title.textContent = theme.name;
    const description = document.createElement("span");
    description.textContent = theme.description || `Компоновка: ${theme.layout}.`;
    copy.append(title, description);
    selectButton.append(preview, copy);
    selectButton.addEventListener("click", () => applyTheme(theme, { notify: true }));
    card.appendChild(selectButton);

    if (theme.id.startsWith("custom-")) {
        const removeButton = document.createElement("button");
        removeButton.className = "btn btn--ghost btn--small theme-choice__remove";
        removeButton.type = "button";
        removeButton.textContent = "Удалить";
        removeButton.setAttribute("aria-label", `Удалить тему ${theme.name}`);
        removeButton.addEventListener("click", () => {
            customThemes = customThemes.filter(item => item.id !== theme.id);
            if (activeThemeId === theme.id) {
                applyTheme(BUILT_IN_THEMES[0]);
            } else {
                persistThemeSettings();
                renderThemeChoices();
            }
            Omni.toast.info(`Тема «${theme.name}» удалена`);
        });
        card.appendChild(removeButton);
    }

    return card;
}

function renderThemeChoices() {
    const list = themeSettingsEl.querySelector("[data-theme-list]");
    if (!list) return;

    list.replaceChildren(...BUILT_IN_THEMES.map(createThemeChoice), ...customThemes.map(createThemeChoice));
}

function updateStudioNavigation() {
    if (!studioNavEl) return;

    const activeTab = currentTab === "task-manager"
        ? "task-manager"
        : currentTab === "studio-home"
            ? "studio-home"
            : currentTab === "console" || document.querySelector(`[data-tab-content="${CSS.escape(currentTab)}"]`)
                ? "console"
                : "";

    const overlayTab = themeSettingsEl.hidden
        ? document.querySelector(".plugin-hub-backdrop") ? "catalog" : ""
        : "appearance";
    const selectedTab = overlayTab || activeTab;

    studioNavEl.querySelectorAll("[data-studio-tab]").forEach(button => {
        const isActive = button.dataset.studioTab === selectedTab;
        button.classList.toggle("studio-nav__item--active", isActive);
        button.setAttribute("aria-current", isActive ? "page" : "false");
    });
}

function renderStudioHome() {
    if (!studioHomeEl) return;

    const runningPlugins = plugins.filter(isPluginRunning);
    studioHomeEl.querySelector("[data-studio-total]").textContent = String(plugins.length);
    studioHomeEl.querySelector("[data-studio-running]").textContent = String(runningPlugins.length);
    studioHomeEl.querySelector("[data-studio-stopped]").textContent = String(plugins.length - runningPlugins.length);
    studioNavEl.querySelector("[data-studio-nav-status]").textContent = runningPlugins.length
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

    updateStudioNavigation();
}

function openThemeSettings() {
    previousThemeFocus = document.activeElement;
    renderThemeChoices();
    themeSettingsEl.hidden = false;
    updateStudioNavigation();
    themeSettingsEl.querySelector("[data-theme-close]").focus();
}

function closeThemeSettings() {
    themeSettingsEl.hidden = true;
    updateStudioNavigation();
    if (previousThemeFocus instanceof HTMLElement) previousThemeFocus.focus();
}

function exportTheme() {
    const theme = activeTheme || BUILT_IN_THEMES[0];
    const contents = JSON.stringify({
        format: "omni-theme",
        version: 2,
        theme: {
            name: theme.name,
            layout: theme.layout,
            colors: theme.colors
        }
    }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    const filename = theme.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "omni-theme";
    link.href = url;
    link.download = `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    Omni.toast.success(`Тема «${theme.name}» экспортирована`);
}

function initThemeSettings() {
    const fileInput = themeSettingsEl.querySelector("[data-theme-file]");

    btnThemeSettings.addEventListener("click", openThemeSettings);
    themeSettingsEl.querySelector("[data-theme-close]").addEventListener("click", closeThemeSettings);
    themeSettingsEl.addEventListener("click", event => {
        if (event.target === themeSettingsEl) closeThemeSettings();
    });
    themeSettingsEl.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeThemeSettings();
        }
    });
    themeSettingsEl.querySelector("[data-theme-export]").addEventListener("click", exportTheme);
    themeSettingsEl.querySelector("[data-theme-import]").addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 64 * 1024) {
            Omni.toast.error("Файл темы слишком большой (максимум 64 КБ).");
            return;
        }

        try {
            const documentData = JSON.parse(await file.text());
            if (!documentData || documentData.format !== "omni-theme" || ![1, 2].includes(documentData.version)) {
                throw new Error('Ожидается файл Omni Theme версии 1 или 2.');
            }

            const normalized = normalizeThemeDefinition(documentData.theme);
            const existing = customThemes.find(theme => theme.name.toLowerCase() === normalized.name.toLowerCase());
            const importedTheme = {
                id: existing?.id || `custom-${Date.now()}-${++customThemeSequence}`,
                ...normalized
            };
            customThemes = existing
                ? customThemes.map(theme => theme.id === existing.id ? importedTheme : theme)
                : [...customThemes, importedTheme].slice(-20);

            applyTheme(importedTheme);
            Omni.toast.success(`Тема «${importedTheme.name}» импортирована`);
        } catch (error) {
            Omni.toast.error(`Не удалось импортировать тему: ${error.message || error}`);
        }
    });

    studioNavEl.addEventListener("click", event => {
        const button = event.target.closest("[data-studio-tab]");
        if (!button) return;

        const tab = button.dataset.studioTab;
        if (tab === "catalog") {
            openPluginHub();
        } else if (tab === "appearance") {
            openThemeSettings();
        } else {
            switchTab(tab);
        }
    });

    studioHomeEl.addEventListener("click", event => {
        if (event.target.closest("[data-studio-tab='console']")) switchTab("console");
        if (event.target.closest("[data-studio-empty-catalog]")) openPluginHub();
    });

    document.getElementById("studio-open-plugins").addEventListener("click", () => switchTab("console"));
    document.getElementById("studio-open-catalog").addEventListener("click", openPluginHub);
    document.getElementById("studio-plugin-grid").addEventListener("click", event => {
        const button = event.target.closest("[data-studio-action]");
        if (!button) return;

        const plugin = plugins.find(item => item.name === button.dataset.studioName);
        if (!plugin) return;
        if (button.dataset.studioAction === "start") startPlugin(plugin.name);
        if (button.dataset.studioAction === "stop") stopPlugin(plugin.name);
    });
    loadThemeSettings();
}

// ── Global Omni API ───────────────────────────────────────────────────────────

window.Omni = {
    // Toast notification system
    toast: {
        success: (message, duration = 3000) => showToast(message, 'success', duration),
        error: (message, duration = 4000) => showToast(message, 'error', duration),
        warning: (message, duration = 3500) => showToast(message, 'warning', duration),
        info: (message, duration = 3000) => showToast(message, 'info', duration)
    },
    
    // Plugin management
    plugins: {
        getAll: () => plugins,
        getRunning: () => plugins.filter(p => p.state === 'ready' || p.state === 'spawned'),
        getByName: (name) => plugins.find(p => p.name === name),
        start: (name) => startPlugin(name),
        stop: (name) => stopPlugin(name),
        restart: (name) => restartPlugin(name)
    }
};

// ── Plugin List ───────────────────────────────────────────────────────────────

async function refreshPlugins() {
    try {
        plugins = await invoke("list_plugins");
        renderPlugins();
        updateSendPanel();
        updateUIPluginTabs();
        renderStudioHome();
        appendLog("system", "info", `Discovered ${plugins.length} plugin(s)`);
    } catch (err) {
        appendLog("system", "error", `Failed to discover plugins: ${err}`);
    }
}

function renderPlugins() {
    if (plugins.length === 0) {
        pluginListEl.innerHTML = '<div class="plugin-list__empty">No plugins found</div>';
        return;
    }

    const html = plugins.map((p) => {
        const isRunning = p.state === "ready" || p.state === "spawned" || p.state === "busy";
        const icon = getPluginIcon(p);
        const displayName = p.display_name || formatPluginName(p.name);

        return `
            <div class="plugin-card ${isRunning ? 'plugin-card--active' : ''}" 
                 data-name="${escapeAttr(p.name)}"
                 title="${escapeAttr(p.description)}">
                <div class="plugin-card__icon">${icon}</div>
                <div class="plugin-card__info">
                    <div class="plugin-card__name">${escapeHtml(displayName)}</div>
                    <div class="plugin-card__type">${escapeHtml(p.type || 'worker')}</div>
                </div>
                <button class="btn ${isRunning ? 'btn--stop' : 'btn--start'} btn--icon" 
                        data-action="${isRunning ? 'stop' : 'start'}" 
                        data-name="${escapeAttr(p.name)}"
                        title="${isRunning ? 'Stop' : 'Start'}">
                    ${isRunning ? '⏹' : '▶'}
                </button>
            </div>`;
    }).join("");
    
    pluginListEl.innerHTML = html;
}

function formatPluginName(name) {
    return name
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getPluginIcon(plugin) {
    // Return emoji icon based on plugin type
    const typeIcons = {
        'daemon': '⚙️',      // Background worker
        'service': '🔧',     // Service with UI form
        'app': '🎨',         // Full UI application
        'widget': '📊',      // Sidebar widget
        'tool': '🛠️',       // Context tool
        'extension': '🧩',   // Extension for other plugins
        'bridge': '🌉',      // External service integration
        'hook': '🪝'         // Event hook
    };
    
    return typeIcons[plugin.type] || '🔌';
}

// ── Send Panel (Auto UI for worker plugins with ui_schema) ───────────────────

function updateSendPanel() {
    // Find running service plugins with ui_schema
    const servicePlugins = plugins.filter(p => 
        p.type === "service" && 
        p.ui_schema &&
        (p.state === "ready" || p.state === "spawned" || p.state === "busy")
    );

    if (servicePlugins.length === 0) {
        sendPanelEl.hidden = true;
        currentWorkerPlugin = null;
        return;
    }

    // Use the first running service plugin with ui_schema
    currentWorkerPlugin = servicePlugins[0];
    sendPanelEl.hidden = false;
    sendPanelTitleEl.textContent = currentWorkerPlugin.display_name || currentWorkerPlugin.name;
    renderSendPanelForm(currentWorkerPlugin.ui_schema);
}

function renderSendPanelForm(schema) {
    const fields = schema.fields || [];
    schemaFieldsEl.innerHTML = fields.map((field) => {
        const name = field.name || "field";
        const type = field.type || "text";
        const label = field.label || name;
        const placeholder = field.placeholder || "";
        const inputType = type === "number" ? "number" : "text";

        return `
            <label class="schema-field">
                <span class="schema-field__label">${escapeHtml(label)}</span>
                <input
                    class="input input--wide schema-field__input"
                    type="${escapeAttr(inputType)}"
                    data-field="${escapeAttr(name)}"
                    placeholder="${escapeAttr(placeholder)}"
                />
            </label>`;
    }).join("");

    btnSchemaSubmit.textContent = schema.submit_button || "Submit";
}

async function submitSendPanel() {
    if (!currentWorkerPlugin) {
        appendLog("system", "warn", "No plugin selected");
        return;
    }

    const schema = currentWorkerPlugin.ui_schema;
    const method = schema.method || "";
    
    if (!method) {
        appendLog("system", "error", "ui_schema must include method");
        return;
    }

    // Collect params
    const params = {};
    for (const field of schema.fields || []) {
        const name = field.name;
        if (!name) continue;
        
        const input = schemaFieldsEl.querySelector(`[data-field="${CSS.escape(name)}"]`);
        if (!input) continue;
        
        let value = input.value.trim();
        
        // Validate required fields
        if (!value && field.type === "text") {
            appendLog("system", "warn", `Fill in: ${field.label || name}`);
            return;
        }
        
        if (field.type === "number" && value) {
            value = Number(value);
        }
        
        params[name] = value;
    }

    // Send to plugin
    try {
        const requestId = await invoke("send_to_plugin", {
            name: currentWorkerPlugin.name,
            method,
            params
        });
        appendLog(currentWorkerPlugin.name, "info", `→ ${method}() [${requestId.slice(0, 8)}...]`);
    } catch (err) {
        appendLog(currentWorkerPlugin.name, "error", `Send failed: ${err}`);
    }
}

// ── Plugin Actions ────────────────────────────────────────────────────────────

async function startPlugin(name) {
    try {
        await invoke("start_plugin", { name });
        appendLog(name, "info", "Starting...");
        setTimeout(refreshPlugins, 800);
    } catch (err) {
        appendLog(name, "error", `Failed to start: ${err}`);
    }
}

async function stopPlugin(name) {
    try {
        await invoke("stop_plugin", { name });
        appendLog(name, "info", "Stopped");
        await refreshPlugins();
    } catch (err) {
        appendLog(name, "error", `Failed to stop: ${err}`);
    }
}

// ── Log ───────────────────────────────────────────────────────────────────────

function appendLog(plugin, level, text) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    const entry = document.createElement("div");
    entry.className = `log-entry log-entry--${level}`;
    entry.innerHTML = `<span class="log-entry__time">${time}</span><span class="log-entry__plugin">[${escapeHtml(String(plugin))}]</span>${escapeHtml(String(text))}`;
    logOutputEl.appendChild(entry);
    logOutputEl.scrollTop = logOutputEl.scrollHeight;
    renderStudioHome();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ── Events ────────────────────────────────────────────────────────────────────

listen("plugin-event", (event) => {
    const ev = event.payload;

    switch (ev.event_type) {
        case "ready":
            appendLog(ev.plugin, "ready", "✓ Plugin is ready");
            refreshPlugins();
            break;

        case "response":
            appendLog(ev.plugin, "response", `← [${ev.data.id?.slice(0, 8)}...] ${JSON.stringify(ev.data.result)}`);
            
            const pendingRequest = scriptRunnerRequests.get(ev.data.id);
            if (pendingRequest) {
                scriptRunnerRequests.delete(ev.data.id);
                pendingRequest.resolve(ev.data.result);
            } else if (ev.plugin === "script_runner") {
                scriptRunnerEarlyResults.set(ev.data.id, { result: ev.data.result });
            }

            // Handle App plugin responses
            const plugin = plugins.find(p => p.name === ev.plugin);
            if (plugin && plugin.type === "app" && plugin.name === "manga_viewer") {
                if (Array.isArray(ev.data.result)) {
                    renderMangaResults(ev.plugin, ev.data.result);
                }
            }
            break;

        case "error":
            const failedRequest = scriptRunnerRequests.get(ev.data.id);
            if (failedRequest) {
                scriptRunnerRequests.delete(ev.data.id);
                failedRequest.reject(new Error(ev.data.message));
            } else if (ev.plugin === "script_runner" && ev.data.id) {
                scriptRunnerEarlyResults.set(ev.data.id, { error: ev.data.message });
            }
            appendLog(ev.plugin, "error", `✗ [${ev.data.id?.slice(0, 8) || "?"}] ${ev.data.message} (code: ${ev.data.code})`);
            break;

        case "log":
            appendLog(ev.plugin, ev.data.level || "info", ev.data.text);
            if (ev.plugin === "script_runner") {
                appendScriptRunnerOutput(ev.data.level || "info", ev.data.text);
            }
            break;

        case "state_changed":
            appendLog(ev.plugin, "warn", `State → ${ev.data.state}`);
            refreshPlugins();
            break;

        default:
            appendLog(ev.plugin, "info", `Unknown event: ${JSON.stringify(ev)}`);
    }
});

// ── DOM Listeners ─────────────────────────────────────────────────────────────

btnRefresh.addEventListener("click", refreshPlugins);
btnClearLog.addEventListener("click", () => {
    logOutputEl.innerHTML = "";
    renderStudioHome();
});
btnSchemaSubmit.addEventListener("click", submitSendPanel);
btnTaskManager.addEventListener("click", () => switchTab("task-manager"));
btnPluginHub.addEventListener("click", openPluginHub);

schemaFieldsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitSendPanel();
    }
});

pluginListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    
    const name = btn.getAttribute("data-name");
    const action = btn.getAttribute("data-action");
    
    if (!name) return;
    
    if (action === "start") {
        startPlugin(name);
    } else if (action === "stop") {
        stopPlugin(name);
    } else if (action === "restart") {
        restartPlugin(name);
    }
});

if (tabsNavEl) {
    tabsNavEl.addEventListener("click", (e) => {
        const tabBtn = e.target.closest(".tab-btn");
        if (tabBtn) {
            const tabId = tabBtn.getAttribute("data-tab");
            if (tabId) switchTab(tabId);
        }
    });
}

// ── Tabs System ───────────────────────────────────────────────────────────────

function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("tab-btn--active"));
    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("tab-content--active"));

    const tabBtn = document.querySelector(`[data-tab="${tabId}"]`);
    const tabContent = document.querySelector(`[data-tab-content="${tabId}"]`);
    
    if (tabBtn) tabBtn.classList.add("tab-btn--active");
    if (tabContent) tabContent.classList.add("tab-content--active");
    
    currentTab = tabId;
    updateStudioNavigation();
}

function updateUIPluginTabs() {
    const appPlugins = plugins.filter(p => 
        p.type === "app" && 
        (p.state === "ready" || p.state === "spawned" || p.state === "busy")
    );

    // Show tabs only when there are running app plugins
    tabsNavEl.hidden = appPlugins.length === 0 && activeTheme?.layout !== "workbench";

    // Remove old tabs
    Array.from(tabsNavEl.querySelectorAll(".tab-btn")).forEach(btn => {
        if (btn.getAttribute("data-tab") !== "console") btn.remove();
    });

    const runningNames = appPlugins.map(p => p.name);
    Object.keys(uiPluginInstances).forEach(name => {
        if (!runningNames.includes(name)) {
            const tabContent = document.querySelector(`[data-tab-content="${name}"]`);
            if (tabContent) tabContent.remove();
            delete uiPluginInstances[name];
            if (currentTab === name) switchTab("console");
        }
    });

    // Add new tabs
    appPlugins.forEach(plugin => {
        if (!document.querySelector(`[data-tab="${plugin.name}"]`)) {
            const tabBtn = document.createElement("button");
            tabBtn.className = "tab-btn";
            tabBtn.setAttribute("data-tab", plugin.name);
            
            const tabText = document.createElement("span");
            tabText.textContent = plugin.display_name || plugin.name;
            tabBtn.appendChild(tabText);
            
            const closeBtn = document.createElement("span");
            closeBtn.className = "tab-btn__close";
            closeBtn.innerHTML = "×";
            closeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                stopPlugin(plugin.name);
            });
            tabBtn.appendChild(closeBtn);
            
            tabBtn.addEventListener("click", () => switchTab(plugin.name));
            tabsNavEl.appendChild(tabBtn);
        }

        if (!document.querySelector(`[data-tab-content="${plugin.name}"]`)) {
            createUIPluginTab(plugin);
        }
    });
}

function createUIPluginTab(plugin) {
    if (!uiPluginInstances[plugin.name]) {
        uiPluginInstances[plugin.name] = { searchResults: [], loading: false };
    }

    if (plugin.name === "manga_viewer") {
        createMangaViewerTab(plugin);
    } else if (plugin.name === "script_runner") {
        createScriptRunnerTab(plugin);
    }
}

async function scriptRunnerRequest(plugin, method, params = {}) {
    const requestId = await invoke("send_to_plugin", { name: plugin.name, method, params });
    return new Promise((resolve, reject) => {
        const earlyResult = scriptRunnerEarlyResults.get(requestId);
        if (earlyResult) {
            scriptRunnerEarlyResults.delete(requestId);
            if (earlyResult.error) reject(new Error(earlyResult.error));
            else resolve(earlyResult.result);
            return;
        }
        const timeout = setTimeout(() => {
            scriptRunnerRequests.delete(requestId);
            reject(new Error(`Timed out waiting for ${method}`));
        }, 10000);
        scriptRunnerRequests.set(requestId, {
            resolve: (result) => { clearTimeout(timeout); resolve(result); },
            reject: (error) => { clearTimeout(timeout); reject(error); }
        });
    });
}

function createScriptRunnerTab(plugin) {
    const tabContent = document.createElement("div");
    tabContent.className = "tab-content";
    tabContent.setAttribute("data-tab-content", plugin.name);
    tabContent.innerHTML = `
        <section class="script-runner">
            <div class="script-runner__toolbar">
                <input class="input input--wide" data-runner-path placeholder="C:\\path\\to\\script.py" />
                <button class="btn btn--primary" data-runner-run>Run file</button>
                <button class="btn btn--stop" data-runner-stop>Stop</button>
            </div>
            <div class="script-runner__recent" data-runner-recent></div>
            <div class="script-runner__terminal" data-runner-terminal aria-live="polite"></div>
            <div class="script-runner__input-row">
                <input class="input input--wide" data-runner-input placeholder="Input for the running script" />
                <button class="btn btn--primary" data-runner-send>Send</button>
            </div>
        </section>`;
    uiPluginTabsEl.appendChild(tabContent);

    const pathInput = tabContent.querySelector("[data-runner-path]");
    const input = tabContent.querySelector("[data-runner-input]");
    const terminal = tabContent.querySelector("[data-runner-terminal]");
    const write = (level, text) => {
        const line = document.createElement("div");
        line.className = `script-runner__line script-runner__line--${level}`;
        line.textContent = text;
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
    };
    uiPluginInstances[plugin.name] = { tabContent, plugin, write };

    const refreshRecent = async () => {
        try {
            const recent = await scriptRunnerRequest(plugin, "list_recent");
            const recentEl = tabContent.querySelector("[data-runner-recent]");
            recentEl.replaceChildren(...recent.map((path) => {
                const button = document.createElement("button");
                button.className = "btn btn--ghost btn--small";
                button.textContent = path;
                button.title = path;
                button.addEventListener("click", () => { pathInput.value = path; });
                return button;
            }));
        } catch (err) { write("error", String(err)); }
    };
    const run = async () => {
        const path = pathInput.value.trim();
        if (!path) return write("warn", "Choose a .py file first.");
        try {
            const result = await scriptRunnerRequest(plugin, "run_script", { path });
            write("info", `Started: ${result.path}`);
            refreshRecent();
        } catch (err) { write("error", String(err)); }
    };
    const send = async () => {
        const text = input.value;
        if (!text) return;
        try {
            await scriptRunnerRequest(plugin, "send_input", { text });
            write("input", `> ${text}`);
            input.value = "";
        } catch (err) { write("error", String(err)); }
    };
    tabContent.querySelector("[data-runner-run]").addEventListener("click", run);
    tabContent.querySelector("[data-runner-stop]").addEventListener("click", async () => {
        try { await scriptRunnerRequest(plugin, "stop_script"); } catch (err) { write("error", String(err)); }
    });
    tabContent.querySelector("[data-runner-send]").addEventListener("click", send);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") send(); });
    refreshRecent();
}

function appendScriptRunnerOutput(level, text) {
    uiPluginInstances.script_runner?.write?.(level, text);
}

function createMangaViewerTab(plugin) {
    const tabContent = document.createElement("div");
    tabContent.className = "tab-content";
    tabContent.setAttribute("data-tab-content", plugin.name);
    
    tabContent.innerHTML = `
        <div class="manga-viewer">
            <!-- Search Section -->
            <div class="manga-viewer__search" id="manga-search-section">
                <input type="text" class="manga-viewer__search-input" placeholder="Введите название манги..." id="manga-search-input" />
                <button class="btn btn--primary" id="manga-search-btn">Искать</button>
            </div>
            
            <!-- Search Results -->
            <div id="manga-results" class="manga-viewer__results">
                <div class="manga-viewer__empty">Введите название манги и нажмите "Искать"</div>
            </div>
            
            <!-- Reader Section (hidden by default) -->
            <div class="manga-reader" id="manga-reader" hidden>
                <!-- Reader Controls -->
                <div class="manga-reader__controls">
                    <button class="btn btn--ghost" id="reader-back-btn" title="Назад к списку">← Назад</button>
                    <div class="manga-reader__info">
                        <span class="manga-reader__title" id="reader-title">Название манги</span>
                        <span class="manga-reader__chapter" id="reader-chapter">Глава 1</span>
                    </div>
                    <div class="manga-reader__mode-switch">
                        <button class="btn btn--ghost mode-btn mode-btn--active" data-mode="page" title="Постраничный режим">📄</button>
                        <button class="btn btn--ghost mode-btn" data-mode="webtoon" title="Webtoon (вертикальный скролл)">📜</button>
                    </div>
                    <div class="manga-reader__zoom">
                        <button class="btn btn--ghost" id="zoom-out-btn" title="Уменьшить">−</button>
                        <input type="range" id="zoom-slider" min="50" max="200" value="100" step="10" />
                        <span id="zoom-value">100%</span>
                        <button class="btn btn--ghost" id="zoom-in-btn" title="Увеличить">+</button>
                    </div>
                </div>
                
                <!-- Page Container -->
                <div class="manga-reader__container" id="reader-container">
                    <div class="manga-reader__spinner">Загрузка...</div>
                </div>
                
                <!-- Chapter Navigation -->
                <div class="manga-reader__nav">
                    <button class="btn btn--primary" id="prev-chapter-btn" disabled>← Предыдущая глава</button>
                    <div class="manga-reader__page-info" id="page-info">Страница 1 / 1</div>
                    <button class="btn btn--primary" id="next-chapter-btn" disabled>Следующая глава →</button>
                </div>
            </div>
        </div>
    `;
    
    uiPluginTabsEl.appendChild(tabContent);
    
    // Initialize manga viewer state
    const state = {
        mode: 'page', // 'page' or 'webtoon'
        zoom: 100,
        currentManga: null,
        currentChapter: 0,
        pages: [],
        currentPage: 0,
        totalChapters: 0
    };
    
    // Elements
    const searchSection = tabContent.querySelector("#manga-search-section");
    const searchInput = tabContent.querySelector("#manga-search-input");
    const searchBtn = tabContent.querySelector("#manga-search-btn");
    const resultsEl = tabContent.querySelector("#manga-results");
    const readerEl = tabContent.querySelector("#manga-reader");
    const readerContainer = tabContent.querySelector("#reader-container");
    const readerTitle = tabContent.querySelector("#reader-title");
    const readerChapter = tabContent.querySelector("#reader-chapter");
    const pageInfo = tabContent.querySelector("#page-info");
    const backBtn = tabContent.querySelector("#reader-back-btn");
    const prevChapterBtn = tabContent.querySelector("#prev-chapter-btn");
    const nextChapterBtn = tabContent.querySelector("#next-chapter-btn");
    const zoomSlider = tabContent.querySelector("#zoom-slider");
    const zoomValue = tabContent.querySelector("#zoom-value");
    const zoomInBtn = tabContent.querySelector("#zoom-in-btn");
    const zoomOutBtn = tabContent.querySelector("#zoom-out-btn");
    const modeBtns = tabContent.querySelectorAll(".mode-btn");
    
    // Search functionality
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            appendLog(plugin.name, "warn", "Введите название манги");
            return;
        }
        
        resultsEl.innerHTML = '<div class="manga-viewer__loading">Поиск...</div>';
        
        try {
            await invoke("send_to_plugin", {
                name: plugin.name,
                method: "search_manga",
                params: { query }
            });
        } catch (err) {
            appendLog(plugin.name, "error", `Search failed: ${err}`);
            resultsEl.innerHTML = '<div class="manga-viewer__empty">Ошибка поиска</div>';
        }
    };
    
    searchBtn.addEventListener("click", performSearch);
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") performSearch();
    });
    
    // Open manga reader
    window.openMangaReader = (manga) => {
        state.currentManga = manga;
        state.currentChapter = 0;
        state.totalChapters = manga.chapters || 10;
        
        searchSection.hidden = true;
        resultsEl.hidden = true;
        readerEl.hidden = false;
        
        readerTitle.textContent = manga.title;
        loadChapter(0);
    };
    
    // Load chapter
    async function loadChapter(chapterIndex) {
        state.currentChapter = chapterIndex;
        state.currentPage = 0;
        
        readerChapter.textContent = `Глава ${chapterIndex + 1}`;
        readerContainer.innerHTML = '<div class="manga-reader__spinner">Загрузка главы...</div>';
        
        // Update chapter navigation
        prevChapterBtn.disabled = chapterIndex === 0;
        nextChapterBtn.disabled = chapterIndex >= state.totalChapters - 1;
        
        // TODO: Request chapter pages from backend
        // For now, use placeholder images
        state.pages = Array.from({ length: 20 }, (_, i) => ({
            url: `https://via.placeholder.com/800x1200/1a1e28/6c7eff?text=Page+${i + 1}`,
            loaded: false
        }));
        
        renderPages();
    }
    
    // Render pages based on mode
    function renderPages() {
        if (state.mode === 'page') {
            renderPageMode();
        } else {
            renderWebtoonMode();
        }
    }
    
    // Page mode (single page with click navigation)
    function renderPageMode() {
        const page = state.pages[state.currentPage];
        readerContainer.className = 'manga-reader__container manga-reader__container--page';
        readerContainer.innerHTML = `
            <div class="manga-page" style="transform: scale(${state.zoom / 100})">
                <img src="${page.url}" alt="Page ${state.currentPage + 1}" class="manga-page__img" />
            </div>
        `;
        
        pageInfo.textContent = `Страница ${state.currentPage + 1} / ${state.pages.length}`;
        
        // Click to navigate
        const pageEl = readerContainer.querySelector(".manga-page");
        pageEl.addEventListener("click", (e) => {
            const rect = pageEl.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const middle = rect.width / 2;
            
            if (clickX < middle) {
                prevPage();
            } else {
                nextPage();
            }
        });
    }
    
    // Webtoon mode (vertical scroll)
    function renderWebtoonMode() {
        readerContainer.className = 'manga-reader__container manga-reader__container--webtoon';
        readerContainer.innerHTML = state.pages.map((page, i) => `
            <div class="manga-page-webtoon" style="transform: scale(${state.zoom / 100})">
                <img src="${page.url}" alt="Page ${i + 1}" class="manga-page__img" loading="lazy" />
            </div>
        `).join('');
        
        pageInfo.textContent = `${state.pages.length} страниц`;
    }
    
    // Navigation
    function nextPage() {
        if (state.currentPage < state.pages.length - 1) {
            state.currentPage++;
            renderPages();
        } else if (state.currentChapter < state.totalChapters - 1) {
            loadChapter(state.currentChapter + 1);
        }
    }
    
    function prevPage() {
        if (state.currentPage > 0) {
            state.currentPage--;
            renderPages();
        } else if (state.currentChapter > 0) {
            loadChapter(state.currentChapter - 1);
            state.currentPage = state.pages.length - 1;
        }
    }
    
    // Zoom
    function updateZoom(newZoom) {
        state.zoom = Math.max(50, Math.min(200, newZoom));
        zoomSlider.value = state.zoom;
        zoomValue.textContent = `${state.zoom}%`;
        renderPages();
    }
    
    zoomSlider.addEventListener("input", (e) => {
        updateZoom(parseInt(e.target.value));
    });
    
    zoomInBtn.addEventListener("click", () => updateZoom(state.zoom + 10));
    zoomOutBtn.addEventListener("click", () => updateZoom(state.zoom - 10));
    
    // Ctrl + wheel zoom
    readerContainer.addEventListener("wheel", (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -10 : 10;
            updateZoom(state.zoom + delta);
        }
    });
    
    // Mode switch
    modeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const mode = btn.getAttribute("data-mode");
            state.mode = mode;
            
            modeBtns.forEach(b => b.classList.remove("mode-btn--active"));
            btn.classList.add("mode-btn--active");
            
            renderPages();
        });
    });
    
    // Chapter navigation
    prevChapterBtn.addEventListener("click", () => {
        if (state.currentChapter > 0) {
            loadChapter(state.currentChapter - 1);
        }
    });
    
    nextChapterBtn.addEventListener("click", () => {
        if (state.currentChapter < state.totalChapters - 1) {
            loadChapter(state.currentChapter + 1);
        }
    });
    
    // Back to search
    backBtn.addEventListener("click", () => {
        searchSection.hidden = false;
        resultsEl.hidden = false;
        readerEl.hidden = true;
    });
    
    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
        if (readerEl.hidden) return;
        
        if (e.key === "ArrowRight") nextPage();
        if (e.key === "ArrowLeft") prevPage();
        if (e.key === "Escape") backBtn.click();
    });
}

function renderMangaResults(pluginName, results) {
    const tabContent = document.querySelector(`[data-tab-content="${pluginName}"]`);
    if (!tabContent) return;
    
    const resultsEl = tabContent.querySelector("#manga-results");
    if (!resultsEl) return;
    
    if (!results || results.length === 0) {
        resultsEl.innerHTML = '<div class="manga-viewer__empty">Ничего не найдено</div>';
        return;
    }
    
    resultsEl.innerHTML = results.map((manga, index) => `
        <div class="manga-card" data-manga-index="${index}">
            <div class="manga-card__title">${escapeHtml(manga.title)}</div>
            <div class="manga-card__chapters">${escapeHtml(manga.chapters)} глав</div>
        </div>
    `).join("");
    
    // Add click listeners to open reader
    resultsEl.querySelectorAll(".manga-card").forEach(card => {
        card.addEventListener("click", () => {
            const mangaData = results[Number(card.dataset.mangaIndex)];
            if (window.openMangaReader) {
                window.openMangaReader(mangaData);
            }
        });
    });
}

// ── Toast Notifications ───────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    
    const icon = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ⓘ'
    }[type] || 'ⓘ';
    
    toast.innerHTML = `
        <span class="toast__icon">${icon}</span>
        <span class="toast__message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });
    
    // Auto remove
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

async function openPluginHub() {
    let collections = [];
    try { collections = await invoke("list_collections"); } catch (err) { Omni.toast.error(String(err)); return; }
    const hub = document.createElement("div");
    hub.className = "plugin-hub-backdrop";
    hub.innerHTML = `
      <section class="plugin-hub">
        <header class="plugin-hub__header"><div><p class="plugin-hub__eyebrow">OMNI / EXTENSIONS</p><h2>Plugin Hub</h2><p>Manage your local plugin workspace</p></div><button class="btn btn--ghost" data-hub-close>Close</button></header>
        <div class="plugin-hub__actions"><input class="input input--wide" data-hub-search placeholder="Search plugins"/><button class="btn btn--ghost" data-hub-template>Create plugin</button><button class="btn btn--primary" data-hub-new-folder>New collection</button></div>
        <div class="plugin-hub__import"><input class="input input--wide" data-hub-path placeholder="Path to a plugin folder containing manifest.json"/><select class="input" data-hub-collection><option value="">Root collection</option>${collections.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("")}</select><button class="btn btn--primary" data-hub-import>Import</button></div>
        <div class="plugin-hub__market"><div><strong>Marketplace</strong><span> Local catalog is ready. Remote sources can be added later without changing installed plugins.</span></div><span class="plugin-hub__badge">${plugins.length} installed</span></div>
        <div class="plugin-hub__grid" data-hub-grid></div>
      </section>`;
    document.body.appendChild(hub);
    const grid = hub.querySelector("[data-hub-grid]");
    const render = () => {
        const query = hub.querySelector("[data-hub-search]").value.toLowerCase();
        const selected = plugins.filter(p => `${p.name} ${p.display_name} ${p.description}`.toLowerCase().includes(query));
        grid.innerHTML = selected.map(p => `<article class="hub-card"><div class="hub-card__top"><span>${getPluginIcon(p)}</span><span class="hub-card__state hub-card__state--${escapeAttr(p.state)}">${escapeHtml(p.state)}</span></div><h3>${escapeHtml(p.display_name || p.name)}</h3><p>${escapeHtml(p.description || "No description provided.")}</p><footer><span>${escapeHtml(p.type)} · v${escapeHtml(p.version)}</span><button class="btn btn--ghost btn--small" data-hub-export="${escapeAttr(p.name)}">Export</button></footer></article>`).join("") || '<div class="plugin-list__empty">No matching plugins</div>';
    };
    render();
    hub.querySelector("[data-hub-close]").addEventListener("click", () => hub.remove());
    hub.addEventListener("click", async event => {
        const exportButton = event.target.closest("[data-hub-export]");
        if (exportButton) {
            const destination = window.prompt("Existing folder for export:");
            if (!destination) return;
            try { await invoke("export_plugin", { name: exportButton.dataset.hubExport, destination }); Omni.toast.success("Plugin exported"); } catch (err) { Omni.toast.error(String(err)); }
        }
    });
    hub.querySelector("[data-hub-search]").addEventListener("input", render);
    hub.querySelector("[data-hub-template]").addEventListener("click", async () => {
        try { const path = await invoke("create_plugin_template"); Omni.toast.success(`Template saved: ${path}`); } catch (err) { Omni.toast.error(String(err)); }
    });
    hub.querySelector("[data-hub-new-folder]").addEventListener("click", async () => {
        const name = window.prompt("Collection name:"); if (!name) return;
        try { await invoke("create_collection", { name }); hub.remove(); await refreshPlugins(); openPluginHub(); } catch (err) { Omni.toast.error(String(err)); }
    });
    hub.querySelector("[data-hub-import]").addEventListener("click", async () => {
        const source = hub.querySelector("[data-hub-path]").value.trim();
        const collection = hub.querySelector("[data-hub-collection]").value || null;
        if (!source) return Omni.toast.warning("Enter a plugin folder path");
        try { await invoke("import_plugin", { source, collection }); hub.remove(); await refreshPlugins(); Omni.toast.success("Plugin imported"); } catch (err) { Omni.toast.error(String(err)); }
    });
}

// ── Task Manager ──────────────────────────────────────────────────────────────

function isPluginRunning(plugin) {
    return plugin && ['ready', 'spawned', 'busy'].includes(plugin.state);
}

function formatUptimeCompact(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function updateTaskManager() {
    const panel = document.querySelector('.task-manager');
    if (!panel) return;

    if (!panel.querySelector('[data-tm-window]')) {
        panel.innerHTML = `
            <section class="tm-window" data-tm-window>
                <header class="tm-titlebar">
                    <div class="tm-titlebar__left">
                        <span class="tm-titlebar__mark"></span>
                        <div>
                            <h2>Task Manager</h2>
                            <p>Omni plugin processes</p>
                        </div>
                    </div>
                    <div class="tm-titlebar__actions">
                        <button class="tm-icon-btn" data-tm-refresh title="Refresh" type="button">R</button>
                        <button class="tm-icon-btn tm-icon-btn--danger" data-tm-close title="Close" type="button">X</button>
                    </div>
                </header>
                <div class="tm-summary">
                    <div class="tm-summary__item"><span>Processes</span><strong data-tm-total>0</strong></div>
                    <div class="tm-summary__item tm-summary__item--live"><span>Running</span><strong data-tm-running>0</strong></div>
                    <div class="tm-summary__item"><span>Ready</span><strong data-tm-ready>0</strong></div>
                    <div class="tm-summary__item"><span>Stopped</span><strong data-tm-stopped>0</strong></div>
                </div>
                <div class="tm-toolbar">
                    <input class="tm-search" data-tm-search type="search" placeholder="Search process, path, PID" autocomplete="off" />
                    <select class="tm-select" data-tm-sort>
                        <option value="state">Sort: status</option>
                        <option value="name">Sort: name</option>
                        <option value="type">Sort: type</option>
                        <option value="pid">Sort: PID</option>
                    </select>
                    <button class="btn btn--ghost btn--small" data-tm-start-all type="button">Start all</button>
                </div>
                <div class="tm-process-table">
                    <table class="tm-table">
                        <thead>
                            <tr>
                                <th>Process</th>
                                <th>Status</th>
                                <th>PID</th>
                                <th>Type</th>
                                <th>Uptime</th>
                                <th>Location</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody data-tm-body></tbody>
                    </table>
                </div>
            </section>`;

        panel.querySelector('[data-tm-close]').addEventListener('click', () => switchTab('console'));
        panel.querySelector('[data-tm-refresh]').addEventListener('click', refreshPlugins);
        panel.querySelector('[data-tm-search]').addEventListener('input', event => {
            taskManagerQuery = event.target.value;
            updateTaskManager();
        });
        panel.querySelector('[data-tm-sort]').addEventListener('change', event => {
            taskManagerSort = event.target.value;
            updateTaskManager();
        });
        panel.querySelector('[data-tm-start-all]').addEventListener('click', async () => {
            for (const plugin of plugins.filter(plugin => !isPluginRunning(plugin))) {
                await startPlugin(plugin.name);
            }
        });
        panel.querySelector('[data-tm-body]').addEventListener('click', event => {
            const button = event.target.closest('[data-tm-action]');
            if (!button) return;
            const { tmAction: action, tmName: name } = button.dataset;
            if (action === 'start') startPlugin(name);
            if (action === 'stop') stopPlugin(name);
            if (action === 'restart') restartPlugin(name);
        });
    }

    const running = plugins.filter(isPluginRunning);
    const ready = plugins.filter(plugin => plugin.state === 'ready').length;
    const stopped = plugins.length - running.length;
    const windowEl = panel.querySelector('[data-tm-window]');
    const searchEl = windowEl.querySelector('[data-tm-search]');
    const sortEl = windowEl.querySelector('[data-tm-sort]');
    if (searchEl.value !== taskManagerQuery) searchEl.value = taskManagerQuery;
    if (sortEl.value !== taskManagerSort) sortEl.value = taskManagerSort;

    windowEl.querySelector('[data-tm-total]').textContent = plugins.length;
    windowEl.querySelector('[data-tm-running]').textContent = running.length;
    windowEl.querySelector('[data-tm-ready]').textContent = ready;
    windowEl.querySelector('[data-tm-stopped]').textContent = stopped;

    const query = taskManagerQuery.trim().toLowerCase();
    const stateRank = { busy: 0, ready: 1, spawned: 2, discovered: 3, dead: 4 };
    const visiblePlugins = plugins
        .filter(plugin => {
            if (!query) return true;
            return [plugin.name, plugin.display_name, plugin.type, plugin.state, plugin.path, plugin.pid]
                .some(value => String(value ?? '').toLowerCase().includes(query));
        })
        .sort((a, b) => {
            if (taskManagerSort === 'state') return (stateRank[a.state] ?? 99) - (stateRank[b.state] ?? 99) || a.name.localeCompare(b.name);
            if (taskManagerSort === 'pid') return (b.pid || 0) - (a.pid || 0) || a.name.localeCompare(b.name);
            if (taskManagerSort === 'type') return String(a.type || '').localeCompare(String(b.type || '')) || a.name.localeCompare(b.name);
            return (a.display_name || a.name).localeCompare(b.display_name || b.name);
        });

    const tbody = windowEl.querySelector('[data-tm-body]');
    if (visiblePlugins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="tm-table__empty">No matching processes</td></tr>';
        return;
    }

    tbody.innerHTML = visiblePlugins.map(plugin => {
        const isRunning = isPluginRunning(plugin);
        const displayName = plugin.display_name || formatPluginName(plugin.name);
        const startTime = pluginStartTimes[plugin.name];
        const uptime = isRunning && startTime ? formatUptimeCompact(Date.now() - startTime) : '-';
        const action = isRunning ? 'stop' : 'start';
        const actionLabel = isRunning ? 'End task' : 'Start';

        return `
            <tr class="${isRunning ? 'tm-row--running' : ''}">
                <td>
                    <div class="tm-plugin">
                        <span class="tm-plugin__icon">${getPluginIcon(plugin)}</span>
                        <div>
                            <span class="tm-plugin__name">${escapeHtml(displayName)}</span>
                            <span class="tm-plugin__id">${escapeHtml(plugin.name)}</span>
                        </div>
                    </div>
                </td>
                <td><span class="tm-status tm-status--${escapeAttr(plugin.state)}">${escapeHtml(plugin.state)}</span></td>
                <td><span class="tm-pid">${plugin.pid ? escapeHtml(plugin.pid) : '-'}</span></td>
                <td><span class="tm-type">${escapeHtml(plugin.type || 'worker')}</span></td>
                <td><span class="tm-uptime">${uptime}</span></td>
                <td><span class="tm-path" title="${escapeAttr(plugin.path || '')}">${escapeHtml(plugin.path || '-')}</span></td>
                <td>
                    <div class="tm-actions">
                        <button class="btn ${isRunning ? 'btn--stop' : 'btn--primary'} btn--small" data-tm-action="${action}" data-tm-name="${escapeAttr(plugin.name)}">${actionLabel}</button>
                        <button class="btn btn--ghost btn--small" data-tm-action="restart" data-tm-name="${escapeAttr(plugin.name)}">Restart</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function restartPlugin(name) {
    await stopPlugin(name);
    setTimeout(() => startPlugin(name), 500);
    Omni.toast.info(`Restarting ${name}...`);
}

// Override startPlugin to track start times
const originalStartPlugin = startPlugin;
startPlugin = async function(name) {
    await originalStartPlugin(name);
    pluginStartTimes[name] = Date.now();
    updateTaskManager();
};

// Override stopPlugin to clear start times
const originalStopPlugin = stopPlugin;
stopPlugin = async function(name) {
    await originalStopPlugin(name);
    delete pluginStartTimes[name];
    updateTaskManager();
};

// Update task manager on tab switch
const originalSwitchTab = switchTab;
switchTab = function(tabId) {
    originalSwitchTab(tabId);
    if (tabId === 'task-manager') {
        updateTaskManager();
        // Auto-refresh every 2 seconds while on task manager
        if (window.taskManagerInterval) clearInterval(window.taskManagerInterval);
        window.taskManagerInterval = setInterval(() => {
            if (currentTab === 'task-manager') updateTaskManager();
        }, 2000);
    } else {
        if (window.taskManagerInterval) {
            clearInterval(window.taskManagerInterval);
            window.taskManagerInterval = null;
        }
    }
};

// Override refreshPlugins to update task manager
const originalRefreshPlugins = refreshPlugins;
refreshPlugins = async function() {
    await originalRefreshPlugins();
    if (currentTab === 'task-manager') {
        updateTaskManager();
    }
};

// ── Init ──────────────────────────────────────────────────────────────────────

initThemeSettings();
appendLog("system", "info", "Omni Core initialized");
refreshPlugins();

// Test notification
setTimeout(() => {
    Omni.toast.success('Omni готов к работе!');
}, 500);
