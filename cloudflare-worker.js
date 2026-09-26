const FIREBASE_PROJECT_ID = "english-lesson-builder";
const PRIMARY_MODEL = "qwen3.8-27b";
const FALLBACK_MODEL = null;
const VISION_MODEL = "qwen3.8-27b";
const DEFAULT_ALIBABA_NATIVE_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
const MODEL_PRICING = {
  "qwen3.8-27b": { inputPerM: 0.50, outputPerM: 3.00, currency: "USD" },
};


const ALLOWED_ORIGINS = new Set([
  "https://lukshaolga1982-ship-it.github.io",
  "https://english-lesson-builder.web.app",
  "https://english-lesson-builder.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
]);

const E_PADRUCHNIK = "https://e-padruchnik.adu.by/";
const ALLOWED_TEXTBOOK_HOSTS = new Set([
  "e-padruchnik.adu.by",
  "files.knihi.com",
  "knihi.com",
  "padruchnik.com",
  "www.padruchnik.com",
]);

// Stable fallbacks are used only when the official portal cannot expose a direct PDF URL.
// The official e-padruchnik catalog remains the primary source and the UI always links to it for comparison.
const TEXTBOOK_SOURCES = {
  "demchenko-5-2025": {
    grade: 5,
    year: 2025,
    title: "Английский язык. 5 класс",
    authors: ["Демченко", "Лапицкая", "Юхнель", "Романчук"],
    partCount: 2,
  },
  "demchenko-6-2026": {
    grade: 6,
    year: 2026,
    title: "Английский язык. 6 класс",
    authors: ["Демченко", "Бушуева", "Юхнель", "Манешина", "Маслёнченко", "Рыбалко", "Лукша"],
    partCount: 2,
  },
  "yuhnel-6-2021": {
    grade: 6,
    year: 2021,
    title: "Английский язык. 6 класс",
    authors: ["Юхнель", "Наумова", "Малиновская"],
    partCount: 1,
    mirrors: {
      "1": "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/anhlijskaja_mova.06kl.2021.rus.pdf.zip/anhlijskaja_mova.06kl.2021_v2.rus.pdf",
    },
  },
  "yuhnel-7-2023": {
    grade: 7,
    year: 2023,
    title: "Английский язык. 7 класс",
    authors: ["Юхнель", "Демченко", "Наумова", "Романчук"],
    partCount: 1,
    mirrors: {
      "1": "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/anhlijskaja_mova.07kl.2023.rus.pdf.zip/anhlijskaja_mova.07kl.2023_v2.rus.pdf",
    },
  },
  "lapitskaya-8-2021": {
    grade: 8,
    year: 2021,
    title: "Английский язык. 8 класс",
    authors: ["Лапицкая", "Демченко", "Калишевич", "Юхнель", "Волков", "Севрюкова"],
    partCount: 1,
    mirrors: {
      "1": "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/anhlijskaja_mova.08kl.2021.rus.pdf.zip/anhlijskaja_mova.08kl.2021_v2.rus.pdf",
    },
  },
  "lapitskaya-9-2026": {
    grade: 9,
    year: 2025,
    alternateYears: [2026],
    title: "Английский язык. 9 класс",
    authors: ["Лапицкая", "Демченко", "Юхнель", "Волков"],
    partCount: 1,
  },
  "demchenko-11-2022": {
    grade: 11,
    year: 2022,
    title: "Английский язык. 11 класс",
    authors: ["Демченко", "Бушуева", "Севрюкова", "Лапицкая", "Романчук"],
    partCount: 2,
    mirrors: {
      "1": "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/anhlijskaja_mova.11kl.2022v.belrus.pdf.zip/anhlijskaja_mova.11kl.2022_1-v2.belrus.pdf",
      "2": "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/anhlijskaja_mova.11kl.2022v.belrus.pdf.zip/anhlijskaja_mova.11kl.2022_2-v2.belrus.pdf",
    },
  },
};

function isSafeCorsOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  // The API uses Firebase Bearer tokens, not cross-site cookies. Echoing a valid
  // HTTPS origin makes GitHub Pages, Firebase Hosting and custom domains work
  // without silently turning server errors into browser-level "Failed to fetch".
  const allowed = isSafeCorsOrigin(origin)
    ? (origin || "*")
    : "https://lukshaolga1982-ship-it.github.io";

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Expose-Headers": "X-Textbook-Source-Name,X-Textbook-Source-Url,X-Textbook-Source-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function verifyFirebaseToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Некорректный Firebase ID token.");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) throw new Error("Неподдерживаемая подпись Firebase token.");

  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error("Неверная аудитория Firebase token.");
  if (payload.iss !== expectedIssuer) throw new Error("Неверный издатель Firebase token.");
  if (!payload.sub) throw new Error("В Firebase token отсутствует uid.");
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("Firebase token истёк.");
  if (typeof payload.iat === "number" && payload.iat > now + 60) throw new Error("Некорректное время Firebase token.");

  const jwksResponse = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    { cf: { cacheTtl: 3600, cacheEverything: true } }
  );
  if (!jwksResponse.ok) throw new Error("Не удалось получить ключи Firebase.");
  const jwks = await jwksResponse.json();
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((key) => key.kid === header.kid) : jwks?.[header.kid];
  if (!jwk) throw new Error("Ключ подписи Firebase не найден.");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!verified) throw new Error("Подпись Firebase token не прошла проверку.");
  return payload;
}

async function requireUser(request) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return verifyFirebaseToken(match[1]);

  // v17: allow the Firebase ID token in the POST body. This lets the browser
  // use a CORS-simple text/plain request and avoids the OPTIONS preflight that
  // can fail on some networks/browser setups. We read from a clone so route
  // handlers can still parse the original request body normally.
  try {
    const body = await request.clone().json();
    const bodyToken = String(body?.firebaseToken || "").trim();
    if (bodyToken) return verifyFirebaseToken(bodyToken);
  } catch {}

  throw new Error("AUTH_REQUIRED");
}

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getUsage(env, uid, type) {
  if (!env.USAGE_LIMITS) return 0;
  const key = `${type}:${uid}:${utcDateKey()}`;
  const raw = await env.USAGE_LIMITS.get(key);
  return Number(raw || 0);
}

async function incrementUsage(env, uid, type) {
  if (!env.USAGE_LIMITS) return 0;
  const key = `${type}:${uid}:${utcDateKey()}`;
  const current = await getUsage(env, uid, type);
  const next = current + 1;
  await env.USAGE_LIMITS.put(key, String(next), { expirationTtl: 172800 });
  return next;
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(value) {
  return htmlDecode(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function absoluteUrl(value, base) {
  try { return new URL(htmlDecode(value), base).href; } catch { return null; }
}

function extractUrls(html, base) {
  const out = new Set();
  const attrRe = /(?:href|src|data-href|data-url|data-file)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(html))) {
    const url = absoluteUrl(match[1], base);
    if (url) out.add(url);
  }
  const pdfRe = /(?:https?:\/\/|\/)[^"'<>\s()]+\.pdf(?:\?[^"'<>\s()]*)?/gi;
  while ((match = pdfRe.exec(html))) {
    const url = absoluteUrl(match[0], base);
    if (url) out.add(url);
  }
  return [...out];
}

function scoreHtmlBlock(block, meta, part) {
  const text = normalizeText(block);
  let score = 0;
  if (text.includes("англий")) score += 6;
  if (text.includes(String(meta.grade))) score += 4;
  const years = [meta.year, ...(meta.alternateYears || [])].map(String);
  if (years.some((year) => text.includes(year))) score += 5;
  for (const author of meta.authors || []) {
    if (text.includes(normalizeText(author))) score += 3;
  }
  if (meta.partCount > 1 && part) {
    if (text.includes(`часть ${part}`) || text.includes(`ч. ${part}`) || text.includes(`часть&nbsp;${part}`)) score += 3;
  }
  return score;
}

async function looksLikePdf(url) {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_TEXTBOOK_HOSTS.has(parsed.hostname)) return false;
    const response = await fetch(url, {
      headers: { Range: "bytes=0-15", "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      cf: { cacheTtl: 86400 },
    });
    if (!response.ok && response.status !== 206) return false;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type.includes("application/pdf")) return true;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  } catch {
    return false;
  }
}

