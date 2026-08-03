"""Run one local Python file and expose its stdin/stdout through Omni IPC."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path

from omni_sdk import OmniBridge


class ScriptRunner(OmniBridge):
    def __init__(self) -> None:
        super().__init__()
        self.process: subprocess.Popen[str] | None = None
        self.lock = threading.Lock()
        self.history_file = Path(__file__).with_name("data") / "recent_scripts.json"

    def on_request(self, method: str, params: dict):
        if method == "run_script":
            return self.run_script(params.get("path", ""))
        if method == "send_input":
            return self.send_input(params.get("text", ""))
        if method == "stop_script":
            return self.stop_script()
        if method == "list_recent":
            return self.load_recent()
        raise ValueError(f"Unknown method: {method}")

    def run_script(self, raw_path: str) -> dict:
        path = Path(raw_path).expanduser().resolve()
        if path.suffix.lower() != ".py" or not path.is_file():
            raise ValueError("Path must point to an existing .py file")
        self.stop_script()
        with self.lock:
            self.process = subprocess.Popen(
                [sys.executable, "-u", str(path)],
                cwd=path.parent,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            process = self.process
        self.save_recent(str(path))
        self._forward(process.stdout, "stdout")
        self._forward(process.stderr, "stderr")
        threading.Thread(target=self._wait_for_exit, args=(process, path.name), daemon=True).start()
        return {"path": str(path), "pid": process.pid}

    def _forward(self, stream, label: str) -> None:
        def read() -> None:
            for line in iter(stream.readline, ""):
                self.log("error" if label == "stderr" else "info", f"[{label}] {line.rstrip()}")
            stream.close()
        threading.Thread(target=read, daemon=True).start()

    def _wait_for_exit(self, process: subprocess.Popen[str], name: str) -> None:
        code = process.wait()
        with self.lock:
            if self.process is process:
                self.process = None
        self.log("info", f"{name} exited with code {code}")

    def send_input(self, text: str) -> dict:
        with self.lock:
            process = self.process
            if not process or process.poll() is not None or not process.stdin:
                raise RuntimeError("No script is running")
            process.stdin.write(f"{text}\n")
            process.stdin.flush()
        return {"sent": True}

    def stop_script(self) -> dict:
        with self.lock:
            process, self.process = self.process, None
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        return {"stopped": bool(process)}

    def load_recent(self) -> list[str]:
        try:
            return [p for p in json.loads(self.history_file.read_text(encoding="utf-8")) if Path(p).is_file()]
        except (OSError, json.JSONDecodeError):
            return []

    def save_recent(self, path: str) -> None:
        recent = [p for p in self.load_recent() if p != path]
        recent.insert(0, path)
        self.history_file.parent.mkdir(exist_ok=True)
        self.history_file.write_text(json.dumps(recent[:20], ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    ScriptRunner().run()
