const fs = require('fs');
const path = require('path');

// НАСТРОЙКИ
const API_KEY = "sk-e3ddb44088cf36fe-0ed441-85523564"; // Вставь ключ OmniRoute
const BASE_URL = "http://localhost:20128/v1/messages";
const MODEL = "kr/claude-sonnet-4.5";

// Читаем сломанный файл
const filePath = path.join(__dirname, 'src', 'main.js');
if (!fs.existsSync(filePath)) {
    console.error("❌ Не найден файл src/App.tsx!");
    process.exit(1);
}
const codeToFix = fs.readFileSync(filePath, 'utf8');

console.log("⏳ Отправка кода в OmniRoute (kr/claude-sonnet-4.5)...");

const prompt = `Вчера прошлый ИИ пытался добавить систему вкладок в интерфейс Omni и полностью сломал отображение и запуск плагинов. Сейчас плагины не работают. Почини импорт плагинов и вызовы IPC-команд (таких как start_plugin), чтобы вернуть приложение в рабочее состояние. Выдай мне ИСПРАВЛЕННЫЙ код файла целиком, без лишней болтовни, внутри блока кода.
Вот текущий сломанный код main.js:\n\n${codeToFix}`;

fetch(BASE_URL, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
    })
})
.then(res => res.json())
.then(data => {
    if (data.error) {
        console.error("❌ Ошибка API:", data.error.message);
    } else {
        const reply = data.content[0].text;
        // Извлекаем код из маркдауна
        const codeBlock = reply.match(/```(?:tsx|typescript|javascript)?([\s\S]*?)```/);
        const fixedCode = codeBlock ? codeBlock[1].trim() : reply;
        
        // Перезаписываем файл
        fs.writeFileSync(filePath, fixedCode, 'utf8');
        console.log("✅ Файл src/App.tsx успешно исправлен и перезаписан!");
    }
})
.catch(err => console.error("❌ Ошибка сети:", err));