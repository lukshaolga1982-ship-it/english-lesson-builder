# Smart Lesson

Конструктор планов-конспектов уроков английского языка для учителей Республики Беларусь.

## Что уже работает

- классы 3–11, базовый / повышенный уровень;
- выбор учебника, части, страниц, Unit / Lesson;
- тип урока и автоматически подобранные этапы + ручное отключение этапов;
- универсальные компетенции и направления функциональной грамотности;
- коммуникативная направленность, дифференциация, виды речевой деятельности;
- обязательная тематическая физкультминутка;
- опциональное аудирование с текстом, заданиями и ключами;
- Google Authentication;
- генерация через Firebase Callable Function → Groq → Qwen 3.8 27B;
- fallback на GPT-OSS 120B;
- 5 полных генераций в сутки на пользователя + 30 точечных доработок;
- редактирование результата, «интереснее / проще / сложнее», перегенерация этапа;
- сохранение и история «Мои конспекты» в Firestore;
- скачивание Word (.docx), Times New Roman 14, интервал 1;
- GitHub Actions для публикации на GitHub Pages.

## 1. Проверить локально

Нужен Node.js 20+.

```bash
npm install
npm run dev
```

## 2. Firebase Authentication

В Firebase Console откройте проект `english-lesson-builder`:

1. **Authentication → Sign-in method → Google → Enable**.
2. В **Authentication → Settings → Authorized domains** добавьте:
   - `lukshaolga1982-ship-it.github.io`
   - `localhost` (обычно уже есть).

## 3. Firestore

Firebase Console → Firestore Database → Create database.

После установки Firebase CLI правила можно развернуть командой:

```bash
npm install -g firebase-tools
firebase login
firebase use english-lesson-builder
firebase deploy --only firestore:rules
```

## 4. Groq API key — НЕ добавлять в GitHub

Ключ хранится только в Google Secret Manager и доступен только Cloud Function.

```bash
firebase functions:secrets:set GROQ_API_KEY
```

CLI попросит ввести ключ. Вставьте его в терминал.

Затем:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

> Для production-развёртывания Cloud Functions Firebase требует подключённый Blaze billing account. Секрет и функции имеют бесплатные квоты, но у проекта должен быть разрешён биллинг. Поставьте budget alerts в Google Cloud Billing.

## 5. GitHub Pages

Загрузите содержимое этой папки в репозиторий:

`https://github.com/lukshaolga1982-ship-it/english-lesson-builder`

В GitHub откройте **Settings → Pages → Source → GitHub Actions**.

После push в `main` workflow `.github/workflows/deploy-pages.yml` соберёт и опубликует сайт.

Ожидаемый адрес:

`https://lukshaolga1982-ship-it.github.io/english-lesson-builder/`

## 6. Как добавить тексты страниц учебников

Генератор умеет автоматически передавать выбранные страницы модели, если они есть в Firestore.

Структура:

```text
textbooks/{bookId}/pages/{pageNumber}
```

Например:

```text
textbooks/demchenko-6-2026/pages/23
```

Документ страницы должен содержать:

```json
{
  "text": "Текст страницы 23..."
}
```

Можно добавлять поля `unit`, `lesson`, `source`, но для генерации достаточно `text`.

Сейчас клиентские правила запрещают пользователям изменять библиотеку учебников. Импорт нужно делать через Firebase Console или отдельный административный скрипт.

## Важно о Firebase Web API key

`apiKey` из web-конфига Firebase не является приватным секретом и по дизайну находится во фронтенде. Доступ к данным защищают Firebase Authentication + Firestore Security Rules. Приватный **Groq API key** во фронтенд никогда не помещается.
