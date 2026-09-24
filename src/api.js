import { buildMethodologyContext } from './methodology';

const API_BASE = 'https://proud-surf-1244.lukshaolga1982.workers.dev';

async function apiRequest(path, user, body) {
  if (!user) throw new Error('Для генерации нужно войти через Google.');

  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
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

export async function generateLesson(user, payload) {
  const methodology = buildMethodologyContext(payload);
  const contract = lessonJsonContract();
  const { textbookContext = '', textbookSourceInfo = {}, ...lessonParams } = payload;
  contract.creativeOptions.opening = [variantContract(), variantContract(), variantContract()];
  contract.creativeOptions.movement = payload.physicalBreakMode === 'Не добавлять'
    ? []
    : [variantContract(), variantContract(), variantContract()];
  contract.creativeOptions.reflection = [variantContract(), variantContract(), variantContract()];

  const prompt = `
Сформируй полный методически грамотный план-конспект урока английского языка.

ПАРАМЕТРЫ УРОКА:
${JSON.stringify(lessonParams, null, 2)}

ТЕКСТ ВЫБРАННЫХ СТРАНИЦ УЧЕБНИКА — ОСНОВНОЙ ИСТОЧНИК СОДЕРЖАНИЯ:
${textbookContext || '[Текст страниц не передан]'}

ИНФОРМАЦИЯ ОБ ИСТОЧНИКЕ:
${JSON.stringify(textbookSourceInfo, null, 2)}

ПРАВИЛА ОПОРЫ НА УЧЕБНИК:
1. Если текст страниц передан, сначала проанализируй ЕГО, а уже потом проектируй урок.
2. Используй содержание, тексты, диалоги, лексику, грамматические явления, формулировки заданий и упражнения с этих страниц как основу урока.
3. Не заменяй материал учебника на полностью авторский набор заданий. Авторские задания можно добавлять только как логичное развитие материала учебника.
4. Если в тексте явно видны номера упражнений, заголовки, вопросы или речевые образцы — ссылайся на них точно. Не придумывай номера упражнений, которых нет в источнике.
5. Если на страницах есть текст для чтения/диалог/таблица/иллюстративная подпись, используй извлечённую из них информацию на последующих этапах и в речевой кульминации.
6. Если выбранная учителем тема расходится с фактическим содержанием страниц, не игнорируй расхождение: укажи его в methodicalCheck.warnings и построй план вокруг реально переданного содержания настолько, насколько это возможно.
7. sourceGrounding.textbookUsed = true только при наличии фактического текста страниц. В references перечисли 3–8 конкретных опор из источника.

МЕТОДИЧЕСКОЕ ЯДРО (обязательные правила генерации):
${JSON.stringify(methodology, null, 2)}

КРИТИЧЕСКИ ВАЖНО ПРО ЛОГИКУ УРОКА:
1. Не составляй набор независимых активностей. Урок должен разворачиваться как одна последовательность.
2. Каждый stageResult должен реально использоваться далее: как языковая опора, содержательная информация, вопрос, решение или материал для следующего задания.
3. Между КАЖДЫМИ двумя соседними этапами создай bridgeToNext. Запрещены пустые связки типа «Now let's do the next task» без содержательной причины.
4. Хороший мостик: «что мы только что выяснили/сделали → какой вопрос или дефицит появился → зачем нужно следующее действие».
5. Новая лексика/грамматика не должна исчезать после тренировки — она должна понадобиться в последующей речевой задаче.
6. Если есть чтение/аудирование, информация из текста должна использоваться в последующем говорении/письме, если это соответствует цели.
7. Рефлексия возвращается к цели и successCriteria урока; минимум два варианта рефлексии должны проверять учебный прогресс, а не только настроение.

КРЕАТИВНЫЕ ВАРИАНТЫ:
- creativeOptions.opening: ровно 3 действительно разных начала урока; каждое является lead-in и логически запускает основной урок. Не делай три косметических варианта одного приёма.
- creativeOptions.movement: ровно 3 коротких варианта 1–3 минуты, если пауза разрешена. Должно быть реальное движение + простой тематический язык. Для 9–11 классов избегай детских «потянулись-зайчики».
- creativeOptions.reflection: ровно 3 разных способа; связывай с successCriteria и конкретным результатом урока.
- Используй загруженный банк приёмов как источник идей, но адаптируй каждый приём под тему, возраст и конкретную цель.

ПОСЛЕДОВАТЕЛЬНОСТЬ УПРАЖНЕНИЙ:
- соблюдай методическую динамику и нужный путь для выбранного ведущего вида речевой деятельности;
- не перепрыгивай от предъявления прямо к сложной свободной речи, если учащимся нужны опоры/тренировка;
- одновременно не перегружай урок лишними промежуточными упражнениями;
- кульминация урока — осмысленная речевая/коммуникативная задача, соответствующая ведущей деятельности.

ФИНАЛЬНАЯ САМОПРОВЕРКА ПЕРЕД ОТВЕТОМ:
- все этапы нужны для цели;
- каждый переход содержательно объясним;
- stageResult каждого этапа конкретен;
- мостики ссылаются на фактическое содержание соседних заданий;
- сумма duration строго равна ${Number(payload.duration)};
- задания реалистичны для ${payload.grade} класса и уровня «${payload.level}»;
- выбранные компетенции/грамотности проявляются в действиях учащихся;
- если текст страниц передан, минимум половина содержательно значимых этапов реально использует материал этих страниц;
- sourceGrounding подтверждает конкретно, что именно взято из учебника;
- нет выдуманных утверждений о содержании страниц учебника, если сам текст страниц в запросе не передан.

ВЕРНИ ТОЛЬКО ОДИН JSON-ОБЪЕКТ ТОЧНО ТАКОЙ СТРУКТУРЫ:
${JSON.stringify(contract, null, 2)}
`;

  const data = await apiRequest('/generate', user, { prompt });
  return {
    lesson: normalizeLesson(data.result, payload),
    remaining: data.remaining,
    model: data.model,
  };
}

export async function refineLessonStage(user, { mode, stage, previousStage, nextStage, lessonContext, form, textbookContext = '' }) {
  const modeText = {
    regenerate: 'Перегенерируй этот этап полностью, сохранив его место, функцию, длительность и связь с соседними этапами.',
    interesting: 'Сделай этот этап заметно интереснее и активнее, но не превращай его в случайную игру и не ломай логику урока.',
    simpler: 'Сделай этот этап проще и доступнее: снизь языковую/когнитивную нагрузку, добавь опоры, сохрани учебный результат.',
    harder: 'Сделай этот этап сложнее и содержательнее: больше самостоятельности, выбора и аргументации, но реалистично для класса.',
    bridge: 'Сохрани само задание, но перепиши stageResult и bridgeToNext так, чтобы переход к следующему этапу был содержательным и естественным.',
  }[mode] || 'Улучши этот этап, сохранив его методическую функцию.';

  const methodology = buildMethodologyContext({ ...form, enabledStages: [stage?.name].filter(Boolean) });
  const prompt = `${modeText}

ОБЯЗАТЕЛЬНО: логический мостик строится как «результат текущего этапа → вопрос/дефицит → необходимость следующего действия». Не используй формальный переход без связи с содержанием.

Верни JSON-объект ТОЛЬКО для одного этапа с полями: name, duration, purpose, stageResult, teacher, students, activities, forms, competencies, literacy, assessment, materials, answers, bridgeToNext.

Контекст урока:
${JSON.stringify({ lessonContext, form, methodology }, null, 2)}

Фактический текст выбранных страниц учебника (если есть):
${textbookContext || '[не передан]'}

Если текст учебника передан, не отрывай улучшенный этап от него и не заменяй фактическое содержание выдуманным материалом.

Предыдущий этап:
${JSON.stringify(previousStage || null, null, 2)}

Текущий этап:
${JSON.stringify(stage, null, 2)}

Следующий этап:
${JSON.stringify(nextStage || null, null, 2)}

Если следующего этапа нет, bridgeToNext должен быть пустой строкой.`;
  const data = await apiRequest('/refine', user, { prompt });
  return {
    stage: normalizeStage(data.result?.stage || data.result),
    remaining: data.remaining,
    model: data.model,
  };
}
