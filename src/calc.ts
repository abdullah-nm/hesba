export type CustomsType = 'traveler' | 'parcel';
export type Category = 'phone' | 'laptop' | 'perfume' | 'generic';

export const MAX_TEXT = 4000;

export function normalizeArDigits(s: string): string {
  const map: Record<string, string> = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','٫':'.','٬':',' };
  return s.replace(/[٠-٩٫٬]/g, m => map[m] || m);
}

export function normalizeArabic(s: string): string {
  return s
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSemantic(s: string): string {
  let t = normalizeArDigits(s).toLowerCase();
  t = normalizeArabic(t);
  t = t.replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function containsPhrase(inputNorm: string, key: string): boolean {
  let from = 0;
  while (from < inputNorm.length) {
    const idx = inputNorm.indexOf(key, from);
    if (idx < 0) return false;
    const beforeOk = idx === 0 || inputNorm[idx - 1] === ' ';
    const after = inputNorm[idx + key.length] ?? '';
    const afterOk = after === '' || after === ' ' || (/\d$/.test(key) ? !/\d/.test(after) : true);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

function fuzzyContains(inputNorm: string, target: string): boolean {
  const targetNorm = normalizeSemantic(target);
  if (!targetNorm) return false;
  if (containsPhrase(inputNorm, targetNorm)) return true;
  if (targetNorm.includes(' ')) return false;
  if (targetNorm.length < 4) return false;
  for (const tok of inputNorm.split(/\s+/)) {
    if (tok.length < 4) continue;
    if (levenshtein(tok, targetNorm) === 1) return true;
  }
  return false;
}

function fuzzyScore(inputNorm: string, keywords: string[], weight = 1): number {
  let score = 0;
  for (const kw of keywords) {
    if (fuzzyContains(inputNorm, kw)) score += weight * (kw.length > 5 ? 1.5 : 1);
  }
  return score;
}

function hasWord(norm: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(norm);
}

const ARABIC_NUM_WORDS: Record<string, number> = {
  'واحد': 1, 'واحده': 1, 'وحده': 1, 'واحدا': 1,
  'اثنين': 2, 'اثنان': 2, 'ثنين': 2, 'حبتين': 2, 'جهازين': 2,
  'ثلاثة': 3, 'ثلاث': 3, 'ثلاثه': 3,
  'اربعه': 4, 'اربعة': 4, 'اربع': 4,
  'خمسه': 5, 'خمسة': 5, 'خمس': 5,
  'سته': 6, 'ستة': 6, 'ست': 6,
  'سبعه': 7, 'سبعة': 7, 'سبع': 7,
  'ثمانيه': 8, 'ثمانية': 8, 'ثمان': 8,
  'تسعه': 9, 'تسعة': 9, 'تسع': 9,
  'عشره': 10, 'عشرة': 10, 'عشر': 10,
  'عشرين': 20, 'عشرون': 20,
  'ثلاثين': 30, 'ثلاثون': 30,
  'اربعين': 40, 'اربعون': 40,
  'خمسين': 50, 'خمسون': 50,
  'ستين': 60, 'ستون': 60,
  'سبعين': 70, 'سبعون': 70,
  'ثمانين': 80, 'ثمانون': 80,
  'تسعين': 90, 'تسعون': 90,
};

const UNIT_WORDS: Record<string, number> = {
  'واحد': 1, 'واحده': 1, 'وحده': 1, 'واحدا': 1,
  'اثنين': 2, 'اثنان': 2, 'ثنين': 2,
  'ثلاثة': 3, 'ثلاث': 3, 'ثلاثه': 3,
  'اربعه': 4, 'اربعة': 4, 'اربع': 4,
  'خمسه': 5, 'خمسة': 5, 'خمس': 5,
  'سته': 6, 'ستة': 6, 'ست': 6,
  'سبعه': 7, 'سبعة': 7, 'سبع': 7,
  'ثمانيه': 8, 'ثمانية': 8, 'ثمان': 8,
  'تسعه': 9, 'تسعة': 9, 'تسع': 9,
};

const TEN_WORDS: Record<string, number> = {
  'عشرين': 20, 'عشرون': 20,
  'ثلاثين': 30, 'ثلاثون': 30,
  'اربعين': 40, 'اربعون': 40,
  'خمسين': 50, 'خمسون': 50,
  'ستين': 60, 'ستون': 60,
  'سبعين': 70, 'سبعون': 70,
  'ثمانين': 80, 'ثمانون': 80,
  'تسعين': 90, 'تسعون': 90,
};

function parseCompoundQty(norm: string): number | null {
  if (/(?:^|\s)اثن(?:ا|ي)\s+عشر(?:ه)?(?:\s|$)/.test(norm)) return 12;
  const tokens = norm.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    const unit = UNIT_WORDS[tokens[i]];
    if (!unit || unit >= 10) continue;
    const next = tokens[i + 1];
    if (next === 'عشر' || next === 'عشره') return unit + 10;
    if (next === 'و' && TEN_WORDS[tokens[i + 2]]) return unit + TEN_WORDS[tokens[i + 2]];
    const unglued = next.startsWith('و') ? next.slice(1) : '';
    if (unglued && TEN_WORDS[unglued]) return unit + TEN_WORDS[unglued];
    if (TEN_WORDS[next]) return unit + TEN_WORDS[next];
  }
  return null;
}

function detectQtySemantic(norm: string): number {
  const compound = parseCompoundQty(norm);
  if (compound) return compound;
  const unitMatch = norm.match(/(\d+)\s*(حبه|حبات|جهاز|اجهزه|قطعه|قطع)(?=\s|$)/i);
  if (unitMatch) {
    const n = parseInt(unitMatch[1], 10);
    if (n >= 1 && n <= 100000) return n;
  }
  const digitRe = /(\d+)/g;
  let digit: RegExpExecArray | null;
  while ((digit = digitRe.exec(norm))) {
    const numStr = digit[1];
    const n = parseInt(numStr, 10);
    if (n < 1 || n > 100000) continue;
    const before = norm.slice(0, digit.index);
    const after = norm.slice(digit.index + numStr.length);
    if (/(?:ايفون|ايفوان|ايففون|iphone|ايباد|ipad|جالكسي|galaxy|سامسونج|samsung)\s*$/i.test(before) && n <= 40) continue;
    if (/^\s*(جيجا|قيقا|جيجابايت|gb|tb|تيرا|تيرابايت|مل|ملي|ml|كيلو|كجم|كغ|kg|جرام|غرام|جم|ريال|رس|sar|sr)(?=\s|$)/i.test(after)) continue;
    if (/^(64|128|256|512|1024)$/.test(numStr)) continue;
    return n;
  }
  const tokens = norm.split(/\s+/);
  for (const tok of tokens) {
    const clean = tok.replace(/[،,]+/g, '');
    const unglued = clean.replace(/^و/, '');
    if (ARABIC_NUM_WORDS[clean] !== undefined) return ARABIC_NUM_WORDS[clean];
    if (unglued !== clean && ARABIC_NUM_WORDS[unglued] !== undefined) return ARABIC_NUM_WORDS[unglued];
  }
  if (/(?:^|\s)(جوالين|ايفونين|جهازين|حبتين|لابتوبين|عطرين)(?:\s|$)/.test(norm)) return 2;
  return 1;
}

function detectStorage(norm: string): string {
  if (/(?:^|\s)(?:\d+\s*)?(?:تيرا|تيرابايت|tera|tb)(?:\s|$)/.test(norm) || /(?:^|\s)1tb(?:\s|$)/.test(norm)) {
    return '1 تيرا';
  }
  const gb = norm.match(/(?:^|\s)(\d+)\s*(جيجا|قيقا|جيجابايت|gb)(?:\s|$)/i);
  if (gb) return `${gb[1]} جيجا`;
  const known = norm.match(/(?:^|\s)(64|128|256|512|1024)(?:\s|$)/);
  if (known) return known[1] === '1024' ? '1 تيرا' : `${known[1]} جيجا`;
  return '';
}

function describePhone(norm: string): { name: string; pricePer: number } {
  const modelMatch = norm.match(/(?:ايفون|ايفوان|ايففون|iphone|ايباد|ipad|جالكسي|galaxy|سامسونج|samsung)\s*(\d{1,2})\b(?!\s*(?:جيجا|قيقا|جيجابايت|gb)\b)/i);
  let model = modelMatch && parseInt(modelMatch[1], 10) <= 40 ? modelMatch[1] : '';
  const isIphone = /ايفون|ايفوان|ايففون|iphone/.test(norm);
  const isIpad = /ايباد|ipad/.test(norm);
  const isSamsung = /سامسونج|جالكسي|galaxy|samsung/.test(norm);
  let variant = '';
  if (/برو\s*ماكس|pro\s*max/.test(norm)) variant = 'برو ماكس';
  else if (hasWord(norm, 'بلس') || hasWord(norm, 'plus')) variant = 'بلس';
  else if (hasWord(norm, 'ميني') || hasWord(norm, 'mini')) variant = 'ميني';
  else if (hasWord(norm, 'برو') || hasWord(norm, 'pro')) variant = 'برو';
  const storage = detectStorage(norm);
  if (model === '1' && storage === '1 تيرا') model = '';
  const brand = isIpad ? 'آيباد' : isSamsung && !isIphone ? 'سامسونج' : isIphone ? 'آيفون' : 'جوال';
  const name = [brand, model, variant, storage].filter(Boolean).join(' ');
  let pricePer = brand === 'سامسونج' ? 3000 : 4500;
  if (variant === 'برو ماكس') pricePer = 6000;
  else if (variant === 'برو') pricePer = 5500;
  else if (variant === 'بلس') pricePer = 5000;
  if (storage === '1 تيرا') pricePer += 500;
  return { name, pricePer };
}

export type PriceSource = 'catalog' | 'typed' | 'estimate' | 'api';

export type SemanticProduct = {
  raw: string;
  norm: string;
  qty: number;
  category: Category;
  name: string;
  sizeMl: number | null;
  pricePer: number;
  totalOutside: number;
  priceSource: PriceSource;
};

function extractExplicitPrice(norm: string): number | null {
  const labeled = norm.match(/(?:^|\s)(?:بسعر|قيمته|سعره|سعر)\s*(\d+)/);
  const money = norm.match(/(\d+)\s*(?:ريال|رس|sar|sr)(?=\s|$)/i);
  const raw = labeled?.[1] ?? money?.[1];
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (n > 0 && n <= 1_000_000) return n;
  return null;
}

function extractVolumeInfo(text: string): { ml: number | null } {
  const norm = normalizeArDigits(text.toLowerCase());
  const mlMatch = norm.match(/(\d+)\s*(مل|ملي|ml)(?=\s|$)/i);
  if (mlMatch) return { ml: parseInt(mlMatch[1], 10) };
  return { ml: null };
}

function extractWeightInfo(text: string): { kg: number | null } {
  const norm = normalizeArDigits(text.toLowerCase());
  const kgMatch = norm.match(/(\d+(?:\.\d+)?)\s*(كيلو|كجم|كغ|kg|kilo)(?=\s|$)/i);
  const gMatch = norm.match(/(\d+(?:\.\d+)?)\s*(جرام|غرام|جم)(?=\s|$)/i);
  if (kgMatch) return { kg: parseFloat(kgMatch[1]) };
  if (gMatch) return { kg: parseFloat(gMatch[1]) / 1000 };
  return { kg: null };
}

type PerfumeSemantic = { keywords: string[]; name: string; price: number };

const PERFUME_SEMANTIC: PerfumeSemantic[] = [
  { keywords: ['روجا', 'roja', 'عود هارودز', 'harrods'], name: 'روجا عود هارودز حصري', price: 1300 },
  { keywords: ['شانيل n5', 'شانيل 5', 'chanel n5', 'chanel no 5', 'chanel number 5'], name: 'شانيل N°5', price: 650 },
  { keywords: ['بلو دو شانيل', 'bleu de chanel', 'bleu chanel'], name: 'بلو دو شانيل', price: 620 },
  { keywords: ['شانيل', 'chanel', 'chance', 'شانس', 'تشانس'], name: 'شانيل شانس', price: 700 },
  { keywords: ['ديور', 'dior', 'سوفاج', 'sauvage'], name: 'ديور سوفاج', price: 580 },
  { keywords: ['كريد', 'creed', 'افينتوس', 'aventus'], name: 'كريد افينتوس', price: 1250 },
];

function matchPerfume(norm: string): PerfumeSemantic | null {
  let best: PerfumeSemantic | null = null;
  let bestLen = 0;
  for (const item of PERFUME_SEMANTIC) {
    for (const kw of item.keywords) {
      const key = normalizeSemantic(kw);
      if (!key) continue;
      if (!fuzzyContains(norm, key)) continue;
      if (key.length > bestLen) {
        best = item;
        bestLen = key.length;
      }
    }
  }
  return best;
}

function mentionsMac(norm: string): boolean {
  if (norm.includes('ماك بوك') || norm.includes('macbook') || norm.includes('mac book')) return true;
  return norm.split(/\s+/).some(t => t === 'ماك' || t === 'ماكبوك' || t === 'mac' || t === 'macbook');
}

function understandSingleProductSemantically(rawSeg: string): SemanticProduct {
  const norm = normalizeSemantic(rawSeg);
  const qty = detectQtySemantic(norm);

  let phoneScore = 0, laptopScore = 0, perfumeScore = 0;
  phoneScore += fuzzyScore(norm, ['ايفون', 'ايفوان', 'ايففون', 'iphone', 'ايفونات', 'ايباد', 'ipad', 'سامسونج', 'جالكسي', 'galaxy', 'samsung'], 10);
  phoneScore += fuzzyScore(norm, ['جوال', 'جوالات', 'موبايل'], 5);
  phoneScore += fuzzyScore(norm, ['برو ماكس', 'pro max'], 3);
  phoneScore += fuzzyScore(norm, ['تيرا', 'tera', '1tb'], 2) * (norm.includes('جوال') || norm.includes('فون') || norm.includes('ايفون') || norm.includes('ايباد') || norm.includes('سامسونج') ? 1 : 0);
  phoneScore += fuzzyScore(norm, ['ابل'], 2) * (norm.includes('جوال') || norm.includes('فون') || norm.includes('ايفون') ? 1 : 0.2);

  laptopScore += fuzzyScore(norm, ['ماك بوك', 'macbook', 'mac book', 'ماكبوك'], 10);
  laptopScore += fuzzyScore(norm, ['لابتوب', 'لاب توب', 'laptop', 'لابتوبات'], 10);
  laptopScore += fuzzyScore(norm, ['اير', 'air', 'خفيف'], 4) * (mentionsMac(norm) || norm.includes('لابتوب') ? 1 : 0.1);

  perfumeScore += fuzzyScore(norm, ['عطر', 'عطور', 'عطورات', 'برفان', 'ريحه'], 10);
  perfumeScore += fuzzyScore(norm, ['شانيل', 'chanel', 'ديور', 'dior', 'روجا', 'roja', 'كريد', 'creed'], 6);

  const scores = [
    { cat: 'phone' as Category, score: phoneScore },
    { cat: 'laptop' as Category, score: laptopScore },
    { cat: 'perfume' as Category, score: perfumeScore },
  ].sort((a, b) => b.score - a.score);

  let category: Category = 'generic';
  if (scores[0].score >= 3) category = scores[0].cat;

  let name = rawSeg.slice(0, 40) || 'منتج';
  let pricePer = 350;
  let priceSource: PriceSource = 'estimate';
  let sizeMl: number | null = null;

  if (category === 'phone') {
    const phone = describePhone(norm);
    name = phone.name;
    pricePer = phone.pricePer;
    priceSource = 'catalog';
  } else if (category === 'laptop') {
    if (mentionsMac(norm) && (hasWord(norm, 'اير') || hasWord(norm, 'air') || norm.includes('خفيف'))) {
      name = 'ماك بوك اير';
      pricePer = 4200;
      priceSource = 'catalog';
    } else if (mentionsMac(norm) && (hasWord(norm, 'برو') || hasWord(norm, 'pro'))) {
      name = 'ماك بوك برو';
      pricePer = 6500;
      priceSource = 'catalog';
    } else if (mentionsMac(norm)) {
      name = 'ماك بوك';
      pricePer = 4200;
      priceSource = 'catalog';
    } else {
      name = rawSeg.trim().slice(0, 40) || 'لابتوب';
      pricePer = 2500;
      priceSource = 'estimate';
    }
  } else if (category === 'perfume') {
    const vol = extractVolumeInfo(rawSeg);
    sizeMl = vol.ml || 100;
    const found = matchPerfume(norm);
    if (found) {
      name = found.name;
      let factor = 1;
      if (sizeMl === 50) factor = 0.7;
      else if (sizeMl === 75) factor = 0.85;
      else if (sizeMl === 100) factor = 1;
      else if (sizeMl === 150) factor = 1.35;
      else if (sizeMl === 200) factor = 1.5;
      pricePer = Math.round(found.price * factor);
      priceSource = 'catalog';
    } else {
      if (norm.includes('فرنسي')) name = 'عطر فرنسي';
      else {
        const kept = rawSeg.trim().split(/\s+/).filter(tok => ARABIC_NUM_WORDS[normalizeSemantic(tok)] === undefined);
        name = kept.join(' ').trim().slice(0, 40) || 'عطر';
      }
      const factor = sizeMl === 50 ? 0.7 : sizeMl <= 100 ? 1 : sizeMl <= 200 ? 1.4 : 1.5;
      pricePer = Math.round(350 * factor);
    }
  } else {
    name = rawSeg.trim().slice(0, 40) || 'منتج';
    pricePer = 350;
    priceSource = 'estimate';
  }

  const typed = extractExplicitPrice(norm);
  if (typed) {
    pricePer = typed;
    priceSource = 'typed';
  }

  return { raw: rawSeg, norm, qty, category, name, sizeMl, pricePer, totalOutside: pricePer * qty, priceSource };
}

const CONJUNCTION_STARTERS = [
  'اثنين', 'اثنان', 'ثنين', 'حبتين', 'جهازين', 'جوالين', 'ايفونين', 'لابتوبين', 'عطرين',
  'واحد', 'واحده', 'واحدة', 'وحده', 'ثلاثة', 'ثلاث', 'ثلاثه', 'اربعة', 'أربعة', 'اربع', 'أربع', 'اربعه',
  'خمسة', 'خمس', 'خمسه', 'ستة', 'ست', 'سته', 'سبعة', 'سبع', 'سبعه', 'ثمانية', 'ثمان', 'ثمانيه',
  'تسعة', 'تسع', 'تسعه', 'عشرة', 'عشر', 'عشره',
  'جوالات', 'جوال', 'ايفون', 'موبايل', 'ماك بوك', 'ماكبوك', 'ماك', 'لابتوبات', 'لابتوب', 'عطور', 'عطر', 'برفان',
  'ايباد', 'سامسونج', 'جالكسي',
  'macbook', 'mac book', 'iphone', 'laptop', 'ipad', 'samsung',
  'شريت', 'اشتريت', 'اشترينا', 'شرينا', 'بشتري', 'جبت', 'خذيت', 'اخذيت', 'طلبت',
  'ابغى', 'ابي', 'بغيت', 'عندي', 'كمان', 'ايضا', 'بعدين', 'برضو',
];

function flexArWord(word: string): string {
  return word
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[اأإآ]/g, '[اأإآ]')
    .replace(/[ةه]/g, '[ةه]')
    .replace(/ى/g, '[ىي]');
}

function splitWawConjunction(text: string): string[] {
  const alt = CONJUNCTION_STARTERS
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(flexArWord)
    .join('|');
  const re = new RegExp(`\\s*و\\s*(?=(?:${alt})(?![\\u0600-\\u06FFa-zA-Z])|[0-9٠-٩])`, 'gu');
  return text.split(re).map(s => s.trim()).filter(Boolean);
}

export function splitProductsSemantic(text: string): string[] {
  if (!text.trim()) return [];
  const parts = text
    .split(/\n+/)
    .flatMap(p => p.split(/،|,|\s*\+\s*|\s+ثم\s+|\s+and\s+/gi))
    .flatMap(splitWawConjunction);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function parseProductsSemantic(text: string): SemanticProduct[] {
  const segments = splitProductsSemantic(text);
  const items = segments.length ? segments : [text].filter(t => t.trim());
  return items.map(seg => understandSingleProductSemantically(seg));
}

export function inputHint(_tab: CustomsType, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (text.length > MAX_TEXT) return 'النص طويل جدًا. الحد ٤٠٠٠ حرف.';
  if (normalizeSemantic(text).length < 2) return 'اكتب اسم المنتج بالعربي أو الإنجليزي.';
  return null;
}

export function isSubmittable(_tab: CustomsType, text: string): boolean {
  if (text.length > MAX_TEXT) return false;
  if (normalizeSemantic(text).length < 2) return false;
  return true;
}

export type CalculatedItem = SemanticProduct & {
  customs: number;
  vat: number;
  bayan: number;
  pay: number;
  total: number;
  exemptQty: number;
};

export type CalcOutcome = {
  ok: true;
  items: CalculatedItem[];
  warning?: string;
  weightKg: number | null;
} | {
  ok: false;
  message: string;
};

function parseWeight(field: string, text: string): { kg: number | null; invalid: boolean } {
  const fromField = normalizeArDigits(field).trim();
  if (fromField) {
    if (!/^\d+(\.\d+)?$/.test(fromField)) return { kg: null, invalid: true };
    const n = parseFloat(fromField);
    if (Number.isFinite(n) && n > 0 && n <= 10000) return { kg: n, invalid: false };
    return { kg: null, invalid: true };
  }
  const fromText = extractWeightInfo(text).kg;
  if (fromText && fromText > 0 && fromText <= 10000) return { kg: fromText, invalid: false };
  return { kg: null, invalid: false };
}

const TRAVELER_ALLOWANCE = 3000;
const PARCEL_DUTY_FREE = 1000;
const VAT_RATE = 0.15;
const GOODS_DUTY = 0.05;

function dutyRate(category: Category): number {
  return category === 'laptop' ? 0 : GOODS_DUTY;
}

function declarationFee(goodsValue: number): number {
  if (goodsValue <= PARCEL_DUTY_FREE) return 15;
  return Math.min(500, Math.max(15, Math.round(goodsValue * 0.0015)));
}

function splitAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const shares = weights.map(w => Math.floor((total * w) / sum));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const rank = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; k < rank.length && left > 0; k++) {
    shares[rank[k].i] += 1;
    left -= 1;
  }
  return shares;
}

function priceGoods(tab: 'traveler' | 'parcel', products: SemanticProduct[]): CalculatedItem[] {
  let phonesLeftExempt = 2;
  const draft = products.map(p => {
    const exemptQty = p.category === 'phone' ? Math.min(p.qty, phonesLeftExempt) : 0;
    if (p.category === 'phone') phonesLeftExempt -= exemptQty;
    const phoneTaxable = p.category === 'phone' ? p.pricePer * (p.qty - exemptQty) : 0;
    return { p, exemptQty, phoneTaxable };
  });

  if (tab === 'traveler') {
    const basketValue = draft
      .filter(d => d.p.category !== 'phone')
      .reduce((s, d) => s + d.p.totalOutside, 0);
    const basketTaxable = basketValue > TRAVELER_ALLOWANCE;
    return draft.map(({ p, exemptQty, phoneTaxable }) => {
      let customs = 0, vat = 0, pay = 0, total = 0;
      if (p.category === 'phone') {
        if (phoneTaxable > 0) {
          customs = Math.round(phoneTaxable * GOODS_DUTY);
          vat = Math.round((phoneTaxable + customs) * VAT_RATE);
          pay = customs + vat;
          total = pay;
        }
      } else if (basketTaxable) {
        customs = Math.round(p.totalOutside * dutyRate(p.category));
        vat = Math.round((p.totalOutside + customs) * VAT_RATE);
        pay = customs + vat;
        total = pay;
      }
      return { ...p, customs, vat, bayan: 0, pay, total, exemptQty };
    });
  }

  const goods = draft.reduce((s, d) => s + d.p.totalOutside, 0);
  const dutyFree = goods <= PARCEL_DUTY_FREE;
  const duties = draft.map(d => dutyFree ? 0 : Math.round(d.p.totalOutside * dutyRate(d.p.category)));
  const dutySum = duties.reduce((a, b) => a + b, 0);
  const bayan = declarationFee(goods);
  const vatSum = Math.round((goods + dutySum + bayan) * VAT_RATE);
  const vats = splitAmount(vatSum, draft.map((d, i) => d.p.totalOutside + duties[i]));
  return draft.map(({ p }, i) => {
    const customs = duties[i];
    const vat = vats[i];
    const itemBayan = i === 0 ? bayan : 0;
    const pay = customs + vat + itemBayan;
    return { ...p, customs, vat, bayan: itemBayan, pay, total: p.totalOutside + pay, exemptQty: 0 };
  });
}

export function calculate(input: {
  tab: CustomsType;
  text: string;
  parcelWeight?: string;
  quotes?: Record<string, number>;
}): CalcOutcome {
  const text = input.text ?? '';
  const parcelWeight = input.parcelWeight ?? '';
  if (text.length > MAX_TEXT) return { ok: false, message: 'النص طويل جدًا. اختصر الطلب إلى ٤٠٠٠ حرف.' };
  if (normalizeSemantic(text).length < 2) return { ok: false, message: 'اكتب المنتج أولاً.' };

  const products = parseProductsSemantic(text);
  const quotes = input.quotes ?? {};
  for (const p of products) {
    const quoted = quotes[p.raw];
    if (p.priceSource === 'estimate' && typeof quoted === 'number' && quoted > 0 && quoted <= 1_000_000) {
      p.pricePer = Math.round(quoted);
      p.totalOutside = p.pricePer * p.qty;
      p.priceSource = 'api';
    }
  }
  const items = priceGoods(input.tab, products);
  const weight = input.tab === 'parcel' ? parseWeight(parcelWeight, text) : { kg: null, invalid: false };
  const warning = weight.invalid
    ? 'الوزن المكتوب خارج المدى المقبول (من أكثر من صفر حتى ١٠٠٠٠ كجم)، وحُسبت الرسوم على قيمة البضاعة.'
    : undefined;
  return { ok: true, items, warning, weightKg: weight.kg };
}
