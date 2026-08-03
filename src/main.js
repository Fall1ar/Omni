// main.js — UI logic for Omni Plugin Manager

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── DOM ───────────────────────────────────────────────────────────────────────

const pluginListEl = document.getElementById("plugin-list");
const logOutputEl = document.getElementById("log-output");
const btnRefresh = document.getElementById("btn-refresh");
const btnClearLog = document.getElementById("btn-clear-log");
const btnTaskManager = document.getElementById("btn-task-manager");

// Tabs
const tabsNavEl = document.querySelector(".tabs-nav");
const uiPluginTabsEl = document.getElementById("ui-plugin-tabs");

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
const scriptRunnerRequests = new Map();
const scriptRunnerEarlyResults = new Map();

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
btnClearLog.addEventListener("click", () => { logOutputEl.innerHTML = ""; });
btnSchemaSubmit.addEventListener("click", submitSendPanel);
btnTaskManager.addEventListener("click", () => switchTab("task-manager"));

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
}

function updateUIPluginTabs() {
    const appPlugins = plugins.filter(p => 
        p.type === "app" && 
        (p.state === "ready" || p.state === "spawned" || p.state === "busy")
    );

    // Show tabs only when there are running app plugins
    tabsNavEl.hidden = appPlugins.length === 0;

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

// ── Task Manager ──────────────────────────────────────────────────────────────

function updateTaskManager() {
    const totalEl = document.getElementById('tm-total');
    const activeEl = document.getElementById('tm-active');
    const tbody = document.getElementById('tm-tbody');
    
    if (!tbody) return;
    
    const runningPlugins = plugins.filter(p => 
        p.state === 'ready' || p.state === 'spawned' || p.state === 'busy'
    );
    
    if (totalEl) totalEl.textContent = plugins.length;
    if (activeEl) activeEl.textContent = runningPlugins.length;
    
    if (runningPlugins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="tm-table__empty">Нет запущенных плагинов</td></tr>';
        return;
    }
    
    tbody.innerHTML = runningPlugins.map(plugin => {
        const displayName = plugin.display_name || formatPluginName(plugin.name);
        const startTime = pluginStartTimes[plugin.name];
        const uptime = startTime ? formatUptime(Date.now() - startTime) : 'N/A';
        const statusClass = {
            'ready': 'status--ready',
            'spawned': 'status--spawned',
            'busy': 'status--busy'
        }[plugin.state] || '';
        
        return `
            <tr>
                <td>
                    <div class="tm-plugin">
                        <span class="tm-plugin__icon">${getPluginIcon(plugin)}</span>
                        <span class="tm-plugin__name">${escapeHtml(displayName)}</span>
                    </div>
                </td>
                <td><span class="tm-type">${escapeHtml(plugin.type || 'worker')}</span></td>
                <td><span class="tm-status ${statusClass}">${escapeHtml(plugin.state)}</span></td>
                <td><span class="tm-uptime">${uptime}</span></td>
                <td>
                    <div class="tm-actions">
                        <button class="btn btn--ghost btn--small" 
                                data-action="restart" data-name="${escapeAttr(plugin.name)}"
                                title="Restart">
                            ↻
                        </button>
                        <button class="btn btn--stop btn--small" 
                                data-action="stop" data-name="${escapeAttr(plugin.name)}"
                                title="Kill">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}ч ${minutes % 60}м`;
    if (minutes > 0) return `${minutes}м ${seconds % 60}с`;
    return `${seconds}с`;
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

appendLog("system", "info", "Omni Core initialized");
refreshPlugins();

// Test notification
setTimeout(() => {
    Omni.toast.success('Omni готов к работе!');
}, 500);
