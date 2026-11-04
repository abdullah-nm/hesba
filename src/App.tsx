import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculate,
  inputHint,
  isSubmittable,
  MAX_TEXT,
  type CalculatedItem,
  type CalcOutcome,
  type CustomsType,
  type PriceOrigin,
} from './calc';

const formatSAR = (n: number) => {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (n === 0) return '0 ر.س';
  const value = Math.round(n * 100) / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value) + ' ر.س';
};

const TABS: { key: CustomsType; label: string; help: string }[] = [
  {
    key: 'traveler',
    label: 'مسافر',
    help: 'الإجمالي هو الجمارك والضريبة فقط. سعر المنتج يظهر لوحده ولا يُضاف إلى الرسوم. سلة ما عدا الجوال تُعفى حتى ٣٠٠٠ ريال، وأول جوالين معفيان.',
  },
  {
    key: 'parcel',
    label: 'شحنة',
    help: 'الإجمالي هو الجمارك والضريبة فقط. سعر المنتج يظهر لوحده ولا يُضاف إلى الرسوم. الشحنة حتى ١٠٠٠ ريال بلا جمرك، والضريبة ١٥٪.',
  },
];

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

type SourceInfo = { sourceName: string; sourceUrl: string; checkedAt: string; note?: string };
type VariantOffer = { name: string; priceSar: number; sourceName: string; sourceUrl: string };

type ResultState = {
  type: CustomsType;
  text: string;
  parcelWeight: string;
  items: CalculatedItem[];
  warning?: string;
  weightKg: number | null;
  unitPrices: Array<number | null>;
  origins: Array<PriceOrigin | null>;
  sources: Array<SourceInfo | null>;
  reasons: Array<'unavailable' | 'not_found' | 'ambiguous' | null>;
  options: Array<VariantOffer[] | null>;
  notes: Array<string | null>;
};

function parseMoney(raw: string): number | null {
  const normalized = raw.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[^\d.]/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return Math.round(value);
}

function FoundPrice({ id, item, source, onCommit }: { id: string; item: CalculatedItem; source: SourceInfo | null; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="mt-3 rounded-2xl bg-black/[0.03] p-4">
      <p className="text-[12px] font-bold text-black/60">سعر المنتج</p>
      <p className="mt-1 text-[16px] font-[800]">{formatSAR(item.pricePer)}</p>
      {item.qty > 1 && (
        <p className="mt-1 text-[13px] font-bold text-black/70">الكمية {item.qty}، وثمن الكمية {formatSAR(item.totalOutside)}</p>
      )}
      {item.priceSource === 'typed' && <p className="mt-1 text-[12px] font-bold text-black/70">السعر مكتوب في الطلب</p>}
      {item.priceSource === 'manual' && <p className="mt-1 text-[12px] font-bold text-black/70">سعر أدخلته</p>}
      {source && (
        <p className="mt-2 text-[12px] font-bold leading-6 text-black/70">
          المصدر{' '}
          <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {source.sourceName}
          </a>
          <span className="mx-1">·</span>
          تاريخ التحقق {source.checkedAt}
        </p>
      )}
      {source?.note && <p className="mt-1 text-[12px] font-bold leading-6 text-black/70">{source.note}</p>}
      {editing ? (
        <MoneyField id={id} label="تعديل السعر" initial={String(item.pricePer)} onCommit={onCommit} />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={`mt-3 text-[13px] font-bold underline ${focusRing}`}>
          تعديل السعر
        </button>
      )}
    </div>
  );
}

