import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const GROQ_API_KEY = defineSecret('GROQ_API_KEY');
const PRIMARY_MODEL = 'qwen/qwen3.8-27b';
const FALLBACK_MODEL = 'openai/gpt-oss-120b';
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

async function groqJson({ messages, schema, schemaName }) {
  const apiKey = GROQ_API_KEY.value();
  const body = (model) => ({
    model,
    messages,
    temperature: 0.45,
    reasoning_effort: model.startsWith('qwen/') ? 'medium' : 'low',
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  });
  let lastError = '';
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body(model)),
    });
    if (res.ok) {
      const json = await res.json();
      return JSON.parse(json.choices?.[0]?.message?.content || '{}');
    }
    lastError = `${res.status}: ${await res.text()}`;
  }
  console.error('Groq failed', lastError);
  throw new HttpsError('internal', 'Groq не смог сгенерировать ответ. Попробуйте ещё раз.');
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
13. Формат вывода строго соответствует JSON schema.`;
}

export const generateLesson = onCall({ region: 'europe-west1', secrets: [GROQ_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
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

  const lesson = await groqJson({ messages: [{ role:'system', content:systemPrompt() }, { role:'user', content:userPrompt }], schema:lessonSchema, schemaName:'lesson_plan' });
  return { lesson, remaining };
});

export const refineLesson = onCall({ region: 'europe-west1', secrets: [GROQ_API_KEY], timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
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
  const stageOut = await groqJson({ messages:[{role:'system',content:systemPrompt()},{role:'user',content:prompt}], schema:stageSchema, schemaName:'lesson_stage' });
  stageOut.name = stage.name; stageOut.duration = stage.duration; stageOut.id = stage.id;
  return { stage: stageOut };
});
