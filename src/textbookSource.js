import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getBytes, listAll, ref as storageRef } from 'firebase/storage';
import { storage } from './firebase';
import { storageTextbookFiles } from './textbooks';
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

function calibrationDocId(bookId, part) {
  return `${bookId}__part-${String(part || '1').replace(/[^a-zA-Z0-9_-]/g, '_')}__calibration`;
}

async function loadUserPageCalibration(db, uid, bookId, part, sourceKey = '') {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'textbookCache', calibrationDocId(bookId, part)));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const pdfPage = Number(data.pdfPage);
    const printedPage = Number(data.printedPage);
    if (!Number.isFinite(pdfPage) || pdfPage < 1 || !Number.isFinite(printedPage) || printedPage < 1) return null;
    const savedSourceKey = String(data.sourceKey || '');
    if (savedSourceKey && sourceKey && savedSourceKey !== sourceKey) return null;
    return {
      pdfPage,
      printedPage,
      offset: pdfPage - printedPage,
      sourceKey: savedSourceKey,
      sourceName: String(data.sourceName || ''),
      mode: String(data.mode || 'manual'),
    };
  } catch (error) {
    console.warn('Не удалось прочитать привязку нумерации PDF', error);
    return null;
  }
}

export async function saveTextbookPageCalibration({
  db,
  user,
  textbookId,
  part = '1',
  pdfPage,
  printedPage,
  sourceKey = '',
  sourceName = '',
  mode = 'manual',
}) {
  if (!user?.uid) throw new Error('Чтобы сохранить привязку страниц, войдите через Google.');
  const pdf = Number(pdfPage);
  const printed = Number(printedPage);
  if (!Number.isFinite(pdf) || pdf < 1 || !Number.isFinite(printed) || printed < 1) {
    throw new Error('Укажите корректный номер PDF-страницы и напечатанный номер страницы.');
  }
  await setDoc(doc(db, 'users', user.uid, 'textbookCache', calibrationDocId(textbookId, part)), {
    kind: 'page-calibration',
    bookId: textbookId,
    part: String(part || '1'),
    pdfPage: pdf,
    printedPage: printed,
    offset: pdf - printed,
    sourceKey: String(sourceKey || ''),
    sourceName: String(sourceName || ''),
    mode,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { pdfPage: pdf, printedPage: printed, offset: pdf - printed, sourceKey, sourceName, mode };
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


let storageRootPromise = null;

function normalizeStorageName(value) {
  return String(value || '').trim().toLowerCase();
}

async function listStorageRootFiles() {
  if (!storageRootPromise) {
    storageRootPromise = listAll(storageRef(storage)).catch((error) => {
      storageRootPromise = null;
      throw error;
    });
  }
  const result = await storageRootPromise;
  return result.items || [];
}

function resolveStorageRule(textbookId, part = '1') {
  const rules = storageTextbookFiles?.[textbookId] || {};
  return rules[String(part || '1')] || rules['1'] || null;
}

async function findStorageTextbookRef(textbookId, part = '1') {
  const rule = resolveStorageRule(textbookId, part);
  if (!rule) return null;
  const items = await listStorageRootFiles();
  const exactNames = new Set((rule.exact || []).map(normalizeStorageName));
  let found = items.find((item) => exactNames.has(normalizeStorageName(item.name)));
  if (found) return found;

  const tokens = (rule.tokens || []).map(normalizeStorageName).filter(Boolean);
  if (tokens.length) {
    found = items.find((item) => {
      const name = normalizeStorageName(item.name);
      return tokens.every((token) => name.includes(token));
    });
  }
  return found || null;
}

async function downloadTextbookPdfFromStorage(textbookId, part = '1', onProgress) {
  onProgress?.('Ищу учебник в Firebase Storage…');
  let fileRef;
  try {
    fileRef = await findStorageTextbookRef(textbookId, part);
  } catch (error) {
    const code = String(error?.code || '');
    if (code.includes('unauthorized')) {
      throw new Error('Firebase Storage не разрешил чтение учебников. Проверьте Storage Rules: авторизованным пользователям нужен read-доступ к PDF.');
    }
    throw new Error(`Не удалось открыть библиотеку Firebase Storage: ${error?.message || error}`);
  }
  if (!fileRef) throw new Error(`PDF выбранного учебника (часть ${part}) не найден в Firebase Storage.`);

  onProgress?.(`Загружаю ${fileRef.name} из Firebase Storage…`);
  try {
    const buffer = await getBytes(fileRef, 100 * 1024 * 1024);
    return {
      buffer,
      sourceName: fileRef.name,
      sourceType: 'firebase-storage',
      sourceUrl: `gs://${storage.app.options.storageBucket}/${fileRef.fullPath}`,
      storagePath: fileRef.fullPath,
    };
  } catch (error) {
    const code = String(error?.code || '');
    if (code.includes('unauthorized')) {
      throw new Error('Firebase Storage не разрешил скачать PDF. Проверьте Storage Rules для авторизованных пользователей.');
    }
    throw new Error(`Не удалось скачать PDF из Firebase Storage: ${error?.message || error}`);
  }
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

function pageNumberCandidates(items, viewportHeight) {
  const out = [];
  for (const item of items || []) {
    const token = normalizeToken(item.str).replace(/[.·•]/g, '');
    if (!/^\d{1,3}$/.test(token)) continue;
    const printedPage = Number(token);
    if (!Number.isFinite(printedPage) || printedPage < 1 || printedPage > 500) continue;
    const y = itemY(item);
    let score = 0;
    // PDF coordinates start at the bottom. Page numbers are usually in the bottom or top margin.
    if (viewportHeight && y < viewportHeight * 0.16) score = 12;
    else if (viewportHeight && y > viewportHeight * 0.88) score = 8;
    else continue;
    out.push({ printedPage, score });
  }
  return out;
}

async function detectPrintedPageCalibration(pdf, onProgress) {
  const scanCount = Math.min(pdf.numPages, 32);
  const clusters = new Map();
  for (let pdfPage = 1; pdfPage <= scanCount; pdfPage += 1) {
    onProgress?.(`Определяю нумерацию учебника… ${pdfPage}/${scanCount}`);
    const page = await pdf.getPage(pdfPage);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: false });
    const candidates = pageNumberCandidates(content.items || [], viewport.height);
    for (const candidate of candidates) {
      const offset = pdfPage - candidate.printedPage;
      const key = String(offset);
      if (!clusters.has(key)) clusters.set(key, { offset, score: 0, matches: [] });
      const cluster = clusters.get(key);
      if (!cluster.matches.some((m) => m.pdfPage === pdfPage)) {
        cluster.matches.push({ pdfPage, printedPage: candidate.printedPage, score: candidate.score });
        cluster.score += candidate.score;
      }
    }
  }

  const ranked = [...clusters.values()]
    .map((cluster) => {
      const pages = cluster.matches.map((m) => m.pdfPage).sort((a, b) => a - b);
      let consecutive = 0;
      for (let i = 1; i < pages.length; i += 1) if (pages[i] === pages[i - 1] + 1) consecutive += 1;
      return { ...cluster, confidence: cluster.score + consecutive * 10 + cluster.matches.length * 4 };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0];
  if (!best || best.matches.length < 2 || best.confidence < 30) return null;
  const anchor = best.matches.sort((a, b) => b.score - a.score || a.pdfPage - b.pdfPage)[0];
  return {
    pdfPage: anchor.pdfPage,
    printedPage: anchor.printedPage,
    offset: best.offset,
    confidence: best.confidence,
    matches: best.matches.length,
    mode: 'auto',
  };
}

async function chooseCalibrationPreviewPage(pdf) {
  const end = Math.min(pdf.numPages, 20);
  let best = null;
  for (let pdfPage = 1; pdfPage <= end; pdfPage += 1) {
    const extracted = await extractPdfPage(pdf, pdfPage);
    const viewport = extracted.page.getViewport({ scale: 1 });
    const candidates = pageNumberCandidates(extracted.items || [], viewport.height);
    const textLength = String(extracted.text || '').replace(/\s/g, '').length;
    // Prefer a content page where a page-like number is actually visible in a margin.
    const candidateBonus = candidates.length ? 10000 + Math.max(...candidates.map((x) => x.score)) * 100 : 0;
    const score = candidateBonus + textLength + (pdfPage >= 4 ? 80 : 0);
    if (!best || score > best.score) best = { pdfPage, page: extracted.page, score };
  }
  return best || { pdfPage: 1, page: await pdf.getPage(1), score: 0 };
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

async function renderCalibrationPreviewDataUrl(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const previewMaxSide = 1050;
  const scale = Math.min(1.8, Math.max(0.9, previewMaxSide / Math.max(baseViewport.width, baseViewport.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  return canvas.toDataURL('image/jpeg', 0.76);
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

async function extractRequestedPagesFromPdf(buffer, printedPages, {
  onProgress,
  user = null,
  ocrFallback = false,
  calibration = null,
} = {}) {
  onProgress?.('Открываю PDF и читаю выбранные страницы…');
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: true });
  const pdf = await task.promise;
  if (!pdf?.numPages) throw new Error('Не удалось прочитать PDF учебника.');

  let resolvedCalibration = calibration && Number.isFinite(Number(calibration.pdfPage)) && Number.isFinite(Number(calibration.printedPage))
    ? {
        ...calibration,
        pdfPage: Number(calibration.pdfPage),
        printedPage: Number(calibration.printedPage),
        offset: Number(calibration.pdfPage) - Number(calibration.printedPage),
        mode: calibration.mode || 'saved',
      }
    : null;

  if (!resolvedCalibration) {
    resolvedCalibration = await detectPrintedPageCalibration(pdf, onProgress);
  }

  if (!resolvedCalibration) {
    onProgress?.('Не удалось уверенно определить нумерацию автоматически. Нужна одна привязка.');
    const preview = await chooseCalibrationPreviewPage(pdf);
    const previewDataUrl = await renderCalibrationPreviewDataUrl(preview.page);
    const error = new Error(`Один раз укажите напечатанный номер страницы, показанной на превью (PDF-страница ${preview.pdfPage}). После этого сайт сам рассчитает все остальные страницы этой части учебника.`);
    error.code = 'PAGE_CALIBRATION_REQUIRED';
    error.calibration = {
      pdfPage: preview.pdfPage,
      totalPdfPages: pdf.numPages,
      previewDataUrl,
    };
    try { await pdf.destroy(); } catch {}
    throw error;
  }

  const offset = Number(resolvedCalibration.offset);
  const results = [];
  for (let i = 0; i < printedPages.length; i += 1) {
    const printedPage = printedPages[i];
    const pdfPage = printedPage + offset;
    if (pdfPage < 1 || pdfPage > pdf.numPages) {
      const error = new Error(`По сохранённой привязке печатная стр. ${printedPage} соответствует PDF-странице ${pdfPage}, которой нет в файле. Проверьте привязку нумерации.`);
      error.code = 'PAGE_CALIBRATION_INVALID';
      try { await pdf.destroy(); } catch {}
      throw error;
    }
    onProgress?.(`Читаю стр. ${printedPage}… ${i + 1}/${printedPages.length}`);
    const extracted = await extractPdfPage(pdf, pdfPage);
    let clean = String(extracted.text || '').trim();

    if (clean.length < 20 && ocrFallback && user) {
      onProgress?.(`Стр. ${printedPage} — скан. Распознаю изображение…`);
      const dataUrl = await renderPdfPageToDataUrl(extracted.page);
      clean = await ocrDataUrl(user, dataUrl, `Печатная страница ${printedPage}`, onProgress);
    }

    if (clean.length < 20) {
      try { await pdf.destroy(); } catch {}
      throw new Error(`На стр. ${printedPage} не удалось извлечь достаточно текста. Загрузите фото этой страницы — сайт распознает её через OCR.`);
    }
    results.push({ page: printedPage, pdfPage, text: clean });
  }

  try { await pdf.destroy(); } catch {}
  return { pages: results, offset, calibration: resolvedCalibration };
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
  let pdf;
  let storageError = null;

  try {
    pdf = await downloadTextbookPdfFromStorage(textbookId, part, onProgress);
  } catch (error) {
    storageError = error;
    console.warn('Firebase Storage textbook lookup failed; trying legacy external source.', error);
  }

  if (!pdf) {
    onProgress?.('В Storage учебник не найден. Пробую резервный внешний источник…');
    try {
      pdf = await downloadTextbookPdf(user, textbookId, part, onProgress);
    } catch (fallbackError) {
      const storageMessage = storageError?.message ? `Firebase Storage: ${storageError.message}` : '';
      const fallbackMessage = fallbackError?.message ? `Резервный источник: ${fallbackError.message}` : '';
      throw new Error([storageMessage, fallbackMessage].filter(Boolean).join(' '));
    }
  }

  const sourceKey = String(pdf.storagePath || pdf.sourceUrl || pdf.sourceName || '');
  const savedCalibration = await loadUserPageCalibration(db, user.uid, textbookId, part, sourceKey);
  let extracted;
  try {
    extracted = await extractRequestedPagesFromPdf(pdf.buffer, missing, {
      onProgress,
      user,
      ocrFallback: true,
      calibration: savedCalibration,
    });
  } catch (error) {
    if (error?.code === 'PAGE_CALIBRATION_REQUIRED') {
      error.calibration = {
        ...(error.calibration || {}),
        origin: 'automatic',
        textbookId,
        part: String(part || '1'),
        sourceKey,
        sourceName: pdf.sourceName || 'PDF учебника',
      };
    }
    throw error;
  }

  if (!savedCalibration && extracted.calibration) {
    await saveTextbookPageCalibration({
      db,
      user,
      textbookId,
      part,
      pdfPage: extracted.calibration.pdfPage,
      printedPage: extracted.calibration.printedPage,
      sourceKey,
      sourceName: pdf.sourceName || '',
      mode: extracted.calibration.mode || 'auto',
    }).catch((error) => console.warn('Не удалось сохранить автоматически найденную привязку страниц', error));
  }

  const enriched = extracted.pages.map((item) => ({
    ...item,
    sourceName: pdf.sourceName,
    sourceType: pdf.sourceType,
    sourceUrl: pdf.sourceUrl,
    cache: 'fresh',
  }));

  await Promise.all(enriched.map((item) => saveUserCachedPage(db, user.uid, textbookId, part, item)));
  const all = [...(cached.details || []), ...enriched];
  const result = buildContext(all, requestedPages, pdf.sourceType === 'firebase-storage' ? 'firebase-storage' : 'automatic');
  return {
    ...result,
    sourceName: pdf.sourceName,
    sourceUrl: pdf.sourceUrl,
    sourceType: pdf.sourceType,
    storagePath: pdf.storagePath || '',
    offset: extracted.offset,
    calibration: extracted.calibration || savedCalibration || null,
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
  const sourceKey = `uploaded:${file.name || 'textbook.pdf'}:${file.size || 0}`;
  const savedCalibration = await loadUserPageCalibration(db, user.uid, textbookId, part, sourceKey);
  let extracted;
  try {
    extracted = await extractRequestedPagesFromPdf(buffer, requestedPages, {
      onProgress,
      user,
      ocrFallback: true,
      calibration: savedCalibration,
    });
  } catch (error) {
    if (error?.code === 'PAGE_CALIBRATION_REQUIRED') {
      error.calibration = {
        ...(error.calibration || {}),
        origin: 'uploaded-pdf',
        textbookId,
        part: String(part || '1'),
        sourceKey,
        sourceName: file.name || 'Загруженный PDF учебника',
      };
    }
    throw error;
  }

  if (!savedCalibration && extracted.calibration) {
    await saveTextbookPageCalibration({
      db,
      user,
      textbookId,
      part,
      pdfPage: extracted.calibration.pdfPage,
      printedPage: extracted.calibration.printedPage,
      sourceKey,
      sourceName: file.name || '',
      mode: extracted.calibration.mode || 'auto',
    }).catch((error) => console.warn('Не удалось сохранить привязку загруженного PDF', error));
  }

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
    calibration: extracted.calibration || savedCalibration || null,
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
