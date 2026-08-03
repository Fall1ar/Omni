#!/usr/bin/env python3
"""Harmless countdown demo plugin for the Omni JSONL SDK."""

import random
import threading

from omni_sdk import OmniBridge


class OmniBombPlugin(OmniBridge):
    def __init__(self):
        super().__init__()
        self.countdown = 10
        self.defused = threading.Event()

    def run(self):
        threading.Thread(target=self._run_countdown, daemon=True).start()
        super().run()

    def _run_countdown(self):
        self.log("warning", "Demo countdown started. Use defuse to stop it.")
        for seconds in range(self.countdown, 0, -1):
            if self.defused.wait(timeout=1):
                self.log("info", "Demo countdown defused.")
                return
            self.log("warning", f"{random.choice(['💣', '💥', '🔥'])} {seconds}…")
        self.log("info", "Demo complete — Omni is unchanged.")

    def on_request(self, method: str, params: dict):
        if method == "defuse":
            self.defused.set()
            return {"status": "defused"}
        if method == "status":
            return {"defused": self.defused.is_set()}
        raise ValueError(f"Unknown method: {method}")


if __name__ == "__main__":
    OmniBombPlugin().run()