async function resolvePdfFromHtmlPage(pageUrl, meta, part) {
  try {
    const response = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      cf: { cacheTtl: 3600 },
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type.includes("application/pdf")) return { url: response.url || pageUrl, type: "official" };
    const html = await response.text();

    // Prefer links inside rows/cards whose text matches class/year/authors.
    const blocks = html.match(/<(?:tr|article|li|div)\b[^>]*>[\s\S]*?<\/(?:tr|article|li|div)>/gi) || [];
    const ranked = blocks
      .map((block) => ({ block, score: scoreHtmlBlock(block, meta, part) }))
      .filter((x) => x.score >= 8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const candidates = [];
    for (const entry of ranked) candidates.push(...extractUrls(entry.block, response.url || pageUrl));
    candidates.push(...extractUrls(html, response.url || pageUrl));

    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      let host;
      try { host = new URL(candidate).hostname; } catch { continue; }
      if (!ALLOWED_TEXTBOOK_HOSTS.has(host)) continue;

      if (/\.pdf(?:$|\?)/i.test(candidate) && await looksLikePdf(candidate)) {
        return { url: candidate, type: host === "e-padruchnik.adu.by" ? "official" : "mirror" };
      }

      // Some catalog rows open a detail/download page rather than the PDF directly.
      if (candidate.startsWith("http") && candidate !== pageUrl && !/\.(?:jpg|jpeg|png|gif|svg|css|js)(?:$|\?)/i.test(candidate)) {
        try {
          const detailResponse = await fetch(candidate, {
            headers: { "User-Agent": "Mozilla/5.0" },
            redirect: "follow",
            cf: { cacheTtl: 3600 },
          });
          if (!detailResponse.ok) continue;
          const detailType = (detailResponse.headers.get("content-type") || "").toLowerCase();
          if (detailType.includes("application/pdf")) return { url: detailResponse.url || candidate, type: host === "e-padruchnik.adu.by" ? "official" : "mirror" };
          const detailHtml = await detailResponse.text();
          const pdfs = extractUrls(detailHtml, detailResponse.url || candidate).filter((u) => /\.pdf(?:$|\?)/i.test(u));
          for (const pdf of pdfs.slice(0, 12)) {
            if (await looksLikePdf(pdf)) return { url: pdf, type: new URL(pdf).hostname === "e-padruchnik.adu.by" ? "official" : "mirror" };
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

function knihiCandidates(meta, part) {
  const grade = String(meta.grade).padStart(2, "0");
  const years = [meta.year, ...(meta.alternateYears || [])];
  const out = [];
  for (const year of years) {
    const root = "https://files.knihi.com/Knihi/skola/zvycajnyja/anhlijskaja_mova/";
    out.push(`${root}anhlijskaja_mova.${grade}kl.${year}.rus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_v2.rus.pdf`);
    out.push(`${root}anhlijskaja_mova.${grade}kl.${year}.belrus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_v2.belrus.pdf`);
    if (meta.partCount > 1) {
      out.push(`${root}anhlijskaja_mova.${grade}kl.${year}v.belrus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_${part}-v2.belrus.pdf`);
      out.push(`${root}anhlijskaja_mova.${grade}kl.${year}v.rus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_${part}-v2.rus.pdf`);
      out.push(`${root}anhlijskaja_mova.${grade}kl.${year}.rus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_${part}-v2.rus.pdf`);
      out.push(`${root}anhlijskaja_mova.${grade}kl.${year}.belrus.pdf.zip/anhlijskaja_mova.${grade}kl.${year}_${part}-v2.belrus.pdf`);
    }
  }
  return [...new Set(out)];
}

async function resolveTextbookSource(env, bookId, requestedPart) {
  const meta = TEXTBOOK_SOURCES[bookId];
  if (!meta) throw new Error("Для этого учебника автоматический источник ещё не настроен.");
  const part = meta.partCount > 1 ? String(requestedPart || "1") : "1";
  if (!/^\d+$/.test(part) || Number(part) < 1 || Number(part) > (meta.partCount || 1)) {
    throw new Error(`Для выбранного учебника укажите часть от 1 до ${meta.partCount || 1}.`);
  }

  const cacheKey = `textbook-source:${bookId}:part-${part}`;
  if (env.USAGE_LIMITS) {
    const cached = await env.USAGE_LIMITS.get(cacheKey, { type: "json" });
    if (cached?.url && await looksLikePdf(cached.url)) return cached;
  }

  // 1) Official portal. Try common client/server search query names; also inspect the root page.
  const searchText = `${meta.title} ${meta.authors?.[0] || ""} ${meta.year}`;
  const officialPages = [
    E_PADRUCHNIK,
    `${E_PADRUCHNIK}?search=${encodeURIComponent(searchText)}`,
    `${E_PADRUCHNIK}?q=${encodeURIComponent(searchText)}`,
    `${E_PADRUCHNIK}?title=${encodeURIComponent("Английский язык")}&class=${meta.grade}&year=${meta.year}`,
  ];
  for (const page of officialPages) {
    const resolved = await resolvePdfFromHtmlPage(page, meta, part);
    if (resolved?.url && new URL(resolved.url).hostname === "e-padruchnik.adu.by") {
      const value = { ...resolved, bookId, part, sourceName: "e-padruchnik.adu.by", catalogUrl: E_PADRUCHNIK };
      if (env.USAGE_LIMITS) await env.USAGE_LIMITS.put(cacheKey, JSON.stringify(value), { expirationTtl: 604800 });
      return value;
    }
  }

  // 2) Curated stable mirror for older editions.
  const mirror = meta.mirrors?.[part] || meta.mirrors?.["1"];
  if (mirror && await looksLikePdf(mirror)) {
    const value = { url: mirror, type: "mirror", bookId, part, sourceName: "files.knihi.com (зеркало электронной версии)", catalogUrl: E_PADRUCHNIK };
    if (env.USAGE_LIMITS) await env.USAGE_LIMITS.put(cacheKey, JSON.stringify(value), { expirationTtl: 604800 });
    return value;
  }

  // 3) Try predictable Knihi filenames for newer editions.
  for (const candidate of knihiCandidates(meta, part)) {
    if (await looksLikePdf(candidate)) {
      const value = { url: candidate, type: "mirror", bookId, part, sourceName: "files.knihi.com (зеркало электронной версии)", catalogUrl: E_PADRUCHNIK };
      if (env.USAGE_LIMITS) await env.USAGE_LIMITS.put(cacheKey, JSON.stringify(value), { expirationTtl: 604800 });
      return value;
    }
  }

  // 4) Last automatic fallback for older editions: public textbook mirror page.
  // For 2025+ editions we intentionally do not guess from an older similarly named book.
  if (Number(meta.year) < 2025) {
    const mirrorPage = `https://padruchnik.com/${meta.grade}-klass/anglijskij-jazyk-${meta.grade}/`;
    const mirrorResolved = await resolvePdfFromHtmlPage(mirrorPage, meta, part);
    if (mirrorResolved?.url) {
      const value = { ...mirrorResolved, type: "mirror", bookId, part, sourceName: "padruchnik.com (резервное зеркало)", catalogUrl: E_PADRUCHNIK };
      if (env.USAGE_LIMITS) await env.USAGE_LIMITS.put(cacheKey, JSON.stringify(value), { expirationTtl: 604800 });
      return value;
    }
  }

  throw new Error("Не удалось автоматически получить PDF выбранного учебника. Откройте e-padruchnik для сверки или временно вставьте текст страниц вручную.");
}

async function handleTextbookSource(request, env) {
  const body = await request.json();
  const source = await resolveTextbookSource(env, String(body?.bookId || ""), String(body?.part || "1"));
  return jsonResponse(request, { ok: true, source: { type: source.type, sourceName: source.sourceName, catalogUrl: source.catalogUrl, part: source.part } });
}

async function handleTextbookPdf(request, env) {
  const body = await request.json();
  const source = await resolveTextbookSource(env, String(body?.bookId || ""), String(body?.part || "1"));
  const sourceUrl = new URL(source.url);
  if (!ALLOWED_TEXTBOOK_HOSTS.has(sourceUrl.hostname)) throw new Error("Источник учебника не разрешён.");

  const upstream = await fetch(source.url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
    cf: { cacheTtl: 86400 },
  });
  if (!upstream.ok) throw new Error(`Источник учебника вернул HTTP ${upstream.status}.`);

  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("pdf") && !/\.pdf(?:$|\?)/i.test(upstream.url || source.url)) {
    throw new Error("Источник не вернул PDF-файл.");
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=3600",
      "X-Textbook-Source-Name": encodeURIComponent(source.sourceName || "Источник учебника"),
      "X-Textbook-Source-Url": source.url,
      "X-Textbook-Source-Type": source.type || "mirror",
      ...corsHeaders(request),
    },
  });
}

function normalizePrompt(body) {
  if (typeof body?.prompt === "string" && body.prompt.trim()) return body.prompt.trim();
  if (body?.lesson && typeof body.lesson === "object") return JSON.stringify(body.lesson, null, 2);
  throw new Error("В запросе отсутствует prompt.");
}

function extractFirstJsonObject(text) {
  let source = String(text || '').trim();
  source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = source.indexOf('{');
  if (first < 0) throw new Error('Модель не вернула JSON-объект.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = first; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(first, i + 1);
    }
  }
  throw new Error('JSON-ответ модели оборвался до закрывающей скобки.');
}

