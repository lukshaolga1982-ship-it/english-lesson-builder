import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Camera, Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, FileUp, History,
  ImagePlus, Link2, LogIn, LogOut, RefreshCw, Save, Sparkles, Star, Upload, WandSparkles, X, Zap,
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
import { exportLessonDocx, exportWorksheetDocx } from './exportDocx';
import { generateLesson, refineLessonStage, generateLessonWorksheet, rewriteLessonStoryBridges } from './api';
import {
  buildTextbookCacheId, loadTextbookPagesFromFirestore, manualTextbookContext,
  obtainTextbookPagesAutomatically, obtainTextbookPagesFromImages, obtainTextbookPagesFromUploadedPdf, parsePageNumbers,
  saveTextbookPageCalibration,
} from './textbookSource';
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
const E_PADRUCHNIK_URL = 'https://e-padruchnik.adu.by/';

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

function AlternativeSection({ title, subtitle, items = [], kind, onApply, onFavorite, selectedKey }) {
  if (!items.length) return null;
  return <section className="alternatives-section">
    <div className="alternatives-head"><div><span>Выбор приёма</span><h3>{title}</h3><p>{subtitle}</p></div><Sparkles size={20}/></div>
    <div className="alternative-grid">{items.slice(0, 3).map((item, i) => {
      const optionKey = item.id || `${kind}-${i}`;
      const selected = selectedKey === optionKey;
      return <article className={`alternative-card ${selected ? 'selected' : ''}`} key={optionKey}>
        <div className="alternative-top-row">
          <div className="alternative-top"><span>{String(i + 1).padStart(2, '0')}</span><div><h4>{item.title}</h4><small>{item.technique || 'Авторский вариант'}{item.duration ? ` · ${item.duration} мин` : ''}</small></div></div>
          <button type="button" className={`alternative-favorite ${selected ? 'selected' : ''}`} onClick={() => onFavorite(kind, optionKey, item)} title={selected ? 'Снять отметку' : 'Отметить понравившийся вариант'}>
            <Star size={16} fill={selected ? 'currentColor' : 'none'}/>
          </button>
        </div>
        {selected && <div className="alternative-selected-label"><Star size={12} fill="currentColor"/> Выбранный вариант</div>}
        {item.rationale && <p className="alternative-why">{item.rationale}</p>}
        <p><b>Ход:</b> {item.activities || item.teacher}</p>
        {item.bridgeToNext && <div className="bridge-preview"><Link2 size={14}/><span>{item.bridgeToNext}</span></div>}
        <button className={`secondary alternative-apply ${selected ? 'selected' : ''}`} onClick={() => onApply(kind, item, optionKey)}><Check size={15}/> {selected ? 'Применить выбранный вариант' : 'Применить этот вариант'}</button>
      </article>;
    })}</div>
  </section>;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('ru-RU').format(Number(value));
}

function formatUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  if (Number(value) < 0.01) return `< $0.01`;
  return `$${Number(value).toFixed(3)}`;
}

function operationLabel(operation) {
  if (operation === 'ocr') return 'OCR страниц';
  if (operation === 'refine') return 'Точечная правка';
  return 'Генерация плана';
}

