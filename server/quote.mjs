import fs from 'fs';
import path from 'path';

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

function currentEnv(fallback = {}) {
  const file = readDotEnv();
  const key = file.API_KEY || process.env.API_KEY || fallback.API_KEY || '';
  let base = file.API_BASE_URL || process.env.API_BASE_URL || fallback.API_BASE_URL || '';
  let model = file.API_MODEL || process.env.API_MODEL || fallback.API_MODEL || '';
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
  const n = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
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
  return !url || /openai\.com|groq\.com|chat\/completions|\/v1\/?$/.test(url);
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function pricesInText(text) {
  const flat = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#x200[ef];|&lrm;|&rlm;/g, '')
    .replace(/[‎‏]/g, '');
  const found = [];
  const re = /(?:ريال(?:اً|ات)?|ر\.?\s*س|sar)\s*[^\d]{0,8}(\d{1,3}(?:[,٬]\d{3})+(?:[.,]\d{1,2})?|\d{2,6}(?:[.,]\d{2})?)|(\d{1,3}(?:[,٬]\d{3})+(?:[.,]\d{1,2})?|\d{3,6})\s*[^\d]{0,8}(?:ريال(?:اً|ات)?|ر\.?\s*س|sar)/gi;
  for (const match of flat.matchAll(re)) {
    const raw = (match[1] || match[2] || '').replace(/[,٬]/g, '');
    const price = acceptPrice(raw);
    if (price && price >= 15) found.push(price);
  }
  return found;
}

function pricesFromJsonLd(data, found) {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    data.forEach(item => pricesFromJsonLd(item, found));
    return;
  }
  const currency = String(data.priceCurrency || '');
  const price = acceptPrice(data.lowPrice ?? data.price);
  if (price && price >= 30 && (!currency || currency === 'SAR')) found.push(price);
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') pricesFromJsonLd(value, found);
  }
}