function MoneyField({ id, label, initial, onCommit }: { id: string; label: string; initial: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const commit = () => {
    const value = parseMoney(draft);
    if (value) onCommit(value);
  };
  return (
    <label htmlFor={id} className="mt-4 block">
      <span className="block text-[13px] font-bold leading-6">{label}</span>
      <span className="mt-2 flex gap-2">
        <input
          id={id}
          inputMode="decimal"
          dir="ltr"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={`h-[40px] min-w-0 flex-1 rounded-full bg-black/[0.04] px-4 text-[13px] font-bold ${focusRing}`}
        />
        <button type="button" onClick={commit} className={`h-[40px] shrink-0 rounded-full bg-black px-4 text-[13px] font-bold text-white ${focusRing}`}>
          اعتماد
        </button>
      </span>
    </label>
  );
}

type ApiState = 'loading' | 'on' | 'off' | 'down';

export default function App() {
  const [tab, setTab] = useState<CustomsType>('traveler');
  const [texts, setTexts] = useState({ traveler: '', parcel: '' });
  const [parcelWeight, setParcelWeight] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [apiOn, setApiOn] = useState<ApiState>('loading');
  const runId = useRef(0);
  const activeTab = TABS.find(item => item.key === tab) ?? TABS[0];

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const check = (attempt: number) => {
      fetch('/api/health')
        .then(r => {
          if (!r.ok) throw new Error('health');
          return r.json();
        })
        .then(data => { if (!cancelled) setApiOn(data.configured ? 'on' : 'off'); })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 4) timer = window.setTimeout(() => check(attempt + 1), 700 * (attempt + 1));
          else setApiOn('down');
        });
    };
    check(0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check(0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const currentText = texts[tab];
  const hint = inputHint(tab, currentText);
  const isValid = useMemo(
    () => isSubmittable(tab, currentText),
    [currentText, tab],
  );

  const cancelInFlight = () => {
    runId.current += 1;
    setIsLoading(false);
  };

  const handleCalc = async () => {
    if (!isSubmittable(tab, texts[tab])) return;
    const my = ++runId.current;
    const tabNow = tab;
    const txt = texts[tab];
    const weight = parcelWeight;
    setIsLoading(true);
    setResult(null);
    setMessage(null);
    let preview: CalcOutcome;
    try {
      preview = calculate({ tab: tabNow, text: txt, parcelWeight: weight });
    } catch {
      if (runId.current !== my) return;
      setMessage('صار خطأ أثناء الحساب. حاول مرة ثانية.');
      setIsLoading(false);
      return;
    }
    if (!preview.ok) {
      if (runId.current !== my) return;
      setIsLoading(false);
      setMessage(preview.message);
      return;
    }
    const unitPrices: Array<number | null> = preview.items.map(item => item.priceSource === 'typed' ? item.pricePer : null);
    const origins: Array<PriceOrigin | null> = preview.items.map(item => item.priceSource === 'typed' ? 'typed' : null);
    const sources: Array<SourceInfo | null> = preview.items.map(() => null);
    const reasons: Array<'unavailable' | 'not_found' | 'ambiguous' | null> = preview.items.map(() => null);
    const options: Array<VariantOffer[] | null> = preview.items.map(() => null);
    const notes: Array<string | null> = preview.items.map(() => null);
    const wanted = preview.items.flatMap((item, index) => unitPrices[index] == null ? [{ raw: item.raw, name: item.name, sizeMl: item.sizeMl }] : []);
    if (wanted.length) {
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: wanted }),
        });
        const data = await res.json();
        if (Array.isArray(data?.prices)) {
          for (const row of data.prices) {
            if (row?.via !== 'web' || typeof row.raw !== 'string' || !Number.isFinite(row.priceSar) || row.priceSar <= 0) continue;
            if (typeof row.sourceName !== 'string' || typeof row.sourceUrl !== 'string' || typeof row.checkedAt !== 'string') continue;
            preview.items.forEach((item, index) => {
              if (item.raw !== row.raw || unitPrices[index] != null) return;
              unitPrices[index] = Math.round(row.priceSar * 100) / 100;
              origins[index] = 'web';
              sources[index] = {
                sourceName: row.sourceName,
                sourceUrl: row.sourceUrl,
                checkedAt: row.checkedAt,
                ...(typeof row.note === 'string' && row.note ? { note: row.note } : {}),
              };
            });
          }
        }
        if (Array.isArray(data?.failures)) {
          for (const row of data.failures) {
            if (typeof row?.raw !== 'string') continue;
            preview.items.forEach((item, index) => {
              if (item.raw !== row.raw || unitPrices[index] != null) return;
              const variants = Array.isArray(row.variants)
                ? row.variants.filter((variant: VariantOffer) => variant && typeof variant.name === 'string' && typeof variant.sourceUrl === 'string' && Number.isFinite(variant.priceSar) && variant.priceSar > 0)
                : [];
              if (row.reason === 'ambiguous' && variants.length >= 1) {
                reasons[index] = 'ambiguous';
                notes[index] = typeof row.note === 'string' ? row.note : null;
                options[index] = variants.map((variant: VariantOffer) => ({
                  name: variant.name,
                  priceSar: Math.round(variant.priceSar * 100) / 100,
                  sourceName: typeof variant.sourceName === 'string' ? variant.sourceName : 'المتجر',
                  sourceUrl: variant.sourceUrl,
                }));
                return;
              }
              reasons[index] = row.reason === 'unavailable' ? 'unavailable' : 'not_found';
            });
          }
        }
      } catch {
        preview.items.forEach((item, index) => {
          if (unitPrices[index] == null) reasons[index] = 'unavailable';
        });
      }
    }
    if (runId.current !== my) return;
    const outcome = calculate({ tab: tabNow, text: txt, parcelWeight: weight, unitPrices, priceSources: origins });
    setIsLoading(false);
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    setResult({
      type: tabNow,
      text: txt,
      parcelWeight: weight,
      items: outcome.items,
      warning: outcome.warning,
      weightKg: outcome.weightKg,
      unitPrices,
      origins,
      sources,
      reasons,
      options,
      notes,
    });
  };

  const chooseVariant = (index: number, variant: VariantOffer) => {
    if (!result) return;
    const unitPrices = result.unitPrices.map((value, itemIndex) => itemIndex === index ? variant.priceSar : value);
    const origins = result.origins.map((origin, itemIndex) => itemIndex === index ? 'web' as const : origin);
    const sources = result.sources.map((source, itemIndex) => itemIndex === index ? {
      sourceName: variant.sourceName,
      sourceUrl: variant.sourceUrl,
      checkedAt: new Date().toISOString().slice(0, 10),
    } : source);
    const outcome = calculate({
      tab: result.type,
      text: result.text,
      parcelWeight: result.parcelWeight,
      unitPrices,
      priceSources: origins,
    });
    if (!outcome.ok) return;
    setResult({ ...result, items: outcome.items, warning: outcome.warning, weightKg: outcome.weightKg, unitPrices, origins, sources });
  };

  const commitPrice = (index: number, price: number) => {
    if (!result) return;
    const unitPrices = result.unitPrices.map((value, itemIndex) => itemIndex === index ? price : value);
    const origins = result.origins.map((origin, itemIndex) => itemIndex === index ? 'manual' as const : origin);
    const outcome = calculate({
      tab: result.type,
      text: result.text,
      parcelWeight: result.parcelWeight,
      unitPrices,
      priceSources: origins,
    });
    if (!outcome.ok) return;
    setResult({ ...result, items: outcome.items, warning: outcome.warning, weightKg: outcome.weightKg, unitPrices, origins });
  };

  const pricedItems = result ? result.items.filter(item => item.priceSource !== 'missing') : [];
  const totalPay = pricedItems.reduce((s, it) => s + it.pay, 0);
  const totalCustoms = pricedItems.reduce((s, it) => s + it.customs, 0);
  const totalVat = pricedItems.reduce((s, it) => s + it.vat, 0);

  return (
    <div
      data-safe-area-inset-root
      dir="rtl"
      className="min-h-screen bg-[#FCFCF9] text-[#111] overflow-x-clip antialiased"
      style={{ boxSizing: 'border-box', paddingTop: 'var(--safe-area-inset-top)' } as React.CSSProperties}
    >
      <header
        data-safe-area-sticky-top
        className="sticky z-20 bg-[#FCFCF9]/90 backdrop-blur-xl border-b border-black/[0.06]"
        style={{ top: 'var(--safe-area-inset-top)' }}
      >
        <div className="max-w-[640px] mx-auto px-5 sm:px-6 h-[64px] flex items-center justify-between gap-3">
          <div>
            <div className="text-[20px] font-[900] tracking-[-0.02em] leading-none">حِسبة</div>
            <p className="mt-1 text-[11px] font-bold text-black/60">جمارك وضريبة تقديرية</p>
          </div>
          <div role="tablist" aria-label="نوع الطلب" className="flex gap-1.5 p-1 rounded-full bg-black/[0.04]">
            {TABS.map(t => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  id={`tab-${t.key}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="request-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    cancelInFlight();
                    setTab(t.key);
                    setResult(null);
                    setMessage(null);
                  }}
                  className={`h-[32px] px-3.5 rounded-full text-[13px] font-bold transition ${focusRing} ${active ? 'bg-black text-white' : 'text-black/70'}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-[640px] mx-auto px-5 sm:px-6 pt-8 pb-24">
        <p id="request-help" className="mb-4 text-[14px] leading-7 text-black/70">{activeTab.help}</p>
        <div id="request-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="bg-white rounded-[24px] border border-black/[0.06] overflow-hidden">
          <div className="p-5 sm:p-6">
            <label htmlFor="goods" className="sr-only">وصف البضاعة</label>
            <textarea
              id="goods"
              value={texts[tab]}
              maxLength={MAX_TEXT}
              aria-describedby="request-help input-hint"
              aria-invalid={Boolean(hint)}
              onChange={e => {
                cancelInFlight();
                setTexts({ ...texts, [tab]: e.target.value });
                setResult(null);
                setMessage(null);
              }}
              placeholder="اكتب هنا..."
              className={`w-full min-h-[132px] bg-transparent text-[20px] font-[500] leading-[1.7] placeholder:text-black/40 resize-none rounded-lg ${focusRing}`}
              rows={4}
            />
            <p id="input-hint" className="mt-3 min-h-[18px] text-[12px] font-bold text-black/70" role="status">
              {hint || (currentText.length > 3200 ? `${currentText.length} / ${MAX_TEXT}` : '')}
            </p>
            <p className="mt-1 text-[12px] font-bold text-black/70" role="status">
              {apiOn === 'down'
                ? 'تعذر الاتصال بالبحث. إذا لم يظهر سعر، اكتبه في الحقل.'
                : 'كل طلب يبحث عن السعر الحالي في مواقع البيع، ولا يُستخدم سعر محفوظ.'}
            </p>
            {tab === 'parcel' && (
              <div className="mt-4">
                <label htmlFor="weight" className="sr-only">وزن الشحنة بالكيلوجرام، اختياري ولا يغيّر الرسوم</label>
                <input
                  id="weight"
                  value={parcelWeight}
                  onChange={e => {
                    cancelInFlight();
                    const cleaned = e.target.value.replace(/[^0-9.\u0660-\u0669]/g, '');
                    const parts = cleaned.split('.');
                    const next = parts.length <= 2 ? cleaned : `${parts[0]}.${parts.slice(1).join('')}`;
                    setParcelWeight(next);
                    setResult(null);
                    setMessage(null);
                  }}
                  placeholder="الوزن كجم (اختياري)"
                  inputMode="decimal"
                  className={`h-[40px] w-full rounded-full bg-black/[0.04] px-4 text-[13px] font-bold placeholder:text-black/45 ${focusRing}`}
                />
              </div>
            )}
          </div>
          <div className="px-5 sm:px-6 pb-6">
            <button
              type="button"
              onClick={handleCalc}
              disabled={!isValid || isLoading}
              aria-busy={isLoading}
              className={`w-full h-[52px] rounded-full bg-black text-white text-[15px] font-bold disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition ${focusRing}`}
            >
              {isLoading ? 'يحسب…' : 'احسب'}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="mt-6 space-y-3">
              {isLoading && <p className="text-[14px] font-bold" role="status">جاري البحث عن السعر في مواقع البيع…</p>}
          {message && !isLoading && (
            <div role="alert" className="bg-white rounded-[20px] border border-black/[0.06] p-6 text-[15px] font-bold leading-relaxed">
              {message}
            </div>
          )}

          {result && !isLoading && (
            <>
              {result.warning && (
                <div role="status" className="bg-white rounded-[20px] border border-black/[0.06] p-6 text-[13px] font-bold text-black/70 leading-relaxed">
                  {result.warning}
                </div>
              )}
              {result.items.map((it, idx) => {
                const missing = it.priceSource === 'missing';
                const source = result.sources[idx];
                return (
                <article key={`${it.raw}-${idx}`} className="bg-white rounded-[20px] border border-black/[0.06] p-6">
                  <h2 className="text-[18px] font-[800] leading-tight">
                    {it.qty > 1 ? `${it.qty} ${it.name}` : it.name}
                  </h2>
                  {it.exemptQty > 0 && (
                    <p className="mt-1 text-[12px] font-bold text-black/70">معفى {it.exemptQty} من الجمارك والضريبة</p>
                  )}
                  {missing ? (
                    <>
                      <p className="mt-3 text-[14px] font-bold">
                        {result.reasons[idx] === 'unavailable'
                          ? 'تعذر الاتصال بمصادر البحث. أعد المحاولة.'
                          : result.reasons[idx] === 'ambiguous'
                            ? (result.notes[idx] || 'اختر المنتج المطابق')
                            : 'Price not found after searching'}
                      </p>
                      {result.reasons[idx] === 'ambiguous' && result.options[idx]?.map(variant => (
                        <div key={variant.sourceUrl} className="mt-3 rounded-2xl border border-black/10 p-3">
                          <button type="button" onClick={() => chooseVariant(idx, variant)} className={`block w-full text-right ${focusRing}`}>
                            <span className="block text-[13px] font-bold">{variant.name}</span>
                            <span className="mt-1 block text-[12px] font-bold text-black/70">{formatSAR(variant.priceSar)} · {variant.sourceName}</span>
                          </button>
                          <a href={variant.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[12px] font-bold underline">
                            صفحة المنتج
                          </a>
                        </div>
                      ))}
                      {result.reasons[idx] !== 'ambiguous' && (
                        <MoneyField
                          id={`price-${idx}`}
                          label="Add price manually"
                          initial=""
                          onCommit={price => commitPrice(idx, price)}
                        />
                      )}
                    </>
                  ) : (
                    <FoundPrice id={`price-${idx}`} item={it} source={source} onCommit={price => commitPrice(idx, price)} />
                  )}
                  {!missing && (
                  <dl className="mt-5 space-y-2 border-t border-black/[0.06] pt-4">
                    <div className="flex justify-between text-[13px]">
                      <dt className="text-black/70">الجمارك</dt>
                      <dd className="font-bold">{formatSAR(it.customs)}</dd>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <dt className="text-black/70">الضريبة</dt>
                      <dd className="font-bold">{formatSAR(it.vat)}</dd>
                    </div>
                    <div className="flex justify-between items-end pt-3 mt-3 border-t border-black/[0.06]">
                      <dt>
                        <span className="block text-[14px] font-bold">الإجمالي</span>
                        <span className="block text-[11px] font-bold text-black/60">الجمارك والضريبة</span>
                      </dt>
                      <dd className="text-[16px] font-[800]">{formatSAR(it.pay)}</dd>
                    </div>
                  </dl>
                  )}
                </article>
                );
              })}

              {result.weightKg != null && (
                <p className="px-2 text-[12px] font-bold text-black/70">
                  الوزن المسجّل {result.weightKg} كجم، وحساب الرسوم على قيمة البضاعة.
                </p>
              )}

              {pricedItems.length > 1 && (
                <section aria-label="مجموع الرسوم" className="bg-black text-white rounded-[20px] p-6">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-white/80">الجمارك</span>
                    <span className="font-bold">{formatSAR(totalCustoms)}</span>
                  </div>
                  <div className="flex justify-between mt-2 text-[13px]">
                    <span className="text-white/80">الضريبة</span>
                    <span className="font-bold">{formatSAR(totalVat)}</span>
                  </div>
                  <div className="flex justify-between items-end mt-4 pt-4 border-t border-white/15">
                    <span>
                      <span className="block text-[15px] font-bold">الإجمالي</span>
                      <span className="block text-[11px] text-white/70">الجمارك والضريبة</span>
                    </span>
                    <span className="text-[18px] font-[800]">{formatSAR(totalPay)}</span>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
