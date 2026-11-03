# Omni

Omni is a local desktop plugin manager built with Tauri v2, Rust, vanilla HTML/CSS/JS, and Python worker plugins.

The core app discovers plugins from `plugins/`, starts them as child Python processes, talks to them through JSON-lines over stdin/stdout, and shows their state in the UI.

## What is inside

- Plugin Hub: import, export, collections, marketplace-style installed plugin view, and plugin template export.
- Task Manager: process table with status, PID, type, uptime, path, search, sorting, start, end task, and restart.
- Themes: switch between Classic, Workbench, and Studio interface layouts; selection persists between launches, and complete themes can be imported/exported as validated JSON. Each layout has its own HTML, CSS, and JavaScript under `src/themes/`; shared plugin operations stay in the application core.
- Script Runner plugin: runs one selected `.py` file and keeps recent files for reuse.
- Python SDK: `shared/omni_sdk/bridge.py` gives plugins a small request/response bridge.

## Requirements

- Windows
- Node.js 18+
- Rust stable
- Python 3.10+ available as `python` in PATH

## Install

```powershell
npm install
```

## Run

```powershell
npm run dev
```

Direct Tauri command:

```powershell
npm run tauri -- dev
```

## Check

From the project root:

```powershell
npm run check
```

Or directly:

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```

Do not run plain `cargo check` from the root folder, because `Cargo.toml` is inside `src-tauri/`.

## Build

```powershell
npm run build
```

## Project Structure

```text
Omni/
  src/                    Frontend entry point and shared application core
    themes/               Independent Classic, Workbench, and Studio layouts
  src-tauri/              Rust/Tauri core
  plugins/                Local plugins
  shared/omni_sdk/        Python SDK for plugins
```

## Plugin Layout

Each plugin is a folder with a `manifest.json` and Python entrypoint:

```text
plugins/my_plugin/
  manifest.json
  main.py
```

Minimal manifest:

```json
{
  "name": "my_plugin",
  "display_name": "My Plugin",
  "version": "0.1.0",
  "description": "Short plugin description",
  "type": "service",
  "entrypoint": "main.py"
}
```

Minimal Python plugin:

```python
from omni_sdk import OmniBridge


class Plugin(OmniBridge):
    def on_request(self, method, params):
        if method == "ping":
            return {"message": "pong"}
        raise ValueError(f"Unknown method: {method}")


if __name__ == "__main__":
    Plugin().run()
```

## Runtime Notes

- Generated folders such as `node_modules/`, `src-tauri/target/`, `__pycache__/`, plugin `downloads/`, and plugin `data/` are ignored by git.
- Plugin code should stay inside plugins. The Rust core starts, stops, tracks, imports, exports, and routes messages.
- Plugin Hub can create a plugin template archive in the Downloads folder.
