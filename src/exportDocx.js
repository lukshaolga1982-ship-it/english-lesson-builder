import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const FONT = 'Times New Roman';
const SIZE = 28; // 14 pt in half-points

const run = (text, opts = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: SIZE, ...opts });
const para = (text = '', opts = {}) => new Paragraph({
  spacing: { line: 240, after: 0 },
  ...opts,
  children: [run(text, opts.run || {})],
});

const labelPara = (label, value) => new Paragraph({
  spacing: { line: 240, after: 0 },
  children: [run(`${label}: `, { bold: true }), run(value || '—')],
});

const arrayText = (value) => Array.isArray(value) ? value.filter(Boolean).join('; ') : (value || '—');


const multilineParagraphs = (text = '', opts = {}) => String(text || '')
  .split(/\r?\n/)
  .map((line) => para(line || ' ', opts));

function worksheetBody(worksheet, { includeTeacherKey = false, pageBreakBefore = false } = {}) {
  if (!worksheet || typeof worksheet !== 'object') return [];
  const out = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore,
      spacing: { line: 240, before: 120, after: 80 },
      children: [run(worksheet.title || 'Рабочий лист', { bold: true })],
    }),
  ];
  if (worksheet.subtitle) out.push(para(worksheet.subtitle));
  out.push(para(worksheet.studentHeader || 'Name: ____________________   Class: ______   Date: __________'));
  if (worksheet.intro) out.push(...multilineParagraphs(worksheet.intro));

  for (const [index, task] of (worksheet.tasks || []).entries()) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { line: 240, before: 140, after: 40 },
      children: [run(`${task.number || index + 1}. ${task.title || `Task ${index + 1}`}`, { bold: true })],
    }));
    if (task.instruction) out.push(para(task.instruction, { run: { italic: true } }));
    if (task.content) out.push(...multilineParagraphs(task.content));
    const lines = Math.max(0, Math.min(8, Number(task.answerSpaceLines || 0)));
    for (let i = 0; i < lines; i += 1) out.push(para('________________________________________________________________________________'));
  }

  if (worksheet.selfCheck) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { line: 240, before: 140, after: 40 }, children: [run('Self-check', { bold: true })] }));
    out.push(...multilineParagraphs(worksheet.selfCheck));
  }

  if (includeTeacherKey && (worksheet.teacherKey || []).length) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [run('Ключи рабочего листа для учителя', { bold: true })],
    }));
    (worksheet.teacherKey || []).forEach((x, i) => out.push(labelPara(`${i + 1}`, x)));
    if (worksheet.teacherNote) out.push(labelPara('Примечание', worksheet.teacherNote));
  }
  return out;
}

function stageTable(lesson) {
  const header = ['Этап', 'Время', 'Результат этапа', 'Деятельность учителя', 'Деятельность учащихся', 'Логический мостик'];
  const rows = [
    new TableRow({
      tableHeader: true,
      children: header.map((h) => new TableCell({ children: [para(h, { run: { bold: true } })] })),
    }),
    ...(lesson.stages || []).map((s) => new TableRow({ children: [
      new TableCell({ children: [para(s.name)] }),
      new TableCell({ children: [para(`${s.duration} мин`)] }),
      new TableCell({ children: [para(s.stageResult || '—')] }),
      new TableCell({ children: [para(s.teacher)] }),
      new TableCell({ children: [para(s.students)] }),
      new TableCell({ children: [para(s.bridgeToNext || '—')] }),
    ] })),
  ];
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function detailedStages(lesson) {
  return (lesson.stages || []).flatMap((s, index) => [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { line: 240, before: 160, after: 60 },
      children: [run(`${index + 1}. ${s.name} — ${s.duration} мин`, { bold: true })],
    }),
    labelPara('Функция этапа', s.purpose),
    labelPara('Результат этапа', s.stageResult),
    labelPara('Деятельность учителя', s.teacher),
    labelPara('Деятельность учащихся', s.students),
    labelPara('Задания / ход работы', s.activities),
    labelPara('Формы работы', arrayText(s.forms)),
    labelPara('Компетенции', arrayText(s.competencies)),
    labelPara('Функциональная грамотность', arrayText(s.literacy)),
    labelPara('Контроль / обратная связь', s.assessment),
    labelPara('Материалы', s.materials),
    ...(s.bridgeToNext ? [labelPara('Логический мостик к следующему этапу', s.bridgeToNext)] : []),
  ]);
}

