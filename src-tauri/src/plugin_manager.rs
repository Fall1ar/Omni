// plugin_manager.rs — Реестр плагинов: discover → spawn → track → communicate
//
// PluginManager хранит состояние всех плагинов и управляет их жизненным циклом.
// Каждый плагин — это дочерний Python-процесс, общение через stdin/stdout (JSON-lines).

use crate::ipc::{IpcIncoming, IpcRequest, ParsedMessage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

// ── Manifest — контракт плагина ───────────────────────────────────────────────

/// Содержимое manifest.json плагина.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Идентификатор плагина (должен совпадать с именем папки в plugins/).
    pub name: String,
    /// Человекочитаемое имя для вкладок/UI (опционально).
    #[serde(default)]
    pub display_name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// "worker" (консоль/форма) или "ui" (своя вкладка в Omni).
    #[serde(rename = "type", default = "default_plugin_type")]
    pub plugin_type: String,
    pub entrypoint: String,
    #[serde(default)]
    pub python: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_sec: u64,
    /// Опциональная схема UI для динамической формы на фронтенде.
    #[serde(default)]
    pub ui_schema: Option<serde_json::Value>,
}

fn default_idle_timeout() -> u64 {
    300
}

fn default_plugin_type() -> String {
    "worker".to_string()
}

// ── Состояние плагина ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginState {
    Discovered,
    Spawned,
    Ready,
    Busy,
    Dead,
}

/// Информация о плагине для отправки на фронтенд.
#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    /// "worker" | "ui"
    #[serde(rename = "type")]
    pub plugin_type: String,
    pub state: PluginState,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_schema: Option<serde_json::Value>,
}

// ── PluginHandle — управление одним процессом ─────────────────────────────────

/// Держит дочерний процесс и канал записи в stdin.
struct PluginHandle {
    child: Child,
    stdin_tx: mpsc::Sender<String>,
    /// Задачи чтения stdout/stderr (для отмены при kill).
    /// Тип — JoinHandle runtime Tauri (не tokio::task::JoinHandle).
    _reader_handle: tauri::async_runtime::JoinHandle<()>,
    _stderr_handle: tauri::async_runtime::JoinHandle<()>,
}

// ── PluginManager ─────────────────────────────────────────────────────────────

pub struct PluginManager {
    /// Каталог plugins/
    plugins_dir: PathBuf,
    /// Каталог shared/ (для PYTHONPATH)
    shared_dir: PathBuf,
    /// Манифесты обнаруженных плагинов: имя → манифест
    manifests: HashMap<String, PluginManifest>,
    /// Текущее состояние плагинов
    states: HashMap<String, PluginState>,
    /// Активные процессы
    handles: HashMap<String, PluginHandle>,
    /// Канал для событий от плагинов → Tauri (для emit в UI)
    event_tx: mpsc::Sender<PluginEvent>,
}

/// Событие от плагина, которое PluginManager отправляет наружу.
#[derive(Debug, Clone, Serialize)]
pub struct PluginEvent {
    pub plugin: String,
    pub event_type: String, // "ready", "response", "error", "log", "state_changed"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl PluginManager {
    pub fn new(
        plugins_dir: PathBuf,
        shared_dir: PathBuf,
        event_tx: mpsc::Sender<PluginEvent>,
    ) -> Self {
        Self {
            plugins_dir,
            shared_dir,
            manifests: HashMap::new(),
            states: HashMap::new(),
            handles: HashMap::new(),
            event_tx,
        }
    }

    // ── discover: сканирует plugins/ и загружает манифесты ────────────────

