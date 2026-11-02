import fs from 'fs';
import path from 'path';

const cache = new Map();

function readDotEnv() {
  const out = {};
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const splitAt = trimmed.indexOf('=');
      const key = trimmed.slice(0, splitAt).trim();
      let value = trimmed.slice(splitAt + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch { /* الملف غير موجود */ }
  return out;
}

function currentEnv(fallback) {
  const file = readDotEnv();
  const key = file.API_KEY || fallback.API_KEY || '';
  let base = file.API_BASE_URL || fallback.API_BASE_URL || '';
  let model = file.API_MODEL || fallback.API_MODEL || '';
  if (key.startsWith('gsk_')) {
    if (!base || base.includes('openai.com')) base = 'https://api.groq.com/openai/v1';
    if (!model || model.startsWith('gpt-4') || model === 'gpt-4o-mini') model = 'openai/gpt-oss-120b';
  }
  return { API_KEY: key, API_BASE_URL: base, API_MODEL: model };
}

function hideSecrets(text) {
  return String(text || '')
    .replace(/gsk_[A-Za-z0-9]+/g, 'gsk_…')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…')
    .slice(0, 180);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function acceptPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n);
}

function pricesFromPayload(data, items) {
  const rows = Array.isArray(data?.prices)
    ? data.prices
    : Array.isArray(data?.items)
      ? data.items
      : data?.priceSar ? [data] : [];
  const prices = [];
  rows.forEach((row, index) => {
    const priceSar = acceptPrice(row?.priceSar ?? row?.price);
    if (!priceSar) return;
    const raw = typeof row?.raw === 'string' ? row.raw : '';
    const match = items.find(item => item.raw === raw || item.name === row?.name) || (items.length === 1 ? items[0] : items[index]);
    if (!match || prices.some(price => price.raw === match.raw)) return;
    prices.push({ raw: match.raw, name: match.name, priceSar });
  });
  return prices;
}

async function askChat(env, items) {
  const base = (env.API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const model = env.API_MODEL || 'gpt-4o-mini';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Reply with json only: {"prices":[{"raw":"same raw","priceSar":1234}]}. priceSar is the current Saudi retail price of ONE piece in riyals. For perfume, price the milliliters in sizeMl or in the text. A 200ml bottle is the large size and must not be priced as a 100ml bottle. ايماجنيشن or Imagination with no other brand means Louis Vuitton Imagination. Keep each raw value unchanged.',
        },
        { role: 'user', content: JSON.stringify({ items }) },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = hideSecrets(data?.error?.message || response.statusText);
    throw new Error(message || 'upstream');
  }
  const content = data?.choices?.[0]?.message?.content ?? '';
  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) return [];
  return pricesFromPayload(JSON.parse(content.slice(jsonStart, jsonEnd + 1)), items);
}

async function askQuote(env, items) {
  const endpoint = env.API_BASE_URL.replace(/\/$/, '');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.API_KEY}`,
    },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  return pricesFromPayload(await response.json(), items);
}

function usesChat(url) {
  return !url || /openai\.com|chat\/completions|\/v1\/?$/.test(url);
}

export function quoteApi(env) {
  const attach = server => {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url || '';
      const live = currentEnv(env);
      if (url === '/api/health' && req.method === 'GET') {
        send(res, 200, { configured: Boolean(live.API_KEY) });
        return;
      }
      if (url !== '/api/quote' || req.method !== 'POST') return next();
      try {
        const body = await readBody(req);
        const items = Array.isArray(body.items) ? body.items.slice(0, 12) : [];
        const clean = items
          .filter(item => item && typeof item.raw === 'string' && typeof item.name === 'string')
          .map(item => {
            const size = Number(item.sizeMl);
            return {
              raw: item.raw.slice(0, 80),
              name: item.name.slice(0, 80),
              ...(Number.isFinite(size) && size > 0 && size <= 5000 ? { sizeMl: Math.round(size) } : {}),
            };
          });
        if (!live.API_KEY) {
          send(res, 200, { ok: false, reason: 'missing_key', prices: [] });
          return;
        }
        const missing = [];
        const prices = [];
        for (const item of clean) {
          const hit = cache.get(item.raw);
          if (hit) prices.push({ ...item, priceSar: hit });
          else missing.push(item);
        }
        if (missing.length) {
          const fresh = usesChat(live.API_BASE_URL) ? await askChat(live, missing) : await askQuote(live, missing);
          for (const row of fresh) {
            if (cache.size > 200) cache.clear();
            cache.set(row.raw, row.priceSar);
            prices.push(row);
          }
        }
        send(res, 200, { ok: prices.length > 0, prices });
      } catch (error) {
        send(res, 200, { ok: false, reason: 'upstream', detail: hideSecrets(error?.message), prices: [] });
      }
    });
  };
  return {
    name: 'hisba-quote-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