function safeJsonParse(text) {
  const candidate = extractFirstJsonObject(text);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const err = new Error(`Модель вернула некорректный JSON: ${error.message}`);
    err.code = 'INVALID_MODEL_JSON';
    err.raw = candidate;
    throw err;
  }
}

function addUsage(a, b) {
  if (!a && !b) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens', 'reasoning_tokens'];
  const out = {};
  for (const field of fields) {
    const value = Number(a?.[field] || 0) + Number(b?.[field] || 0);
    if (value) out[field] = value;
  }
  return Object.keys(out).length ? out : (b || a || null);
}

function alibabaNativeBaseUrl(env) {
  const configured = String(env.ALIBABA_NATIVE_BASE_URL || env.ALIBABA_WORKSPACE_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Backward compatibility: if the old compatible-mode URL is still configured,
  // convert it to the native DashScope base instead of using /chat/completions.
  const legacy = String(env.ALIBABA_BASE_URL || "").trim();
  if (legacy) {
    try {
      const url = new URL(legacy);
      return `${url.origin}/api/v1`;
    } catch {}
  }
  return DEFAULT_ALIBABA_NATIVE_BASE_URL;
}

function alibabaNativeEndpoint(env) {
  return `${alibabaNativeBaseUrl(env)}/services/aigc/multimodal-generation/generation`;
}

function alibabaApiKey(env) {
  return env.DASHSCOPE_API_KEY || env.ALIBABA_API_KEY || "";
}

function alibabaErrorMessage(data, status, model) {
  const raw = data?.message || data?.error?.message || data?.code || `Alibaba Model Studio вернул HTTP ${status} для ${model}`;
  if (status === 401 || status === 403) {
    return `Alibaba Model Studio отклонил API key. Проверьте DASHSCOPE_API_KEY и регион ключа. ${raw}`;
  }
  if (status === 429) {
    return `Alibaba Model Studio временно ограничил частоту запросов. Попробуйте ещё раз через минуту. ${raw}`;
  }
  return raw;
}

function extractUsageTotals(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens)) || (promptTokens + completionTokens);
  const reasoningTokens = Number(usage.reasoning_tokens ?? usage.reasoningTokens ?? 0) || 0;
  return { promptTokens, completionTokens, totalTokens, reasoningTokens };
}

