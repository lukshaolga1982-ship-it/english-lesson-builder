const FIREBASE_PROJECT_ID = "english-lesson-builder";
const PRIMARY_MODEL = "qwen/qwen3.8-27b";
const FALLBACK_MODEL = "openai/gpt-oss-120b";

const ALLOWED_ORIGINS = new Set([
  "https://lukshaolga1982-ship-it.github.io",
  "https://english-lesson-builder.web.app",
  "https://english-lesson-builder.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowed = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://lukshaolga1982-ship-it.github.io";

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
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

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Неподдерживаемая подпись Firebase token.");
  }

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
  const jwk = jwks[header.kid];
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

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData
  );

  if (!verified) throw new Error("Подпись Firebase token не прошла проверку.");
  return payload;
}

async function requireUser(request) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("AUTH_REQUIRED");
  return verifyFirebaseToken(match[1]);
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

function normalizePrompt(body) {
  if (typeof body?.prompt === "string" && body.prompt.trim()) return body.prompt.trim();
  if (body?.lesson && typeof body.lesson === "object") {
    return JSON.stringify(body.lesson, null, 2);
  }
  throw new Error("В запросе отсутствует prompt.");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callGroq(env, prompt, systemPrompt) {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.35,
          max_completion_tokens: 12000,
          response_format: { type: "json_object" },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        lastError = new Error(
          data?.error?.message || `Groq вернул HTTP ${response.status} для ${model}`
        );
        continue;
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = new Error(`Groq не вернул текст ответа для ${model}.`);
        continue;
      }

      return {
        model,
        result: safeJsonParse(content),
        usage: data.usage || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось получить ответ от Groq.");
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
- если даны страницы учебника, опирайся только на переданное содержание страниц и не выдумывай упражнения, которых там нет;
- для всех проверяемых заданий добавляй ключи/образцы ответов;
- время всех этапов в сумме должно соответствовать продолжительности урока;
- пользовательский prompt содержит дополнительное методическое ядро и точный JSON-контракт — соблюдай их.

Верни ТОЛЬКО валидный JSON-объект без markdown и без пояснений вне JSON.
`;

const REFINE_SYSTEM_PROMPT = `
Ты редактируешь отдельный фрагмент плана-конспекта урока английского языка для школы
Республики Беларусь. Сохраняй тему, возраст, уровень, длительность и методическую функцию исходного этапа.
Учитывай соседние этапы. При изменении не ломай сквозную содержательную и языковую логику.
bridgeToNext должен быть содержательным: конкретный результат текущего этапа → вопрос/дефицит → необходимость следующего действия.
Выполни указанное пользователем изменение и верни ТОЛЬКО валидный JSON-объект без markdown.
`;

async function handleGenerate(request, env, user) {
  const FULL_DAILY_LIMIT = 5;
  const used = await getUsage(env, user.sub, "generate");

  if (used >= FULL_DAILY_LIMIT) {
    return jsonResponse(request, {
      ok: false,
      error: "DAILY_LIMIT",
      message: "Лимит полных генераций на сегодня исчерпан.",
      limit: FULL_DAILY_LIMIT,
      used,
      remaining: 0,
    }, 429);
  }

  const body = await request.json();
  const prompt = normalizePrompt(body);

  if (prompt.length > 180000) {
    return jsonResponse(request, {
      ok: false,
      error: "PROMPT_TOO_LARGE",
      message: "Материал запроса слишком большой.",
    }, 413);
  }

  const groq = await callGroq(env, prompt, LESSON_SYSTEM_PROMPT);
  const next = await incrementUsage(env, user.sub, "generate");

  return jsonResponse(request, {
    ok: true,
    ...groq,
    limit: FULL_DAILY_LIMIT,
    used: next,
    remaining: Math.max(0, FULL_DAILY_LIMIT - next),
  });
}

async function handleRefine(request, env, user) {
  const REFINE_DAILY_LIMIT = 40;
  const used = await getUsage(env, user.sub, "refine");

  if (used >= REFINE_DAILY_LIMIT) {
    return jsonResponse(request, {
      ok: false,
      error: "REFINE_LIMIT",
      message: "Лимит точечных изменений на сегодня исчерпан.",
      limit: REFINE_DAILY_LIMIT,
      used,
      remaining: 0,
    }, 429);
  }

  const body = await request.json();
  const prompt = normalizePrompt(body);
  const groq = await callGroq(env, prompt, REFINE_SYSTEM_PROMPT);
  const next = await incrementUsage(env, user.sub, "refine");

  return jsonResponse(request, {
    ok: true,
    ...groq,
    limit: REFINE_DAILY_LIMIT,
    used: next,
    remaining: Math.max(0, REFINE_DAILY_LIMIT - next),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse(request, {
        ok: true,
        service: "Smart Lesson API",
        groqConfigured: Boolean(env.GROQ_API_KEY),
        kvConfigured: Boolean(env.USAGE_LIMITS),
        primaryModel: PRIMARY_MODEL,
        fallbackModel: FALLBACK_MODEL,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(request, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse(request, {
        ok: false,
        error: "GROQ_NOT_CONFIGURED",
        message: "В Worker не найден секрет GROQ_API_KEY.",
      }, 500);
    }

    let user;
    try {
      user = await requireUser(request);
    } catch (error) {
      if (error?.message === "AUTH_REQUIRED") {
        return jsonResponse(request, {
          ok: false,
          error: "AUTH_REQUIRED",
          message: "Необходимо войти через Google.",
        }, 401);
      }

      return jsonResponse(request, {
        ok: false,
        error: "INVALID_TOKEN",
        message: "Не удалось проверить авторизацию Firebase.",
      }, 401);
    }

    try {
      if (url.pathname === "/generate") return await handleGenerate(request, env, user);
      if (url.pathname === "/refine") return await handleRefine(request, env, user);
      return jsonResponse(request, { ok: false, error: "NOT_FOUND" }, 404);
    } catch (error) {
      console.error("Smart Lesson API error:", error);

      return jsonResponse(request, {
        ok: false,
        error: "SERVER_ERROR",
        message: error?.message || "Неизвестная ошибка сервера.",
      }, 500);
    }
  },
};
