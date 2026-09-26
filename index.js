import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const DASHSCOPE_API_KEY = defineSecret('DASHSCOPE_API_KEY');
const PRIMARY_MODEL = 'qwen3.8-27b';
const ALIBABA_NATIVE_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const FULL_DAILY_LIMIT = 5;
const REFINE_DAILY_LIMIT = 30;

const stageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    duration: { type: 'integer' },
    teacher: { type: 'string' },
    students: { type: 'string' },
    activities: { type: 'string' },
    forms: { type: 'array', items: { type: 'string' } },
    competencies: { type: 'array', items: { type: 'string' } },
    literacy: { type: 'array', items: { type: 'string' } },
    assessment: { type: 'string' },
    materials: { type: 'string' },
  },
  required: ['id','name','duration','teacher','students','activities','forms','competencies','literacy','assessment','materials'],
  additionalProperties: false,
};

const lessonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    meta: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        tasks: {
          type: 'object',
          properties: {
            educational: { type: 'array', items: { type: 'string' } },
            developmental: { type: 'array', items: { type: 'string' } },
            upbringing: { type: 'array', items: { type: 'string' } },
          },
          required: ['educational','developmental','upbringing'], additionalProperties: false,
        },
        equipment: { type: 'array', items: { type: 'string' } },
        forms: { type: 'array', items: { type: 'string' } },
        methods: { type: 'array', items: { type: 'string' } },
        plannedResults: { type: 'array', items: { type: 'string' } },
        languageMaterial: { type: 'array', items: { type: 'string' } },
      },
      required: ['goal','tasks','equipment','forms','methods','plannedResults','languageMaterial'], additionalProperties: false,
    },
    stages: { type: 'array', items: stageSchema },
    homework: { type: 'string' },
    listening: {
      type: 'object',
      properties: {
        included: { type: 'boolean' },
        script: { type: 'string' },
        tasks: { type: 'array', items: { type: 'string' } },
        answers: { type: 'array', items: { type: 'string' } },
      },
      required: ['included','script','tasks','answers'], additionalProperties: false,
    },
    answerKeys: { type: 'array', items: { type: 'string' } },
    appendices: {
      type: 'object',
      properties: { worksheet: { type: 'string' }, cards: { type: 'string' } },
      required: ['worksheet','cards'], additionalProperties: false,
    },
  },
  required: ['title','meta','stages','homework','listening','answerKeys','appendices'],
  additionalProperties: false,
};

function minskDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function consume(uid, kind, max) {
  const ref = db.doc(`usage/${uid}/days/${minskDay()}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.[kind] || 0) : 0;
    if (current >= max) throw new HttpsError('resource-exhausted', `Дневной лимит исчерпан (${max}).`);
    tx.set(ref, { [kind]: current + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return max - current - 1;
  });
}

function parsePages(value) {
  if (!value) return [];
  const out = new Set();
  for (const token of String(value).replace(/–/g,'-').split(/[;, ]+/).filter(Boolean)) {
    if (token.includes('-')) {
      const [a,b] = token.split('-').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) for (let p=Math.min(a,b); p<=Math.max(a,b) && out.size<24; p++) out.add(p);
    } else if (Number.isFinite(Number(token))) out.add(Number(token));
  }
  return [...out].slice(0,24);
}

async function loadTextbookContext(textbookId, pagesString) {
  if (!textbookId || textbookId.startsWith('custom-')) return '';
  const pages = parsePages(pagesString);
  const chunks = [];
  for (const p of pages) {
    const snap = await db.doc(`textbooks/${textbookId}/pages/${p}`).get();
    if (snap.exists) chunks.push(`СТРАНИЦА ${p}:\n${String(snap.data()?.text || '').slice(0,12000)}`);
  }
  return chunks.join('\n\n').slice(0,70000);
}

function extractJsonObject(text) {
  let source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = source.indexOf('{');
  if (first < 0) throw new Error('Qwen не вернул JSON.');
  let depth = 0, inString = false, escaped = false;
  for (let i = first; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(first, i + 1);
  }
  throw new Error('JSON Qwen оборвался.');
}

function nativeMessage(message) {
  const content = Array.isArray(message?.content)
    ? message.content.map((item) => item?.image ? { image: item.image } : { text: String(item?.text ?? item ?? '') })
    : [{ text: String(message?.content ?? '') }];
  return { role: message?.role || 'user', content };
}

function nativeContent(data) {
  const content = data?.output?.choices?.[0]?.message?.content ?? data?.output?.text ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((x) => typeof x === 'string' ? x : (x?.text || '')).filter(Boolean).join('\n');
  return String(content || '');
}

async function alibabaCompletion(messages) {
  const res = await fetch(ALIBABA_NATIVE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_API_KEY.value()}` },
    body: JSON.stringify({
      model: PRIMARY_MODEL,
      input: { messages: messages.map(nativeMessage) },
      parameters: {
        result_format: 'message',
        enable_thinking: false,
        temperature: 0.2,
        max_tokens: 8000,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.code) {
    console.error('Alibaba Model Studio failed', JSON.stringify(data));
    if (res.status === 401 || res.status === 403) throw new HttpsError('internal', 'Alibaba API key отклонён. Проверьте DASHSCOPE_API_KEY и регион ключа.');
    if (res.status === 429) throw new HttpsError('resource-exhausted', 'Alibaba Model Studio временно ограничил частоту запросов. Попробуйте ещё раз через минуту.');
    throw new HttpsError('internal', data?.message || 'Alibaba Qwen не смог сгенерировать ответ. Попробуйте ещё раз.');
  }
  return { ...data, _content: nativeContent(data) };
}

async function alibabaJson({ messages, schema }) {
  const schemaHint = schema ? `\nТребуемая структура JSON: ${JSON.stringify(schema)}` : '';
  const prepared = messages.map((m, index) => index === messages.length - 1
    ? { ...m, content: `${m.content}${schemaHint}\nВерни только один валидный JSON-объект, без markdown и текста вокруг.` }
    : m);

  let response = await alibabaCompletion(prepared);
  let raw = response._content || '';
  try {
    return JSON.parse(extractJsonObject(raw));
  } catch {
    const retry = prepared.map((m, index) => index === prepared.length - 1
      ? { ...m, content: `${m.content}\nПредыдущая попытка была невалидным JSON. Сгенерируй ответ заново целиком, короче, и обязательно закрой все массивы и объекты.` }
      : m);
    response = await alibabaCompletion(retry);
    raw = response._content || '';
    try { return JSON.parse(extractJsonObject(raw)); }
    catch { throw new HttpsError('internal', 'Qwen дважды вернул некорректный JSON. Попробуйте повторить генерацию.'); }
  }
}

function systemPrompt() {
  return `Ты — методист и учитель английского языка Республики Беларусь. Создаёшь методически корректные планы-конспекты для 3–11 классов.\n
ПРАВИЛА:\n
1. План и методические пояснения — на русском языке. Реплики учителя, инструкции учащимся и сами упражнения могут быть на английском языке. Используй British English.\n
2. Цель — конкретная, диагностичная и достижимая за один урок. Не используй пустые формулировки типа «создать условия».\n
3. Строго учитывай возраст, класс, базовый/повышенный уровень, продолжительность, количество учащихся, тип урока и выбранные этапы. Сумма длительности этапов должна быть равна продолжительности урока.\n
4. Физкультминутка обязательна и тематически связана с языковым материалом.\n
5. Выбранные компетенции и виды функциональной грамотности должны проявляться в реальных заданиях, а не только перечисляться. Для каждого релевантного этапа укажи их в соответствующих массивах.\n
6. Коммуникативная направленность означает реальную речь учащихся, информационный разрыв, выбор, мнение, обмен данными, смену партнёров — по возрасту и теме. Минимизируй бессмысленную фронтальную работу.\n
7. Если включено аудирование — создай оригинальный текст подходящей сложности, задания до/во время/после прослушивания и ключи.\n
8. Все задания должны иметь понятную инструкцию; где возможно — английскую формулировку, которую учитель может произнести.\n
9. Обязательно создай ключи/ответы для учителя к закрытым и полуоткрытым заданиям.\n
10. Если дан текст страниц учебника, используй его как основной источник содержания и не придумывай упражнения учебника, которых там нет. Можно добавлять авторские задания, явно интегрируя их в урок.\n
11. Не перегружай урок количеством активностей. Реалистично оцени время.\n
12. Если ведущая деятельность — диалогическая/монологическая речь, аудирование, чтение или письменная речь, она должна определять кульминационную коммуникативную задачу урока.\n
13. Формат вывода — только валидный JSON, строго по переданной структуре.`;
}

export const generateLesson = onCall({ region: 'europe-west1', secrets: [DASHSCOPE_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Нужно войти через Google.');
  const data = request.data || {};
  if (!data.topic || !data.grade || !data.lessonType) throw new HttpsError('invalid-argument', 'Не заполнены обязательные поля.');
  const remaining = await consume(request.auth.uid, 'fullGenerations', FULL_DAILY_LIMIT);
  const textbookContext = await loadTextbookContext(data.textbookId, data.pages);
  const userPrompt = `Составь план-конспект.\n\nПАРАМЕТРЫ:\n${JSON.stringify({
    class: data.grade, level: data.level, topic: data.topic, leadingActivity: data.leadingActivity,
    textbook: data.textbookLabel, part: data.part, pages: data.pages, unit: data.unit, lesson: data.lesson,
    duration: data.duration, lessonType: data.lessonType, enabledStages: data.enabledStages,
    studentCount: data.studentCount, classNotes: data.classNotes, communication: data.communication,
    speechActivities: data.speechActivities, languageMaterial: data.languageMaterial, competencies: data.competencies,
    literacies: data.literacies, extras: data.extras, differentiation: data.differentiation, listening: data.listening,
    previousHomework: data.previousHomework, homeworkMode: data.homeworkMode, homework: data.homework,
    detail: data.detail, format: data.format,
  }, null, 2)}\n\nТЕКСТ ВЫБРАННЫХ СТРАНИЦ УЧЕБНИКА:\n${textbookContext || '[Страницы ещё не загружены в библиотеку Smart Lesson. Не утверждай, что видел их содержание.]'}\n\nНазвание урока должно быть: «${data.topic}. ${data.leadingActivity}».`;

  const lesson = await alibabaJson({ messages: [{ role:'system', content:systemPrompt() }, { role:'user', content:userPrompt }], schema:lessonSchema, schemaName:'lesson_plan' });
  return { lesson, remaining };
});

export const refineLesson = onCall({ region: 'europe-west1', secrets: [DASHSCOPE_API_KEY], timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Нужно войти через Google.');
  await consume(request.auth.uid, 'refinements', REFINE_DAILY_LIMIT);
  const { mode, stage, lessonContext, form } = request.data || {};
  if (!stage) throw new HttpsError('invalid-argument', 'Этап не передан.');
  const instructions = {
    regenerate: 'Перепиши этап с нуля, сохранив его назначение и реалистичное время.',
    interesting: 'Сделай этап заметно более вовлекающим и коммуникативным, но без лишней развлекательности и без телефонов, если это запрещено в пожеланиях.',
    simpler: 'Упрости этап: снизь языковую и когнитивную нагрузку, добавь опоры, сохрани учебную цель.',
    harder: 'Усложни этап для сильных учащихся: добавь выбор, аргументацию, более самостоятельное использование языка, сохрани время.',
  };
  const prompt = `${instructions[mode] || instructions.regenerate}\nКонтекст урока: ${JSON.stringify(lessonContext)}\nПараметры: ${JSON.stringify({grade:form?.grade,level:form?.level,topic:form?.topic,studentCount:form?.studentCount,classNotes:form?.classNotes,competencies:form?.competencies,literacies:form?.literacies})}\nИсходный этап: ${JSON.stringify(stage)}\nВерни один этап. duration и name не меняй без крайней необходимости.`;
  const stageOut = await alibabaJson({ messages:[{role:'system',content:systemPrompt()},{role:'user',content:prompt}], schema:stageSchema, schemaName:'lesson_stage' });
  stageOut.name = stage.name; stageOut.duration = stage.duration; stageOut.id = stage.id;
  return { stage: stageOut };
});