function priceFromHtml(html) {
  const sale = acceptPrice(html.match(/product:sale_price:amount"\s+content="([\d.]+)"/i)?.[1]);
  if (sale && sale >= 30) return sale;
  const regular = acceptPrice((html.match(/product:price:amount"\s+content="([\d.]+)"/i) || [])[1]);
  if (regular && regular >= 30) return regular;
  const og = acceptPrice((html.match(/property="og:price:amount"\s+content="([\d.]+)"/i) || html.match(/itemprop="price"\s+content="([\d.]+)"/i) || [])[1]);
  if (og && og >= 30) return og;
  const found = [];
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { pricesFromJsonLd(JSON.parse(block[1]), found); }
    catch { /* صفحة بلا بيانات منظمة */ }
  }
  for (const match of html.matchAll(/"lowPrice"\s*:\s*"?([\d.]+)/g)) {
    const price = acceptPrice(match[1]);
    if (price && price >= 100) found.push(price);
  }
  const notable = found.filter(price => price >= 100);
  return median(notable.length ? notable : found);
}

function trustedHost(host) {
  return /noon\.com|nahdionline|jarir|extra\.com|amazon\.sa|pcpalace|microless|goldenscent|sephora|faces\.com|apple\.com/.test(host);
}

function shopName(host) {
  const names = [
    [/nahdionline/, 'النهدي'],
    [/noon\.com/, 'نون'],
    [/jarir/, 'جرير'],
    [/extra\.com/, 'اكسترا'],
    [/amazon\.sa/, 'أمازون السعودية'],
    [/pcpalace/, 'بي سي بالاس'],
    [/microless/, 'ميكرولس'],
    [/goldenscent/, 'جولدن سنت'],
    [/sephora/, 'سيفورا'],
    [/faces\.com/, 'فيسز'],
    [/apple\.com/, 'أبل'],
  ];
  for (const [pattern, name] of names) {
    if (pattern.test(host)) return name;
  }
  return host.replace(/^www\./, '');
}

function checkedOn() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function tokensOf(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/).filter(Boolean);
}

function conflictsWithQuery(itemName, resultText) {
  const name = tokensOf(itemName);
  const page = new Set(tokensOf(resultText));
  const has = word => name.includes(word);
  const pageHas = word => page.has(word);
  if (!has('pro') && !has('برو') && (pageHas('pro') || pageHas('برو'))) return true;
  if (!has('max') && !has('ماكس') && (pageHas('max') || pageHas('ماكس'))) return true;
  if (!has('plus') && !has('بلس') && (pageHas('plus') || pageHas('بلس'))) return true;
  if ((has('max') || has('ماكس')) && !pageHas('max') && !pageHas('ماكس')) return true;
  const wanted = name.find(token => /^(64|128|256|512|1024)$/.test(token));
  const stated = [...page].filter(token => /^(64|128|256|512|1024)$/.test(token));
  if (wanted && stated.length && !stated.includes(wanted)) return true;
  return false;
}

function pickOffer(entries) {
  const pages = entries.filter(entry => entry.fromPage);
  const pool = pages.length ? pages : entries;
  const trusted = pool.filter(entry => entry.trusted);
  return (trusted.length ? trusted : pool)[0] || null;
}

function decodeResultUrl(href) {
  const encoded = href.match(/uddg=([^&"]+)/);
  if (!encoded) return href;
  try { return decodeURIComponent(encoded[1]); }
  catch { return href; }
}

function searchResults(html) {
  const rows = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(re)) {
    let url = decodeResultUrl(match[1]);
    try { url = new URL(url).toString(); } catch { continue; }
    const host = new URL(url).hostname;
    if (/duckduckgo|google\.|youtube|facebook|instagram|tiktok|wikipedia/.test(host)) continue;
    const title = match[2].replace(/<[^>]+>/g, '');
    const snippet = match[4].replace(/<[^>]+>/g, ' ');
    const path = new URL(url).pathname + new URL(url).search;
    const isSearchPage = /\/search|\/s\?|[?&](?:k|query)=/.test(path) && !/\/products?\//.test(path);
    rows.push({ url, host, title, snippet, isSearchPage, saudi: host.endsWith('.sa') || /\/sa(?:[-/]|$)/.test(url) || /السعود/.test(title + snippet) });
  }
  return rows.slice(0, 12);
}

async function readLimited(response, max = 700_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  try { await reader.cancel(); } catch { /* الاكتفاء بأول جزء */ }
  return Buffer.concat(chunks).toString('utf8');
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8',
};

async function fetchText(url, timeout = 7000, max = 700_000, extraHeaders = {}) {
  const headers = { ...FETCH_HEADERS, ...extraHeaders };
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!response.ok) return '';
  const html = await readLimited(response, max);
  const verify = html.match(/URL='([^']*bm-verify=[^']+)'/);
  if (!verify || html.length > 20_000) return html;
  const cookies = response.headers.getSetCookie?.() || [];
  const cookie = cookies.map(item => item.split(';')[0]).join('; ');
  if (!cookie) return html;
  const next = new URL(verify[1], response.url);
  if (next.hostname !== new URL(response.url).hostname) return html;
  const second = await fetch(next, {
    headers: { ...headers, cookie, referer: response.url },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!second.ok) return '';
  return readLimited(second, max);
}

function mentionedNumbers(text) {
  return new Set((String(text).match(/\d{3,}/g) || []));
}

function isComponentQuery(text) {
  return /كرت|معالج|gpu|rtx|motherboard/.test(String(text));
}

function isBundleTitle(text) {
  return /بيسي|تجميع|تجميعه|حاسب مكتبي|كمبيوتر مكتبي|gaming pc/.test(String(text));
}

function isSaudiShop(result) {
  if (result.host.endsWith('.sa') || result.host.endsWith('.com.sa')) return true;
  if (/noon\.com|nahdionline|jarir|extra\.com|goldenscent|faces\.com|sephora|amazon\.sa/.test(result.host)) return true;
  if (/apple\.com|samsung\.com/.test(result.host) && /\/sa(?:[-/]|$)/.test(result.url)) return true;
  if (/\/saudi|\/ar-sa|saudi-ar|\/sa(?:[-/]|$)/.test(result.url)) return true;
  return result.saudi;
}

function toEnglish(name) {
  let text = String(name || '');
  const phrases = [
    ['ماك بوك اير', 'MacBook Air'],
    ['ماك بوك برو', 'MacBook Pro'],
    ['ماك بوك', 'MacBook'],
    ['آيفون', 'iPhone'],
    ['ايفون', 'iPhone'],
    ['آيباد', 'iPad'],
    ['ايباد', 'iPad'],
    ['جالكسي', 'Galaxy'],
    ['سامسونج', 'Samsung'],
    ['برو ماكس', 'Pro Max'],
    ['جيجا', 'GB'],
    ['تيرا', 'TB'],
    ['برو', 'Pro'],
    ['اير', 'Air'],
  ];
  for (const [from, to] of phrases) text = text.replaceAll(from, to);
  return text.replace(/\s+/g, ' ').trim();
}

function searchQueries(item) {
  const name = String(item.name || '').replace(/\s+/g, ' ').trim();
  const english = toEnglish(name);
  const queries = [`${name} سعر`];
  if (english && english.toLowerCase() !== name.toLowerCase()) queries.push(`${english} Saudi Arabia SAR`);
  if (/iPhone|iPad|MacBook|Apple/i.test(english) || /ايفون|ايباد|ماك/.test(name)) queries.push(`${english || name} site:apple.com/sa-ar`);
  else if (/Samsung|Galaxy/i.test(english) || /سامسونج|جالكسي/.test(name)) queries.push(`${english || name} site:samsung.com/sa`);
  return [...new Set(queries.map(query => query.replace(/\s+/g, ' ').trim().slice(0, 140)))].slice(0, 3);
}

function sourceRank(result, itemName) {
  const apple = /ايفون|ايباد|ماك|iphone|ipad|macbook/i.test(itemName);
  const samsung = /سامسونج|جالكسي|samsung|galaxy/i.test(itemName);
  if (apple && /apple\.com/.test(result.host) && /\/sa/.test(result.url)) return 0;
  if (samsung && /samsung\.com/.test(result.host) && /\/sa/.test(result.url)) return 0;
  if (trustedHost(result.host)) return 1;
  if (isSaudiShop(result)) return 2;
  return 3;
}

function choosePrice(entries) {
  const trusted = entries.filter(entry => entry.trusted);
  const pool = (trusted.length ? trusted : entries).map(entry => entry.price);
  const sorted = [...new Set(pool)].filter(price => price >= 30).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length > 1 && sorted[0] * 2 < sorted[1]) sorted.shift();
  const band = sorted.filter(price => price <= sorted[0] * 1.6);
  return median(band.length ? band : sorted);
}

export function appleBuyUrl(name) {
  const text = toEnglish(name).toLowerCase();
  if (/macbook/.test(text)) {
    if (/\bpro\b/.test(text)) return 'https://www.apple.com/sa/shop/buy-mac/macbook-pro';
    return 'https://www.apple.com/sa/shop/buy-mac/macbook-air';
  }
  if (/ipad/.test(text)) {
    if (/\bpro\b/.test(text)) return 'https://www.apple.com/sa/shop/buy-ipad/ipad-pro';
    if (/\bair\b/.test(text)) return 'https://www.apple.com/sa/shop/buy-ipad/ipad-air';
    if (/\bmini\b/.test(text)) return 'https://www.apple.com/sa/shop/buy-ipad/ipad-mini';
    return 'https://www.apple.com/sa/shop/buy-ipad/ipad';
  }
  const model = text.match(/iphone\s*(\d{2})/)?.[1];
  if (!model) return '';
  let slug = `iphone-${model}`;
  if (/\bpro\b/.test(text) && /\bmax\b/.test(text)) slug = `iphone-${model}-pro-max`;
  else if (/\bpro\b/.test(text)) slug = `iphone-${model}-pro`;
  else if (/\bplus\b/.test(text)) slug = `iphone-${model}-plus`;
  else if (/\bair\b/.test(text)) slug = `iphone-${model}-air`;
  return `https://www.apple.com/sa/shop/buy-iphone/${slug}`;
}

export function pickApplePrice(html, itemName) {
  const offers = [];
  const re = /"fullPrice"\s*:\s*([\d.]+)[\s\S]{0,240}?"name"\s*:\s*"([^"]+)"/g;
  for (const match of String(html || '').matchAll(re)) {
    const price = acceptPrice(match[1]);
    const name = match[2];
    if (!price || price < 100 || !/iphone|macbook|ipad/i.test(name)) continue;
    offers.push({ price, name });
  }
  if (!offers.length) return null;
  const want = toEnglish(itemName).toLowerCase();
  const storage = want.match(/\b(64|128|256|512|1024)\b/)?.[1] || (/\b1\s*tb\b/.test(want) ? '1tb' : '');
  const wantsPro = /\bpro\b/.test(want);
  const wantsMax = /\bmax\b/.test(want);
  const wantsPlus = /\bplus\b/.test(want);
  const model = want.match(/iphone\s*(\d{2})/)?.[1];
  const matching = offers.filter(offer => {
    const name = offer.name.toLowerCase();
    if (model && !name.includes(model)) return false;
    if (wantsPro && !/\bpro\b/.test(name)) return false;
    if (!wantsPro && /\bpro\b/.test(name)) return false;
    if (/\bair\b/.test(want) && !/\bair\b/.test(name)) return false;
    if (!wantsMax && /\bmax\b/.test(name)) return false;
    if (wantsMax && !/\bmax\b/.test(name)) return false;
    if (wantsPlus && !/\bplus\b/.test(name)) return false;
    if (!wantsPlus && /\bplus\b/.test(name)) return false;
    if (storage === '1tb') return /1\s?tb|1024/.test(name);
    if (storage) return name.replace(/[\s,]/g, '').includes(storage);
    return true;
  });
  if (!matching.length) return null;
  return matching.sort((a, b) => a.price - b.price)[0];
}

export function appleListedPrice(html, itemName) {
  const named = pickApplePrice(html, itemName);
  if (named) return named.price;
  const want = toEnglish(itemName).toLowerCase();
  if (/\b(64|128|256|512|1024)\b/.test(want) || /\b1\s*tb\b/.test(want)) return null;
  const prices = [];
  for (const match of String(html || '').matchAll(/"seoPrice"\s*:\s*([\d.]+)/g)) {
    const price = acceptPrice(match[1]);
    if (price >= 100) prices.push(price);
  }
  return prices.length ? Math.min(...prices) : null;
}

function bingSearchUrl(query) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&setmkt=ar-SA&count=10`;
}

function bingResults(html) {
  const rows = [];
  const re = /<li class="b_algo"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of String(html || '').matchAll(re)) {
    rows.push({
      href: match[1].replace(/&amp;/g, '&'),
      title: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return rows.slice(0, 8);
}

async function resolveUrl(href) {
  const url = href.startsWith('http') ? href : `https://www.bing.com${href}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  return response.url || '';
}

function webOffer(price, sourceName, sourceUrl, note = '') {
  return { priceSar: price, sourceName, sourceUrl, checkedAt: checkedOn(), ...(note ? { note } : {}) };
}

export function fragranceIdentity(text) {
  const folded = String(text || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[×*]/g, ' ')
    .replace(/ايف سان لوران|إيف سان لوران|يف سان لوران/g, ' yves saint laurent ')
    .replace(/ليبر/g, ' libre ')
    .replace(/بلو\s+(?:دي|دو)\s+شانيل|بلو\s+شانيل/g, ' bleu de chanel ')
    .replace(/شانيل/g, ' chanel ')
    .replace(/شانس|تشانس/g, ' chance ')
    .replace(/أو دو بارفيوم|او دو بارفيوم|اودو بارفيوم/g, ' eau de parfum ')
    .replace(/أو دو تواليت|او دو تواليت/g, ' eau de toilette ')
    .replace(/(\d)\s*مل/g, '$1 ml')
    .toLowerCase();
  const normalized = folded.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\d+\s+/, '');
  let brand = '';
  if (/yves saint laurent|\bysl\b/.test(normalized)) brand = 'ysl';
  else if (/\bchanel\b|\bbleu\b/.test(normalized)) brand = 'chanel';
  let line = '';
  if (/\blibre\b/.test(normalized)) line = 'libre';
  else if (/\bbleu\b/.test(normalized)) line = 'bleu';
  else if (/\bchance\b/.test(normalized)) line = 'chance';
  let concentration = '';
  if (/eau de parfum|\bedp\b/.test(normalized)) concentration = 'edp';
  else if (/eau de toilette|\bedt\b/.test(normalized)) concentration = 'edt';
  const mlMatch = normalized.match(/\b(\d{2,3})\s*ml\b/);
  const ml = mlMatch ? Number(mlMatch[1]) : null;
  const extra = /intense/.test(normalized) ? 'intense' : /berry/.test(normalized) ? 'berry' : /flames/.test(normalized) ? 'flames' : '';
  const query = [
    brand === 'ysl' ? 'Yves Saint Laurent' : brand === 'chanel' ? 'Chanel' : '',
    line === 'libre' ? 'Libre' : line === 'bleu' ? 'Bleu de Chanel' : line === 'chance' ? 'Chance' : '',
    extra,
    concentration === 'edp' ? 'Eau de Parfum' : concentration === 'edt' ? 'Eau de Toilette' : '',
    ml ? `${ml}ml` : '',
  ].filter(Boolean).join(' ');
  return { brand, line, concentration, ml, extra, query };
}

export function titleMatchesFragrance(title, identity) {
  const text = String(title || '').toLowerCase().replace(/&amp;/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!identity?.line || !new RegExp(`\\b${identity.line}\\b`).test(text)) return false;
  if (identity.brand === 'ysl' && !/\bysl\b|\byves\b|saint laurent/.test(text)) return false;
  if (identity.brand === 'chanel' && !/\bchanel\b/.test(text)) return false;
  if (identity.line === 'bleu' && !/\bbleu\b/.test(text)) return false;
  if (identity.line === 'bleu' && /\bchance\b|\bcoco\b|\bgabrielle\b|\ballure\b/.test(text)) return false;
  if (/\bshower\b|\bgel\b|\bdeodorant\b|\baftershave\b|\blotion\b|\bsoap\b|\bshampoo\b|\bstick\b/.test(text)) return false;
  if (!/eau|parfum|perfume|toilette|\bedp\b|\bedt\b|cologne/.test(text)) return false;
  if (identity.line === 'chance' && (!/\bchance\b/.test(text) || /\bbleu\b/.test(text))) return false;
  if (identity.extra) {
    if (!text.includes(identity.extra)) return false;
  } else if (/\bintense\b|\belixir\b|\bberry\b|\bflames\b|\bflowers\b|\bcologne\b|\bnue\b|\babsolu\b/.test(text)) return false;
  if (identity.concentration === 'edp' && !/eau de parfum|\bedp\b/.test(text)) return false;
  if (identity.concentration === 'edt' && !/eau de toilette|\bedt\b/.test(text)) return false;
  if (identity.ml) {
    const sizes = [...text.matchAll(/\b(\d{2,3})\s*ml\b/g)].map(match => Number(match[1]));
    if (!sizes.includes(identity.ml)) return false;
  }
  return true;
}

async function amazonFragrance(identity) {
  if (!identity.line || !identity.query) return { reason: 'skip' };
  const html = await fetchText('https://www.amazon.sa/s?k=' + encodeURIComponent(identity.query), 12000, 1_600_000, { 'Accept-Language': 'en-US,en;q=0.9' });
  if (!html || html.length < 20_000) return { reason: 'unavailable' };
  const candidates = [];
  for (const match of html.matchAll(/alt="([^"]{8,180})"/g)) {
    const title = match[1].replace(/&amp;/g, '&');
    if (!titleMatchesFragrance(title, identity)) continue;
    const around = html.slice(Math.max(0, match.index - 8000), match.index + 800);
    const asin = around.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || around.match(/data-asin="([A-Z0-9]{10})"/)?.[1];
    if (asin && !candidates.some(item => item.asin === asin)) candidates.push({ title, asin });
  }
  candidates.sort((a, b) => Number(/eau de parfum/i.test(b.title)) - Number(/eau de parfum/i.test(a.title)));
  const specific = Boolean(identity.ml && identity.concentration);
  const offers = [];
  for (const candidate of candidates.slice(0, specific ? 2 : 3)) {
    const sourceUrl = `https://www.amazon.sa/dp/${candidate.asin}`;
    const page = await fetchText(sourceUrl, 12000, 1_200_000, { 'Accept-Language': 'en-US,en;q=0.9' });
    if (!page) continue;
    const pageTitle = (page.match(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      || page.match(/<title[^>]*>([^<]+)/i)?.[1]
      || candidate.title).replace(/\s+/g, ' ').replace(/\s*[:|-]\s*Amazon\.[a-z.]+/i, '').trim();
    if (!titleMatchesFragrance(pageTitle, identity)) continue;
    const price = acceptPrice(page.match(/"priceAmount"\s*:\s*([0-9.]+)/)?.[1]);
    if (!price) continue;
    if (specific) return { price, sourceUrl, title: pageTitle };
    offers.push({ name: pageTitle, priceSar: price, sourceName: 'أمازون السعودية', sourceUrl });
  }
  if (offers.length === 1) return { price: offers[0].priceSar, sourceUrl: offers[0].sourceUrl, title: offers[0].name };
  if (offers.length > 1) return { reason: 'ambiguous', variants: offers };
  return { reason: 'not_found' };
}

async function searchWebPrice(item) {
  let reachedSource = false;
  const fragrance = fragranceIdentity(`${item.name} ${item.raw}`);
  if (fragrance.line) {
    let officialBlocked = false;
    if (fragrance.brand === 'ysl') {
      try {
        const html = await fetchText('https://www.yslbeauty.sa/en/perfume', 8000);
        if (!html || /just a moment|cf-mitigated|challenge-platform|cf-browser/i.test(html.slice(0, 2500))) officialBlocked = true;
        else reachedSource = true;
      } catch { officialBlocked = true; }
    }
    try {
      const amazon = await amazonFragrance(fragrance);
      if (amazon?.price) {
        const note = officialBlocked ? 'تعذر فتح yslbeauty.sa، وهذا سعر الصفحة المطابقة.' : '';
        return webOffer(amazon.price, 'أمازون السعودية', amazon.sourceUrl, note);
      }
      if (Array.isArray(amazon?.variants) && amazon.variants.length) return { reason: 'ambiguous', variants: amazon.variants };
      if (fragrance.ml) {
        const broader = await amazonFragrance({ ...fragrance, ml: null, query: fragrance.query.replace(/\s*\d+ml\b/i, '').trim() });
        const variants = Array.isArray(broader?.variants) ? broader.variants : [];
        if (broader?.price && broader.sourceUrl) {
          variants.push({
            name: broader.title || fragrance.query.replace(/\s*\d+ml\b/i, '').trim(),
            priceSar: broader.price,
            sourceName: 'أمازون السعودية',
            sourceUrl: broader.sourceUrl,
          });
        }
        if (variants.length) {
          return {
            reason: 'ambiguous',
            note: `ما لقينا ${fragrance.ml} مل من هذا الإصدار، وهذه الإصدارات المتوفرة.`,
            variants,
          };
        }
      }
      if (amazon?.reason === 'not_found' || amazon?.reason === 'ambiguous') reachedSource = true;
      if (amazon?.reason === 'unavailable' && officialBlocked) return { reason: 'unavailable' };
    } catch { /* المتجر لم يُفتح */ }
  }
  const official = appleBuyUrl(item.name);
  if (official) {
    try {
      const html = await fetchText(official, 9000);
      if (html) {
        reachedSource = true;
        const price = appleListedPrice(html, item.name);
        if (price) return webOffer(price, 'أبل', official);
      }
    } catch { /* الصفحة الرسمية لم تُفتح، وتُجرَّب المتاجر */ }
  }
  const named = mentionedNumbers(item.name);
  const pages = [];
  try {
    const htmls = await Promise.all(searchQueries(item).map(query => fetchText(bingSearchUrl(query), 8000).catch(() => '')));
    const seen = new Set();
    for (const html of htmls) {
      if (!html || !html.includes('b_algo')) continue;
      reachedSource = true;
      for (const row of bingResults(html)) {
        if (seen.has(row.href) || pages.length >= 4) continue;
        if (conflictsWithQuery(item.name, row.title)) continue;
        seen.add(row.href);
        pages.push(row);
      }
    }
  } catch { /* محرك البحث لم يستجب */ }
  for (const page of pages) {
    let pageUrl = '';
    try { pageUrl = await resolveUrl(page.href); }
    catch { continue; }
    if (!pageUrl || /bing\.com|microsoft\.com/.test(pageUrl)) continue;
    if (conflictsWithQuery(item.name, `${page.title} ${pageUrl}`)) continue;
    const body = await fetchText(pageUrl).catch(() => '');
    if (!body) continue;
    reachedSource = true;
    const appleHit = /apple\.com/.test(pageUrl) ? pickApplePrice(body, item.name) : null;
    if (fragrance.line && !appleHit && !titleMatchesFragrance(page.title, fragrance)) continue;
    const price = appleHit?.price || priceFromHtml(body);
    if (!price || named.has(String(Math.round(price)))) continue;
    let sourceName = 'المتجر';
    try { sourceName = shopName(new URL(pageUrl).hostname); }
    catch { /* يبقى الاسم العام */ }
    return webOffer(price, sourceName, pageUrl);
  }
  return { reason: reachedSource ? 'not_found' : 'unavailable' };
}

function cleanItems(body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 12) : [];
  return items
    .filter(item => item && typeof item.raw === 'string' && typeof item.name === 'string')
    .map(item => {
      const size = Number(item.sizeMl);
      return {
        raw: item.raw.slice(0, 80),
        name: item.name.slice(0, 80),
        ...(Number.isFinite(size) && size > 0 && size <= 5000 ? { sizeMl: Math.round(size) } : {}),
      };
    });
}

