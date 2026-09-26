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

    const data = await response.json().catch(() => ({}));

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
      throw new Error(`Браузер не получил ответ от Cloudflare Worker (origin: ${origin}). Проверьте /health. В версии v18 запрос идёт без CORS preflight и с потоковым keep-alive.`);
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
      bridgeToNext: '1–3 естественные реплики учителя, связывающие результат этого этапа со следующим; у последнего этапа пустая строка',
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
"lessonLogic":"", "sourceGrounding":{"textbookUsed":true,"pages":[],"references":[],"summary":""},
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
- Между каждой парой соседних этапов bridgeToNext = результат текущего этапа → вопрос/дефицит → необходимость следующего действия; никаких пустых «переходим дальше».
- Целевая лексика/грамматика проходит от тренировки к речевой задаче. Информация чтения/аудирования используется далее в говорении/письме, если это соответствует цели.
- Рефлексия проверяет цель и successCriteria.
- Сумма duration всех stages строго = ${Number(payload.duration)} минут.
- Используй только enabledStages и сохраняй их логичный порядок.
- Для проверяемых заданий дай ключ/образец.
- creativeOptions.opening: ровно 3 разных lead-in; movement: ровно ${movementCount}; reflection: ровно 3. Варианты короткие, тематические, возрастно уместные и не считаются во время основного урока. ${VARIANT_FIELDS}
- Если contextTrimmed=true, добавь предупреждение в methodicalCheck.warnings и не придумывай пропущенный фрагмент.
- sourceGrounding.textbookUsed=true только если фактический текст выше не пустой; references = 3–8 конкретных опор, реально видимых в тексте.
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
    bridge: 'Сохрани задание, но улучши stageResult и bridgeToNext.',
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
  };
  const prompt = `${modeText} Верни только JSON одного этапа с полями name,duration,purpose,stageResult,teacher,students,activities,forms,competencies,literacy,assessment,materials,answers,bridgeToNext.
Логический мостик: конкретный результат текущего этапа → вопрос/дефицит → следующее действие. Если следующего этапа нет, bridgeToNext="".
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

