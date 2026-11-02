import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculate,
  inputHint,
  isSubmittable,
  MAX_TEXT,
  type CalculatedItem,
  type CalcOutcome,
  type CustomsType,
} from './calc';

const formatSAR = (n: number) => {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (n === 0) return '0 ر.س';
  return new Intl.NumberFormat('ar-SA').format(Math.round(n)) + ' ر.س';
};

const TABS: { key: CustomsType; label: string; help: string }[] = [
  {
    key: 'traveler',
    label: 'مسافر',
    help: 'الإجمالي هنا هو الجمارك والضريبة فقط، لأن ثمن البضاعة مدفوع. سلة ما عدا الجوال تُعفى حتى ٣٠٠٠ ريال، وأول جوالين معفيان.',
  },
  {
    key: 'parcel',
    label: 'شحنة',
    help: 'الإجمالي يشمل ثمن البضاعة والرسوم. الشحنة حتى ١٠٠٠ ريال بلا جمرك، مع رسم بيان وضريبة ١٥٪.',
  },
];

type ApiState = 'loading' | 'on' | 'off' | 'down';

type ResultState = {
  type: CustomsType;
  items: CalculatedItem[];
  warning?: string;
  weightKg: number | null;
};

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

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
    fetch('/api/health')
      .then(r => r.json())
      .then(data => { if (!cancelled) setApiOn(data.configured ? 'on' : 'off'); })
      .catch(() => { if (!cancelled) setApiOn('down'); });
    return () => { cancelled = true; };
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
    let quotes: Record<string, number> | undefined;
    let quoteMissed = false;
    if (preview.ok) {
      const estimated = preview.items.filter(it => it.priceSource === 'estimate');
      if (estimated.length) {
        try {
          const res = await fetch('/api/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: estimated.map(it => ({ raw: it.raw, name: it.name, sizeMl: it.sizeMl })) }),
          });
          const data = await res.json();
          if (data?.ok && Array.isArray(data.prices)) {
            quotes = {};
            for (const row of data.prices) {
              if (row && typeof row.raw === 'string' && Number.isFinite(row.priceSar) && row.priceSar > 0) {
                quotes[row.raw] = Math.round(row.priceSar);
              }
            }
          }
          quoteMissed = !quotes || Object.keys(quotes).length === 0;
        } catch {
          quoteMissed = true;
        }
      }
    }
    if (runId.current !== my) return;
    let outcome = quotes && Object.keys(quotes).length
      ? calculate({ tab: tabNow, text: txt, parcelWeight: weight, quotes })
      : preview;
    if (outcome.ok && quoteMissed) {
      outcome = { ...outcome, warning: [outcome.warning, 'تعذر جلب السعر من الواجهة، فبقي السعر تقديريًا.'].filter(Boolean).join(' ') };
    }
    setIsLoading(false);
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    setResult({
      type: tabNow,
      items: outcome.items,
      warning: outcome.warning,
      weightKg: outcome.weightKg,
    });
  };

  const totalPay = result ? result.items.reduce((s, it) => s + it.pay, 0) : 0;
  const totalCustoms = result ? result.items.reduce((s, it) => s + it.customs, 0) : 0;
  const totalVat = result ? result.items.reduce((s, it) => s + it.vat, 0) : 0;
  const totalValue = result ? result.items.reduce((s, it) => s + it.totalOutside, 0) : 0;
  const totalAll = result ? result.items.reduce((s, it) => s + it.total, 0) : 0;

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
              {apiOn === 'on' && 'أسعار السلع غير المعروفة تُجلب تلقائيًا. المفتاح يبقى على الخادم.'}
              {apiOn === 'off' && 'السلع غير المعروفة تبقى بسعر تقديري حتى يوضع مفتاح في ملف .env.'}
              {apiOn === 'down' && 'تعذر الاتصال بخدمة الأسعار. السلع المعروفة تُحسب من الجدول المحلي.'}
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
          {isLoading && <p className="sr-only">جاري الحساب</p>}
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
              {result.items.map((it, idx) => (
                <article key={`${it.raw}-${idx}`} className="bg-white rounded-[20px] border border-black/[0.06] p-6">
                  <h2 className="text-[18px] font-[800] leading-tight">
                    {it.qty > 1 ? `${it.qty} ${it.name}` : it.name}
                  </h2>
                  {it.exemptQty > 0 && (
                    <p className="mt-1 text-[12px] font-bold text-black/70">معفى {it.exemptQty} من الجمارك والضريبة</p>
                  )}
                  <p className="mt-2 text-[14px] text-black/70 font-[500]">
                    {it.qty} × {formatSAR(it.pricePer)} = {formatSAR(it.totalOutside)}
                  </p>
                  {it.priceSource === 'estimate' && <p className="mt-1 text-[12px] font-bold text-black/70">سعر تقديري</p>}
                  {it.priceSource === 'api' && <p className="mt-1 text-[12px] font-bold text-black/70">سعر من الواجهة</p>}
                  {it.priceSource === 'typed' && <p className="mt-1 text-[12px] font-bold text-black/70">السعر المكتوب</p>}
                  <dl className="mt-5 space-y-2 border-t border-black/[0.06] pt-4">
                    <div className="flex justify-between text-[13px]">
                      <dt className="text-black/70">الجمارك</dt>
                      <dd className="font-bold">{formatSAR(it.customs)}</dd>
                    </div>
                    {it.bayan > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <dt className="text-black/70">البيان</dt>
                        <dd className="font-bold">{formatSAR(it.bayan)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between text-[13px]">
                      <dt className="text-black/70">الضريبة</dt>
                      <dd className="font-bold">{formatSAR(it.vat)}</dd>
                    </div>
                    {result.type === 'traveler' ? (
                      <div className="flex justify-between items-end pt-3 mt-3 border-t border-black/[0.06]">
                        <dt>
                          <span className="block text-[14px] font-bold">الإجمالي</span>
                          <span className="block text-[11px] font-bold text-black/60">الجمارك والضريبة</span>
                        </dt>
                        <dd className="text-[16px] font-[800]">{formatSAR(it.pay)}</dd>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-end pt-3 mt-3 border-t border-black/[0.06]">
                          <dt>
                            <span className="block text-[14px] font-bold">تدفع</span>
                            <span className="block text-[11px] font-bold text-black/60">الرسوم فقط</span>
                          </dt>
                          <dd className="text-[16px] font-[800]">{formatSAR(it.pay)}</dd>
                        </div>
                        <div className="flex justify-between items-end">
                          <dt>
                            <span className="block text-[12px] font-bold text-black/70">الإجمالي</span>
                            <span className="block text-[11px] font-bold text-black/60">القيمة مع الرسوم</span>
                          </dt>
                          <dd className="text-[12px] font-bold text-black/70">{formatSAR(it.total)}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </article>
              ))}

              {result.weightKg != null && (
                <p className="px-2 text-[12px] font-bold text-black/70">
                  الوزن المسجّل {result.weightKg} كجم، وحساب الرسوم على قيمة البضاعة.
                </p>
              )}

              {result.items.length > 1 && (
                <section aria-label="مجموع الطلب" className="bg-black text-white rounded-[20px] p-6">
                  {result.type === 'traveler' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-[13px]">
                        <span className="text-white/80">القيمة</span>
                        <span className="font-bold">{formatSAR(totalValue)}</span>
                      </div>
                      <div className="flex justify-between mt-2 text-[13px]">
                        <span className="text-white/80">الرسوم</span>
                        <span className="font-bold">{formatSAR(totalPay)}</span>
                      </div>
                      <div className="flex justify-between items-end mt-4 pt-4 border-t border-white/15">
                        <span>
                          <span className="block text-[15px] font-bold">الإجمالي</span>
                          <span className="block text-[11px] text-white/70">القيمة مع الرسوم</span>
                        </span>
                        <span className="text-[18px] font-[800]">{formatSAR(totalAll)}</span>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
