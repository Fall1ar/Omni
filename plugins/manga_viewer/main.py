#!/usr/bin/env python3
"""
Manga Viewer Plugin — UI плагин для просмотра манги
Тестовая версия с заглушкой данных
"""

import sys
import json
from pathlib import Path

# Добавляем shared/omni_sdk в путь
sdk_path = Path(__file__).parent.parent.parent / "shared" / "omni_sdk"
sys.path.insert(0, str(sdk_path))

from omni_sdk import OmniBridge


class MangaViewerPlugin(OmniBridge):
    """UI плагин для просмотра манги"""

    def __init__(self):
        super().__init__()
        self.log("info", "Manga Viewer initialized")

    def on_request(self, method: str, params: dict):
        """Обработка запросов от Omni Core"""
        if method == "search_manga":
            return self.search_manga(params)
        else:
            return super().on_request(method, params)

    def search_manga(self, params):
        """
        Поиск манги по запросу.
        Пока возвращает тестовые данные.
        
        Args:
            params: Параметры запроса (dict с полем query)
            
        Returns:
            list: Список манги с полями title и chapters
        """
        # Извлекаем query из params
        query = params.get("query", "") if isinstance(params, dict) else str(params)
        query = str(query)
        
        self.log("info", f"Searching for: {query}")
        
        # Тестовые данные для демонстрации
        test_results = [
            {"title": "One Piece", "chapters": 1100},
            {"title": "Naruto", "chapters": 700},
            {"title": "Bleach", "chapters": 686},
            {"title": "Attack on Titan", "chapters": 139},
            {"title": "My Hero Academia", "chapters": 400},
            {"title": "Demon Slayer", "chapters": 205},
        ]
        
        # Фильтруем результаты по запросу (простой поиск)
        if query:
            query_lower = query.lower()
            filtered = [
                manga for manga in test_results
                if query_lower in manga["title"].lower()
            ]
            
            # Если ничего не найдено, возвращаем все результаты
            if not filtered:
                self.log("info", f"No exact match for '{query}', showing all results")
                return test_results
            
            self.log("info", f"Found {len(filtered)} results")
            return filtered
        else:
            self.log("info", "Empty query, showing all results")
            return test_results


def main():
    """Точка входа плагина"""
    plugin = MangaViewerPlugin()
    plugin.run()


if __name__ == "__main__":
    main()