export async function exportLessonDocx({ lesson, form, format }) {
  if (!lesson) return;
  const title = lesson.title || `${form.topic}. ${form.leadingActivity}`;
  const children = [
    para(form.institution || 'Учреждение образования', { alignment: AlignmentType.CENTER }),
    para('ПЛАН-КОНСПЕКТ УРОКА АНГЛИЙСКОГО ЯЗЫКА', { alignment: AlignmentType.CENTER, run: { bold: true } }),
    para('', {}),
    labelPara('Учитель', form.teacherName),
    labelPara('Дата', form.date),
    labelPara('Класс', `${form.grade} (${form.level})`),
    labelPara('Тема урока', title),
    labelPara('Тип урока', form.lessonType),
    labelPara('Продолжительность', `${form.duration} минут`),
    labelPara('Учебное пособие', form.textbookLabel || form.customTextbook),
    labelPara('Часть / страницы', `${form.part || '—'} / ${form.pages || '—'}`),
    para('', {}),
    labelPara('Цель', lesson.meta?.goal),
    labelPara('Критерии успеха', arrayText(lesson.meta?.successCriteria)),
    labelPara('Образовательные задачи', arrayText(lesson.meta?.tasks?.educational)),
    labelPara('Развивающие задачи', arrayText(lesson.meta?.tasks?.developmental)),
    labelPara('Воспитательные задачи', arrayText(lesson.meta?.tasks?.upbringing)),
    labelPara('Планируемые результаты', arrayText(lesson.meta?.plannedResults)),
    labelPara('Оборудование', arrayText(lesson.meta?.equipment)),
    labelPara('Формы работы', arrayText(lesson.meta?.forms)),
    labelPara('Методы', arrayText(lesson.meta?.methods)),
    labelPara('Языковой материал', arrayText(lesson.meta?.languageMaterial)),
    ...(lesson.sourceGrounding?.textbookUsed ? [
      labelPara('Опора на учебник', lesson.sourceGrounding.summary || `Использованы страницы: ${arrayText(lesson.sourceGrounding.pages)}`),
      labelPara('Конкретные опоры из учебника', arrayText(lesson.sourceGrounding.references)),
    ] : []),
    ...(lesson.lessonLogic ? [labelPara('Сквозная логика урока', lesson.lessonLogic)] : []),
    ...(lesson.storyThread?.situation ? [
      labelPara('Сюжетная линия урока', lesson.storyThread.title || 'Единая тематическая история'),
      labelPara('Ситуация', lesson.storyThread.situation),
      labelPara('Главный вопрос', lesson.storyThread.drivingQuestion),
      labelPara('Финал истории', lesson.storyThread.finalOutcome),
    ] : []),
    para('', {}),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Ход урока', { bold: true })] }),
    ...(format === 'Таблица' ? [stageTable(lesson)] : detailedStages(lesson)),
    para('', {}),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Домашнее задание', { bold: true })] }),
    para(lesson.homework || '—'),
  ];

  if (lesson.listening?.included) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Материал для аудирования', { bold: true })] }),
      labelPara('Текст для озвучивания', lesson.listening.script),
      labelPara('Задания', arrayText(lesson.listening.tasks)),
      labelPara('Ответы', arrayText(lesson.listening.answers)),
    );
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Ключи и ответы для учителя', { bold: true })] }),
    ...((lesson.answerKeys || []).map((x, i) => labelPara(`${i + 1}`, x))),
  );

  if (lesson.appendices?.worksheet || lesson.appendices?.cards) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Приложения', { bold: true })] }));
    if (lesson.appendices.worksheet) {
      if (typeof lesson.appendices.worksheet === 'object') children.push(...worksheetBody(lesson.appendices.worksheet, { includeTeacherKey: true, pageBreakBefore: true }));
      else children.push(labelPara('Рабочий лист', lesson.appendices.worksheet));
    }
    if (lesson.appendices.cards) children.push(labelPara('Карточки', lesson.appendices.cards));
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { line: 240, after: 0 } } },
      },
    },
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const safe = (title || 'plan-konspekt').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${safe}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

export async function exportWorksheetDocx({ worksheet, lesson, form }) {
  if (!worksheet || typeof worksheet !== 'object') return;
  const children = worksheetBody(worksheet, { includeTeacherKey: true, pageBreakBefore: false });
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { line: 240, after: 0 } } },
      },
    },
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(doc);
  const base = worksheet.title || lesson?.title || form?.topic || 'worksheet';
  const safe = String(base).replace(/[\/:*?"<>|]/g, '_').slice(0, 80);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${safe}_worksheet.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