function getModelPricing(model) {
  return MODEL_PRICING[String(model || "").toLowerCase()] || null;
}

function buildUsageSummary(usage, model, operation = "generate") {
  const totals = extractUsageTotals(usage);
  if (!totals) return null;
  const pricing = getModelPricing(model);
  const inputCost = pricing ? (totals.promptTokens / 1_000_000) * pricing.inputPerM : null;
  const outputCost = pricing ? (totals.completionTokens / 1_000_000) * pricing.outputPerM : null;
  const totalCost = inputCost != null && outputCost != null ? inputCost + outputCost : null;
  return {
    operation,
    model,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    reasoningTokens: totals.reasoningTokens,
    pricing: pricing ? {
      currency: pricing.currency || "USD",
      inputPerM: pricing.inputPerM,
      outputPerM: pricing.outputPerM,
    } : null,
    estimatedCost: totalCost != null ? {
      currency: pricing?.currency || "USD",
      input: Number(inputCost.toFixed(6)),
      output: Number(outputCost.toFixed(6)),
      total: Number(totalCost.toFixed(6)),
    } : null,
  };
}

function normalizeNativeMessage(message) {
  const role = message?.role || "user";
  const content = message?.content;
  if (Array.isArray(content)) {
    return {
      role,
      content: content.map((item) => {
        if (item?.image) return { image: item.image };
        if (item?.image_url?.url) return { image: item.image_url.url };
        if (item?.text != null) return { text: String(item.text) };
        if (item?.type === "text" && item?.text != null) return { text: String(item.text) };
        return { text: String(item ?? "") };
      }),
    };
  }
  return { role, content: [{ text: String(content ?? "") }] };
}

function extractNativeContent(data) {
  const content = data?.output?.choices?.[0]?.message?.content ?? data?.output?.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      return item?.text ?? item?.content ?? "";
    }).filter(Boolean).join("\n");
  }
  return String(content || "");
}

