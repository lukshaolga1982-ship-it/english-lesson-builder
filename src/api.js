import { buildMethodologyContext } from './methodology';

const API_BASE = 'https://proud-surf-1244.lukshaolga1982.workers.dev';

async function apiRequest(path, user, body) {
  if (!user) throw new Error('Для генерации нужно войти через Google.');

  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      // text/plain is a CORS-safelisted content type, so the browser does not
      // need a preflight OPTIONS request before calling the Worker.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...body, firebaseToken: token }),
      signal: controller.signal,
      cache: 'no-store',
    });

    // v21: Worker keeps long generations alive with whitespace heartbeats.
    // Reading the response as text is more robust than Response.json() for a
    // streamed body and also lets us surface the real server reply when JSON
    // parsing fails instead of showing the misleading "HTTP 200" message.
    const raw = await response.text();
    const cleaned = String(raw || '').trim();
    let data = null;

    if (cleaned) {
      try {
        data = JSON.parse(cleaned);
      } catch {
        // Heartbeats are whitespace, but defensively extract the outer JSON
        // object in case a proxy/browser inserted harmless text around it.
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try { data = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch {}
        }
      }
    }

    if (!data || typeof data !== 'object') {
      const preview = cleaned.slice(0, 500);
      const err = new Error(preview
        ? `Worker вернул ответ, который сайт не смог разобрать: ${preview}`
        : `Worker вернул пустой ответ (HTTP ${response.status}).`);
      err.code = 'INVALID_WORKER_RESPONSE';
      err.status = response.status;
      err.rawResponse = cleaned;
      throw err;
    }

    if (!response.ok || !data.ok) {
      const err = new Error(data.message || `Ошибка API: HTTP ${response.status}`);
      err.code = data.error;
      err.status = response.status;
      err.details = data;
      throw err;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Генерация заняла слишком много времени. Попробуйте ещё раз.');
    }
    if (error instanceof TypeError && /failed to fetch/i.test(error.message || '')) {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'неизвестный origin';
      throw new Error(`Браузер не получил ответ от Cloudflare Worker (origin: ${origin}). Проверьте /health. В версии v20 запрос идёт без CORS preflight и с потоковым keep-alive.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [String(value)];
}

function normalizeStage(stage, index = 0) {
  return {
    id: stage.id || `stage-${Date.now()}-${index}`,
    name: stage.name || stage.stage || `Этап ${index + 1}`,
    duration: Number(stage.duration ?? stage.minutes ?? 0),
    purpose: stage.purpose || '',
    stageResult: stage.stageResult || stage.result || stage.expectedResult || '',
    bridgeToNext: stage.bridgeToNext || stage.bridge || stage.transition || '',
    teacher: stage.teacher || stage.teacherActivity || '',
    students: stage.students || stage.studentActivity || '',
    activities: stage.activities || stage.activity || stage.task || '',
    forms: toArray(stage.forms),
    competencies: toArray(stage.competencies),
    literacy: toArray(stage.literacy || stage.functionalLiteracy),
    assessment: stage.assessment || '',
    materials: stage.materials || '',
    answers: stage.answers || '',
  };
}

function normalizeVariant(option, index = 0) {
  return {
    id: option?.id || `option-${index}`,
    title: option?.title || option?.name || `Вариант ${index + 1}`,
    technique: option?.technique || option?.method || '',
    duration: Number(option?.duration ?? option?.minutes ?? 0),
    rationale: option?.rationale || option?.why || '',
    teacher: option?.teacher || option?.teacherActivity || '',
    students: option?.students || option?.studentActivity || '',
    activities: option?.activities || option?.activity || option?.task || '',
    forms: toArray(option?.forms),
    assessment: option?.assessment || '',
    materials: option?.materials || '',
    stageResult: option?.stageResult || option?.result || '',
    bridgeToNext: option?.bridgeToNext || option?.bridge || '',
  };
}

function normalizeCreativeOptions(raw = {}) {
  return {
    opening: toArray(raw.opening || raw.openings || raw.start).map(normalizeVariant),
    movement: toArray(raw.movement || raw.movementBreaks || raw.physical).map(normalizeVariant),
    reflection: toArray(raw.reflection || raw.reflections).map(normalizeVariant),
  };
}

function normalizeStoryThread(raw = {}) {
  if (typeof raw === 'string') {
    return { title: '', situation: raw, drivingQuestion: '', finalOutcome: '' };
  }
  return {
    title: raw?.title || raw?.name || '',
    situation: raw?.situation || raw?.frame || raw?.context || '',
    drivingQuestion: raw?.drivingQuestion || raw?.question || '',
    finalOutcome: raw?.finalOutcome || raw?.finalProduct || raw?.outcome || '',
  };
}

export function normalizeWorksheet(raw = {}) {
  const data = raw?.worksheet || raw || {};
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return {
    title: data.title || 'Рабочий лист',
    subtitle: data.subtitle || '',
    studentHeader: data.studentHeader || 'Name: ____________________   Class: ______   Date: __________',
    intro: data.intro || '',
    tasks: tasks.map((task, index) => ({
      number: Number(task?.number ?? index + 1),
      title: task?.title || `Task ${index + 1}`,
      instruction: task?.instruction || '',
      content: task?.content || task?.items || '',
      answerSpaceLines: Math.max(0, Math.min(8, Number(task?.answerSpaceLines ?? task?.lines ?? 0) || 0)),
    })),
    selfCheck: data.selfCheck || '',
    teacherKey: toArray(data.teacherKey || data.answers || data.key),
    teacherNote: data.teacherNote || '',
  };
}

export function normalizeLesson(raw, form = {}) {
  const data = raw?.lesson || raw || {};
  const objectives = data.objectives || {};
  const meta = data.meta || {};
  const rawStages = data.stages || data.lessonStages || [];
  const check = data.methodicalCheck || data.methodologyCheck || {};

  return {
    title: data.title || `${form.topic || 'Тема урока'}${form.leadingActivity ? `. ${form.leadingActivity}` : ''}`,
    meta: {
      goal: meta.goal || data.goal || '',
      successCriteria: toArray(meta.successCriteria || data.successCriteria),
      tasks: {
        educational: toArray(meta.tasks?.educational || objectives.educational),
        developmental: toArray(meta.tasks?.developmental || objectives.developmental),
        upbringing: toArray(
          meta.tasks?.upbringing ||
          objectives.upbringing ||
          objectives['воспитательные'] ||
          objectives[' воспитательные']
        ),
      },
      equipment: toArray(meta.equipment || data.equipment),
      forms: toArray(meta.forms || data.forms),
      methods: toArray(meta.methods || data.methods),
      plannedResults: toArray(meta.plannedResults || data.plannedResults),
      languageMaterial: toArray(meta.languageMaterial || data.languageMaterial || form.languageMaterial),
    },
    lessonLogic: data.lessonLogic || '',
    storyThread: normalizeStoryThread(data.storyThread || data.storyline || data.lessonStory || {}),
    sourceGrounding: {
      textbookUsed: Boolean(data.sourceGrounding?.textbookUsed),
      pages: toArray(data.sourceGrounding?.pages).map((x) => String(x)),
      references: toArray(data.sourceGrounding?.references),
      summary: data.sourceGrounding?.summary || '',
    },
    stages: rawStages.map(normalizeStage),
    creativeOptions: normalizeCreativeOptions(data.creativeOptions || data.alternatives || {}),
    methodicalCheck: {
      summary: check.summary || '',
      strengths: toArray(check.strengths),
      warnings: toArray(check.warnings || check.issues),
      timeTotal: Number(check.timeTotal ?? check.totalMinutes ?? 0),
    },
    physicalActivity: data.physicalActivity || null,
    homework: typeof data.homework === 'string' ? data.homework : (data.homework?.text || ''),
    listening: data.listening || { included: false, script: '', tasks: [], answers: [] },
    answerKeys: toArray(data.answerKeys || data.keys),
    appendices: data.appendices || { worksheet: '', cards: '' },
    teacherNotes: toArray(data.teacherNotes),
  };
}

function lessonJsonContract() {
  return {
    title: 'string',
    meta: {
      goal: 'string — конкретный диагностичный результат урока',
      successCriteria: ['3–5 наблюдаемых can-do / критериев успеха'],
      tasks: {
        educational: ['string'],
        developmental: ['string'],
        upbringing: ['string'],
      },
      equipment: ['string'],
      forms: ['string'],
      methods: ['string'],
      plannedResults: ['string'],
      languageMaterial: ['string'],
    },
    lessonLogic: 'кратко опиши сквозную содержательную логику урока и кульминационную коммуникативную задачу',
    storyThread: {
      title: 'короткое название сквозной сюжетной/коммуникативной линии',
      situation: 'единая тематическая ситуация, которая естественно объединяет этапы урока',
      drivingQuestion: 'главный вопрос/проблема, к которой класс возвращается по ходу урока',
      finalOutcome: 'что учащиеся создают/решают/могут сказать к финалу этой истории',
    },
    sourceGrounding: {
      textbookUsed: 'boolean — true только если в запросе передан фактический текст страниц',
      pages: ['номера реально использованных страниц'],
      references: ['конкретные элементы учебника: номер упражнения/заголовок/тип текста/лексика — только то, что явно видно в переданном тексте'],
      summary: '2–4 предложения: как именно содержание выбранных страниц встроено в урок',
    },
    stages: [{
      id: 'string',
      name: 'точно одно из enabledStages',
      duration: 'integer minutes',
      purpose: 'функция этапа именно в этом уроке',
      stageResult: 'конкретный наблюдаемый результат этапа',
      teacher: 'конкретные действия и ключевые реплики учителя',
      students: 'конкретные действия учащихся',
      activities: 'полный ход задания с инструкцией; без пустых общих фраз',
      forms: ['string'],
      competencies: ['string'],
      literacy: ['string'],
      assessment: 'как проверяется результат',
      materials: 'string',
      answers: 'ключ/образец, если применимо',
      bridgeToNext: '1–3 естественные реплики учителя: продолжение одной тематической истории урока + результат текущего этапа → новый тематический вопрос/дефицит → следующее действие; у последнего этапа пустая строка',
    }],
    creativeOptions: {
      opening: ['ровно 3 объекта варианта по структуре ниже'],
      movement: ['ровно 3 объекта, если двигательная пауза разрешена; иначе []'],
      reflection: ['ровно 3 объекта'],
    },
    methodicalCheck: {
      summary: 'короткий итог проверки',
      strengths: ['string'],
      warnings: ['только реальные ограничения/риски; [] если нет'],
      timeTotal: 'integer — сумма минут этапов',
    },
    homework: 'string',
    listening: { included: 'boolean', script: 'string', tasks: ['string'], answers: ['string'] },
    answerKeys: ['string'],
    appendices: { worksheet: 'string', cards: 'string' },
    teacherNotes: ['string'],
  };
}

function variantContract() {
  return {
    id: 'string',
    title: 'короткое название варианта',
    technique: 'название методического приёма',
    duration: 'integer minutes',
    rationale: 'почему вариант уместен именно здесь',
    teacher: 'действия/реплики учителя',
    students: 'действия учащихся',
    activities: 'полный ход',
    forms: ['string'],
    assessment: 'string',
    materials: 'string',
    stageResult: 'конкретный результат',
    bridgeToNext: 'содержательный мостик к следующему этапу',
  };
}

function compactLessonParams(payload = {}) {
  const keys = [
    'grade','level','textbookLabel','part','pages','unit','lesson','topic','duration','lessonType',
    'studentCount','communication','leadingActivity','speechActivities','languageMaterial',
    'competencies','literacies','extras','differentiation','listening','physicalBreakMode',
    'previousHomework','homeworkMode','homework','classNotes','enabledStages','detail'
  ];
  return keys.reduce((out, key) => {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)) out[key] = value;
    return out;
  }, {});
}

function compactTextbookContext(text = '', maxChars = 14000) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxChars) return { text: normalized, trimmed: false };
  const head = Math.floor(maxChars * 0.82);
  const tail = maxChars - head;
  return {
    text: `${normalized.slice(0, head)}\n\n[...часть текста сокращена из-за лимита API; не придумывай пропущенное...]\n\n${normalized.slice(-tail)}`,
    trimmed: true,
  };
}

function compactSourceInfo(info = {}, trimmed = false) {
  return {
    source: info.source || '',
    sourceName: info.sourceName || '',
    requestedPages: info.requestedPages || [],
    loadedPages: info.loadedPages || [],
    missingPages: info.missingPages || [],
    contextTrimmed: trimmed,
  };
}

const OUTPUT_SCHEMA = `{
"title":"", "meta":{"goal":"","successCriteria":[],"tasks":{"educational":[],"developmental":[],"upbringing":[]},"equipment":[],"forms":[],"methods":[],"plannedResults":[],"languageMaterial":[]},
"lessonLogic":"", "storyThread":{"title":"","situation":"","drivingQuestion":"","finalOutcome":""}, "sourceGrounding":{"textbookUsed":true,"pages":[],"references":[],"summary":""},
"stages":[{"id":"","name":"","duration":0,"purpose":"","stageResult":"","teacher":"","students":"","activities":"","forms":[],"competencies":[],"literacy":[],"assessment":"","materials":"","answers":"","bridgeToNext":""}],
"creativeOptions":{"opening":[],"movement":[],"reflection":[]},
"methodicalCheck":{"summary":"","strengths":[],"warnings":[],"timeTotal":0},
"homework":"", "listening":{"included":false,"script":"","tasks":[],"answers":[]}, "answerKeys":[], "appendices":{"worksheet":"","cards":""}, "teacherNotes":[]
}`;

const VARIANT_FIELDS = 'Каждый объект creativeOptions: {id,title,technique,duration,rationale,teacher,students,activities,forms,assessment,materials,stageResult,bridgeToNext}.';

export async function generateLesson(user, payload) {
  const methodology = buildMethodologyContext(payload, { compact: true });
  const params = compactLessonParams(payload);
  const compactBook = compactTextbookContext(payload.textbookContext || '');
  const source = compactSourceInfo(payload.textbookSourceInfo || {}, compactBook.trimmed);
  const movementCount = payload.physicalBreakMode === 'Не добавлять' ? 0 : 3;

  const prompt = `Создай полный план-конспект урока английского языка для школы Республики Беларусь. Верни только JSON.

ПАРАМЕТРЫ:${JSON.stringify(params)}

ТЕКСТ УЧЕБНИКА (главный источник):\n${compactBook.text || '[не передан]'}

ИСТОЧНИК:${JSON.stringify(source)}

МЕТОДИКА:${JSON.stringify(methodology)}

ОБЯЗАТЕЛЬНО:
- Если текст учебника есть, реально используй его тексты, лексику, грамматику и видимые упражнения; не выдумывай номера/содержание отсутствующих заданий. Авторские задания только развивают материал учебника.
- Каждый этап имеет конкретный stageResult. Его результат используется дальше.
- Сначала придумай ОДНУ сквозную storyThread, строго связанную с темой урока и учебным материалом: ситуация → drivingQuestion → finalOutcome. Это не случайная игра и не отдельные мини-сюжеты. Если теме не подходит ролевая история, используй естественную проблемную/исследовательскую линию.
- Весь урок должен ощущаться как одна история/коммуникативная ситуация: начало запускает storyThread, каждый следующий этап продвигает её, речевая кульминация решает главный вопрос, а рефлексия возвращается к drivingQuestion и finalOutcome.
- Между каждой парой соседних этапов bridgeToNext = тематическое продолжение этой же storyThread + конкретный результат текущего этапа → новый вопрос/дефицит по ТЕМЕ → необходимость следующего действия. Используй лексику, персонажей/объекты, факты или проблему текущей темы. Никаких «теперь перейдём дальше», «а сейчас следующее задание» и никаких мостиков, не связанных с темой.
- Мостик должен звучать как 1–3 естественные реплики учителя, которые можно реально сказать классу. Не объясняй учащимся методическую структуру урока.
- Целевая лексика/грамматика проходит от тренировки к речевой задаче. Информация чтения/аудирования используется далее в говорении/письме, если это соответствует цели.
- Рефлексия проверяет цель и successCriteria.
- Сумма duration всех stages строго = ${Number(payload.duration)} минут.
- Используй только enabledStages и сохраняй их логичный порядок.
- Для проверяемых заданий дай ключ/образец.
- creativeOptions.opening: ровно 3 разных lead-in; movement: ровно ${movementCount}; reflection: ровно 3. Варианты короткие, возрастно уместные и продолжают ту же storyThread, а не создают отдельную тему/историю. ${VARIANT_FIELDS}
- Если contextTrimmed=true, добавь предупреждение в methodicalCheck.warnings и не придумывай пропущенный фрагмент.
- sourceGrounding.textbookUsed=true только если фактический текст выше не пустой; references = 3–8 конкретных опор, реально видимых в тексте.
- appendices.worksheet оставь пустой строкой: рабочий лист генерируется отдельно по кнопке после готового урока.
- Пиши достаточно подробно для работы учителя, но без повторов и методических пояснений ради объёма.

СХЕМА ОТВЕТА:${OUTPUT_SCHEMA}`;

  const data = await apiRequest('/generate', user, { prompt });
  return {
    lesson: normalizeLesson(data.result, payload),
    remaining: data.remaining,
    model: data.model,
    usageSummary: data.usageSummary || null,
  };
}

export async function refineLessonStage(user, { mode, stage, previousStage, nextStage, lessonContext, form, textbookContext = '' }) {
  const modeText = {
    regenerate: 'Перегенерируй этап полностью, сохрани функцию, длительность и место.',
    interesting: 'Сделай этап интереснее и активнее без случайной игры.',
    simpler: 'Сделай этап проще: снизь нагрузку и добавь опоры.',
    harder: 'Сделай этап сложнее: больше самостоятельности, выбора и аргументации.',
    bridge: 'Сохрани задание, но перепиши stageResult и bridgeToNext так, чтобы мостик был частью единой тематической истории урока, а не техническим переходом.',
  }[mode] || 'Улучши этап без изменения его функции.';

  const methodology = buildMethodologyContext({ ...form, enabledStages: [stage?.name].filter(Boolean) }, { compact: true });
  const book = compactTextbookContext(textbookContext, 6500).text;
  const compactContext = {
    topic: lessonContext?.title || form?.topic || '',
    goal: lessonContext?.meta?.goal || '',
    successCriteria: lessonContext?.meta?.successCriteria || [],
    grade: form?.grade,
    level: form?.level,
    leadingActivity: form?.leadingActivity,
    storyThread: lessonContext?.storyThread || {},
  };
  const prompt = `${modeText} Верни только JSON одного этапа с полями name,duration,purpose,stageResult,teacher,students,activities,forms,competencies,literacy,assessment,materials,answers,bridgeToNext.
Логический мостик должен продолжать storyThread урока: используй тему, ситуацию, главный вопрос, факты/лексику текущего материала. Формула: конкретный результат текущего этапа → новый ТЕМАТИЧЕСКИЙ вопрос/дефицит внутри той же истории → следующее действие. Это 1–3 естественные реплики учителя, а не методическое «переходим к...». Если следующего этапа нет, bridgeToNext="".
КОНТЕКСТ:${JSON.stringify(compactContext)}
МЕТОДИКА:${JSON.stringify(methodology)}
УЧЕБНИК:${book || '[не передан]'}
ПРЕДЫДУЩИЙ:${JSON.stringify(previousStage || null)}
ТЕКУЩИЙ:${JSON.stringify(stage)}
СЛЕДУЮЩИЙ:${JSON.stringify(nextStage || null)}`;
  const data = await apiRequest('/refine', user, { prompt });
  return {
    stage: normalizeStage(data.result?.stage || data.result),
    remaining: data.remaining,
    model: data.model,
    usageSummary: data.usageSummary || null,
  };
}

function compactLessonForWorksheet(lesson = {}) {
  return {
    title: lesson.title || '',
    goal: lesson.meta?.goal || '',
    successCriteria: lesson.meta?.successCriteria || [],
    languageMaterial: lesson.meta?.languageMaterial || [],
    lessonLogic: lesson.lessonLogic || '',
    storyThread: lesson.storyThread || {},
    sourceGrounding: lesson.sourceGrounding || {},
    stages: (lesson.stages || []).map((s) => ({
      name: s.name,
      duration: s.duration,
      stageResult: s.stageResult,
      activities: s.activities,
      materials: s.materials,
      answers: s.answers,
      bridgeToNext: s.bridgeToNext,
    })),
    preferredVariants: lesson.preferredVariants || {},
  };
}

export async function generateLessonWorksheet(user, { lesson, form, textbookContext = '', size = 'Обычный (2 страницы)' }) {
  const book = compactTextbookContext(textbookContext, 8000).text;
  const context = compactLessonForWorksheet(lesson);
  const prompt = `Создай печатный рабочий лист учащегося к УЖЕ ГОТОВОМУ уроку английского языка. Верни только JSON.

ПАРАМЕТРЫ КЛАССА:${JSON.stringify({ grade: form?.grade, level: form?.level, topic: form?.topic, pages: form?.pages, differentiation: form?.differentiation, size })}
УРОК:${JSON.stringify(context)}
ТЕКСТ УЧЕБНИКА:${book || '[не передан]'}

ТРЕБОВАНИЯ:
- Рабочий лист должен обслуживать именно этот урок, а не быть отдельным набором случайных упражнений.
- Сохраняй ту же storyThread/коммуникативную ситуацию, drivingQuestion и финальную задачу. Задания листа должны ощущаться как последовательные шаги одной истории.
- Не выдумывай факты/тексты/номера упражнений, которых нет в переданном учебнике или плане.
- Используй целевую лексику и грамматику урока. Не дублируй дословно весь учебник.
- Уровень и объём соответствуют ${form?.grade || ''} классу и уровню ${form?.level || ''}.
- Дай 5–7 заданий для размера «Обычный», 3–4 для «Краткий», 7–9 для «Расширенный».
- Сделай задания разными: понимание/лексика/грамматика/работа с информацией/говорение или подготовка к говорению — только если это соответствует уроку.
- В student-части НЕ показывай ответы. Ответы вынеси только в teacherKey.
- content — готовый для печати текст задания; списки оформляй переносами строк. answerSpaceLines = сколько пустых строк оставить ученику (0–8).
- selfCheck должен возвращать к критериям успеха и главному вопросу истории.

JSON:
{"worksheet":{"title":"","subtitle":"","studentHeader":"Name: ____________________   Class: ______   Date: __________","intro":"","tasks":[{"number":1,"title":"","instruction":"","content":"","answerSpaceLines":0}],"selfCheck":"","teacherKey":[],"teacherNote":""}}`;
  const data = await apiRequest('/refine', user, { prompt });
  return {
    worksheet: normalizeWorksheet(data.result?.worksheet || data.result),
    remaining: data.remaining,
    model: data.model,
    usageSummary: data.usageSummary || null,
  };
}

export async function rewriteLessonStoryBridges(user, { lesson, form, textbookContext = '' }) {
  const book = compactTextbookContext(textbookContext, 6500).text;
  const stages = (lesson?.stages || []).map((s, index) => ({
    index,
    id: s.id || `stage-${index}`,
    name: s.name,
    stageResult: s.stageResult,
    activities: s.activities,
    bridgeToNext: s.bridgeToNext,
  }));
  const prompt = `Перепиши ТОЛЬКО сквозную сюжетно-коммуникативную линию и мостики между этапами уже готового урока. Сами задания, время и порядок этапов не меняй. Верни только JSON.

ТЕМА/ПАРАМЕТРЫ:${JSON.stringify({ topic: form?.topic, grade: form?.grade, level: form?.level, leadingActivity: form?.leadingActivity })}
ЦЕЛЬ:${JSON.stringify(lesson?.meta?.goal || '')}
ТЕКУЩАЯ ЛОГИКА:${JSON.stringify(lesson?.lessonLogic || '')}
ЭТАПЫ:${JSON.stringify(stages)}
УЧЕБНИК:${book || '[не передан]'}

Создай ОДНУ естественную историю/коммуникативную ситуацию, полностью связанную с темой. Если ролевая история неуместна, это может быть единый проблемный вопрос, расследование, выбор, подготовка продукта или последовательное решение реальной коммуникативной задачи.
Каждый bridgeToNext должен:
1) опираться на конкретный результат текущего этапа;
2) продолжать ту же ситуацию и лексику темы;
3) порождать следующий тематический вопрос/дефицит;
4) естественно подводить к уже существующему следующему заданию;
5) звучать как 1–3 реплики учителя, а не как методическое пояснение.
Последний мостик = "". Финал и рефлексия должны закрывать drivingQuestion.

JSON:
{"storyThread":{"title":"","situation":"","drivingQuestion":"","finalOutcome":""},"lessonLogic":"","bridges":[{"index":0,"bridgeToNext":""}]}`;
  const data = await apiRequest('/refine', user, { prompt });
  const result = data.result || {};
  return {
    storyThread: normalizeStoryThread(result.storyThread || result.storyline || {}),
    lessonLogic: result.lessonLogic || lesson?.lessonLogic || '',
    bridges: Array.isArray(result.bridges) ? result.bridges : [],
    remaining: data.remaining,
    model: data.model,
    usageSummary: data.usageSummary || null,
  };
}

