# hello_world/main.py — Демо-плагин Omni.
#
# Поддерживает метод "greet" — возвращает приветствие.

from omni_sdk import OmniBridge


class HelloPlugin(OmniBridge):
    def on_request(self, method: str, params: dict):
        if method == "greet":
            name = params.get("name", "World")
            return {"message": f"Привет, {name}! Я — плагин hello_world 🎉"}

        if method == "ping":
            return {"pong": True}

        raise ValueError(f"Unknown method: {method}")


if __name__ == "__main__":
    plugin = HelloPlugin()
    plugin.run()
