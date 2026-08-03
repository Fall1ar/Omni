# Этап 1: Базовое Ядро — Задачи

## Инициализация проекта
- [x] Инициализировать Tauri v2 проект (vanilla HTML/JS)
- [x] Настроить `Cargo.toml` (добавить tokio, uuid, serde)
- [x] Настроить `tauri.conf.json`
- [x] `rustup default stable` (Rust 1.97.0)
- [x] `npm install`

## Rust Core
- [x] `ipc.rs` — типы IPC-сообщений
- [x] `plugin_manager.rs` — PluginManager + PluginHandle
- [x] `lib.rs` — Tauri commands (list, start, stop, send)
- [x] `main.rs` — точка входа (не менялся, scaffold'ный)

## Frontend
- [x] `index.html` — UI оболочка
- [x] `styles.css` — тёмная тема
- [x] `main.js` — логика управления плагинами

## Python SDK
- [x] `shared/omni_sdk/__init__.py`
- [x] `shared/omni_sdk/bridge.py` — OmniBridge

## Plugin Example
- [x] `plugins/hello_world/manifest.json`
- [x] `plugins/hello_world/main.py`

## Verification
- [/] `cargo build` — ожидается результат
- [ ] `cargo tauri dev` запускается
- [ ] Плагин hello_world стартует и отвечает
