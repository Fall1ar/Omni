// ipc.rs — Протокол общения Ядро (Rust) ↔ Плагин (Python)
//
// Формат: JSON-lines через stdin/stdout дочернего процесса.
// Каждое сообщение — одна строка JSON, разделённая '\n'.

use serde::{Deserialize, Serialize};

// ── Исходящие сообщения (Ядро → Плагин) ──────────────────────────────────────

/// Запрос от Ядра к плагину.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String, // всегда "request"
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

impl IpcRequest {
    pub fn new(method: &str, params: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            msg_type: "request".to_string(),
            method: method.to_string(),
            params,
        }
    }
}

// ── Входящие сообщения (Плагин → Ядро) ───────────────────────────────────────

/// Универсальная обёртка для парсинга входящих сообщений от плагина.
/// Поле `type` определяет, какой это тип: "ready", "response", "error", "log".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcIncoming {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    // Для "response":
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    // Для "error":
    #[serde(default)]
    pub code: Option<i32>,
    #[serde(default)]
    pub message: Option<String>,
    // Для "log":
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

// ── Перечисление распарсенных сообщений ───────────────────────────────────────

/// Типизированное сообщение после парсинга.
#[derive(Debug, Clone)]
pub enum ParsedMessage {
    Ready,
    Response {
        id: String,
        result: serde_json::Value,
    },
    Error {
        id: Option<String>,
        code: i32,
        message: String,
    },
    Log {
        level: String,
        text: String,
    },
    Unknown(String),
}

impl IpcIncoming {
    /// Преобразует сырое IPC-сообщение в типизированный enum.
    pub fn parse(self) -> ParsedMessage {
        match self.msg_type.as_str() {
            "ready" => ParsedMessage::Ready,
            "response" => ParsedMessage::Response {
                id: self.id.unwrap_or_default(),
                result: self.result.unwrap_or(serde_json::Value::Null),
            },
            "error" => ParsedMessage::Error {
                id: self.id,
                code: self.code.unwrap_or(-1),
                message: self.message.unwrap_or_else(|| "Unknown error".to_string()),
            },
            "log" => ParsedMessage::Log {
                level: self.level.unwrap_or_else(|| "info".to_string()),
                text: self.text.unwrap_or_default(),
            },
            other => ParsedMessage::Unknown(other.to_string()),
        }
    }
}
