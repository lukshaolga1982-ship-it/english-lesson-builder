import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const API_BASE = 'https://proud-surf-1244.lukshaolga1982.workers.dev';
const MAX_PAGES = 24;
const MAX_CONTEXT_CHARS = 70000;
const MAX_IMAGE_SIDE = 1900;
const IMAGE_JPEG_QUALITY = 0.86;
const MAX_OCR_IMAGES = 12;

export function parsePageNumbers(value, maxPages = MAX_PAGES) {
  if (!value) return [];
  const out = new Set();
  const normalized = String(value).replace(/[–—]/g, '-');
  for (const token of normalized.split(/[;,\s]+/).filter(Boolean)) {
    if (token.includes('-')) {
      const [aRaw, bRaw] = token.split('-');
      const a = Number(aRaw);
      const b = Number(bRaw);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const from = Math.max(1, Math.min(a, b));
      const to = Math.max(a, b);
      for (let p = from; p <= to && out.size < maxPages; p += 1) out.add(p);
    } else {
      const p = Number(token);
      if (Number.isFinite(p) && p >= 1) out.add(p);
    }
    if (out.size >= maxPages) break;
  }
  return [...out].slice(0, maxPages);
}

function tinyHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildTextbookCacheId(textbookId, customTitle = '') {
  const base = String(textbookId || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!base.startsWith('custom-')) return base;
  const cleanTitle = String(customTitle || '').trim().toLowerCase();
  return cleanTitle ? `${base}-${tinyHash(cleanTitle)}` : `${base}-default`;
}

function cacheDocId(bookId, part, printedPage) {
  return `${bookId}__part-${String(part || '1').replace(/[^a-zA-Z0-9_-]/g, '_')}__page-${printedPage}`;
}

async function loadUserCachedPage(db, uid, bookId, part, page) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'textbookCache', cacheDocId(bookId, part, page)));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const text = String(data.text || '').trim();
    if (!text) return null;
    return {
      page,
      text,
      pdfPage: Number(data.pdfPage || 0) || null,
      sourceName: data.sourceName || 'Личный кэш',
      sourceType: data.sourceType || 'cache',
      sourceUrl: data.sourceUrl || '',
      cache: 'user',
    };
  } catch (error) {
    console.warn(`Не удалось прочитать кэш страницы ${page}`, error);
    return null;
  }
}

async function loadSharedPage(db, bookId, page) {
  try {
    const snap = await getDoc(doc(db, 'textbooks', bookId, 'pages', String(page)));
    if (!snap.exists()) return null;
    const text = String(snap.data()?.text || '').trim();
    if (!text) return null;
    return {
      page,
      text,
      pdfPage: Number(snap.data()?.pdfPage || 0) || null,
      sourceName: snap.data()?.sourceName || 'Firestore',
      sourceType: snap.data()?.sourceType || 'firestore',
      sourceUrl: snap.data()?.sourceUrl || '',
      cache: 'shared',
    };
  } catch (error) {
    console.warn(`Не удалось прочитать общую страницу ${page}`, error);
    return null;
  }
}