export function healthPayload(fallback = {}) {
  const live = currentEnv(fallback);
  return { configured: true, web: true, model: Boolean(live.API_KEY) };
}

export async function quotePayload(body) {
  const clean = cleanItems(body);
  const settled = await Promise.all(clean.map(async item => {
    try {
      const found = await searchWebPrice(item);
      if (found?.priceSar) return { price: { ...item, ...found, via: 'web' } };
      if (Array.isArray(found?.variants) && found.variants.length) {
        return { failure: { raw: item.raw, reason: 'ambiguous', variants: found.variants, ...(found.note ? { note: found.note } : {}) } };
      }
      return { failure: { raw: item.raw, reason: found?.reason === 'unavailable' ? 'unavailable' : 'not_found' } };
    } catch {
      return { failure: { raw: item.raw, reason: 'unavailable' } };
    }
  }));
  const prices = settled.map(row => row.price).filter(Boolean);
  const failures = settled.map(row => row.failure).filter(Boolean);
  return { ok: prices.length > 0, prices, failures };
}

export function quoteApi(env) {
  const attach = server => {
    server.middlewares.use(async (req, res, next) => {
      const url = (req.url || '').split('?')[0];
      if (url === '/api/health' && req.method === 'GET') {
        send(res, 200, healthPayload(env));
        return;
      }
      if (url !== '/api/quote' || req.method !== 'POST') return next();
      try {
        const body = await readBody(req);
        send(res, 200, await quotePayload(body, env));
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
