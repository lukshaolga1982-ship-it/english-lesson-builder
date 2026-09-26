# Подключение Alibaba Cloud Model Studio к Smart Lesson v0.9

Smart Lesson v0.9 использует **Alibaba Cloud Model Studio / Qwen3.8-27B** для:

- генерации полного плана-конспекта;
- точечной переработки этапов;
- OCR/распознавания фотографий страниц учебника.

OpenAI и Groq этой версии не нужны.

## 1. Активировать Alibaba Cloud Model Studio

1. Войдите в Alibaba Cloud.
2. Откройте **Model Studio**.
3. Выберите регион **Singapore**.
4. Если сервис ещё не активирован, примите условия и активируйте Model Studio / Large Model Inference.

Почему Singapore: для `qwen3.8-27b` доступен международный deployment и бесплатная квота для новых пользователей может предоставляться именно в Singapore.

## 2. Создать API key

В Model Studio откройте **API Key** → **Create API Key**.

Рекомендуемые настройки:

- Region: `Singapore`;
- Workspace: default workspace;
- Permissions: `All` (или разрешите как минимум модель `qwen3.8-27b`).

Сразу сохраните показанный ключ: после закрытия окна полный ключ может быть больше недоступен.

## 3. Добавить ключ в Cloudflare

Cloudflare Dashboard → **Workers & Pages** → ваш Smart Lesson Worker → **Settings → Variables and Secrets**.

Добавьте **Secret**:

```text
Name: DASHSCOPE_API_KEY
Value: ваш API key Alibaba Model Studio
```

Не добавляйте API key в GitHub и не вставляйте его в `src/`.

## 4. Base URL

По умолчанию Worker использует Singapore DashScope endpoint:

```text
https://dashscope-intl.aliyuncs.com/api/v1
```

Поэтому при Singapore API key дополнительная переменная обычно не нужна.

Если Model Studio при создании ключа показывает workspace-specific API Host, можно использовать его. В Cloudflare добавьте обычную переменную:

```text
Name: ALIBABA_NATIVE_BASE_URL
Value: https://ВАШ_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/api/v1
```

Важно: API key и Base URL должны относиться к одному региону. Ключи Model Studio между регионами не взаимозаменяемы.

## 5. Необязательная смена модели

По умолчанию используется:

```text
qwen3.8-27b
```

Если понадобится сменить модель без правки Worker, добавьте Cloudflare variable:

```text
QWEN_MODEL=qwen3.8-27b
QWEN_VISION_MODEL=qwen3.8-27b
```

Для текущей версии их можно не создавать.

## 6. Заменить Cloudflare Worker

1. Cloudflare → **Workers & Pages** → Smart Lesson Worker.
2. **Edit code**.
3. Удалите старый код.
4. Вставьте `cloudflare-worker.js` из v0.9.
5. Нажмите **Deploy**.

## 7. Проверить Worker

Откройте:

```text
https://ВАШ-WORKER.workers.dev/health
```

Должно быть примерно:

```json
{
  "ok": true,
  "alibabaConfigured": true,
  "primaryModel": "qwen3.8-27b",
  "visionModel": "qwen3.8-27b",
  "textbookImageOcr": true
}
```

Если `alibabaConfigured` = `false`, проверьте имя Secret: оно должно быть **DASHSCOPE_API_KEY**.

## 8. Обновить GitHub

Распакуйте ZIP v0.9 и загрузите **содержимое архива** в корень текущего репозитория с заменой файлов.

После публикации обновите сайт через `Ctrl + Shift + R`.

## 9. Тест

Рекомендуемый тест:

1. войти через Google;
2. выбрать учебник и 1–2 страницы;
3. загрузить фото этих страниц;
4. нажать распознавание;
5. проверить полученный текст;
6. создать план-конспект;
7. проверить блок «Опора на учебник» и логические мостики между этапами.

## Старые секреты

После успешной проверки v0.9 старые `OPENAI_API_KEY` и `GROQ_API_KEY` Worker больше не использует. Их можно удалить из Cloudflare, если они нигде больше не нужны.


## v12: native DashScope API

В версии v12 генерация и OCR идут через нативный endpoint `.../api/v1/services/aigc/multimodal-generation/generation`, а не через OpenAI-compatible `/chat/completions`. Это полностью исключает параметр `response_format` из запросов. Старую переменную `ALIBABA_BASE_URL`, если она уже есть в Cloudflare, можно оставить: Worker использует только её домен и автоматически переходит на `/api/v1`. Новая переменная не обязательна.