    pub fn discover(&mut self) -> Result<Vec<PluginInfo>, String> {
        self.manifests.clear();
        // Не трогаем states/handles тех, кто уже запущен

        let entries = std::fs::read_dir(&self.plugins_dir)
            .map_err(|e| format!("Cannot read plugins dir: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&manifest_path)
                .map_err(|e| format!("Cannot read {}: {e}", manifest_path.display()))?;

            let manifest: PluginManifest = serde_json::from_str(&content)
                .map_err(|e| format!("Invalid manifest {}: {e}", manifest_path.display()))?;

            let name = manifest.name.clone();
            self.manifests.insert(name.clone(), manifest);

            // Если плагин не в handles (не запущен), ставим Discovered
            if !self.handles.contains_key(&name) {
                self.states.insert(name, PluginState::Discovered);
            }
        }

        Ok(self.list())
    }

    // ── list: возвращает информацию обо всех плагинах ─────────────────────

    pub fn list(&self) -> Vec<PluginInfo> {
        self.manifests
            .iter()
            .map(|(name, manifest)| {
                let state = self
                    .states
                    .get(name)
                    .cloned()
                    .unwrap_or(PluginState::Discovered);
                let path = self.plugins_dir.join(name).display().to_string();
                let display_name = if manifest.display_name.is_empty() {
                    name.clone()
                } else {
                    manifest.display_name.clone()
                };
                PluginInfo {
                    name: name.clone(),
                    display_name,
                    version: manifest.version.clone(),
                    description: manifest.description.clone(),
                    plugin_type: manifest.plugin_type.clone(),
                    state,
                    path,
                    ui_schema: manifest.ui_schema.clone(),
                }
            })
            .collect()
    }

    // ── spawn: запускает Python-процесс плагина ──────────────────────────

    pub async fn spawn(&mut self, name: &str) -> Result<(), String> {
        // Проверяем, не запущен ли уже
        if self.handles.contains_key(name) {
            return Err(format!("Plugin '{name}' is already running"));
        }

        let manifest = self
            .manifests
            .get(name)
            .ok_or_else(|| format!("Plugin '{name}' not found"))?
            .clone();

        let plugin_dir = self.plugins_dir.join(name);
        let entrypoint = plugin_dir.join(&manifest.entrypoint);

        if !entrypoint.exists() {
            return Err(format!(
                "Entrypoint not found: {}",
                entrypoint.display()
            ));
        }

        // Запускаем Python-процесс (-u + UTF-8 env — критично для IPC на Windows)
        let mut child = Command::new("python")
            .arg("-u")
            .arg(&entrypoint)
            .current_dir(&plugin_dir)
            .env("PYTHONPATH", &self.shared_dir)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // Предотвращаем создание окна консоли на Windows
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to spawn plugin '{name}': {e}"))?;

        // Забираем stdin для записи
        let child_stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture stdin")?;

        // Забираем stdout для чтения
        let child_stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture stdout")?;

        // stderr тоже читаем — иначе pipe может забиться, плюс видны ошибки плагина
        let child_stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture stderr")?;

        // Канал для передачи строк в stdin writer task
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(64);

        // Задача записи в stdin
        let mut writer = child_stdin;
        tauri::async_runtime::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = writer.flush().await;
            }
        });

        // Задача чтения stderr → log-события в UI
        let stderr_tx = self.event_tx.clone();
        let stderr_plugin = name.to_string();
        let stderr_handle = tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(child_stderr);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        let _ = stderr_tx
                            .send(PluginEvent {
                                plugin: stderr_plugin.clone(),
                                event_type: "log".to_string(),
                                data: Some(serde_json::json!({
                                    "level": "error",
                                    "text": format!("[stderr] {line}"),
                                })),
                            })
                            .await;
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = stderr_tx
                            .send(PluginEvent {
                                plugin: stderr_plugin.clone(),
                                event_type: "log".to_string(),
                                data: Some(serde_json::json!({
                                    "level": "warn",
                                    "text": format!("[stderr read error] {e}"),
                                })),
                            })
                            .await;
                        break;
                    }
                }
            }
        });

        // Задача чтения stdout — парсим JSON-lines
        let event_tx = self.event_tx.clone();
        let plugin_name = name.to_string();
        let reader_handle = tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(child_stdout);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim().to_string();
                        if line.is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<IpcIncoming>(&line) {
                            Ok(incoming) => {
                                let parsed = incoming.parse();
                                let event = match &parsed {
                                    ParsedMessage::Ready => PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "ready".to_string(),
                                        data: None,
                                    },
                                    ParsedMessage::Response { id, result } => PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "response".to_string(),
                                        data: Some(serde_json::json!({
                                            "id": id,
                                            "result": result,
                                        })),
                                    },
                                    ParsedMessage::Error { id, code, message } => PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "error".to_string(),
                                        data: Some(serde_json::json!({
                                            "id": id,
                                            "code": code,
                                            "message": message,
                                        })),
                                    },
                                    ParsedMessage::Log { level, text } => PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "log".to_string(),
                                        data: Some(serde_json::json!({
                                            "level": level,
                                            "text": text,
                                        })),
                                    },
                                    ParsedMessage::Unknown(t) => PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "unknown".to_string(),
                                        data: Some(serde_json::json!({ "raw_type": t })),
                                    },
                                };
                                let _ = event_tx.send(event).await;
                            }
                            Err(e) => {
                                let _ = event_tx
                                    .send(PluginEvent {
                                        plugin: plugin_name.clone(),
                                        event_type: "log".to_string(),
                                        data: Some(serde_json::json!({
                                            "level": "warn",
                                            "text": format!("Unparseable output: {line} (err: {e})"),
                                        })),
                                    })
                                    .await;
                            }
                        }
                    }
                    Ok(None) => break, // EOF
                    Err(e) => {
                        // Раньше `while let Ok(...)` молча рвал reader при UTF-8/IO ошибке
                        let _ = event_tx
                            .send(PluginEvent {
                                plugin: plugin_name.clone(),
                                event_type: "log".to_string(),
                                data: Some(serde_json::json!({
                                    "level": "error",
                                    "text": format!("stdout read error: {e}"),
                                })),
                            })
                            .await;
                        break;
                    }
                }
            }

            // Поток чтения завершился → процесс завершился
            let _ = event_tx
                .send(PluginEvent {
                    plugin: plugin_name.clone(),
                    event_type: "state_changed".to_string(),
                    data: Some(serde_json::json!({ "state": "dead" })),
                })
                .await;
        });

        self.handles.insert(
            name.to_string(),
            PluginHandle {
                child,
                stdin_tx,
                _reader_handle: reader_handle,
                _stderr_handle: stderr_handle,
            },
        );
        self.states.insert(name.to_string(), PluginState::Spawned);

        Ok(())
    }

    // ── send: отправляет IPC-запрос в stdin плагина ───────────────────────

    pub async fn send(&self, name: &str, method: &str, params: serde_json::Value) -> Result<String, String> {
        let handle = self
            .handles
            .get(name)
            .ok_or_else(|| format!("Plugin '{name}' is not running"))?;

        let request = IpcRequest::new(method, params);
        let request_id = request.id.clone();
        let json = serde_json::to_string(&request)
            .map_err(|e| format!("Serialization error: {e}"))?;

        handle
            .stdin_tx
            .send(json)
            .await
            .map_err(|e| format!("Failed to send to plugin '{name}': {e}"))?;

        Ok(request_id)
    }

    // ── kill: завершает процесс плагина ───────────────────────────────────

    pub async fn kill(&mut self, name: &str) -> Result<(), String> {
        if let Some(mut handle) = self.handles.remove(name) {
            // Пробуем мягко завершить, затем kill
            let _ = handle.child.kill().await;
            handle._reader_handle.abort();
            handle._stderr_handle.abort();
            self.states.insert(name.to_string(), PluginState::Dead);
            Ok(())
        } else {
            Err(format!("Plugin '{name}' is not running"))
        }
    }

    // ── get_state ─────────────────────────────────────────────────────────

    pub fn get_state(&self, name: &str) -> Option<&PluginState> {
        self.states.get(name)
    }

    /// Обновляет состояние плагина (вызывается при получении "ready" и т.д.)
    pub fn set_state(&mut self, name: &str, state: PluginState) {
        self.states.insert(name.to_string(), state);
    }
}

// Обёртка для Tauri managed state (требует Send + Sync)
pub type SharedPluginManager = Arc<Mutex<PluginManager>>;
