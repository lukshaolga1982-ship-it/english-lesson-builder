import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, History,
  Link2, LogIn, LogOut, RefreshCw, Save, Sparkles, WandSparkles, X, Zap,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query,
  serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import {
  competencies, defaultStages, extras, lessonTypes, literacies, speechActivities, textbookCatalog,
} from './textbooks';
import { findStageIndexForVariant, isMovementStage, resolveEnabledStages } from './methodology';
import { exportLessonDocx } from './exportDocx';
import { generateLesson, refineLessonStage } from './api';
import './styles.css';

const INITIAL = {
  grade: 6,
  level: 'Повышенный',
  textbookId: 'demchenko-6-2026',
  customTextbook: '',
  part: '1',
  pages: '',
  unit: '',
  lesson: '',
  topic: '',
  duration: 45,
  lessonType: 'Закрепление',
  institution: 'ГУО «Браславская гимназия имени Героя Советского Союза И.Н.Волчкова»',
  teacherName: '',
  date: new Date().toISOString().slice(0, 10),
  studentCount: 14,
  classNotes: '',
  communication: 'Повышенная',
  leadingActivity: 'Диалогическая речь',
  speechActivities: ['Диалогическая речь'],
  languageMaterial: ['Лексика'],
  competencies: ['Коммуникация', 'Кооперация'],
  literacies: ['Информационная', 'Читательская'],
  extras: ['Парная работа', 'Двигательная активность'],
  differentiation: 'Базовая',
  listening: false,
  physicalBreakMode: 'Добавить',
  previousHomework: '',
  homeworkMode: 'Сгенерировать',
  homework: '',
  format: 'Подробный текст',
  detail: 'Обычный (4–6 страниц)',
};

const STEPS = ['Основа урока', 'Методика', 'Параметры класса', 'Проверка'];

function ChipGroup({ options, value, onChange, priorityNames = [] }) {
  const toggle = (item) => onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  return <div className="chips">{options.map((item) => {
    const name = typeof item === 'string' ? item : item.name;
    return <button type="button" key={name} onClick={() => toggle(name)} className={`chip ${value.includes(name) ? 'active' : ''}`}>
      {value.includes(name) && <Check size={14} />} {name} {priorityNames.includes(name) && <span className="priority">приоритет</span>}
    </button>;
  })}</div>;
}

function Field({ label, hint, children, wide = false }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span className="label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function EditableArray({ label, items = [], onChange }) {
  return <div className="editable-block"><b>{label}</b>{items.map((item, i) => <textarea key={i} value={item} rows={2} onChange={(e) => {
    const next = [...items]; next[i] = e.target.value; onChange(next);
  }} />)}</div>;
}

