import { doc, getDoc } from 'firebase/firestore';

export function parsePageNumbers(value, maxPages = 24) {
  if (!value) return [];
  const out = new Set();
  const normalized = String(value).replace(/[–—]/g, '-');
  for (const token of normalized.split(/[;,\s]+/).filter(Boolean)) {
    if (token.includes('-')) {
      const [aRaw, bRaw] = token.split('-');
      const a = Number(aRaw);
      const b = Number(bRaw);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      for (let p = from; p <= to && out.size < maxPages; p += 1) out.add(p);
    } else {
      const p = Number(token);
      if (Number.isFinite(p)) out.add(p);
    }
    if (out.size >= maxPages) break;
  }
  return [...out].slice(0, maxPages);
}

export async function loadTextbookPagesFromFirestore(db, textbookId, pagesString) {
  const pages = parsePageNumbers(pagesString);
  if (!textbookId || textbookId.startsWith('custom-') || pages.length === 0) {
    return { text: '', requestedPages: pages, loadedPages: [], missingPages: pages, source: 'firestore' };
  }

  const loaded = [];
  const missing = [];

  await Promise.all(pages.map(async (page) => {
    try {
      const snap = await getDoc(doc(db, 'textbooks', textbookId, 'pages', String(page)));
      const text = snap.exists() ? String(snap.data()?.text || '').trim() : '';
      if (text) loaded.push({ page, text });
      else missing.push(page);
    } catch (error) {
      console.error(`Не удалось загрузить страницу ${page}`, error);
      missing.push(page);
    }
  }));

  loaded.sort((a, b) => a.page - b.page);
  missing.sort((a, b) => a - b);

  const text = loaded
    .map(({ page, text: pageText }) => `=== СТРАНИЦА ${page} ===\n${pageText}`)
    .join('\n\n')
    .slice(0, 70000);

  return {
    text,
    requestedPages: pages,
    loadedPages: loaded.map((x) => x.page),
    missingPages: missing,
    source: 'firestore',
  };
}

export function manualTextbookContext(text, pagesString) {
  const clean = String(text || '').trim();
  const requestedPages = parsePageNumbers(pagesString);
  return {
    text: clean ? `=== ТЕКСТ СТРАНИЦ, ВСТАВЛЕННЫЙ УЧИТЕЛЕМ ===\n${clean}`.slice(0, 70000) : '',
    requestedPages,
    loadedPages: requestedPages,
    missingPages: [],
    source: 'manual',
  };
}
