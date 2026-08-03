#!/usr/bin/env python3
"""
💣 Omni Bomb Plugin
Шуточный плагин который "взорвёт" Omni с обратным отсчётом
"""

import sys
import os
import time
import random

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
from omni_sdk import OmniPlugin


class OmniBombPlugin(OmniPlugin):
    def __init__(self):
        super().__init__()
        self.countdown = 10
        self.defused = False
        
    def on_ready(self):
        """Запускается когда плагин готов"""
        self.send_log('error', '🚨 ВНИМАНИЕ! Бомба активирована!')
        self.send_log('warning', f'Обратный отсчёт: {self.countdown} секунд!')
        self.send_log('info', 'Omni.toast.error("💣 БОМБА АКТИВИРОВАНА! ' + str(self.countdown) + ' СЕКУНД ДО ВЗРЫВА!")')
        
        # Запускаем отсчёт
        self.start_countdown()
        
    def start_countdown(self):
        """Обратный отсчёт"""
        emojis = ['💣', '💥', '🔥', '⚠️', '☠️']
        
        for i in range(self.countdown, 0, -1):
            if self.defused:
                self.send_log('info', 'Omni.toast.success("✅ Бомба обезврежена!")')
                self.send_log('ready', '✅ Бомба успешно обезврежена!')
                return
                
            # Выбираем случайную эмоджи
            emoji = random.choice(emojis)
            
            # Разные уведомления в зависимости от времени
            if i > 7:
                self.send_log('warning', f'{emoji} Обратный отсчёт: {i}...')
                self.send_log('info', f'Omni.toast.warning("{emoji} Обратный отсчёт: {i} сек")')
            elif i > 3:
                self.send_log('error', f'{emoji} ОСТАЛОСЬ {i} СЕКУНД!')
                self.send_log('info', f'Omni.toast.error("{emoji} ОСТАЛОСЬ {i} СЕКУНД!")')
            else:
                self.send_log('error', f'{emoji}💀 ВЗРЫВ ЧЕРЕЗ {i}!!!')
                self.send_log('info', f'Omni.toast.error("{emoji}💀 ВЗРЫВ ЧЕРЕЗ {i}!!!", 800)')
                
            time.sleep(1)
        
        # ВЗРЫВ!
        self.detonate()
        
    def detonate(self):
        """ВЗРЫВ!"""
        explosion_messages = [
            '💥💥💥 БУУУММММ!!! 💥💥💥',
            '🔥🔥🔥 ОГОНЬ! 🔥🔥🔥',
            '☠️ Omni уничтожен! ☠️',
            '💀 R.I.P. Omni 💀',
            '🌋 Катастрофический взрыв! 🌋'
        ]
        
        # Отправляем серию взрывных сообщений
        for msg in explosion_messages:
            self.send_log('error', msg)
            self.send_log('info', f'Omni.toast.error("{msg}", 2000)')
            time.sleep(0.3)
        
        # Финальное сообщение
        time.sleep(1)
        self.send_log('info', 'Omni.toast.warning("😎 Шутка! Omni в порядке!", 4000)')
        self.send_log('ready', '😎 Это была шутка! Omni работает нормально.')
        self.send_log('info', '💡 Совет: используйте Task Manager для остановки плагинов!')
        
    def on_request(self, request_id, method, params):
        """Обработка запросов"""
        if method == "defuse":
            self.defused = True
            self.send_response(request_id, {"status": "defused", "message": "Бомба обезврежена!"})
        elif method == "status":
            self.send_response(request_id, {
                "countdown": self.countdown,
                "defused": self.defused
            })
        else:
            self.send_error(request_id, -1, f"Unknown method: {method}")


if __name__ == "__main__":
    plugin = OmniBombPlugin()
    plugin.run()
