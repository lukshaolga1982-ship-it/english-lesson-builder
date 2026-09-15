import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, History,
  LogIn, LogOut, RefreshCw, Save, Sparkles, WandSparkles, X, Zap,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query,
  serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, googleProvider } from './firebase';
import {
  competencies, defaultStages, extras, lessonTypes, literacies, speechActivities, textbookCatalog,
} from './textbooks';
import { exportLessonDocx } from './exportDocx';
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
  physicalMinute: true,
  previousHomework: '',
  homeworkMode: 'Сгенерировать',
  homework: '',
  format: 'Подробный текст',
  detail: 'Обычный (4–6 страниц)',
};

const STEPS = ['Основа урока', 'Методика', 'Параметры класса', 'Проверка'];

const demoLesson = (f) => ({
  title: `${f.topic || 'Тема урока'}. ${f.leadingActivity}`,
  meta: {
    goal: `К концу урока учащиеся смогут использовать изученный языковой материал по теме «${f.topic || '…'}» в ${f.leadingActivity.toLowerCase()} в соответствии с коммуникативной задачей.`,
    tasks: {
      educational: ['активизировать тематическую лексику и речевые образцы'],
      developmental: ['развивать умение взаимодействовать с партнёром и извлекать необходимую информацию'],
      upbringing: ['формировать ответственное отношение к совместной работе'],
    },
    equipment: ['учебное пособие', 'доска / экран', 'раздаточный материал'],
    forms: ['фронтальная', 'парная', 'индивидуальная'],
    methods: ['коммуникативный', 'частично-поисковый', 'самоконтроль'],
    plannedResults: ['учащиеся выполняют коммуникативную задачу с использованием изученного материала'],
    languageMaterial: f.languageMaterial,
  },
  stages: (defaultStages[f.lessonType] || []).map((name, i) => ({
    id: `demo-${i}`,
    name,
    duration: name === 'Физкультминутка' ? 2 : Math.max(2, Math.round((Number(f.duration) - 2) / Math.max(1, defaultStages[f.lessonType].length - 1))),
    teacher: name === 'Физкультминутка' ? 'Даёт короткие команды на английском языке и демонстрирует движения.' : 'Организует работу, даёт коммуникативную инструкцию на английском языке, при необходимости уточняет её по-русски.',
    students: name === 'Физкультминутка' ? 'Выполняют движения и повторяют языковые единицы.' : 'Выполняют задание индивидуально / в парах, сравнивают ответы и формулируют результат.',
    activities: name === 'Физкультминутка' ? 'Stand up. Stretch up. Turn around. Find a partner and say one word from today’s topic.' : 'Пример задания появится после подключения Cloud Function Groq.',
    forms: name === 'Физкультминутка' ? ['фронтальная'] : ['парная', 'индивидуальная'],
    competencies: ['Коммуникация'],
    literacy: ['Читательская'],
    assessment: 'наблюдение, самопроверка, краткая обратная связь',
    materials: 'учебное пособие / карточки',
  })),
  homework: f.homeworkMode === 'Ввести самостоятельно' ? f.homework : 'Домашнее задание генерируется с учётом содержания урока.',
  listening: { included: false, script: '', tasks: [], answers: [] },
  answerKeys: ['Ключи будут сформированы моделью Groq.'],
  appendices: { worksheet: '', cards: '' },
});

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

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const changeGrade = (grade) => {
    const first = textbookCatalog[grade]?.[0];
    setForm((f) => ({ ...f, grade, textbookId: first?.id || '', customTextbook: '' }));
  };

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
    const payload = { lesson: nextLesson, form: { ...form, enabledStages: stages, textbookLabel: currentBook?.label || form.customTextbook }, updatedAt: serverTimestamp() };
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
      enabledStages: stages,
      duration: Number(form.duration),
      studentCount: Number(form.studentCount),
    };
    try {
      const call = httpsCallable(functions, 'generateLesson', { timeout: 120000 });
      const result = await call(payload);
      setLesson(result.data.lesson);
      setRemaining(result.data.remaining ?? null);
      setLessonId(null);
      await saveLesson(result.data.lesson, true);
      setStep(3);
    } catch (e) {
      console.error(e);
      const msg = e?.message || '';
      if (msg.includes('not-found') || msg.includes('internal') || msg.includes('unavailable')) {
        setLesson(demoLesson(payload));
        setNotice('Показан демонстрационный результат: Cloud Function ещё не развёрнута или Groq Secret не добавлен. После настройки Firebase генерация будет реальной.');
        setStep(3);
      } else setNotice(`Ошибка генерации: ${msg}`);
    } finally { setBusy(false); }
  }

  async function refineStage(index, mode) {
    if (!user || !lesson) return;
    setBusy(true); setNotice('');
    try {
      const call = httpsCallable(functions, 'refineLesson', { timeout: 120000 });
      const result = await call({ mode, stage: lesson.stages[index], lessonContext: { title: lesson.title, meta: lesson.meta }, form });
      const next = structuredClone(lesson);
      next.stages[index] = result.data.stage;
      setLesson(next);
      await saveLesson(next);
    } catch (e) { setNotice(`Не удалось изменить этап: ${e.message}`); }
    finally { setBusy(false); }
  }

  function updateStage(index, key, value) {
    const next = structuredClone(lesson); next.stages[index][key] = value; setLesson(next);
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
        <div><span className="eyebrow"><Sparkles size={14}/> Для учителей Республики Беларусь</span><h1>План-конспект урока<br/><em>за несколько минут</em></h1><p>Выберите класс, учебник и методические параметры. Smart Lesson подготовит структурированный конспект, который можно отредактировать и скачать в Word.</p></div>
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
            <Field label="Тема урока" wide hint={`В документе: ${titlePreview}`}><input className="large-input" value={form.topic} onChange={(e) => update('topic', e.target.value)} placeholder="Например: Моя семья"/></Field>
            <div className="grid two">
              <Field label="Тип урока"><select value={form.lessonType} onChange={(e) => update('lessonType', e.target.value)}>{lessonTypes.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Ведущая речевая деятельность" hint="Автоматически добавляется к теме"><select value={form.leadingActivity} onChange={(e) => { update('leadingActivity', e.target.value); if (!form.speechActivities.includes(e.target.value)) update('speechActivities', [...form.speechActivities, e.target.value]); }}>{speechActivities.map((x) => <option key={x}>{x}</option>)}</select></Field>
            </div>
          </>}

          {step === 1 && <>
            <div className="section-head"><div><span>Шаг 2</span><h2>Методический фокус</h2></div><WandSparkles/></div>
            <h3>Виды речевой деятельности</h3><ChipGroup options={speechActivities} value={form.speechActivities} onChange={(v) => update('speechActivities', v)}/>
            <h3>Языковой материал</h3><ChipGroup options={['Лексика','Грамматика','Фонетика']} value={form.languageMaterial} onChange={(v) => update('languageMaterial', v)}/>
            <h3>Универсальные компетенции</h3><ChipGroup options={competencies} value={form.competencies} onChange={(v) => update('competencies', v)}/>
            <h3>Функциональная грамотность</h3><ChipGroup options={literacies} value={form.literacies} onChange={(v) => update('literacies', v)} priorityNames={literacies.filter(x=>x.priority).map(x=>x.name)}/>
            <h3>Дополнительные направления</h3><ChipGroup options={extras} value={form.extras} onChange={(v) => update('extras', v)}/>
            <div className="grid three spaced">
              <Field label="Коммуникативная направленность"><select value={form.communication} onChange={(e) => update('communication', e.target.value)}><option>Обычная</option><option>Повышенная</option></select></Field>
              <Field label="Дифференциация"><select value={form.differentiation} onChange={(e) => update('differentiation', e.target.value)}><option>Не нужна</option><option>Базовая</option><option>Для сильных и слабых учащихся</option></select></Field>
              <Field label="Подробность"><select value={form.detail} onChange={(e) => update('detail', e.target.value)}><option>Краткий (2–3 страницы)</option><option>Обычный (4–6 страниц)</option><option>Максимально подробный</option></select></Field>
            </div>
            <div className="switch-row"><label><input type="checkbox" checked={form.listening} onChange={(e) => update('listening', e.target.checked)}/><span>Добавить аудирование: текст + задания + ответы</span></label><label className="locked"><input type="checkbox" checked readOnly/><span>Тематическая физкультминутка — обязательно</span></label></div>
            <h3>Этапы урока <small>можно отключить</small></h3>
            <div className="stage-toggles">{defaultStages[form.lessonType].map((s) => <label key={s}><input type="checkbox" checked={stages.includes(s)} onChange={(e) => setStages(e.target.checked ? [...stages, s] : stages.filter(x=>x!==s))}/><span>{s}</span></label>)}</div>
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
            <div className="info-box"><b>Учебник и страницы</b><p>Если страницы выбранного учебника загружены в библиотеку Firestore, модель получит их текст автоматически. Если их ещё нет, генератор использует указанные тему, Unit/Lesson и методические параметры и отметит отсутствие текста страниц в служебном контексте.</p></div>
          </>}

          {step === 3 && !lesson && <>
            <div className="section-head"><div><span>Шаг 4</span><h2>Проверка перед генерацией</h2></div><Sparkles/></div>
            <div className="summary-grid"><div><span>Тема</span><b>{titlePreview}</b></div><div><span>Класс</span><b>{form.grade}, {form.level.toLowerCase()}</b></div><div><span>Урок</span><b>{form.lessonType}</b></div><div><span>Время</span><b>{selectedStageMinutes} минут</b></div><div><span>Учащихся</span><b>{form.studentCount}</b></div><div><span>Этапов</span><b>{stages.length}</b></div></div>
            <div className="summary-long"><b>Компетенции</b><p>{form.competencies.join(', ') || 'Не выбраны'}</p><b>Функциональная грамотность</b><p>{form.literacies.join(', ') || 'Не выбрана'}</p><b>Дополнительно</b><p>{form.extras.join(', ') || 'Нет'}</p></div>
            <button className="generate" disabled={busy} onClick={generate}>{busy ? <RefreshCw className="spin"/> : <Sparkles/>}{busy ? 'Создаю план-конспект…' : 'Создать план-конспект'}</button>
            {!user && <p className="signin-hint">Для генерации нужен вход через Google — так работают история и дневной лимит.</p>}
          </>}

          {step === 3 && lesson && <div className="result">
            <div className="result-toolbar"><div><span className="success"><Check size={15}/> План создан</span><h2>{lesson.title}</h2>{remaining !== null && <small>Осталось полных генераций сегодня: {remaining}</small>}</div><div className="toolbar-actions"><button className="secondary" onClick={() => saveLesson()}><Save size={17}/> Сохранить</button><button className="primary" onClick={exportDocx}><Download size={17}/> Скачать Word</button></div></div>

            <div className="meta-editor">
              <Field label="Цель"><textarea rows={3} value={lesson.meta?.goal || ''} onChange={(e) => setLesson({ ...lesson, meta: { ...lesson.meta, goal: e.target.value } })}/></Field>
              <EditableArray label="Образовательные задачи" items={lesson.meta?.tasks?.educational || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, educational: v } } })}/>
              <EditableArray label="Развивающие задачи" items={lesson.meta?.tasks?.developmental || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, developmental: v } } })}/>
              <EditableArray label="Воспитательные задачи" items={lesson.meta?.tasks?.upbringing || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, upbringing: v } } })}/>
            </div>

            <h3 className="result-title">Ход урока</h3>
            <div className="result-stages">{(lesson.stages || []).map((s, i) => <article className="stage-card" key={s.id || i}>
              <div className="stage-top"><div><span>{String(i + 1).padStart(2,'0')}</span><div><h4>{s.name}</h4><small>{s.duration} мин · {(s.forms || []).join(', ')}</small></div></div><div className="stage-buttons"><button onClick={() => refineStage(i, 'regenerate')} title="Перегенерировать"><RefreshCw size={15}/></button><button onClick={() => refineStage(i, 'interesting')}>Интереснее</button><button onClick={() => refineStage(i, 'simpler')}>Проще</button><button onClick={() => refineStage(i, 'harder')}>Сложнее</button></div></div>
              <div className="stage-edit-grid"><Field label="Деятельность учителя"><textarea rows={4} value={s.teacher || ''} onChange={(e) => updateStage(i,'teacher',e.target.value)}/></Field><Field label="Деятельность учащихся"><textarea rows={4} value={s.students || ''} onChange={(e) => updateStage(i,'students',e.target.value)}/></Field><Field label="Задания / ход работы" wide><textarea rows={5} value={s.activities || ''} onChange={(e) => updateStage(i,'activities',e.target.value)}/></Field></div>
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

    {historyOpen && <div className="drawer-backdrop" onClick={() => setHistoryOpen(false)}><aside className="drawer" onClick={(e)=>e.stopPropagation()}><div className="drawer-head"><div><span>История</span><h2>Мои конспекты</h2></div><button onClick={()=>setHistoryOpen(false)}><X/></button></div>{history.length===0 ? <div className="empty">Пока нет сохранённых конспектов.</div> : history.map((item) => <div className="history-item" key={item.id}><button className="history-open" onClick={() => { setForm({...INITIAL,...item.form}); setStages(item.form?.enabledStages || defaultStages[item.form?.lessonType] || []); setLesson(item.lesson); setLessonId(item.id); setStep(3); setHistoryOpen(false); }}><b>{item.lesson?.title || item.form?.topic}</b><span>{item.form?.grade} класс · {item.form?.date || ''}</span></button><button className="delete" onClick={async()=>{await deleteDoc(doc(db,'users',user.uid,'lessons',item.id)); setHistory(history.filter(x=>x.id!==item.id));}}><X size={15}/></button></div>)}</aside></div>}

    {busy && step===3 && lesson && <div className="busy-overlay"><RefreshCw className="spin"/><span>Обновляю этап…</span></div>}
  </div>;
}
