# Omni Plugins

This folder contains local Omni plugins. Each plugin lives in its own folder and must include:

```text
plugin_name/
  manifest.json
  main.py
```

## Manifest Fields

```json
{
  "name": "plugin_name",
  "display_name": "Plugin Name",
  "version": "0.1.0",
  "description": "What this plugin does",
  "type": "service",
  "entrypoint": "main.py"
}
```

Common `type` values:

- `service`: worker plugin with optional generated form UI.
- `app`: plugin with its own full UI tab.
- `tool`: small utility plugin.
- `daemon`: background worker.

## Runtime Data

Keep generated files inside ignored folders such as:

- `downloads/`
- `data/`
- `__pycache__/`
- `.venv/`

## Import and Export

Use Plugin Hub in the Omni UI to import plugin folders, export installed plugins, create collections, or download the plugin template archive.
