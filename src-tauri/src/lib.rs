// lib.rs — Точка входа библиотеки Omni. 
// Регистрация Tauri commands и managed state.

mod ipc;
mod plugin_manager;

use plugin_manager::{PluginEvent, PluginInfo, PluginManager, SharedPluginManager};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Сканирует каталог plugins/ и возвращает список обнаруженных плагинов.
#[tauri::command]
async fn list_plugins(manager: tauri::State<'_, SharedPluginManager>) -> Result<Vec<PluginInfo>, String> {
    let mut mgr = manager.lock().await;
    mgr.discover()
}

/// Запускает Python-процесс плагина по имени.
#[tauri::command]
async fn start_plugin(
    name: String,
    manager: tauri::State<'_, SharedPluginManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.spawn(&name).await
}

/// Останавливает (убивает) процесс плагина.
#[tauri::command]
async fn stop_plugin(
    name: String,
    manager: tauri::State<'_, SharedPluginManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.kill(&name).await
}

/// Отправляет IPC-запрос в плагин. Возвращает request_id для корреляции ответа.
#[tauri::command]
async fn send_to_plugin(
    name: String,
    method: String,
    params: serde_json::Value,
    manager: tauri::State<'_, SharedPluginManager>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.send(&name, &method, params).await
}

// ── Инициализация ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Определяем каталоги plugins/ и shared/ относительно exe
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to resolve resource dir");

            // В dev-режиме ищем plugins/ и shared/ в корне проекта
            let base_dir = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
            } else {
                resource_dir
            };

            let plugins_dir = base_dir.join("plugins");
            let shared_dir = base_dir.join("shared");

            // Создаём каталог plugins/ если его нет
            std::fs::create_dir_all(&plugins_dir).ok();

            // Канал для событий от плагинов
            let (event_tx, mut event_rx) = mpsc::channel::<PluginEvent>(256);

            let manager = Arc::new(Mutex::new(PluginManager::new(
                plugins_dir,
                shared_dir,
                event_tx,
            )));

            // Сохраняем manager как managed state
            app.manage(manager.clone());

            // Фоновая задача: слушает события от плагинов и emit'ит их в UI
            // tauri::async_runtime — правильный runtime Tauri (не «голый» tokio::spawn)
            let app_handle = app.handle().clone();
            let manager_for_events = manager.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    // Обновляем состояние при получении "ready"
                    if event.event_type == "ready" {
                        let mut mgr = manager_for_events.lock().await;
                        mgr.set_state(
                            &event.plugin,
                            plugin_manager::PluginState::Ready,
                        );
                    }

                    // Обновляем состояние при "state_changed" → "dead"
                    if event.event_type == "state_changed" {
                        let mut mgr = manager_for_events.lock().await;
                        mgr.set_state(
                            &event.plugin,
                            plugin_manager::PluginState::Dead,
                        );
                    }

                    // Emit в фронтенд
                    let _ = app_handle.emit("plugin-event", &event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_plugins,
            start_plugin,
            stop_plugin,
            send_to_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