async function saveUserCachedPage(db, uid, bookId, part, item) {
  if (!uid || !item?.text || !Number.isFinite(Number(item?.page))) return;
  try {
    await setDoc(doc(db, 'users', uid, 'textbookCache', cacheDocId(bookId, part, item.page)), {
      bookId,
      part: String(part || '1'),
      printedPage: Number(item.page),
      pdfPage: item.pdfPage || null,
      text: item.text,
      sourceName: item.sourceName || '',
      sourceType: item.sourceType || '',
      sourceUrl: item.sourceUrl || '',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    // The lesson can still be generated even if cache writing is temporarily unavailable.
    console.warn(`Не удалось сохранить страницу ${item.page} в личный кэш`, error);
  }
}

function buildContext(loaded, requestedPages, source = 'cache') {
  const sorted = [...loaded].sort((a, b) => Number(a.page) - Number(b.page));
  const loadedPages = sorted.map((x) => Number(x.page)).filter(Number.isFinite);
  const loadedSet = new Set(loadedPages);
  const missingPages = requestedPages.filter((page) => !loadedSet.has(page));
  const text = sorted
    .map(({ page, text: pageText }) => `=== СТРАНИЦА ${page} ===\n${pageText}`)
    .join('\n\n')
    .slice(0, MAX_CONTEXT_CHARS);
  const sources = [...new Set(sorted.map((x) => x.sourceName).filter(Boolean))];
  return {
    text,
    requestedPages,
    loadedPages,
    missingPages,
    source,
    sourceName: sources.join(' + '),
    details: sorted,
  };
}

export async function loadTextbookPagesFromFirestore(db, textbookId, pagesString, { uid = '', part = '1' } = {}) {
  const pages = parsePageNumbers(pagesString);
  if (!textbookId || pages.length === 0) {
    return { text: '', requestedPages: pages, loadedPages: [], missingPages: pages, source: 'firestore', sourceName: '' };
  }

  const loaded = [];
  await Promise.all(pages.map(async (page) => {
    const userCached = await loadUserCachedPage(db, uid, textbookId, part, page);
    if (userCached) { loaded.push(userCached); return; }
    // Shared library is meaningful only for canonical textbook IDs.
    if (!String(textbookId).startsWith('custom-')) {
      const shared = await loadSharedPage(db, textbookId, page);
      if (shared) loaded.push(shared);
    }
  }));

  return buildContext(loaded, pages, 'firestore');
}

async function authorizedFetch(user, path, body, { binary = false, timeoutMs = 120000 } = {}) {
  if (!user) throw new Error('Чтобы работать со страницами учебника, сначала войдите через Google.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Источник учебника вернул HTTP ${response.status}.`);
    }

    if (binary) return response;
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || 'Не удалось обработать источник учебника.');
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Обработка учебника заняла слишком много времени. Попробуйте ещё раз.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkAutomaticTextbookSource(user, textbookId, part = '1') {
  const data = await authorizedFetch(user, '/textbook-source', { bookId: textbookId, part });
  return data.source || {};
}

async function downloadTextbookPdf(user, textbookId, part = '1', onProgress) {
  onProgress?.('Получаю электронную версию учебника…');
  const response = await authorizedFetch(user, '/textbook-pdf', { bookId: textbookId, part }, { binary: true, timeoutMs: 180000 });
  const length = Number(response.headers.get('content-length') || 0);
  const sourceName = decodeURIComponent(response.headers.get('x-textbook-source-name') || 'Электронная версия учебника');
  const sourceUrl = response.headers.get('x-textbook-source-url') || '';
  const sourceType = response.headers.get('x-textbook-source-type') || 'auto';

  if (!response.body || !length) {
    const buffer = await response.arrayBuffer();
    return { buffer, sourceName, sourceUrl, sourceType };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (length > 0) onProgress?.(`Загружаю учебник… ${Math.min(100, Math.round(received / length * 100))}%`);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return { buffer: merged.buffer, sourceName, sourceUrl, sourceType };
}

function itemY(item) {
  return Number(item?.transform?.[5] ?? 0);
}

function itemX(item) {
  return Number(item?.transform?.[4] ?? 0);
}

function normalizeToken(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function textItemsToLines(items) {
  const useful = items
    .filter((item) => normalizeToken(item.str))
    .map((item) => ({ str: normalizeToken(item.str), x: itemX(item), y: itemY(item), h: Math.max(1, Math.abs(item?.height || item?.transform?.[0] || 10)) }));
  if (!useful.length) return '';

  const rows = [];
  for (const item of useful.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2.5, item.h * 0.45);
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function extractPdfPage(pdf, pdfPageNumber) {
  const page = await pdf.getPage(pdfPageNumber);
  const content = await page.getTextContent({ includeMarkedContent: false });
  const items = content.items || [];
  const text = textItemsToLines(items);
  return { page, items, text };
}

function pageNumberScore(items, printedPage, viewportHeight) {
  const target = String(printedPage);
  let score = 0;
  for (const item of items || []) {
    const token = normalizeToken(item.str).replace(/[.·•]/g, '');
    if (token !== target) continue;
    const y = itemY(item);
    if (viewportHeight && y < viewportHeight * 0.14) score += 12;
    else if (viewportHeight && y > viewportHeight * 0.86) score += 6;
    else score += 1;
  }
  return score;
}

async function detectPrintedPageOffset(pdf, printedPage, onProgress) {
  const start = Math.max(1, printedPage - 2);
  const end = Math.min(pdf.numPages, printedPage + 14);
  let best = null;
  for (let pdfPage = start; pdfPage <= end; pdfPage += 1) {
    onProgress?.(`Определяю соответствие страниц… ${pdfPage - start + 1}/${end - start + 1}`);
    const page = await pdf.getPage(pdfPage);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: false });
    const score = pageNumberScore(content.items || [], printedPage, viewport.height);
    if (score > 0 && (!best || score > best.score)) best = { pdfPage, score, offset: pdfPage - printedPage };
    if (score >= 12) break;
  }
  return best?.offset ?? null;
}

async function renderPdfPageToDataUrl(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.3, Math.max(1.2, MAX_IMAGE_SIDE / Math.max(baseViewport.width, baseViewport.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл ${file?.name || ''}.`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось открыть изображение страницы.'));
    image.src = src;
  });
}

async function compressImageFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error(`Файл ${file?.name || ''} не является изображением.`);
  const src = await readFileAsDataUrl(file);
  const image = await loadHtmlImage(src);
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = maxSide > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / maxSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
}

async function ocrImageBatch(user, images, onProgress) {
  if (!images.length) return [];
  const data = await authorizedFetch(user, '/ocr-textbook-images', { images }, { timeoutMs: 180000 });
  const pages = Array.isArray(data.pages) ? data.pages : [];
  onProgress?.(`Распознано изображений: ${pages.length}.`);
  return pages;
}

async function ocrDataUrl(user, dataUrl, label, onProgress) {
  const [first] = await ocrImageBatch(user, [{ dataUrl, label }], onProgress);
  return String(first?.text || '').trim();
}

async function extractRequestedPagesFromPdf(buffer, printedPages, { onProgress, user = null, ocrFallback = false } = {}) {
  onProgress?.('Открываю PDF и читаю выбранные страницы…');
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: true });
  const pdf = await task.promise;
  if (!pdf?.numPages) throw new Error('Не удалось прочитать PDF учебника.');

  const firstPrinted = printedPages[0];
  let offset = await detectPrintedPageOffset(pdf, firstPrinted, onProgress);
  if (offset == null) {
    let best = null;
    for (const candidateOffset of [0, 1, 2, 3, 4, 5, 6]) {
      const pdfPage = firstPrinted + candidateOffset;
      if (pdfPage < 1 || pdfPage > pdf.numPages) continue;
      const extracted = await extractPdfPage(pdf, pdfPage);
      const score = extracted.text.replace(/\s/g, '').length;
      if (!best || score > best.score) best = { offset: candidateOffset, score };
    }
    offset = best?.offset ?? 0;
  }

  const results = [];
  for (let i = 0; i < printedPages.length; i += 1) {
    const printedPage = printedPages[i];
    const pdfPage = printedPage + offset;
    if (pdfPage < 1 || pdfPage > pdf.numPages) throw new Error(`Страница ${printedPage} выходит за пределы PDF.`);
    onProgress?.(`Читаю стр. ${printedPage}… ${i + 1}/${printedPages.length}`);
    const extracted = await extractPdfPage(pdf, pdfPage);
    let clean = String(extracted.text || '').trim();

    if (clean.length < 20 && ocrFallback && user) {
      onProgress?.(`Стр. ${printedPage} — скан. Распознаю изображение…`);
      const dataUrl = await renderPdfPageToDataUrl(extracted.page);
      clean = await ocrDataUrl(user, dataUrl, `Печатная страница ${printedPage}`, onProgress);
    }

    if (clean.length < 20) {
      throw new Error(`На стр. ${printedPage} не удалось извлечь достаточно текста. Загрузите фото этой страницы — сайт распознает её через OCR.`);
    }
    results.push({ page: printedPage, pdfPage, text: clean });
  }

  try { await pdf.destroy(); } catch {}
  return { pages: results, offset };
}

export async function obtainTextbookPagesAutomatically({
  db,
  user,
  textbookId,
  part = '1',
  pagesString,
  onProgress,
}) {
  const requestedPages = parsePageNumbers(pagesString);
  if (!requestedPages.length) return { text: '', requestedPages: [], loadedPages: [], missingPages: [], source: 'none', sourceName: '' };
  if (!textbookId || textbookId.startsWith('custom-')) throw new Error('Для учебника, указанного вручную, автоматическое получение страниц недоступно. Загрузите PDF или фото страниц ниже.');
  if (!user) throw new Error('Чтобы получить страницы автоматически, войдите через Google.');

  onProgress?.('Проверяю сохранённые страницы…');
  const cached = await loadTextbookPagesFromFirestore(db, textbookId, pagesString, { uid: user.uid, part });
  if (cached.text && cached.missingPages.length === 0) {
    return { ...cached, source: 'cache', sourceName: cached.sourceName || 'Сохранённые страницы' };
  }

  const missing = cached.missingPages.length ? cached.missingPages : requestedPages;
  const pdf = await downloadTextbookPdf(user, textbookId, part, onProgress);
  const extracted = await extractRequestedPagesFromPdf(pdf.buffer, missing, { onProgress, user, ocrFallback: true });
  const enriched = extracted.pages.map((item) => ({
    ...item,
    sourceName: pdf.sourceName,
    sourceType: pdf.sourceType,
    sourceUrl: pdf.sourceUrl,
    cache: 'fresh',
  }));

  await Promise.all(enriched.map((item) => saveUserCachedPage(db, user.uid, textbookId, part, item)));
  const all = [...(cached.details || []), ...enriched];
  const result = buildContext(all, requestedPages, 'automatic');
  return {
    ...result,
    sourceName: pdf.sourceName,
    sourceUrl: pdf.sourceUrl,
    sourceType: pdf.sourceType,
    offset: extracted.offset,
  };
}

export async function obtainTextbookPagesFromUploadedPdf({
  db,
  user,
  textbookId,
  part = '1',
  pagesString,
  file,
  onProgress,
}) {
  if (!user) throw new Error('Чтобы обработать PDF, сначала войдите через Google.');
  const requestedPages = parsePageNumbers(pagesString);
  if (!requestedPages.length) throw new Error('Сначала укажите печатные страницы, которые нужны для урока.');
  if (!file) throw new Error('Выберите PDF учебника.');
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) throw new Error('Нужно выбрать PDF-файл.');
  if (file.size > 80 * 1024 * 1024) throw new Error('PDF слишком большой. Максимальный размер локального файла — 80 МБ.');

  onProgress?.(`Открываю ${file.name}…`);
  const buffer = await file.arrayBuffer();
  const extracted = await extractRequestedPagesFromPdf(buffer, requestedPages, { onProgress, user, ocrFallback: true });
  const enriched = extracted.pages.map((item) => ({
    ...item,
    sourceName: file.name || 'Загруженный PDF учебника',
    sourceType: 'uploaded-pdf',
    sourceUrl: '',
    cache: 'fresh',
  }));

  await Promise.all(enriched.map((item) => saveUserCachedPage(db, user.uid, textbookId, part, item)));
  return {
    ...buildContext(enriched, requestedPages, 'uploaded-pdf'),
    sourceName: file.name || 'Загруженный PDF учебника',
    sourceType: 'uploaded-pdf',
    offset: extracted.offset,
  };
}

export async function obtainTextbookPagesFromImages({
  db,
  user,
  textbookId,
  part = '1',
  pagesString,
  files,
  onProgress,
}) {
  if (!user) throw new Error('Чтобы распознать фото страниц, сначала войдите через Google.');
  const requestedPages = parsePageNumbers(pagesString);
  if (!requestedPages.length) throw new Error('Сначала укажите номера страниц, которые вы фотографируете.');
  const list = [...(files || [])].slice(0, MAX_OCR_IMAGES);
  if (!list.length) throw new Error('Выберите фото страниц.');

  onProgress?.('Подготавливаю изображения для распознавания…');
  const encoded = [];
  for (let i = 0; i < list.length; i += 1) {
    onProgress?.(`Подготавливаю фото ${i + 1}/${list.length}…`);
    encoded.push(await compressImageFile(list[i]));
  }

  const exactOnePhotoPerPage = requestedPages.length === encoded.length;
  const recognized = [];
  for (let start = 0; start < encoded.length; start += 3) {
    const batch = encoded.slice(start, start + 3).map((dataUrl, index) => {
      const absoluteIndex = start + index;
      const page = exactOnePhotoPerPage ? requestedPages[absoluteIndex] : null;
      const label = page ? `Печатная страница ${page}` : `Фото страницы ${absoluteIndex + 1}; заявленный диапазон ${pagesString}`;
      return { dataUrl, label };
    });
    onProgress?.(`Распознаю фото ${start + 1}–${Math.min(start + 3, encoded.length)} из ${encoded.length}…`);
    const result = await ocrImageBatch(user, batch, onProgress);
    recognized.push(...result);
  }

  const texts = recognized.map((item, index) => ({
    page: exactOnePhotoPerPage ? requestedPages[index] : index + 1,
    actualPage: exactOnePhotoPerPage ? requestedPages[index] : null,
    text: String(item?.text || '').trim(),
    sourceName: list[index]?.name || `Фото ${index + 1}`,
    sourceType: 'uploaded-image',
    sourceUrl: '',
    cache: 'fresh',
  })).filter((item) => item.text.length >= 10);

  if (!texts.length) throw new Error('Не удалось распознать текст на загруженных фото. Попробуйте более чёткие снимки без бликов.');

  if (exactOnePhotoPerPage) {
    await Promise.all(texts.map((item) => saveUserCachedPage(db, user.uid, textbookId, part, { ...item, page: item.actualPage })));
    return {
      ...buildContext(texts.map((item) => ({ ...item, page: item.actualPage })), requestedPages, 'uploaded-images'),
      sourceName: 'Фото страниц учебника',
      sourceType: 'uploaded-images',
    };
  }

  // A photo may contain a whole spread. In that case preserve all OCR as one grounded context,
  // but do not pretend that we know which exact fragment belongs to each printed page.
  const combined = texts
    .map((item, index) => `=== ФОТО ${index + 1}; ЗАЯВЛЕННЫЕ СТРАНИЦЫ ${pagesString} ===\n${item.text}`)
    .join('\n\n')
    .slice(0, MAX_CONTEXT_CHARS);
  return {
    text: combined,
    requestedPages,
    loadedPages: requestedPages,
    missingPages: [],
    source: 'uploaded-images',
    sourceName: 'Фото / развороты страниц учебника',
    sourceType: 'uploaded-images',
    details: texts,
  };
}

export function manualTextbookContext(text, pagesString) {
  const clean = String(text || '').trim();
  const requestedPages = parsePageNumbers(pagesString);
  return {
    text: clean ? `=== ТЕКСТ СТРАНИЦ, ВСТАВЛЕННЫЙ УЧИТЕЛЕМ ===\n${clean}`.slice(0, MAX_CONTEXT_CHARS) : '',
    requestedPages,
    loadedPages: requestedPages,
    missingPages: [],
    source: 'manual',
    sourceName: 'Текст, вставленный учителем',
  };
}
