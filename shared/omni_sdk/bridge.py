# bridge.py — Базовый класс для Python-плагинов Omni.
#
# Плагин наследует OmniBridge и переопределяет on_request().
# Общение с Ядром через stdin/stdout в формате JSON-lines.

import json
import sys
import traceback
from typing import Any


class OmniBridge:
    """Базовый мост Плагин ↔ Ядро.

    Протокол:
        - Каждое сообщение — одна строка JSON, разделённая '\\n'.
        - При старте плагин отправляет {"type": "ready"}.
        - Ядро отправляет {"id": "...", "type": "request", "method": "...", "params": {...}}.
        - Плагин отвечает {"id": "...", "type": "response", "result": {...}}.
        - Ошибки: {"id": "...", "type": "error", "code": N, "message": "..."}.
    """

    def __init__(self):
        self._running = False

    # ── Публичный API ──────────────────────────────────────────────────────

    def run(self):
        """Запускает event loop плагина. Блокирует до завершения."""
        self._running = True
        # Windows pipes often default to cp1251 — emoji/Cyrillic in responses then fail.
        # Force UTF-8 for the whole IPC channel (stdin + stdout).
        self._configure_stdio_utf8()
        self._send_ready()

        # readline() is more reliable than `for line in sys.stdin` over pipes on Windows.
        while True:
            line = sys.stdin.readline()
            if line == "":
                break  # EOF — ядро закрыло stdin / процесс завершается

            line = line.strip()
            if not line:
                continue

            try:
                msg = json.loads(line)
            except json.JSONDecodeError as e:
                self.log("error", f"Invalid JSON from core: {e}")
                continue

            msg_type = msg.get("type", "")
            msg_id = msg.get("id")

            if msg_type == "request":
                self._handle_request(msg_id, msg.get("method", ""), msg.get("params", {}))
            else:
                self.log("warn", f"Unknown message type: {msg_type}")

    def on_request(self, method: str, params: dict) -> Any:
        """Переопределяется плагином. Обрабатывает запрос от Ядра.

        Args:
            method: Имя метода (например, "greet", "execute").
            params: Параметры запроса.

        Returns:
            Результат, который будет сериализован в JSON.

        Raises:
            Exception: Будет перехвачено и отправлено как error.
        """
        raise NotImplementedError(f"Method '{method}' is not implemented")

    def log(self, level: str, text: str):
        """Отправляет лог-сообщение в Ядро."""
        self._send({"type": "log", "level": level, "text": text})

    # ── Внутренние методы ──────────────────────────────────────────────────

    def _send_ready(self):
        self._send({"type": "ready"})

    def _handle_request(self, msg_id: str, method: str, params: dict):
        try:
            result = self.on_request(method, params)
            self._send({
                "id": msg_id,
                "type": "response",
                "result": result,
            })
        except Exception as e:
            self._send({
                "id": msg_id,
                "type": "error",
                "code": 1000,
                "message": f"{type(e).__name__}: {e}",
            })
            # Также логируем traceback
            self.log("error", traceback.format_exc())

    def _configure_stdio_utf8(self):
        """Переводит stdin/stdout в UTF-8 (критично для Windows + pipes)."""
        for stream in (sys.stdin, sys.stdout):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

    def _send(self, data: dict):
        """Отправляет JSON-строку в stdout (→ Ядро) как UTF-8 bytes."""
        try:
            line = json.dumps(data, ensure_ascii=False) + "\n"
            # Пишем в buffer — не зависим от text-encoding консоли/pipe.
            sys.stdout.buffer.write(line.encode("utf-8"))
            sys.stdout.buffer.flush()
        except Exception as e:
            # Последняя попытка: сообщить о сбое в stderr (ASCII-safe).
            try:
                sys.stderr.write(f"omni_sdk _send failed: {type(e).__name__}: {e}\n")
                sys.stderr.flush()
            except Exception:
                pass