function UsageSummaryCard({ usage }) {
  if (!usage) return null;
  return <div className="usage-card">
    <div className="usage-head">
      <div>
        <span>Токены и стоимость</span>
        <b>{operationLabel(usage.operation)}</b>
      </div>
      <small>{usage.model || 'Qwen'}</small>
    </div>
    <div className="usage-grid">
      <div><span>Input</span><b>{formatNumber(usage.promptTokens)}</b></div>
      <div><span>Output</span><b>{formatNumber(usage.completionTokens)}</b></div>
      <div><span>Всего</span><b>{formatNumber(usage.totalTokens)}</b></div>
      <div><span>Стоимость</span><b>{formatUsd(usage.estimatedCost?.total)}</b></div>
    </div>
    {usage.estimatedCost && <p>≈ {formatUsd(usage.estimatedCost?.input)} input + {formatUsd(usage.estimatedCost?.output)} output</p>}
  </div>;
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
  const [manualTextbookText, setManualTextbookText] = useState('');
  const [textbookSourceStatus, setTextbookSourceStatus] = useState({ state: 'idle', message: '' });
  const [activeTextbookContext, setActiveTextbookContext] = useState('');
  const [uploadedPageImages, setUploadedPageImages] = useState([]);
  const [uploadedPdfFile, setUploadedPdfFile] = useState(null);
  const [uploadedTextbookSource, setUploadedTextbookSource] = useState(null);
  const [usageSummary, setUsageSummary] = useState(null);
  const [worksheetBusy, setWorksheetBusy] = useState(false);
  const [storyBusy, setStoryBusy] = useState(false);
  const [worksheetSize, setWorksheetSize] = useState('Обычный (2 страницы)');
  const [pageCalibrationRequest, setPageCalibrationRequest] = useState(null);
  const [calibrationPrintedPage, setCalibrationPrintedPage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    setStages(defaultStages[form.lessonType]);
  }, [form.lessonType]);

  const books = textbookCatalog[form.grade] || [];
  const currentBook = books.find((b) => b.id === form.textbookId) || books[0];
  const titlePreview = `${form.topic || 'Тема урока'}${form.leadingActivity ? `. ${form.leadingActivity}` : ''}`;
  const selectedStageMinutes = useMemo(() => Number(form.duration), [form.duration]);
  const effectiveStages = useMemo(() => resolveEnabledStages(stages, form), [stages, form.physicalBreakMode]);
  const textbookCacheId = useMemo(() => buildTextbookCacheId(form.textbookId, form.customTextbook || currentBook?.label || ''), [form.textbookId, form.customTextbook, currentBook?.label]);
  const sourceSignature = `${textbookCacheId}|${form.part || '1'}|${String(form.pages || '').trim()}`;

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const clearProcessedTextbookSource = () => {
    setUploadedTextbookSource(null);
    setActiveTextbookContext('');
    setPageCalibrationRequest(null);
    setCalibrationPrintedPage('');
    setTextbookSourceStatus({ state: 'idle', message: '' });
  };

  const changeGrade = (grade) => {
    const first = textbookCatalog[grade]?.[0];
    setManualTextbookText('');
    setActiveTextbookContext('');
    setUploadedTextbookSource(null);
    setUploadedPageImages([]);
    setUploadedPdfFile(null);
    setPageCalibrationRequest(null);
    setCalibrationPrintedPage('');
    setTextbookSourceStatus({ state: 'idle', message: '' });
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

  function showCalibrationRequest(error) {
    const calibration = error?.calibration || null;
    if (!calibration) return false;
    setPageCalibrationRequest(calibration);
    setCalibrationPrintedPage('');
    setActiveTextbookContext('');
    setTextbookSourceStatus({
      state: 'calibration',
      message: `Нужно один раз привязать нумерацию этой части учебника. На превью показана PDF-страница ${calibration.pdfPage}; введите напечатанный на ней номер страницы.`,
    });
    return true;
  }

  async function confirmPageCalibration() {
    if (!user || !pageCalibrationRequest) return;
    const printedPage = Number(calibrationPrintedPage);
    if (!Number.isFinite(printedPage) || printedPage < 1) {
      setNotice('Введите напечатанный номер страницы с превью.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await saveTextbookPageCalibration({
        db,
        user,
        textbookId: pageCalibrationRequest.textbookId || textbookCacheId,
        part: pageCalibrationRequest.part || form.part || '1',
        pdfPage: pageCalibrationRequest.pdfPage,
        printedPage,
        sourceKey: pageCalibrationRequest.sourceKey || '',
        sourceName: pageCalibrationRequest.sourceName || '',
        mode: 'manual',
      });
      const origin = pageCalibrationRequest.origin || 'automatic';
      setPageCalibrationRequest(null);
      setCalibrationPrintedPage('');
      setTextbookSourceStatus({ state: 'checking', message: 'Привязка сохранена. Повторно читаю нужные страницы…' });
      if (origin === 'uploaded-pdf' && uploadedPdfFile) await processUploadedPdf();
      else await resolveTextbookSource({ strict: false });
    } catch (error) {
      setNotice(`Не удалось сохранить привязку: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  async function resolveTextbookSource({ strict = false } = {}) {
    const requestedPages = parsePageNumbers(form.pages);

    if (!requestedPages.length) {
      setTextbookSourceStatus({ state: 'neutral', message: 'Страницы не указаны — урок будет строиться без опоры на конкретный разворот учебника.' });
      setActiveTextbookContext('');
      return { text: '', requestedPages: [], loadedPages: [], missingPages: [], source: 'none' };
    }

    if (manualTextbookText.trim()) {
      const manual = manualTextbookContext(manualTextbookText, form.pages);
      setTextbookSourceStatus({ state: 'ready', message: `Используется текст, вставленный вручную, для стр. ${form.pages}.` });
      setActiveTextbookContext(manual.text);
      return manual;
    }

    if (uploadedTextbookSource?.signature === sourceSignature && uploadedTextbookSource?.text) {
      setTextbookSourceStatus({ state: 'ready', message: uploadedTextbookSource.message || `Используется загруженный материал для стр. ${form.pages}.` });
      setActiveTextbookContext(uploadedTextbookSource.text);
      return uploadedTextbookSource;
    }

    if (user) {
      const cached = await loadTextbookPagesFromFirestore(db, textbookCacheId, form.pages, { uid: user.uid, part: form.part || '1' });
      if (cached.text && cached.missingPages.length === 0) {
        const ready = { ...cached, source: 'cache', sourceName: cached.sourceName || 'Сохранённые страницы' };
        setTextbookSourceStatus({ state: 'ready', message: `Стр. ${ready.loadedPages.join(', ')} уже сохранены в вашем кэше — можно генерировать урок.` });
        setActiveTextbookContext(ready.text);
        return ready;
      }
    }

    if (currentBook?.custom) {
      const message = 'Для этого учебника загрузите PDF целиком или фото нужных страниц ниже. После распознавания текст сохранится в вашем личном кэше.';
      setTextbookSourceStatus({ state: 'missing', message });
      if (strict) throw new Error(message);
      return { text: '', requestedPages, loadedPages: [], missingPages: requestedPages, source: 'custom' };
    }

    if (!user) {
      const message = 'Чтобы получить страницы автоматически, сначала войдите через Google.';
      setTextbookSourceStatus({ state: 'missing', message });
      if (strict) throw new Error(message);
      return { text: '', requestedPages, loadedPages: [], missingPages: requestedPages, source: 'automatic' };
    }

    setTextbookSourceStatus({ state: 'checking', message: 'Проверяю кэш и библиотеку Firebase Storage…' });
    try {
      const loaded = await obtainTextbookPagesAutomatically({
        db,
        user,
        textbookId: form.textbookId,
        part: form.part || '1',
        pagesString: form.pages,
        onProgress: (message) => setTextbookSourceStatus({ state: 'checking', message }),
      });

      if (loaded.text && loaded.missingPages.length === 0) {
        const sourceLabel = loaded.sourceName ? ` Источник: ${loaded.sourceName}.` : '';
        const cacheLabel = loaded.source === 'cache' ? ' Страницы уже были сохранены — повторная загрузка не потребовалась.' : ' Текст сохранён в вашем кэше Firestore для следующих уроков.';
        setTextbookSourceStatus({ state: 'ready', message: `Готово: стр. ${loaded.loadedPages.join(', ')}.${sourceLabel}${cacheLabel}` });
        setActiveTextbookContext(loaded.text);
        return loaded;
      }

      throw new Error(`Не удалось получить стр. ${loaded.missingPages.join(', ') || form.pages}.`);
    } catch (error) {
      setActiveTextbookContext('');
      if (error?.code === 'PAGE_CALIBRATION_REQUIRED' && showCalibrationRequest(error)) {
        if (strict) throw error;
        return { text: '', requestedPages, loadedPages: [], missingPages: requestedPages, source: 'calibration' };
      }
      const message = error?.message || 'Не удалось автоматически получить страницы учебника.';
      setTextbookSourceStatus({ state: 'missing', message });
      if (strict) throw error;
      return { text: '', requestedPages, loadedPages: [], missingPages: requestedPages, source: 'automatic' };
    }
  }

  async function checkTextbookSource() {
    try {
      await resolveTextbookSource({ strict: false });
    } catch (error) {
      setTextbookSourceStatus({ state: 'missing', message: error.message });
    }
  }

  async function processPageImages() {
    if (!user) { setNotice('Сначала войдите через Google.'); return; }
    if (!form.pages.trim()) { setNotice('Сначала укажите номера страниц, которые вы загрузили.'); return; }
    if (!uploadedPageImages.length) { setNotice('Выберите фото страниц.'); return; }
    setTextbookSourceStatus({ state: 'checking', message: 'Подготавливаю фото страниц…' });
    setNotice('');
    try {
      const loaded = await obtainTextbookPagesFromImages({
        db, user, textbookId: textbookCacheId, part: form.part || '1', pagesString: form.pages, files: uploadedPageImages,
        onProgress: (message) => setTextbookSourceStatus({ state: 'checking', message }),
      });
      const message = `Фото распознаны. Используются стр. ${form.pages}. ${loaded.source === 'uploaded-images' ? 'Текст готов для генерации и, где возможно, сохранён в Firestore.' : ''}`;
      const ready = { ...loaded, signature: sourceSignature, message };
      setUploadedTextbookSource(ready);
      setActiveTextbookContext(loaded.text);
      setManualTextbookText('');
      setPageCalibrationRequest(null);
      setCalibrationPrintedPage('');
      setTextbookSourceStatus({ state: 'ready', message });
    } catch (error) {
      setTextbookSourceStatus({ state: 'missing', message: error?.message || 'Не удалось распознать фото страниц.' });
    }
  }

  async function processUploadedPdf() {
    if (!user) { setNotice('Сначала войдите через Google.'); return; }
    if (!form.pages.trim()) { setNotice('Сначала укажите печатные страницы, которые нужны для урока.'); return; }
    if (!uploadedPdfFile) { setNotice('Выберите PDF учебника.'); return; }
    setTextbookSourceStatus({ state: 'checking', message: `Открываю ${uploadedPdfFile.name}…` });
    setNotice('');
    try {
      const loaded = await obtainTextbookPagesFromUploadedPdf({
        db, user, textbookId: textbookCacheId, part: form.part || '1', pagesString: form.pages, file: uploadedPdfFile,
        onProgress: (message) => setTextbookSourceStatus({ state: 'checking', message }),
      });
      const message = `PDF обработан: стр. ${loaded.loadedPages.join(', ')}. Текст сохранён в вашем кэше Firestore.`;
      const ready = { ...loaded, signature: sourceSignature, message };
      setUploadedTextbookSource(ready);
      setActiveTextbookContext(loaded.text);
      setManualTextbookText('');
      setPageCalibrationRequest(null);
      setCalibrationPrintedPage('');
      setTextbookSourceStatus({ state: 'ready', message });
    } catch (error) {
      if (error?.code === 'PAGE_CALIBRATION_REQUIRED' && showCalibrationRequest(error)) return;
      setTextbookSourceStatus({ state: 'missing', message: error?.message || 'Не удалось прочитать PDF учебника.' });
    }
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
    try {
      const source = await resolveTextbookSource({ strict: Boolean(form.pages.trim()) });
      const payload = {
        ...form,
        textbookLabel: currentBook?.label || form.customTextbook,
        enabledStages: effectiveStages,
        duration: Number(form.duration),
        studentCount: Number(form.studentCount),
        textbookContext: source.text,
        textbookSourceInfo: {
          source: source.source,
          sourceName: source.sourceName || '',
          sourceType: source.sourceType || '',
          sourceUrl: source.sourceUrl || '',
          requestedPages: source.requestedPages,
          loadedPages: source.loadedPages,
          missingPages: source.missingPages,
        },
      };
      const result = await generateLesson(user, payload);
      setLesson(result.lesson);
      setRemaining(result.remaining ?? null);
      setUsageSummary(result.usageSummary ?? null);
      setLessonId(null);
      await saveLesson(result.lesson, true);
      setStep(3);
    } catch (e) {
      console.error(e);
      const msg = e?.message || 'Неизвестная ошибка';
      if (e?.code === 'DAILY_LIMIT') {
        setRemaining(0);
        setNotice('Лимит: 5 полных генераций на сегодня уже использованы.');
      } else if (e?.code === 'PAGE_CALIBRATION_REQUIRED') {
        setStep(0);
        setNotice('Нужно один раз сопоставить нумерацию PDF и печатных страниц. Я открыла форму привязки на первом шаге.');
      } else if (/tokens per minute|\bTPM\b|Request too large for model/i.test(msg)) {
        setNotice('Alibaba Qwen отклонил запрос из-за лимита или размера. Попробуйте ещё раз через минуту; если ошибка повторится, уменьшите количество страниц учебника в одной генерации.');
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
        lessonContext: { title: lesson.title, meta: lesson.meta, lessonLogic: lesson.lessonLogic, storyThread: lesson.storyThread },
        form,
        textbookContext: activeTextbookContext,
      });
      const next = structuredClone(lesson);
      next.stages[index] = { ...result.stage, id: current.id, name: current.name, duration: current.duration };
      setLesson(next);
      setUsageSummary(result.usageSummary ?? null);
      await saveLesson(next);
    } catch (e) { setNotice(`Не удалось изменить этап: ${e.message}`); }
    finally { setBusy(false); }
  }

  function updateStage(index, key, value) {
    const next = structuredClone(lesson); next.stages[index][key] = value; setLesson(next);
  }

  async function markPreferredVariant(kind, optionKey, option) {
    if (!lesson) return;
    const next = structuredClone(lesson);
    const current = next.preferredVariants?.[kind]?.key;
    next.preferredVariants = {
      ...(next.preferredVariants || {}),
      [kind]: current === optionKey ? null : {
        key: optionKey,
        title: option?.title || '',
        technique: option?.technique || '',
      },
    };
    setLesson(next);
    if (user) await saveLesson(next);
  }

  async function applyVariant(kind, option, optionKey = null) {
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
    if (optionKey) {
      next.preferredVariants = {
        ...(next.preferredVariants || {}),
        [kind]: {
          key: optionKey,
          title: option?.title || '',
          technique: option?.technique || '',
        },
      };
    }
    setLesson(next);
    if (user) await saveLesson(next);
  }

  async function generateWorksheet() {
    if (!user || !lesson) return;
    setWorksheetBusy(true); setNotice('');
    try {
      const result = await generateLessonWorksheet(user, {
        lesson,
        form,
        textbookContext: activeTextbookContext,
        size: worksheetSize,
      });
      const next = structuredClone(lesson);
      next.appendices = { ...(next.appendices || {}), worksheet: result.worksheet };
      setLesson(next);
      setUsageSummary(result.usageSummary ?? null);
      await saveLesson(next);
    } catch (e) {
      setNotice(`Не удалось создать рабочий лист: ${e.message}`);
    } finally { setWorksheetBusy(false); }
  }

  async function rebuildStoryBridges() {
    if (!user || !lesson) return;
    setStoryBusy(true); setNotice('');
    try {
      const result = await rewriteLessonStoryBridges(user, {
        lesson,
        form,
        textbookContext: activeTextbookContext,
      });
      const next = structuredClone(lesson);
      next.storyThread = result.storyThread;
      next.lessonLogic = result.lessonLogic;
      for (const item of result.bridges || []) {
        const index = Number(item?.index);
        if (Number.isInteger(index) && index >= 0 && index < next.stages.length) {
          next.stages[index].bridgeToNext = item.bridgeToNext || '';
        }
      }
      if (next.stages?.length) next.stages[next.stages.length - 1].bridgeToNext = '';
      setLesson(next);
      setUsageSummary(result.usageSummary ?? null);
      await saveLesson(next);
    } catch (e) {
      setNotice(`Не удалось перестроить сюжетные мостики: ${e.message}`);
    } finally { setStoryBusy(false); }
  }

  function updateWorksheetTask(index, key, value) {
    if (!lesson?.appendices?.worksheet || typeof lesson.appendices.worksheet !== 'object') return;
    const next = structuredClone(lesson);
    next.appendices.worksheet.tasks[index][key] = value;
    setLesson(next);
  }

  async function exportDocx() {
    await exportLessonDocx({ lesson, form: { ...form, textbookLabel: currentBook?.label || form.customTextbook }, format: form.format === 'Таблица' ? 'Таблица' : 'Подробный текст' });
  }

  async function exportWorksheet() {
    if (!lesson?.appendices?.worksheet || typeof lesson.appendices.worksheet !== 'object') return;
    await exportWorksheetDocx({ worksheet: lesson.appendices.worksheet, lesson, form });
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
        <div><span className="eyebrow"><Sparkles size={14}/> Для учителей Республики Беларусь</span><h1>План-конспект урока<br/><em>с методической логикой</em></h1><p>Smart Lesson выстраивает урок как единую тематическую историю, связывает этапы содержательными мостиками и может создать рабочий лист к готовому плану.</p></div>
        <div className="hero-card"><Zap/><strong>Alibaba · Qwen3.8-27B</strong><span>5 полных генераций в сутки</span><small>Thinking mode отключён</small>{remaining !== null && <small>Сегодня осталось: {remaining}</small>}</div>
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
              <Field label="Учебник" wide>
                <select value={form.textbookId} onChange={(e) => { update('textbookId', e.target.value); setManualTextbookText(''); setUploadedTextbookSource(null); setUploadedPageImages([]); setUploadedPdfFile(null); setActiveTextbookContext(''); setPageCalibrationRequest(null); setCalibrationPrintedPage(''); setTextbookSourceStatus({ state: 'idle', message: '' }); }}>{books.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                <div className="textbook-resource-row">
                  <div className="textbook-resource-copy">
                    <b>Сверить страницы учебника</b>
                    <span>{currentBook?.custom ? 'Откройте официальный каталог и найдите нужный учебник по названию или автору.' : `Откройте электронную версию и сравните указанные страницы перед генерацией. Для поиска: ${currentBook?.label || `${form.grade} класс`}`}</span>
                  </div>
                  <a className="secondary textbook-resource-link" href={E_PADRUCHNIK_URL} target="_blank" rel="noreferrer" title="Открыть официальный каталог электронных учебников">
                    <BookOpen size={15}/> e-padruchnik <ExternalLink size={13}/>
                  </a>
                </div>
              </Field>
              {currentBook?.custom && <Field label="Название / авторы учебника"><input value={form.customTextbook} onChange={(e) => { update('customTextbook', e.target.value); clearProcessedTextbookSource(); }} placeholder="Например: Английский язык, 10 класс…"/></Field>}
            </div>
            <div className="grid four">
              <Field label="Часть"><input value={form.part} onChange={(e) => { update('part', e.target.value); clearProcessedTextbookSource(); }} placeholder="1"/></Field>
              <Field label="Страницы"><input value={form.pages} onChange={(e) => { update('pages', e.target.value); clearProcessedTextbookSource(); }} placeholder="23–26"/></Field>
              <Field label="Unit (по желанию)"><input value={form.unit} onChange={(e) => update('unit', e.target.value)} placeholder="Unit 1"/></Field>
              <Field label="Lesson (по желанию)"><input value={form.lesson} onChange={(e) => update('lesson', e.target.value)} placeholder="Lesson 4"/></Field>
            </div>
            <div className={`textbook-source-panel ${textbookSourceStatus.state || 'idle'}`}>
              <div className="textbook-source-head">
                <div><b>Страницы учебника</b><span>Сайт сначала берёт PDF из вашей библиотеки Firebase Storage, читает только указанные страницы и сохраняет их текст в личном кэше. Фото страниц и ручная загрузка PDF остаются как запасной вариант.</span></div>
                <button type="button" className="secondary" onClick={checkTextbookSource} disabled={!form.pages.trim() || textbookSourceStatus.state === 'checking' || currentBook?.custom}>
                  {textbookSourceStatus.state === 'checking' ? <RefreshCw size={14} className="spin"/> : <BookOpen size={14}/>} Получить страницы
                </button>
              </div>
              {textbookSourceStatus.message && <div className="textbook-source-status">{textbookSourceStatus.message}</div>}

              {pageCalibrationRequest && <div className="page-calibration-card">
                <div className="page-calibration-head"><Link2 size={18}/><div><b>Один раз сопоставьте нумерацию</b><p>PDF может начинаться с обложки или продолжать нумерацию со второй части. После одной привязки сайт сам рассчитает все остальные страницы.</p></div></div>
                <div className="page-calibration-grid">
                  {pageCalibrationRequest.previewDataUrl && <div className="page-calibration-preview"><img src={pageCalibrationRequest.previewDataUrl} alt={`PDF-страница ${pageCalibrationRequest.pdfPage}`}/><span>PDF-страница {pageCalibrationRequest.pdfPage}{pageCalibrationRequest.totalPdfPages ? ` из ${pageCalibrationRequest.totalPdfPages}` : ''}</span></div>}
                  <div className="page-calibration-form">
                    <div className="calibration-source"><span>Файл</span><b>{pageCalibrationRequest.sourceName || currentBook?.label || 'Учебник'}</b></div>
                    <p>Посмотрите на номер страницы, напечатанный в самом учебнике на превью, и введите его ниже.</p>
                    <label><span>На PDF-странице {pageCalibrationRequest.pdfPage} напечатан номер:</span><input type="number" min="1" step="1" value={calibrationPrintedPage} onChange={(e) => setCalibrationPrintedPage(e.target.value)} placeholder="Например, 3"/></label>
                    <button type="button" className="primary" onClick={confirmPageCalibration} disabled={busy || !calibrationPrintedPage}><Check size={15}/> Сохранить привязку и продолжить</button>
                    <small>Привязка сохранится только для этой части учебника. Фото страниц по-прежнему можно использовать вместо PDF.</small>
                  </div>
                </div>
              </div>}

              <div className="textbook-upload-area">
                <div className="textbook-upload-heading"><Upload size={17}/><div><b>Добавить материал самостоятельно</b><span>Фото страниц оставлены: их можно использовать, если нужного PDF нет в библиотеке, страница является сканом или нужно дать модели конкретный разворот.</span></div></div>
                <div className="textbook-upload-grid">
                  <div className="upload-source-card">
                    <div className="upload-source-icon"><ImagePlus size={20}/></div>
                    <div><b>Фото страниц</b><p>JPG, PNG или WEBP. Лучше: одно фото = одна страница. Можно выбрать несколько.</p></div>
                    <label className="secondary file-picker"><Camera size={14}/> Выбрать фото<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => { setUploadedPageImages([...e.target.files].slice(0, 12)); setUploadedTextbookSource(null); setManualTextbookText(''); }}/></label>
                    {uploadedPageImages.length > 0 && <div className="upload-selection"><span>{uploadedPageImages.length} файл(а): {uploadedPageImages.slice(0, 3).map((f) => f.name).join(', ')}{uploadedPageImages.length > 3 ? '…' : ''}</span><button type="button" className="primary small" onClick={processPageImages} disabled={textbookSourceStatus.state === 'checking'}><Sparkles size={14}/> Распознать фото</button></div>}
                  </div>

                  <div className="upload-source-card">
                    <div className="upload-source-icon"><FileUp size={20}/></div>
                    <div><b>PDF учебника</b><p>Выберите учебник с компьютера. Сам PDF никуда не сохраняется — в Firestore попадёт только текст выбранных страниц.</p></div>
                    <label className="secondary file-picker"><FileText size={14}/> Выбрать PDF<input type="file" accept="application/pdf,.pdf" onChange={(e) => { setUploadedPdfFile(e.target.files?.[0] || null); setUploadedTextbookSource(null); setManualTextbookText(''); }}/></label>
                    {uploadedPdfFile && <div className="upload-selection"><span>{uploadedPdfFile.name} · {(uploadedPdfFile.size / 1024 / 1024).toFixed(1)} МБ</span><button type="button" className="primary small" onClick={processUploadedPdf} disabled={textbookSourceStatus.state === 'checking'}><BookOpen size={14}/> Прочитать страницы</button></div>}
                  </div>
                </div>
                <small className="upload-note">Для фото используется распознавание текста. Если вы загружаете разворот одним фото, сайт использует его как общий контекст для указанного диапазона страниц.</small>
              </div>

              <Field label="Ещё один вариант — вставить текст вручную" hint="Вставленный текст имеет приоритет над автоматическим источником, фото и PDF." wide>
                <textarea rows={5} value={manualTextbookText} onChange={(e) => { setManualTextbookText(e.target.value); setUploadedTextbookSource(null); setActiveTextbookContext(''); setPageCalibrationRequest(null); setCalibrationPrintedPage(''); setTextbookSourceStatus({ state: e.target.value.trim() ? 'ready' : 'idle', message: e.target.value.trim() ? `Будет использован вставленный текст для стр. ${form.pages || 'указанных страниц'}.` : '' }); }} placeholder="Вставьте текст упражнений, диалогов, правил и заданий с выбранных страниц…"/>
              </Field>
            </div>
            <Field label="Тема урока" wide hint={`В документе: ${titlePreview}`}><input className="large-input" value={form.topic} onChange={(e) => update('topic', e.target.value)} placeholder="Например: Mass Media"/></Field>
            <div className="grid two">
              <Field label="Тип урока"><select value={form.lessonType} onChange={(e) => update('lessonType', e.target.value)}>{lessonTypes.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Ведущая речевая деятельность" hint="Определяет кульминационную задачу"><select value={form.leadingActivity} onChange={(e) => { update('leadingActivity', e.target.value); if (!form.speechActivities.includes(e.target.value)) update('speechActivities', [...form.speechActivities, e.target.value]); }}>{speechActivities.map((x) => <option key={x}>{x}</option>)}</select></Field>
            </div>
          </>}

          {step === 1 && <>
            <div className="section-head"><div><span>Шаг 2</span><h2>Методический фокус</h2></div><WandSparkles/></div>
            <div className="methodology-note"><Link2 size={18}/><div><b>Сквозная история и тематические мостики включены автоматически</b><p>Урок строится вокруг одной коммуникативной ситуации или проблемного вопроса. Каждый мостик продолжает тему: результат этапа → новый тематический вопрос/дефицит → следующее действие.</p></div></div>
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
            <div className="info-box"><b>Учебник и страницы</b><p>Если указаны страницы, сайт берёт их фактический текст из кэша, Firebase Storage, фото/PDF или ручного текста. Если нумерация PDF отличается от печатной, привязка определяется автоматически или запрашивается один раз.</p></div>
          </>}

          {step === 3 && !lesson && <>
            <div className="section-head"><div><span>Шаг 4</span><h2>Проверка перед генерацией</h2></div><Sparkles/></div>
            <div className="summary-grid"><div><span>Тема</span><b>{titlePreview}</b></div><div><span>Класс</span><b>{form.grade}, {form.level.toLowerCase()}</b></div><div><span>Урок</span><b>{form.lessonType}</b></div><div><span>Время</span><b>{selectedStageMinutes} минут</b></div><div><span>Учащихся</span><b>{form.studentCount}</b></div><div><span>Этапов</span><b>{effectiveStages.length}</b></div></div>
            <div className="summary-long"><b>Компетенции</b><p>{form.competencies.join(', ') || 'Не выбраны'}</p><b>Функциональная грамотность</b><p>{form.literacies.join(', ') || 'Не выбрана'}</p><b>Дополнительно</b><p>{form.extras.join(', ') || 'Нет'}</p><b>Методическая логика</b><p>Одна тематическая история/коммуникативная ситуация → последовательная система упражнений → речевая кульминация → финал истории и рефлексия; мостики продолжают одну тему, а не просто переключают задания.</p></div>
            <div className={`source-summary ${textbookSourceStatus.state || 'idle'}`}><b>Опора на учебник</b><p>{form.pages ? (textbookSourceStatus.message || `Перед генерацией будут проверены стр. ${form.pages}.`) : 'Конкретные страницы не указаны.'}</p></div>
            <button className="generate" disabled={busy} onClick={generate}>{busy ? <RefreshCw className="spin"/> : <Sparkles/>}{busy ? 'Создаю и проверяю план…' : 'Создать план-конспект'}</button>
            <UsageSummaryCard usage={usageSummary} />
            {!user && <p className="signin-hint">Для генерации нужен вход через Google — так работают история и дневной лимит.</p>}
          </>}

          {step === 3 && lesson && <div className="result">
            <div className="result-toolbar"><div><span className="success"><Check size={15}/> План создан</span><h2>{lesson.title}</h2>{remaining !== null && <small>Осталось полных генераций сегодня: {remaining}</small>}</div><div className="toolbar-actions"><button className="secondary" onClick={() => saveLesson()}><Save size={17}/> Сохранить</button><button className="primary" onClick={exportDocx}><Download size={17}/> Скачать Word</button></div></div>
            <UsageSummaryCard usage={usageSummary} />

            <div className="meta-editor">
              <Field label="Цель"><textarea rows={3} value={lesson.meta?.goal || ''} onChange={(e) => setLesson({ ...lesson, meta: { ...lesson.meta, goal: e.target.value } })}/></Field>
              <EditableArray label="Критерии успеха" items={lesson.meta?.successCriteria || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, successCriteria: v } })}/>
              <EditableArray label="Образовательные задачи" items={lesson.meta?.tasks?.educational || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, educational: v } } })}/>
              <EditableArray label="Развивающие задачи" items={lesson.meta?.tasks?.developmental || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, developmental: v } } })}/>
              <EditableArray label="Воспитательные задачи" items={lesson.meta?.tasks?.upbringing || []} onChange={(v) => setLesson({ ...lesson, meta: { ...lesson.meta, tasks: { ...lesson.meta.tasks, upbringing: v } } })}/>
            </div>

            {lesson.sourceGrounding?.textbookUsed && <div className="source-grounding"><BookOpen size={18}/><div><b>Опора на учебник</b><p>{lesson.sourceGrounding.summary || `Использованы страницы: ${(lesson.sourceGrounding.pages || []).join(', ')}`}</p>{lesson.sourceGrounding.references?.length > 0 && <ul>{lesson.sourceGrounding.references.map((x, i)=><li key={i}>{x}</li>)}</ul>}</div></div>}

            {lesson.lessonLogic && <div className="logic-box"><Link2 size={18}/><div><b>Сквозная логика урока</b><p>{lesson.lessonLogic}</p></div></div>}
            <div className="story-thread-box">
              <div className="story-thread-main">
                <div className="story-thread-title"><Sparkles size={17}/><div><span>Единая история урока</span><b>{lesson.storyThread?.title || 'Сквозная тематическая линия'}</b></div></div>
                {lesson.storyThread?.situation && <p><strong>Ситуация:</strong> {lesson.storyThread.situation}</p>}
                {lesson.storyThread?.drivingQuestion && <p><strong>Главный вопрос:</strong> {lesson.storyThread.drivingQuestion}</p>}
                {lesson.storyThread?.finalOutcome && <p><strong>Финал:</strong> {lesson.storyThread.finalOutcome}</p>}
              </div>
              <button type="button" className="secondary story-rebuild" onClick={rebuildStoryBridges} disabled={storyBusy}>
                {storyBusy ? <RefreshCw className="spin" size={15}/> : <Link2 size={15}/>} {storyBusy ? 'Перестраиваю…' : 'Сделать мостики одной историей'}
              </button>
            </div>
            {lesson.methodicalCheck?.summary && <div className="method-check"><div><b>Методическая самопроверка</b><p>{lesson.methodicalCheck.summary}</p></div><span>{lesson.methodicalCheck.timeTotal || selectedStageMinutes} мин</span>{lesson.methodicalCheck.warnings?.length > 0 && <ul>{lesson.methodicalCheck.warnings.map((x, i)=><li key={i}>{x}</li>)}</ul>}</div>}

            <AlternativeSection title="Креативное начало" subtitle="Три разных lead-in, каждый должен естественно запустить основную работу урока." kind="opening" items={lesson.creativeOptions?.opening} onApply={applyVariant} onFavorite={markPreferredVariant} selectedKey={lesson.preferredVariants?.opening?.key}/>
            <AlternativeSection title="Двигательная пауза" subtitle="Короткое движение без разрыва темы; для старших классов — без инфантильности." kind="movement" items={lesson.creativeOptions?.movement} onApply={applyVariant} onFavorite={markPreferredVariant} selectedKey={lesson.preferredVariants?.movement?.key}/>
            <AlternativeSection title="Рефлексия" subtitle="Варианты возвращают учащихся к цели и критериям успеха, а не только к эмоциям." kind="reflection" items={lesson.creativeOptions?.reflection} onApply={applyVariant} onFavorite={markPreferredVariant} selectedKey={lesson.preferredVariants?.reflection?.key}/>

            <h3 className="result-title">Ход урока</h3>
            <div className="result-stages">{(lesson.stages || []).map((s, i) => <article className="stage-card" key={s.id || i}>
              <div className="stage-top"><div><span>{String(i + 1).padStart(2,'0')}</span><div><h4>{s.name}</h4><small>{s.duration} мин · {(s.forms || []).join(', ')}</small></div></div><div className="stage-buttons"><button onClick={() => refineStage(i, 'regenerate')} title="Перегенерировать"><RefreshCw size={15}/></button><button onClick={() => refineStage(i, 'interesting')}>Интереснее</button><button onClick={() => refineStage(i, 'simpler')}>Проще</button><button onClick={() => refineStage(i, 'harder')}>Сложнее</button><button onClick={() => refineStage(i, 'bridge')}><Link2 size={13}/> Мостик</button></div></div>
              <div className="stage-edit-grid">
                <Field label="Функция этапа"><textarea rows={2} value={s.purpose || ''} onChange={(e) => updateStage(i,'purpose',e.target.value)}/></Field>
                <Field label="Результат этапа"><textarea rows={2} value={s.stageResult || ''} onChange={(e) => updateStage(i,'stageResult',e.target.value)}/></Field>
                <Field label="Деятельность учителя"><textarea rows={4} value={s.teacher || ''} onChange={(e) => updateStage(i,'teacher',e.target.value)}/></Field>
                <Field label="Деятельность учащихся"><textarea rows={4} value={s.students || ''} onChange={(e) => updateStage(i,'students',e.target.value)}/></Field>
                <Field label="Задания / ход работы" wide><textarea rows={5} value={s.activities || ''} onChange={(e) => updateStage(i,'activities',e.target.value)}/></Field>
                {i < lesson.stages.length - 1 && <Field label="Логический мостик к следующему этапу" wide hint="Продолжение общей истории: результат этапа → тематический вопрос/дефицит → следующее действие"><textarea className="bridge-textarea" rows={3} value={s.bridgeToNext || ''} onChange={(e) => updateStage(i,'bridgeToNext',e.target.value)}/></Field>}
              </div>
              <div className="stage-tags">{(s.competencies || []).map(x=><span key={x}>{x}</span>)}{(s.literacy || []).map(x=><span key={x}>{x}</span>)}</div>
            </article>)}</div>

            <section className="worksheet-section">
              <div className="worksheet-head">
                <div><span>Дополнительный материал</span><h3>Рабочий лист к уроку</h3><p>Генерируется по текущей версии урока и продолжает ту же тематическую историю.</p></div>
                <FileText size={22}/>
              </div>
              <div className="worksheet-actions">
                <select value={worksheetSize} onChange={(e) => setWorksheetSize(e.target.value)}>
                  <option>Краткий (1 страница)</option>
                  <option>Обычный (2 страницы)</option>
                  <option>Расширенный (3 страницы)</option>
                </select>
                <button type="button" className="primary" onClick={generateWorksheet} disabled={worksheetBusy}>
                  {worksheetBusy ? <RefreshCw className="spin" size={16}/> : <Sparkles size={16}/>} {worksheetBusy ? 'Создаю рабочий лист…' : (lesson.appendices?.worksheet && typeof lesson.appendices.worksheet === 'object' ? 'Сгенерировать заново' : 'Сгенерировать рабочий лист')}
                </button>
                {lesson.appendices?.worksheet && typeof lesson.appendices.worksheet === 'object' && <button type="button" className="secondary" onClick={exportWorksheet}><Download size={16}/> Скачать Word</button>}
              </div>
              {lesson.appendices?.worksheet && typeof lesson.appendices.worksheet === 'object' && <div className="worksheet-editor">
                <Field label="Название рабочего листа" wide><input value={lesson.appendices.worksheet.title || ''} onChange={(e) => setLesson({...lesson, appendices:{...(lesson.appendices||{}), worksheet:{...lesson.appendices.worksheet, title:e.target.value}}})}/></Field>
                <Field label="Введение / сюжетная задача" wide><textarea rows={3} value={lesson.appendices.worksheet.intro || ''} onChange={(e) => setLesson({...lesson, appendices:{...(lesson.appendices||{}), worksheet:{...lesson.appendices.worksheet, intro:e.target.value}}})}/></Field>
                <div className="worksheet-task-list">{(lesson.appendices.worksheet.tasks || []).map((task, i) => <article className="worksheet-task-card" key={`${task.number}-${i}`}>
                  <div className="worksheet-task-number">{task.number || i + 1}</div>
                  <div className="worksheet-task-fields">
                    <Field label="Название"><input value={task.title || ''} onChange={(e) => updateWorksheetTask(i,'title',e.target.value)}/></Field>
                    <Field label="Инструкция"><textarea rows={2} value={task.instruction || ''} onChange={(e) => updateWorksheetTask(i,'instruction',e.target.value)}/></Field>
                    <Field label="Материал задания" wide><textarea rows={5} value={task.content || ''} onChange={(e) => updateWorksheetTask(i,'content',e.target.value)}/></Field>
                  </div>
                </article>)}</div>
                <Field label="Самопроверка / финал истории" wide><textarea rows={3} value={lesson.appendices.worksheet.selfCheck || ''} onChange={(e) => setLesson({...lesson, appendices:{...(lesson.appendices||{}), worksheet:{...lesson.appendices.worksheet, selfCheck:e.target.value}}})}/></Field>
                <EditableArray label="Ключи рабочего листа для учителя" items={lesson.appendices.worksheet.teacherKey || []} onChange={(v) => setLesson({...lesson, appendices:{...(lesson.appendices||{}), worksheet:{...lesson.appendices.worksheet, teacherKey:v}}})}/>
              </div>}
            </section>

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
      setManualTextbookText(''); setActiveTextbookContext(''); setTextbookSourceStatus({ state: 'idle', message: '' });
      setStages(item.form?.enabledStages || defaultStages[item.form?.lessonType] || []);
      setLesson(item.lesson); setLessonId(item.id); setStep(3); setHistoryOpen(false);
    }}><b>{item.lesson?.title || item.form?.topic}</b><span>{item.form?.grade} класс · {item.form?.date || ''}</span></button><button className="delete" onClick={async()=>{await deleteDoc(doc(db,'users',user.uid,'lessons',item.id)); setHistory(history.filter(x=>x.id!==item.id));}}><X size={15}/></button></div>)}</aside></div>}

    {busy && step===3 && lesson && <div className="busy-overlay"><RefreshCw className="spin"/><span>Обновляю этап…</span></div>}
  </div>;
}