async function requestAlibabaNative(env, model, messages, maxTokens = 8000, temperature = 0.2) {
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("ALIBABA_TIMEOUT"), 90000);
    try {
      response = await fetch(alibabaNativeEndpoint(env), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${alibabaApiKey(env)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: { messages: messages.map(normalizeNativeMessage) },
          parameters: {
            result_format: "message",
            enable_thinking: false,
            temperature,
            max_tokens: maxTokens,
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const suffix = error?.name === "AbortError"
      ? "Alibaba не ответил за 90 секунд."
      : (error?.message || String(error));
    const wrapped = new Error(`Не удалось связаться с Alibaba Model Studio: ${suffix}`);
    wrapped.code = "ALIBABA_NETWORK_ERROR";
    throw wrapped;
  }
  const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  if (!response.ok || data?.code) {
    const error = new Error(alibabaErrorMessage(data, response.status || 400, model));
    error.status = response.status;
    error.code = data?.code || data?.error?.code || "";
    throw error;
  }
  return data;
}

async function callAlibaba(env, prompt, systemPrompt) {
  const models = [String(env.QWEN_MODEL || PRIMARY_MODEL), FALLBACK_MODEL].filter(Boolean);
  let lastError = null;

  for (const model of models) {
    try {
      const messages = [
        { role: "system", content: `${systemPrompt}\nВАЖНО: ответ должен быть одним валидным JSON-объектом. Не используй markdown-кодовые блоки и текст вне JSON.` },
        { role: "user", content: prompt },
      ];
      let data = await requestAlibabaNative(env, model, messages, 8000, 0.2);
      let usage = data.usage || null;
      let content = extractNativeContent(data);

      try {
        const result = safeJsonParse(content);
        return { model, result, usage, usageSummary: buildUsageSummary(usage, model, "generate"), jsonRetry: false, apiMode: "dashscope-native" };
      } catch {
        const retryMessages = [
          { role: "system", content: `${systemPrompt}\nВерни ТОЛЬКО один валидный JSON-объект. Без markdown и без текста до/после JSON. Сделай формулировки компактнее, но сохрани все обязательные поля.` },
          { role: "user", content: `${prompt}\n\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА JSON-ПРОВЕРКУ. Сгенерируй ответ заново целиком, короче и обязательно закрой все массивы/объекты.` },
        ];
        const retryData = await requestAlibabaNative(env, model, retryMessages, 8000, 0.1);
        usage = addUsage(usage, retryData.usage || null);
        content = extractNativeContent(retryData);
        const result = safeJsonParse(content);
        return { model, result, usage, usageSummary: buildUsageSummary(usage, model, "generate"), jsonRetry: true, apiMode: "dashscope-native" };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Не удалось получить корректный JSON-ответ от Alibaba Model Studio.");
}

async function callAlibabaVisionOcr(env, images) {
  const content = [{
    text: `Ты выполняешь точное распознавание страниц школьного учебника английского языка.
Для каждого изображения перепиши ВСЁ учебно значимое содержимое максимально близко к оригиналу:
- заголовки, номера и формулировки упражнений;
- английские тексты, диалоги, слова, таблицы и подписи;
- русские инструкции, если они есть;
- видимые номера страниц;
- коротко опиши содержательно значимые иллюстрации в квадратных скобках, только если они нужны для выполнения задания.
Не решай упражнения, не исправляй авторский текст, не переводи его и не придумывай пропущенное.
Сохраняй порядок элементов сверху вниз. Для таблиц используй понятную текстовую структуру.
Верни только один валидный JSON-объект вида {"pages":[{"label":"метка изображения","text":"распознанный текст"}]}. Порядок объектов должен совпадать с порядком изображений. Без markdown.`
  }];

  for (const image of images) {
    content.push({ text: `Метка следующего изображения: ${String(image.label || "страница").slice(0, 120)}` });
    content.push({ image: image.dataUrl });
  }

  const model = String(env.QWEN_VISION_MODEL || env.QWEN_MODEL || VISION_MODEL);
  let data = await requestAlibabaNative(env, model, [{ role: "user", content }], 8000, 0.1);
  let usage = data.usage || null;
  let raw = extractNativeContent(data);
  let parsed;
  let jsonRetry = false;
  try {
    parsed = safeJsonParse(raw);
  } catch {
    jsonRetry = true;
    const retryContent = [...content, { text: "Предыдущий ответ был невалидным JSON. Повтори распознавание и верни только один корректно закрытый JSON-объект без markdown." }];
    const retryData = await requestAlibabaNative(env, model, [{ role: "user", content: retryContent }], 8000, 0.05);
    usage = addUsage(usage, retryData.usage || null);
    raw = extractNativeContent(retryData);
    parsed = safeJsonParse(raw);
  }
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
  if (!pages.length) throw new Error("Alibaba Qwen не вернул распознанные страницы.");
  return { model, pages, usage, usageSummary: buildUsageSummary(usage, model, "ocr"), jsonRetry, apiMode: "dashscope-native" };
}

async function handleOcrTextbookImages(request, env, user) {
  const OCR_DAILY_LIMIT = 30;
  const used = await getUsage(env, user.sub, "ocr");
  if (used >= OCR_DAILY_LIMIT) {
    return jsonResponse(request, { ok: false, error: "OCR_LIMIT", message: "Лимит распознавания страниц на сегодня исчерпан.", limit: OCR_DAILY_LIMIT, used, remaining: 0 }, 429);
  }

  const body = await request.json();
  const images = Array.isArray(body?.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return jsonResponse(request, { ok: false, error: "NO_IMAGES", message: "Не переданы изображения страниц." }, 400);
  if (Array.isArray(body?.images) && body.images.length > 3) return jsonResponse(request, { ok: false, error: "TOO_MANY_IMAGES", message: "За один запрос можно распознать не более 3 изображений." }, 400);

  let totalChars = 0;
  const clean = images.map((item, index) => {
    const dataUrl = String(item?.dataUrl || "");
    const label = String(item?.label || `Фото ${index + 1}`).slice(0, 120);
    if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(dataUrl)) throw new Error("Поддерживаются изображения JPG, PNG и WEBP.");
    totalChars += dataUrl.length;
    return { dataUrl, label };
  });
  if (totalChars > 18_000_000) return jsonResponse(request, { ok: false, error: "IMAGES_TOO_LARGE", message: "Изображения слишком большие. Попробуйте загрузить меньше страниц за один раз." }, 413);

  const result = await callAlibabaVisionOcr(env, clean);
  const next = await incrementUsage(env, user.sub, "ocr");
  return jsonResponse(request, { ok: true, ...result, limit: OCR_DAILY_LIMIT, used: next, remaining: Math.max(0, OCR_DAILY_LIMIT - next) });
}

const LESSON_SYSTEM_PROMPT = `
Ты — методист по английскому языку системы общего среднего образования Республики Беларусь.
Создавай методически обоснованные планы-конспекты на русском языке, а реплики учителя,
формулировки упражнений и языковой материал на английском — там, где это уместно.

Обязательные принципы:
- цель конкретная, диагностичная и достижимая за указанное время;
- логика урока строится по четырём критериям: целенаправленность, целостность, динамика, связность;
- все этапы и упражнения взаимозависимы и работают на цель урока;
- результат предыдущего этапа становится материалом, вопросом, проблемой или опорой для следующего;
- между каждым соседним этапом обязателен содержательный bridgeToNext: результат → дефицит/вопрос → следующее действие;
- запрещены пустые переходы вроде «теперь перейдём к следующему заданию», если они не объясняют содержательную связь;
- последовательность упражнений должна учитывать закономерности формирования навыков и развития речевых умений: от осмысления/тренировки с опорой к условно-речевому и затем самостоятельному речевому использованию, когда это требуется целью;
- ведущий вид речевой деятельности должен реально определять кульминационную коммуникативную задачу;
- выбранные компетенции и направления функциональной грамотности должны быть реализованы в конкретных действиях учащихся, а не просто перечислены;
- учитывай возраст, класс, базовый/повышенный уровень, число учащихся и пожелания учителя;
- двигательная пауза, если она включена, должна реально менять позу/движение, занимать 1–3 минуты и быть возрастно уместной; для 9–11 классов избегай инфантильных форм;
- рефлексия возвращает к цели и критериям успеха, фиксирует прогресс и трудности;
- если запрошено аудирование, включай текст для озвучивания, задания и ответы;
- если в запросе передан textbookContext, это главный содержательный источник для работы с указанными страницами: используй реальные тексты, упражнения, лексику и грамматику из него;
- не придумывай номера или содержание упражнений, которых нет в textbookContext;
- авторские задания допустимы только как развитие материала учебника и должны быть явно отличимы от упражнений учебника;
- для всех проверяемых заданий добавляй ключи/образцы ответов;
- время всех этапов в сумме должно соответствовать продолжительности урока;
- пользовательский prompt содержит дополнительное методическое ядро и точный JSON-контракт — соблюдай их.

Верни ТОЛЬКО валидный JSON-объект без markdown и без пояснений вне JSON.
`;

const REFINE_SYSTEM_PROMPT = `
Ты редактируешь отдельный фрагмент плана-конспекта урока английского языка для школы Республики Беларусь.
Сохраняй тему, возраст, уровень, длительность и методическую функцию исходного этапа. Учитывай соседние этапы.
При изменении не ломай сквозную содержательную и языковую логику. bridgeToNext должен быть содержательным:
конкретный результат текущего этапа → вопрос/дефицит → необходимость следующего действия.
Если передан текст учебника, не выдумывай содержание отсутствующих упражнений.
Верни ТОЛЬКО валидный JSON-объект без markdown.
`;

async function handleGenerate(request, env, user) {
  const FULL_DAILY_LIMIT = 5;
  const used = await getUsage(env, user.sub, "generate");
  if (used >= FULL_DAILY_LIMIT) {
    return jsonResponse(request, { ok: false, error: "DAILY_LIMIT", message: "Лимит полных генераций на сегодня исчерпан.", limit: FULL_DAILY_LIMIT, used, remaining: 0 }, 429);
  }
  const body = await request.json();
  const prompt = normalizePrompt(body);
  if (prompt.length > 50000) return jsonResponse(request, { ok: false, error: "PROMPT_TOO_LARGE", message: "Материал запроса слишком большой." }, 413);
  const alibaba = await callAlibaba(env, prompt, LESSON_SYSTEM_PROMPT);
  const next = await incrementUsage(env, user.sub, "generate");
  return jsonResponse(request, { ok: true, ...alibaba, limit: FULL_DAILY_LIMIT, used: next, remaining: Math.max(0, FULL_DAILY_LIMIT - next) });
}

async function handleRefine(request, env, user) {
  const REFINE_DAILY_LIMIT = 40;
  const used = await getUsage(env, user.sub, "refine");
  if (used >= REFINE_DAILY_LIMIT) {
    return jsonResponse(request, { ok: false, error: "REFINE_LIMIT", message: "Лимит точечных изменений на сегодня исчерпан.", limit: REFINE_DAILY_LIMIT, used, remaining: 0 }, 429);
  }
  const body = await request.json();
  const prompt = normalizePrompt(body);
  const alibaba = await callAlibaba(env, prompt, REFINE_SYSTEM_PROMPT);
  const next = await incrementUsage(env, user.sub, "refine");
  const usageSummary = alibaba.usageSummary ? { ...alibaba.usageSummary, operation: "refine" } : null;
  return jsonResponse(request, { ok: true, ...alibaba, usageSummary, limit: REFINE_DAILY_LIMIT, used: next, remaining: Math.max(0, REFINE_DAILY_LIMIT - next) });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/cors-test") {
      return jsonResponse(request, {
        ok: true,
        service: "Smart Lesson CORS test",
        receivedOrigin: request.headers.get("Origin") || null,
        accessControlAllowOrigin: corsHeaders(request)["Access-Control-Allow-Origin"],
      });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse(request, {
        ok: true,
        service: "Smart Lesson API",
        alibabaConfigured: Boolean(alibabaApiKey(env)),
        alibabaNativeBaseUrl: alibabaNativeBaseUrl(env),
        alibabaNativeEndpoint: alibabaNativeEndpoint(env),
        apiMode: "dashscope-native-multimodal",
        workerVersion: "v17-no-preflight",
        corsMode: "simple-post-no-preflight",
        authTransport: "firebase-token-in-body-or-bearer",
        kvConfigured: Boolean(env.USAGE_LIMITS),
        automaticTextbooks: Object.keys(TEXTBOOK_SOURCES),
        primaryModel: PRIMARY_MODEL,
        fallbackModel: FALLBACK_MODEL,
        visionModel: VISION_MODEL,
        textbookImageOcr: true,
        thinkingEnabled: false,
        structuredOutputMode: "worker-validated-json",
        jsonAutoRetry: true,
      });
    }

    if (request.method !== "POST") return jsonResponse(request, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

    let user;
    try {
      user = await requireUser(request);
    } catch (error) {
      if (error?.message === "AUTH_REQUIRED") return jsonResponse(request, { ok: false, error: "AUTH_REQUIRED", message: "Необходимо войти через Google." }, 401);
      console.error("Firebase auth verification failed:", error);
      return jsonResponse(request, { ok: false, error: "INVALID_TOKEN", message: "Не удалось проверить авторизацию Firebase. Выйдите из аккаунта на сайте, войдите снова и повторите действие." }, 401);
    }

    try {
      if (url.pathname === "/textbook-source") return await handleTextbookSource(request, env, user);
      if (url.pathname === "/textbook-pdf") return await handleTextbookPdf(request, env, user);

      if (!alibabaApiKey(env)) return jsonResponse(request, { ok: false, error: "ALIBABA_NOT_CONFIGURED", message: "В Worker не найден секрет DASHSCOPE_API_KEY." }, 500);
      if (url.pathname === "/ocr-textbook-images") return await handleOcrTextbookImages(request, env, user);

      if (url.pathname === "/generate") return await handleGenerate(request, env, user);
      if (url.pathname === "/refine") return await handleRefine(request, env, user);
      return jsonResponse(request, { ok: false, error: "NOT_FOUND" }, 404);
    } catch (error) {
      console.error("Smart Lesson API error:", error);
      return jsonResponse(request, { ok: false, error: "SERVER_ERROR", message: error?.message || "Неизвестная ошибка сервера." }, 500);
    }
  },
};
