# Подключение OpenAI API к Smart Lesson v0.8

## 1. Создать OpenAI API key
Создайте ключ в OpenAI Platform. Ключ должен начинаться с `sk-...` или иметь актуальный формат проекта OpenAI.

Важно: подписка ChatGPT Plus не включает API-баланс. Для OpenAI API нужен отдельный биллинг/кредиты в OpenAI Platform.

## 2. Добавить ключ в Cloudflare
1. Cloudflare Dashboard → **Workers & Pages**.
2. Откройте Worker, который использует Smart Lesson.
3. **Settings → Variables and Secrets**.
4. Добавьте новый **Secret**:
   - Name: `OPENAI_API_KEY`
   - Value: ваш OpenAI API key
5. Сохраните.

Старый `GROQ_API_KEY` можно пока оставить до успешной проверки v0.8. После проверки он больше не используется и его можно удалить.

## 3. Заменить код Worker
Откройте **Edit code**, полностью замените старый код содержимым `cloudflare-worker.js` из v0.8 и нажмите **Deploy**.

## 4. Загрузить v0.8 в GitHub
Распакуйте ZIP и загрузите содержимое архива в корень текущего репозитория с заменой файлов.

## 5. Проверить
1. Откройте `https://ВАШ-WORKER.workers.dev/health`.
2. Должно быть: `"openaiConfigured": true`.
3. На сайте обновите страницу через Ctrl+Shift+R.
4. Загрузите 1–2 фото страниц и проверьте OCR.
5. Сгенерируйте один план.

## Используемая модель
По умолчанию: `gpt-5.6-luna` для генерации планов и распознавания изображений.
