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

export function normalizeLesson(raw, form = {}) {
  const data = raw?.lesson || raw || {};
  const objectives = data.objectives || {};
  const meta = data.meta || {};
  const rawStages = data.stages || data.lessonStages || [];

  return {
    title: data.title || `${form.topic || 'Тема урока'}${form.leadingActivity ? `. ${form.leadingActivity}` : ''}`,
    meta: {
      goal: meta.goal || data.goal || '',
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
    stages: rawStages.map(normalizeStage),
    physicalActivity: data.physicalActivity || null,
    homework: typeof data.homework === 'string' ? data.homework : (data.homework?.text || ''),
    listening: data.listening || { included: false, script: '', tasks: [], answers: [] },
    answerKeys: toArray(data.answerKeys || data.keys),
    appendices: data.appendices || { worksheet: '', cards: '' },
    teacherNotes: toArray(data.teacherNotes),
  };
}

export async function generateLesson(user, payload) {
  const prompt = `Сформируй полный план-конспект урока по этим параметрам.\n\n${JSON.stringify(payload, null, 2)}`;
  const data = await apiRequest('/generate', user, { prompt });
  return {
    lesson: normalizeLesson(data.result, payload),
    remaining: data.remaining,
    model: data.model,
  };
}

export async function refineLessonStage(user, { mode, stage, lessonContext, form }) {
  const modeText = {
    regenerate: 'Перегенерируй этот этап полностью, сохранив его место и функцию в уроке.',
    interesting: 'Сделай этот этап заметно интереснее и активнее, без усложнения цели.',
    simpler: 'Сделай этот этап проще и доступнее для учащихся, добавь опоры при необходимости.',
    harder: 'Сделай этот этап сложнее и содержательнее, но реалистично для указанного класса.',
  }[mode] || 'Улучши этот этап.';

  const prompt = `${modeText}\n\nВерни JSON-объект ТОЛЬКО для одного этапа со следующими полями: name, duration, teacher, students, activities, forms, competencies, literacy, assessment, materials, answers.\n\nКонтекст урока:\n${JSON.stringify({ lessonContext, form }, null, 2)}\n\nТекущий этап:\n${JSON.stringify(stage, null, 2)}`;
  const data = await apiRequest('/refine', user, { prompt });
  return {
    stage: normalizeStage(data.result?.stage || data.result),
    remaining: data.remaining,
    model: data.model,
  };
}

export { API_BASE };
