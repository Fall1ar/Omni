# media_downloader/main.py — «Медиа-Комбайн» на базе yt-dlp.
#
# Методы:
#   download_video  — params: { "url": "...", "format"?: "..." }
#   ping            — health-check
#
# Зависимости (yt-dlp) ставятся автоматически при старте плагина.

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from omni_sdk import OmniBridge

# Каталог загрузок рядом с плагином (не в ядре — модульность).
DOWNLOADS_DIR = Path(__file__).resolve().parent / "downloads"

# С ffmpeg: лучшее видео + лучшее аудио → merge.
# Без ffmpeg: один уже готовый поток (merge не нужен).
FORMAT_WITH_FFMPEG = "bv*+ba/b"
FORMAT_WITHOUT_FFMPEG = "b/best"

# pip-пакет → import-имя модуля
REQUIRED_PACKAGES = {
    "yt-dlp": "yt_dlp",
}


def ensure_dependencies() -> None:
    """Проверяет и при необходимости ставит Python-зависимости плагина."""
    missing: list[tuple[str, str]] = []
    for pip_name, import_name in REQUIRED_PACKAGES.items():
        try:
            __import__(import_name)
        except ImportError:
            missing.append((pip_name, import_name))

    if not missing:
        return

    for pip_name, _ in missing:
        # stderr читается ядром Omni → видно в Console UI
        print(f"[media_downloader] Installing dependency: {pip_name} …", file=sys.stderr, flush=True)
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", pip_name],
                stdout=sys.stderr,
                stderr=sys.stderr,
            )
        except subprocess.CalledProcessError as e:
            raise SystemExit(
                f"Failed to install '{pip_name}'. "
                f"Install manually: {sys.executable} -m pip install {pip_name}"
            ) from e

    # Повторный import после установки
    for _, import_name in missing:
        try:
            __import__(import_name)
        except ImportError as e:
            raise SystemExit(
                f"Package installed but import '{import_name}' still fails: {e}"
            ) from e

    print("[media_downloader] Dependencies ready.", file=sys.stderr, flush=True)


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


class MediaDownloaderPlugin(OmniBridge):
    def on_request(self, method: str, params: dict) -> Any:
        if method == "download_video":
            return self._download_video(params)

        if method == "ping":
            return {
                "pong": True,
                "plugin": "media_downloader",
                "ffmpeg": _has_ffmpeg(),
            }

        raise ValueError(f"Unknown method: {method}")

    # ── download_video ─────────────────────────────────────────────────────

    def _download_video(self, params: dict) -> dict:
        import yt_dlp  # гарантированно после ensure_dependencies()

        url = (params.get("url") or "").strip()
        if not url:
            raise ValueError("Missing required param: url")

        has_ffmpeg = _has_ffmpeg()
        user_fmt = (params.get("format") or "").strip()

        if user_fmt:
            fmt = user_fmt
        elif has_ffmpeg:
            fmt = FORMAT_WITH_FFMPEG
        else:
            fmt = FORMAT_WITHOUT_FFMPEG

        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

        self.log("info", f"Starting download: {url}")
        self.log("info", f"Output dir: {DOWNLOADS_DIR}")
        if has_ffmpeg:
            self.log("info", f"ffmpeg: yes | format: {fmt}")
        else:
            self.log(
                "warn",
                "ffmpeg not found — downloading single best stream "
                "(install ffmpeg for higher quality merge). "
                f"format: {fmt}",
            )

        # Путь к итоговому файлу заполняется progress_hook / post-process
        result_path: dict[str, str | None] = {"path": None}

        def progress_hook(d: dict) -> None:
            status = d.get("status")
            if status == "downloading":
                percent = (d.get("_percent_str") or "?").strip()
                speed = (d.get("_speed_str") or "?").strip()
                eta = (d.get("_eta_str") or "?").strip()
                filename = Path(d.get("filename") or "").name or "…"
                self.log(
                    "info",
                    f"progress {percent} | speed {speed} | eta {eta} | {filename}",
                )
            elif status == "finished":
                fname = d.get("filename")
                if fname:
                    result_path["path"] = str(Path(fname).resolve())
                self.log("info", "Download finished, post-processing…")
            elif status == "error":
                self.log("error", f"yt-dlp progress error: {d}")

        ydl_opts: dict[str, Any] = {
            "outtmpl": str(DOWNLOADS_DIR / "%(title)s [%(id)s].%(ext)s"),
            "format": fmt,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
            "noprogress": True,
        }
        if has_ffmpeg:
            ydl_opts["merge_output_format"] = "mp4"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise RuntimeError("yt-dlp returned no info for URL")

                path = result_path["path"]
                if not path:
                    path = ydl.prepare_filename(info)
                    path = self._resolve_downloaded_path(path, info)

                path = str(Path(path).resolve())
                if not Path(path).is_file():
                    alt = self._find_recent_download(info)
                    if alt:
                        path = alt
                    else:
                        raise FileNotFoundError(
                            f"Downloaded file not found at expected path: {path}"
                        )

                title = info.get("title") or Path(path).stem
                self.log("info", f"Saved: {path}")
                return {
                    "status": "success",
                    "path": path,
                    "title": title,
                    "url": url,
                }

        except yt_dlp.utils.DownloadError as e:
            msg = self._clean_error(str(e))
            self.log("error", f"Download failed: {msg}")
            raise RuntimeError(msg) from e

    @staticmethod
    def _resolve_downloaded_path(prepared: str, info: dict) -> str:
        """Учитывает смену расширения после merge (часто → .mp4)."""
        p = Path(prepared)
        if p.is_file():
            return str(p)

        for ext in ("mp4", "mkv", "webm", "m4a", "mp3"):
            candidate = p.with_suffix(f".{ext}")
            if candidate.is_file():
                return str(candidate)

        requested = info.get("requested_downloads") or []
        for item in requested:
            fp = item.get("filepath")
            if fp and Path(fp).is_file():
                return str(Path(fp).resolve())

        return prepared

    @staticmethod
    def _find_recent_download(info: dict) -> str | None:
        video_id = info.get("id")
        if not video_id or not DOWNLOADS_DIR.is_dir():
            return None
        matches = [
            f
            for f in DOWNLOADS_DIR.iterdir()
            if f.is_file() and f"[{video_id}]" in f.name
        ]
        if not matches:
            return None
        matches.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        return str(matches[0].resolve())

    @staticmethod
    def _clean_error(message: str) -> str:
        text = re.sub(r"\x1b\[[0-9;]*m", "", message)
        return text.strip() or "Unknown download error"


if __name__ == "__main__":
    ensure_dependencies()
    MediaDownloaderPlugin().run()