function AlternativeSection({ title, subtitle, items = [], kind, onApply }) {
  if (!items.length) return null;
  return <section className="alternatives-section">
    <div className="alternatives-head"><div><span>Выбор приёма</span><h3>{title}</h3><p>{subtitle}</p></div><Sparkles size={20}/></div>
    <div className="alternative-grid">{items.slice(0, 3).map((item, i) => <article className="alternative-card" key={item.id || `${kind}-${i}`}>
      <div className="alternative-top"><span>{String(i + 1).padStart(2, '0')}</span><div><h4>{item.title}</h4><small>{item.technique || 'Авторский вариант'}{item.duration ? ` · ${item.duration} мин` : ''}</small></div></div>
      {item.rationale && <p className="alternative-why">{item.rationale}</p>}
      <p><b>Ход:</b> {item.activities || item.teacher}</p>
      {item.bridgeToNext && <div className="bridge-preview"><Link2 size={14}/><span>{item.bridgeToNext}</span></div>}
      <button className="secondary alternative-apply" onClick={() => onApply(kind, item)}><Check size={15}/> Применить этот вариант</button>
    </article>)}</div>
  </section>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL);
  const [stages, setStages] = useState(defaultStages[INITIAL.lessonType]);
  const [lesson, setLesson] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [remaining, setRemaining] = useState(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    setStages(defaultStages[form.lessonType]);
  }, [form.lessonType]);

  const books = textbookCatalog[form.grade] || [];
  const currentBook = books.find((b) => b.id === form.textbookId) || books[0];
  const titlePreview = `${form.topic || 'Тема урока'}${form.leadingActivity ? `. ${form.leadingActivity}` : ''}`;
  const selectedStageMinutes = useMemo(() => Number(form.duration), [form.duration]);
  const effectiveStages = useMemo(() => resolveEnabledStages(stages, form), [stages, form.physicalBreakMode]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const changeGrade = (grade) => {
    const first = textbookCatalog[grade]?.[0];
    setForm((f) => ({ ...f, grade, textbookId: first?.id || '', customTextbook: '' }));
  };

  function toggleStage(name, checked) {
    setStages((current) => checked ? [...new Set([...current, name])] : current.filter((x) => x !== name));
    if (isMovementStage(name)) update('physicalBreakMode', checked ? 'Добавить' : 'Не добавлять');
  }

  function changePhysicalBreak(mode) {
    update('physicalBreakMode', mode);
    if (mode === 'Не добавлять') setStages((current) => current.filter((name) => !isMovementStage(name)));
    if (mode === 'Добавить') setStages((current) => resolveEnabledStages(current, { ...form, physicalBreakMode: mode }));
  }

  async function login() {
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { setNotice(`Не удалось войти: ${e.message}`); }
  }

  async function loadHistory() {
    if (!user) return;
    setHistoryOpen(true);
    const q = query(collection(db, 'users', user.uid, 'lessons'), orderBy('updatedAt', 'desc'), limit(30));
    const snap = await getDocs(q);
    setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  async function saveLesson(nextLesson = lesson, newRecord = false) {
    if (!user || !nextLesson) return;
    const payload = {
      lesson: nextLesson,
      form: { ...form, enabledStages: effectiveStages, textbookLabel: currentBook?.label || form.customTextbook },
      updatedAt: serverTimestamp(),
    };
    if (lessonId && !newRecord) {
      await updateDoc(doc(db, 'users', user.uid, 'lessons', lessonId), payload);
      return lessonId;
    }
    const created = await addDoc(collection(db, 'users', user.uid, 'lessons'), { ...payload, createdAt: serverTimestamp() });
    setLessonId(created.id);
    return created.id;
  }

  async function generate() {
    if (!user) { setNotice('Для генерации войдите через Google.'); return; }
    if (!form.topic.trim()) { setNotice('Укажите тему урока.'); setStep(0); return; }
    setBusy(true); setNotice('');
    const payload = {
      ...form,
      textbookLabel: currentBook?.label || form.customTextbook,
      enabledStages: effectiveStages,
      duration: Number(form.duration),
      studentCount: Number(form.studentCount),
    };
    try {
      const result = await generateLesson(user, payload);
      setLesson(result.lesson);
      setRemaining(result.remaining ?? null);
      setLessonId(null);
      await saveLesson(result.lesson, true);
      setStep(3);
    } catch (e) {
      console.error(e);
      const msg = e?.message || 'Неизвестная ошибка';
      if (e?.code === 'DAILY_LIMIT') {
        setRemaining(0);
        setNotice('Лимит: 5 полных генераций на сегодня уже использованы.');
      } else {
        setNotice(`Ошибка генерации: ${msg}`);
      }
    } finally { setBusy(false); }
  }

  async function refineStage(index, mode) {
    if (!user || !lesson) return;
    setBusy(true); setNotice('');
    try {
      const current = lesson.stages[index];
      const result = await refineLessonStage(user, {
        mode,
        stage: current,
        previousStage: lesson.stages[index - 1] || null,
        nextStage: lesson.stages[index + 1] || null,
        lessonContext: { title: lesson.title, meta: lesson.meta, lessonLogic: lesson.lessonLogic },
        form,
      });
      const next = structuredClone(lesson);
      next.stages[index] = { ...result.stage, id: current.id, name: current.name, duration: current.duration };
      setLesson(next);
      await saveLesson(next);
    } catch (e) { setNotice(`Не удалось изменить этап: ${e.message}`); }
    finally { setBusy(false); }
  }

  function updateStage(index, key, value) {
    const next = structuredClone(lesson); next.stages[index][key] = value; setLesson(next);
  }

  async function applyVariant(kind, option) {
    if (!lesson) return;
    const index = findStageIndexForVariant(kind, lesson.stages);
    if (index < 0) {
      setNotice(kind === 'movement'
        ? 'В плане нет этапа двигательной паузы. Включите его в методических параметрах и сгенерируйте урок заново.'
        : 'Не удалось определить этап, к которому относится этот вариант.');
      return;
    }
    const next = structuredClone(lesson);
    const current = next.stages[index];
    next.stages[index] = {
      ...current,
      teacher: option.teacher || current.teacher,
      students: option.students || current.students,
      activities: option.activities || current.activities,
      forms: option.forms?.length ? option.forms : current.forms,
      assessment: option.assessment || current.assessment,
      materials: option.materials || current.materials,
      stageResult: option.stageResult || current.stageResult,
      bridgeToNext: option.bridgeToNext || current.bridgeToNext,
    };
    setLesson(next);
    if (user) await saveLesson(next);
  }

  async function exportDocx() {
    await exportLessonDocx({ lesson, form: { ...form, textbookLabel: currentBook?.label || form.customTextbook }, format: form.format === 'Таблица' ? 'Таблица' : 'Подробный текст' });
  }

  const canNext = step !== 0 || form.topic.trim().length > 0;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">SL</div><div><strong>Smart Lesson</strong><span>конструктор уроков английского языка</span></div></div>
      <nav>
        {user && <button className="ghost" onClick={loadHistory}><History size={17}/> Мои конспекты</button>}
        {user ? <div className="user-box"><span className="avatar">{(user.displayName || user.email || 'U')[0]}</span><span className="user-name">{user.displayName || user.email}</span><button className="icon-btn" onClick={() => signOut(auth)} title="Выйти"><LogOut size={17}/></button></div>
          : <button className="primary small" onClick={login}><LogIn size={17}/> Войти через Google</button>}
      </nav>
    </header>

    <main className="page">
      <section className="hero">
        <div><span className="eyebrow"><Sparkles size={14}/> Для учителей Республики Беларусь</span><h1>План-конспект урока<br/><em>с методической логикой</em></h1><p>Smart Lesson выстраивает задания в последовательность, связывает этапы логическими мостиками и предлагает несколько вариантов начала, двигательной паузы и рефлексии.</p></div>
        <div className="hero-card"><Zap/><strong>Groq + Qwen</strong><span>5 полных генераций в сутки</span>{remaining !== null && <small>Сегодня осталось: {remaining}</small>}</div>
      </section>

      <section className="builder">
        <div className="stepper">{STEPS.map((s, i) => <button key={s} onClick={() => i <= step && setStep(i)} className={`${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}><span>{i < step ? <Check size={16}/> : i + 1}</span><b>{s}</b></button>)}</div>

        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')}><X size={16}/></button></div>}

        <div className="card form-card">
          {step === 0 && <>
            <div className="section-head"><div><span>Шаг 1</span><h2>Основа урока</h2></div><BookOpen/></div>
            <div className="grid three">
              <Field label="Класс"><select value={form.grade} onChange={(e) => changeGrade(Number(e.target.value))}>{[3,4,5,6,7,8,9,10,11].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Уровень"><select value={form.level} onChange={(e) => update('level', e.target.value)}><option>Базовый</option><option>Повышенный</option></select></Field>
              <Field label="Продолжительность"><select value={form.duration} onChange={(e) => update('duration', Number(e.target.value))}><option value={35}>35 минут</option><option value={40}>40 минут</option><option value={45}>45 минут</option></select></Field>
            </div>
            <div className="grid two">
              <Field label="Учебник" wide><select value={form.textbookId} onChange={(e) => update('textbookId', e.target.value)}>{books.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
              {currentBook?.custom && <Field label="Название / авторы учебника"><input value={form.customTextbook} onChange={(e) => update('customTextbook', e.target.value)} placeholder="Например: Английский язык, 10 класс…"/></Field>}
            </div>
            <div className="grid four">
              <Field label="Часть"><input value={form.part} onChange={(e) => update('part', e.target.value)} placeholder="1"/></Field>
              <Field label="Страницы"><input value={form.pages} onChange={(e) => update('pages', e.target.value)} placeholder="23–26"/></Field>
              <Field label="Unit (по желанию)"><input value={form.unit} onChange={(e) => update('unit', e.target.value)} placeholder="Unit 1"/></Field>
              <Field label="Lesson (по желанию)"><input value={form.lesson} onChange={(e) => update('lesson', e.target.value)} placeholder="Lesson 4"/></Field>
            </div>
            <Field label="Тема урока" wide hint={`В документе: ${titlePreview}`}><input className="large-input" value={form.topic} onChange={(e) => update('topic', e.target.value)} placeholder="Например: Mass Media"/></Field>
            <div className="grid two">
              <Field label="Тип урока"><select value={form.lessonType} onChange={(e) => update('lessonType', e.target.value)}>{lessonTypes.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Ведущая речевая деятельность" hint="Определяет кульминационную задачу"><select value={form.leadingActivity} onChange={(e) => { update('leadingActivity', e.target.value); if (!form.speechActivities.includes(e.target.value)) update('speechActivities', [...form.speechActivities, e.target.value]); }}>{speechActivities.map((x) => <option key={x}>{x}</option>)}</select></Field>
            </div>
          </>}

          {step === 1 && <>
            <div className="section-head"><div><span>Шаг 2</span><h2>Методический фокус</h2></div><WandSparkles/></div>
            <div className="methodology-note"><Link2 size={18}/><div><b>Логические мостики включены автоматически</b><p>Результат каждого этапа должен стать основанием для следующего: результат → вопрос/дефицит → следующее действие.</p></div></div>
            <h3>Виды речевой деятельности</h3><ChipGroup options={speechActivities} value={form.speechActivities} onChange={(v) => update('speechActivities', v)}/>
            <h3>Языковой материал</h3><ChipGroup options={['Лексика','Грамматика','Фонетика']} value={form.languageMaterial} onChange={(v) => update('languageMaterial', v)}/>
            <h3>Универсальные компетенции</h3><ChipGroup options={competencies} value={form.competencies} onChange={(v) => update('competencies', v)}/>
            <h3>Функциональная грамотность</h3><ChipGroup options={literacies} value={form.literacies} onChange={(v) => update('literacies', v)} priorityNames={literacies.filter(x=>x.priority).map(x=>x.name)}/>
            <h3>Дополнительные направления</h3><ChipGroup options={extras} value={form.extras} onChange={(v) => update('extras', v)}/>
            <div className="grid four spaced">
              <Field label="Коммуникативная направленность"><select value={form.communication} onChange={(e) => update('communication', e.target.value)}><option>Обычная</option><option>Повышенная</option></select></Field>
              <Field label="Дифференциация"><select value={form.differentiation} onChange={(e) => update('differentiation', e.target.value)}><option>Не нужна</option><option>Базовая</option><option>Для сильных и слабых учащихся</option></select></Field>
              <Field label="Двигательная пауза"><select value={form.physicalBreakMode} onChange={(e) => changePhysicalBreak(e.target.value)}><option>Добавить</option><option>Не добавлять</option></select></Field>
              <Field label="Подробность"><select value={form.detail} onChange={(e) => update('detail', e.target.value)}><option>Краткий (2–3 страницы)</option><option>Обычный (4–6 страниц)</option><option>Максимально подробный</option></select></Field>
            </div>
            <div className="switch-row"><label><input type="checkbox" checked={form.listening} onChange={(e) => update('listening', e.target.checked)}/><span>Добавить аудирование: текст + задания + ответы</span></label><label className="unlocked"><Sparkles size={16}/><span>Генерировать по 3 варианта: начало, пауза, рефлексия</span></label></div>
            <h3>Этапы урока <small>можно отключить</small></h3>
            <div className="stage-toggles">{defaultStages[form.lessonType].map((s) => <label key={s}><input type="checkbox" checked={effectiveStages.includes(s)} onChange={(e) => toggleStage(s, e.target.checked)}/><span>{s}</span></label>)}</div>
          </>}

          {step === 2 && <>
            <div className="section-head"><div><span>Шаг 3</span><h2>Класс и оформление</h2></div><FileText/></div>
            <div className="grid two">
              <Field label="Количество учащихся"><input type="number" min="1" max="40" value={form.studentCount} onChange={(e) => update('studentCount', e.target.value)}/></Field>
              <Field label="Формат конспекта"><select value={form.format} onChange={(e) => update('format', e.target.value)}><option>Подробный текст</option><option>Таблица</option></select></Field>
              <Field label="ФИО учителя"><input value={form.teacherName} onChange={(e) => update('teacherName', e.target.value)} placeholder="Иванова Анна Петровна"/></Field>
              <Field label="Дата"><input type="date" value={form.date} onChange={(e) => update('date', e.target.value)}/></Field>
              <Field label="Учреждение образования" wide><input value={form.institution} onChange={(e) => update('institution', e.target.value)}/></Field>
              <Field label="Особенности класса / пожелания" wide><textarea rows={3} value={form.classNotes} onChange={(e) => update('classNotes', e.target.value)} placeholder="Например: слабая группа; 14 учащихся; без телефонов; больше смены партнёров…"/></Field>
              <Field label="Предыдущее домашнее задание" wide><textarea rows={2} value={form.previousHomework} onChange={(e) => update('previousHomework', e.target.value)} placeholder="Можно оставить пустым"/></Field>
            </div>
            <div className="grid two">
              <Field label="Домашнее задание"><select value={form.homeworkMode} onChange={(e) => update('homeworkMode', e.target.value)}><option>Сгенерировать</option><option>Ввести самостоятельно</option></select></Field>
              {form.homeworkMode === 'Ввести самостоятельно' && <Field label="Текст домашнего задания"><input value={form.homework} onChange={(e) => update('homework', e.target.value)}/></Field>}
            </div>
            <div className="info-box"><b>Учебник и страницы</b><p>Если страницы выбранного учебника загружены в библиотеку Firestore, модель может получить их текст через серверную интеграцию. Если текста страниц нет в запросе, генератору запрещено утверждать, что он видел конкретные упражнения учебника.</p></div>
          </>}

          {step === 3 && !lesson && <>
            <div className="section-head"><div><span>Шаг 4</span><h2>Проверка перед генерацией</h2></div><Sparkles/></div>
            <div className="summary-grid"><div><span>Тема</span><b>{titlePreview}</b></div><div><span>Класс</span><b>{form.grade}, {form.level.toLowerCase()}</b></div><div><span>Урок</span><b>{form.lessonType}</b></div><div><span>Время</span><b>{selectedStageMinutes} минут</b></div><div><span>Учащихся</span><b>{form.studentCount}</b></div><div><span>Этапов</span><b>{effectiveStages.length}</b></div></div>
            <div className="summary-long"><b>Компетенции</b><p>{form.competencies.join(', ') || 'Не выбраны'}</p><b>Функциональная грамотность</b><p>{form.literacies.join(', ') || 'Не выбрана'}</p><b>Дополнительно</b><p>{form.extras.join(', ') || 'Нет'}</p><b>Методическая логика</b><p>Цель → последовательная система упражнений → речевая кульминация → рефлексия по критериям успеха; между этапами — содержательные мостики.</p></div>
            <button className="generate" disabled={busy} onClick={generate}>{busy ? <RefreshCw className="spin"/> : <Sparkles/>}{busy ? 'Создаю и проверяю план…' : 'Создать план-конспект'}</button>
            {!user && <p className="signin-hint">Для генерации нужен вход через Google — так работают история и дневной лимит.</p>}
          </>}

          {step === 3 && lesson && <div className="result">
            <div className="result-toolbar"><div><span className="success"><Check size={15}/> План создан</span><h2>{lesson.title}</h2>{remaining !== null && <small>Осталось полных генераций сегодня: {remaining}</small>}</div><div className="toolbar-actions"><button className="secondary" onClick={() => saveLesson()}><Save size={17}/> Сохранить</button><button className="primary" onClick={exportDocx}><Download size={17}/> Скачать Word</button></div></div>

            <div className="meta-editor">
              <Field label="Цель"><textarea rows={3} value={lesson.meta?.goal || ''} onChange={(e) => setLesson({ ...lesson, meta: { ...lesson.meta, goal: e.target.value } })}/></Field>
              <EditableArray label="Критерии успеха" items={lesson.meta?.successCriteria || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, successCriteria: v } })}/>
              <EditableArray label="Образовательные задачи" items={lesson.meta?.tasks?.educational || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, educational: v } } })}/>
              <EditableArray label="Развивающие задачи" items={lesson.meta?.tasks?.developmental || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, developmental: v } } })}/>
              <EditableArray label="Воспитательные задачи" items={lesson.meta?.tasks?.upbringing || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, upbringing: v } } })}/>
            </div>

            {lesson.lessonLogic && <div className="logic-box"><Link2 size={18}/><div><b>Сквозная логика урока</b><p>{lesson.lessonLogic}</p></div></div>}
            {lesson.methodicalCheck?.summary && <div className="method-check"><div><b>Методическая самопроверка</b><p>{lesson.methodicalCheck.summary}</p></div><span>{lesson.methodicalCheck.timeTotal || selectedStageMinutes} мин</span>{lesson.methodicalCheck.warnings?.length > 0 && <ul>{lesson.methodicalCheck.warnings.map((x, i)=><li key={i}>{x}</li>)}</ul>}</div>}

            <AlternativeSection title="Креативное начало" subtitle="Три разных lead-in, каждый должен естественно запустить основную работу урока." kind="opening" items={lesson.creativeOptions?.opening} onApply={applyVariant}/>
            <AlternativeSection title="Двигательная пауза" subtitle="Короткое движение без разрыва темы; для старших классов — без инфантильности." kind="movement" items={lesson.creativeOptions?.movement} onApply={applyVariant}/>
            <AlternativeSection title="Рефлексия" subtitle="Варианты возвращают учащихся к цели и критериям успеха, а не только к эмоциям." kind="reflection" items={lesson.creativeOptions?.reflection} onApply={applyVariant}/>

            <h3 className="result-title">Ход урока</h3>
            <div className="result-stages">{(lesson.stages || []).map((s, i) => <article className="stage-card" key={s.id || i}>
              <div className="stage-top"><div><span>{String(i + 1).padStart(2,'0')}</span><div><h4>{s.name}</h4><small>{s.duration} мин · {(s.forms || []).join(', ')}</small></div></div><div className="stage-buttons"><button onClick={() => refineStage(i, 'regenerate')} title="Перегенерировать"><RefreshCw size={15}/></button><button onClick={() => refineStage(i, 'interesting')}>Интереснее</button><button onClick={() => refineStage(i, 'simpler')}>Проще</button><button onClick={() => refineStage(i, 'harder')}>Сложнее</button><button onClick={() => refineStage(i, 'bridge')}><Link2 size={13}/> Мостик</button></div></div>
              <div className="stage-edit-grid">
                <Field label="Функция этапа"><textarea rows={2} value={s.purpose || ''} onChange={(e) => updateStage(i,'purpose',e.target.value)}/></Field>
                <Field label="Результат этапа"><textarea rows={2} value={s.stageResult || ''} onChange={(e) => updateStage(i,'stageResult',e.target.value)}/></Field>
                <Field label="Деятельность учителя"><textarea rows={4} value={s.teacher || ''} onChange={(e) => updateStage(i,'teacher',e.target.value)}/></Field>
                <Field label="Деятельность учащихся"><textarea rows={4} value={s.students || ''} onChange={(e) => updateStage(i,'students',e.target.value)}/></Field>
                <Field label="Задания / ход работы" wide><textarea rows={5} value={s.activities || ''} onChange={(e) => updateStage(i,'activities',e.target.value)}/></Field>
                {i < lesson.stages.length - 1 && <Field label="Логический мостик к следующему этапу" wide hint="Результат → вопрос / дефицит → следующее действие"><textarea className="bridge-textarea" rows={3} value={s.bridgeToNext || ''} onChange={(e) => updateStage(i,'bridgeToNext',e.target.value)}/></Field>}
              </div>
              <div className="stage-tags">{(s.competencies || []).map(x=><span key={x}>{x}</span>)}{(s.literacy || []).map(x=><span key={x}>{x}</span>)}</div>
            </article>)}</div>

            {lesson.listening?.included && <div className="appendix"><h3>Аудирование</h3><Field label="Текст для озвучивания"><textarea rows={8} value={lesson.listening.script} onChange={(e)=>setLesson({...lesson,listening:{...lesson.listening,script:e.target.value}})}/></Field><EditableArray label="Задания" items={lesson.listening.tasks} onChange={(v)=>setLesson({...lesson,listening:{...lesson.listening,tasks:v}})}/><EditableArray label="Ответы" items={lesson.listening.answers} onChange={(v)=>setLesson({...lesson,listening:{...lesson.listening,answers:v}})}/></div>}
            <div className="appendix"><h3>Домашнее задание</h3><textarea rows={3} value={lesson.homework || ''} onChange={(e)=>setLesson({...lesson,homework:e.target.value})}/><h3>Ключи для учителя</h3><EditableArray label="Ответы" items={lesson.answerKeys || []} onChange={(v)=>setLesson({...lesson,answerKeys:v})}/></div>
          </div>}

          <div className="nav-buttons">
            <button className="secondary" disabled={step === 0 || busy} onClick={() => { if (step===3 && lesson) setLesson(null); else setStep((s) => Math.max(0, s - 1)); }}><ChevronLeft size={18}/> Назад</button>
            {step < 3 && <button className="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Продолжить <ChevronRight size={18}/></button>}
          </div>
        </div>
      </section>
    </main>

    <footer><div><strong>Smart Lesson</strong><span>© О.В. Лукша · Браславская гимназия имени И.Н.Волчкова</span></div><a href="https://vk.ru/olga.luksha" target="_blank" rel="noreferrer">vk.ru/olga.luksha</a></footer>

    {historyOpen && <div className="drawer-backdrop" onClick={() => setHistoryOpen(false)}><aside className="drawer" onClick={(e)=>e.stopPropagation()}><div className="drawer-head"><div><span>История</span><h2>Мои конспекты</h2></div><button onClick={()=>setHistoryOpen(false)}><X/></button></div>{history.length===0 ? <div className="empty">Пока нет сохранённых конспектов.</div> : history.map((item) => <div className="history-item" key={item.id}><button className="history-open" onClick={() => {
      const restoredForm = { ...INITIAL, ...item.form };
      if (item.form?.physicalMinute === false && !item.form?.physicalBreakMode) restoredForm.physicalBreakMode = 'Не добавлять';
      setForm(restoredForm);
      setStages(item.form?.enabledStages || defaultStages[item.form?.lessonType] || []);
      setLesson(item.lesson); setLessonId(item.id); setStep(3); setHistoryOpen(false);
    }}><b>{item.lesson?.title || item.form?.topic}</b><span>{item.form?.grade} класс · {item.form?.date || ''}</span></button><button className="delete" onClick={async()=>{await deleteDoc(doc(db,'users',user.uid,'lessons',item.id)); setHistory(history.filter(x=>x.id!==item.id));}}><X size={15}/></button></div>)}</aside></div>}

    {busy && step===3 && lesson && <div className="busy-overlay"><RefreshCw className="spin"/><span>Обновляю этап…</span></div>}
  </div>;
}
