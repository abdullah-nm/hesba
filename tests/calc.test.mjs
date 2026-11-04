import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, isSubmittable, inputHint } from '../src/calc.ts';

function ok(result) {
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  return result;
}

test('عدة طلبات في جملة واحدة: أربعة آيفون وخمسة ماك بوك', () => {
  const result = ok(calculate({
    tab: 'traveler',
    text: 'شريت اربع ايفون 17 برو ماكس وشريت خمس لابتوبات ماك بوك اير',
    quotes: {
      'شريت اربع ايفون 17 برو ماكس': 6000,
      'شريت خمس لابتوبات ماك بوك اير': 4200,
    },
  }));
  assert.equal(result.items.length, 2);
  const [phone, laptop] = result.items;
  assert.equal(phone.name, 'آيفون 17 برو ماكس');
  assert.equal(phone.qty, 4);
  assert.equal(phone.pricePer, 6000);
  assert.equal(phone.exemptQty, 2);
  assert.equal(phone.customs, 600);
  assert.equal(phone.vat, 1890);
  assert.equal(phone.pay, 2490);
  assert.equal(phone.total, phone.pay);
  assert.equal(laptop.name, 'ماك بوك اير');
  assert.equal(laptop.qty, 5);
  assert.equal(laptop.pricePer, 4200);
  assert.equal(laptop.customs, 0);
  assert.equal(laptop.vat, 3150);
  assert.equal(laptop.pay, 3150);
  assert.equal(laptop.total, laptop.pay);
});

test('الإعفاء هاتفان للرحلة كلها وليس لكل جملة', () => {
  const result = ok(calculate({ tab: 'traveler', text: 'ايفون وايفون وايفون', quotes: { ايفون: 4500 } }));
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].pay, 0);
  assert.equal(result.items[1].pay, 0);
  assert.equal(result.items[2].customs, 225);
  assert.equal(result.items[2].vat, 709);
  assert.equal(result.items[2].pay, 934);
  assert.equal(result.items[2].total, 934);
});

test('جهازان في سطر واحد يبقيان معفيين، وأربعة برو ماكس تُحسب على اثنين', () => {
  const two = ok(calculate({ tab: 'traveler', text: 'اثنين ايفون 16 برو', quotes: { 'اثنين ايفون 16 برو': 5500 } }));
  assert.equal(two.items[0].qty, 2);
  assert.equal(two.items[0].name, 'آيفون 16 برو');
  assert.equal(two.items[0].exemptQty, 2);
  assert.equal(two.items[0].pay, 0);
  const four = ok(calculate({ tab: 'traveler', text: '4 ايفون 17 برو ماكس', quotes: { '4 ايفون 17 برو ماكس': 6000 } }));
  assert.equal(four.items[0].pay, 2490);
});

test('كلمة مستعمل واستيراد لا تغيّر الكمية ولا التخزين', () => {
  const used = ok(calculate({ tab: 'traveler', text: 'ايفون 15 مستعمل' }));
  assert.equal(used.items[0].qty, 1);
  assert.equal(used.items[0].name, 'آيفون 15');
  assert.equal(used.items[0].priceSource, 'missing');
  assert.equal(used.items[0].pay, 0);
  const imported = ok(calculate({ tab: 'traveler', text: 'استيراد ايفون 15' }));
  assert.equal(imported.items[0].qty, 1);
  assert.equal(imported.items[0].name, 'آيفون 15');
  assert.equal(imported.items[0].priceSource, 'missing');
});

test('رقم داخل اسم السلعة يبقى موديلًا وليس كمية', () => {
  const gpu = ok(calculate({ tab: 'traveler', text: 'بشتري كرت شاشه 5060rtx' }));
  assert.equal(gpu.items.length, 1);
  assert.equal(gpu.items[0].qty, 1);
  assert.match(gpu.items[0].name, /5060rtx/);
  assert.equal(gpu.items[0].name.includes('بشتري'), false);

  const spaced = ok(calculate({ tab: 'traveler', text: 'كرت شاشة 5060' }));
  assert.equal(spaced.items[0].qty, 1);
  assert.match(spaced.items[0].name, /5060/);

  const counted = ok(calculate({ tab: 'traveler', text: '2 كرت شاشه 5060' }));
  assert.equal(counted.items[0].qty, 2);
  assert.match(counted.items[0].name, /5060/);
  assert.equal(counted.items[0].name.startsWith('2'), false);
});

test('كمّية أكبر من 1000 تُقرأ كما كُتبت', () => {
  const result = ok(calculate({ tab: 'traveler', text: '2000 ايفون', quotes: { '2000 ايفون': 4500 } }));
  assert.equal(result.items[0].qty, 2000);
  assert.ok(result.items[0].pay > 0);
});

test('تيرا تخزين وليست موديل 1، و17 مع تيرا يبقى موديل 17', () => {
  const one = ok(calculate({ tab: 'traveler', text: 'ايفون 1 تيرا' }));
  assert.equal(one.items[0].name, 'آيفون 1 تيرا');
  assert.equal(one.items.length, 1);
  const seventeen = ok(calculate({ tab: 'traveler', text: 'ايفون 17 تيرا' }));
  assert.equal(seventeen.items[0].name, 'آيفون 17 1 تيرا');
  assert.equal(seventeen.items.length, 1);
});

test('العطور تُطابق الماركة المكتوبة', () => {
  const chanel = ok(calculate({ tab: 'parcel', text: 'عطر شانيل', quotes: { 'عطر شانيل': 700 } }));
  assert.equal(chanel.items[0].name, 'شانيل شانس');
  assert.equal(chanel.items[0].pricePer, 700);
  assert.equal(chanel.items[0].customs, 0);
  assert.equal(chanel.items[0].bayan, 15);
  assert.equal(chanel.items[0].vat, 107);
  assert.equal(chanel.items[0].pay, 107);
  assert.equal(chanel.items[0].total, chanel.items[0].pay);

  const both = ok(calculate({
    tab: 'parcel',
    text: 'عطر شانيل وثلاثة عطر ديور',
    quotes: { 'عطر شانيل': 700, 'ثلاثة عطر ديور': 580 },
  }));
  assert.equal(both.items.length, 2);
  assert.equal(both.items[0].name, 'شانيل شانس');
  assert.equal(both.items[1].name, 'ديور سوفاج');
  assert.equal(both.items[1].qty, 3);
  assert.equal(both.items[1].pricePer, 580);

  const plain = ok(calculate({ tab: 'traveler', text: 'عطر' }));
  assert.equal(plain.items[0].name, 'عطر');
  assert.equal(plain.items[0].pricePer, 0);
  assert.equal(plain.items[0].priceSource, 'missing');
  assert.equal(plain.items[0].pay, 0);
  assert.notEqual(plain.items[0].name, 'روجا عود هارودز حصري');

  const imagination = ok(calculate({ tab: 'traveler', text: 'خمس عطور ايماجنيشن ٢٠٠ مل' }));
  assert.equal(imagination.items[0].qty, 5);
  assert.equal(imagination.items[0].sizeMl, 200);
  assert.equal(imagination.items[0].name.includes('خمس'), false);
  assert.match(imagination.items[0].name, /ايماجنيشن/);
  assert.equal(imagination.items[0].priceSource, 'missing');

  const n5 = ok(calculate({ tab: 'parcel', text: 'عطر شانيل 5' }));
  assert.equal(n5.items.length, 1);
  assert.equal(n5.items[0].name, 'شانيل N°5');
  assert.equal(n5.items[0].priceSource, 'missing');

  const bleu = ok(calculate({ tab: 'parcel', text: 'بلو دو شانيل' }));
  assert.match(bleu.items[0].name, /Bleu de Chanel/);
  assert.equal(bleu.items[0].name.includes('شانس'), false);

  const bleuDi = ok(calculate({ tab: 'traveler', text: 'شريت ١٠ عطور بلو دي شانيل ٢٠٠ مل' }));
  assert.equal(bleuDi.items.length, 1);
  assert.equal(bleuDi.items[0].qty, 10);
  assert.equal(bleuDi.items[0].sizeMl, 200);
  assert.match(bleuDi.items[0].name, /Bleu de Chanel/);
  assert.equal(bleuDi.items[0].name.includes('شانس'), false);
  assert.equal(/chance/i.test(bleuDi.items[0].name), false);
  assert.equal(/^10\b/.test(bleuDi.items[0].name), false);

  const roja = ok(calculate({ tab: 'parcel', text: 'عطر روجا' }));
  assert.equal(roja.items[0].name, 'روجا عود هارودز حصري');
  assert.equal(roja.items[0].priceSource, 'missing');

  const small = ok(calculate({ tab: 'parcel', text: 'عطر شانيل 50 مل' }));
  assert.equal(small.items.length, 1);
  assert.match(small.items[0].name, /50/);
  assert.equal(small.items[0].sizeMl, 50);
  assert.equal(small.items[0].priceSource, 'missing');
});

test('حد المسافر ٣٠٠٠ وحد الشحنة ١٠٠٠', () => {
  const under = ok(calculate({ tab: 'traveler', text: '8 عطر', quotes: { '8 عطر': 350 } }));
  assert.equal(under.items[0].totalOutside, 2800);
  assert.equal(under.items[0].pay, 0);
  const over = ok(calculate({ tab: 'traveler', text: '9 عطر', quotes: { '9 عطر': 350 } }));
  assert.equal(over.items[0].totalOutside, 3150);
  assert.equal(over.items[0].customs, 158);
  assert.equal(over.items[0].vat, 496);
  assert.equal(over.items[0].pay, 654);
  assert.equal(over.items[0].total, 654);

  const parcelUnder = ok(calculate({ tab: 'parcel', text: 'عطرين', quotes: { عطرين: 350 } }));
  assert.equal(parcelUnder.items[0].qty, 2);
  assert.equal(parcelUnder.items[0].totalOutside, 700);
  assert.equal(parcelUnder.items[0].customs, 0);
  assert.equal(parcelUnder.items[0].bayan, 15);
  assert.equal(parcelUnder.items[0].vat, 107);
  assert.equal(parcelUnder.items[0].pay, 107);
  assert.equal(parcelUnder.items[0].total, parcelUnder.items[0].pay);
  const parcelOver = ok(calculate({ tab: 'parcel', text: '4 عطر', quotes: { '4 عطر': 350 } }));
  assert.equal(parcelOver.items[0].customs, 70);
  assert.equal(parcelOver.items[0].bayan, 15);
  assert.equal(parcelOver.items[0].vat, 223);
  assert.equal(parcelOver.items[0].pay, 293);
  assert.equal(parcelOver.items[0].total, parcelOver.items[0].pay);

  const splitFree = ok(calculate({ tab: 'traveler', text: Array.from({ length: 8 }, () => 'عطر').join(' و'), quotes: { عطر: 350 } }));
  assert.equal(splitFree.items.length, 8);
  assert.equal(splitFree.items.reduce((s, it) => s + it.totalOutside, 0), 2800);
  assert.equal(splitFree.items.every(it => it.pay === 0), true);
  const splitTaxed = ok(calculate({ tab: 'traveler', text: Array.from({ length: 9 }, () => 'عطر').join(' و'), quotes: { عطر: 350 } }));
  assert.equal(splitTaxed.items.length, 9);
  assert.equal(splitTaxed.items.reduce((s, it) => s + it.pay, 0) > 0, true);
});

test('لابتوب الشحنة بلا جمارك مع بيان وضريبة، ولابتوب غير ماك يحتفظ باسمه', () => {
  const air = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير', quotes: { 'ماك بوك اير': 4200 } }));
  assert.equal(air.items[0].name, 'ماك بوك اير');
  assert.equal(air.items[0].customs, 0);
  assert.equal(air.items[0].bayan, 15);
  assert.equal(air.items[0].vat, 632);
  assert.equal(air.items[0].pay, 632);
  assert.equal(air.items[0].total, air.items[0].pay);
  const basic = ok(calculate({ tab: 'traveler', text: 'لابتوب' }));
  assert.equal(basic.items[0].priceSource, 'missing');
  assert.equal(basic.items[0].pay, 0);
  const dell = ok(calculate({ tab: 'traveler', text: 'لابتوب مايكروسوفت' }));
  assert.equal(dell.items[0].name, 'لابتوب مايكروسوفت');
  assert.equal(dell.items[0].priceSource, 'missing');
  assert.equal(dell.items[0].pay, 0);
  const mixed = ok(calculate({
    tab: 'traveler',
    text: 'لابتوب وماك بوك اير',
    quotes: { لابتوب: 2500, 'ماك بوك اير': 4200 },
  }));
  assert.equal(mixed.items[0].pay, 375);
  assert.equal(mixed.items[1].name, 'ماك بوك اير');
  assert.equal(mixed.items[1].pay, 630);
});

test('سامسونج وآيباد تُحسب جوالات، والإنجليزي ينقسم عند and', () => {
  const samsung = ok(calculate({ tab: 'traveler', text: 'سامسونج جالكسي 24' }));
  assert.equal(samsung.items[0].category, 'phone');
  assert.equal(samsung.items[0].name, 'سامسونج 24');
  assert.equal(samsung.items[0].priceSource, 'missing');
  assert.equal(samsung.items[0].pay, 0);
  const ipad = ok(calculate({ tab: 'traveler', text: 'ايباد برو' }));
  assert.equal(ipad.items[0].name, 'آيباد برو');
  assert.equal(ipad.items[0].priceSource, 'missing');
  const english = ok(calculate({ tab: 'traveler', text: '2 iphone 15 pro and macbook air', quotes: { '2 iphone 15 pro': 5500, 'macbook air': 4200 } }));
  assert.equal(english.items.length, 2);
  assert.equal(english.items[0].qty, 2);
  assert.equal(english.items[0].name, 'آيفون 15 برو');
  assert.equal(english.items[0].pay, 0);
  assert.equal(english.items[1].name, 'ماك بوك اير');
  assert.equal(english.items[1].pay, 630);
});

test('فواصل وأسطر وأرقام عربية وعلامة مخفية', () => {
  const result = ok(calculate({
    tab: 'traveler',
    text: 'ايفون\u200f 17 برو ماكس\nماك بوك برو + عطر كريد',
  }));
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].name, 'آيفون 17 برو ماكس');
  assert.equal(result.items[1].name, 'ماك بوك برو');
  assert.equal(result.items[2].name, 'كريد افينتوس');
  const arabicQty = ok(calculate({ tab: 'traveler', text: '٤ ايفون ١٧ برو' }));
  assert.equal(arabicQty.items[0].qty, 4);
  assert.equal(arabicQty.items[0].name, 'آيفون 17 برو');
});

test('وزن الشحنة يُعرض ولا يغيّر الرسوم، والتكرار يعطي نفس الأرقام', () => {
  const plain = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير' }));
  const weighed = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير', parcelWeight: '٢.٥' }));
  assert.equal(weighed.weightKg, 2.5);
  assert.equal(weighed.items[0].pay, plain.items[0].pay);
  assert.equal(weighed.items[0].total, plain.items[0].total);
  const fromText = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير وزنه 500 جرام' }));
  assert.equal(fromText.weightKg, 0.5);
  assert.equal(fromText.items[0].pay, plain.items[0].pay);
  const again = calculate({ tab: 'parcel', text: 'ماك بوك اير', parcelWeight: '2.5' });
  assert.deepEqual(again, weighed);

  const zero = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير', parcelWeight: '0' }));
  assert.equal(zero.weightKg, null);
  assert.equal(zero.items[0].pay, plain.items[0].pay);
  assert.match(zero.warning, /الوزن/);
  const hugeWeight = ok(calculate({ tab: 'parcel', text: 'ماك بوك اير', parcelWeight: '20000' }));
  assert.equal(hugeWeight.weightKg, null);
  assert.match(hugeWeight.warning, /١٠٠٠٠/);
});

test('المدخلات الفارغة والحدود والضغط', () => {
  assert.equal(isSubmittable('traveler', ''), false);
  assert.equal(isSubmittable('traveler', ' '), false);
  assert.equal(isSubmittable('traveler', '!'), false);
  assert.equal(isSubmittable('traveler', 'ا'), false);
  assert.equal(isSubmittable('traveler', 'ايفون'), true);
  assert.equal(inputHint('traveler', ''), null);

  const huge = 'ا'.repeat(4001);
  assert.equal(isSubmittable('traveler', huge), false);
  const rejected = calculate({ tab: 'traveler', text: huge });
  assert.equal(rejected.ok, false);

  const many = Array.from({ length: 30 }, () => 'ايفون').join(' و');
  const started = Date.now();
  const crowd = ok(calculate({ tab: 'traveler', text: many, quotes: { ايفون: 4500 } }));
  assert.ok(Date.now() - started < 1000);
  assert.equal(crowd.items.length, 30);
  assert.equal(crowd.items[0].pay, 0);
  assert.equal(crowd.items[1].pay, 0);
  assert.equal(crowd.items[2].pay, 934);
  assert.equal(crowd.items.reduce((s, it) => s + it.pay, 0), 28 * 934);
});

test('الأرقام المركبة والسعر المكتوب وسعر الواجهة', () => {
  const sixteen = ok(calculate({ tab: 'traveler', text: 'ستة عشر ايفون', quotes: { 'ستة عشر ايفون': 4500 } }));
  assert.equal(sixteen.items[0].qty, 16);
  assert.equal(sixteen.items[0].exemptQty, 2);
  assert.equal(sixteen.items[0].pay > 0, true);

  const twentyThree = ok(calculate({ tab: 'traveler', text: 'ثلاثة وعشرون عطر', quotes: { 'ثلاثة وعشرون عطر': 350 } }));
  assert.equal(twentyThree.items.length, 1);
  assert.equal(twentyThree.items[0].qty, 23);
  assert.equal(twentyThree.items[0].customs, 403);
  assert.equal(twentyThree.items[0].vat, 1268);
  assert.equal(twentyThree.items[0].pay, 1671);

  const typed = ok(calculate({ tab: 'traveler', text: 'ذهب 800 ريال' }));
  assert.equal(typed.items[0].pricePer, 800);
  assert.equal(typed.items[0].priceSource, 'typed');
  assert.equal(typed.items[0].qty, 1);
  assert.equal(typed.items[0].pay, 0);

  const quoted = ok(calculate({ tab: 'traveler', text: 'ذهب', quotes: { 'ذهب': 4000 } }));
  assert.equal(quoted.items[0].pricePer, 4000);
  assert.equal(quoted.items[0].priceSource, 'web');
  assert.equal(quoted.items[0].customs, 200);
  assert.equal(quoted.items[0].vat, 630);
  assert.equal(quoted.items[0].pay, 830);
  assert.equal(quoted.items[0].total, quoted.items[0].pay);

  const missing = ok(calculate({ tab: 'traveler', text: 'ذهب' }));
  assert.equal(missing.items[0].priceSource, 'missing');
  assert.equal(missing.items[0].pricePer, 0);
  assert.equal(missing.items[0].customs, 0);
  assert.equal(missing.items[0].vat, 0);
  assert.equal(missing.items[0].pay, 0);

  const manual = ok(calculate({
    tab: 'parcel',
    text: 'ذهب',
    unitPrices: [900],
    priceSources: ['manual'],
  }));
  assert.equal(manual.items[0].priceSource, 'manual');
  assert.equal(manual.items[0].pricePer, 900);
  assert.equal(manual.items[0].total, manual.items[0].pay);
  assert.equal(manual.items[0].pay, manual.items[0].customs + manual.items[0].vat);
  assert.ok(manual.items[0].pay < manual.items[0].totalOutside);
});

test('إجمالي الشحنة جمارك وضريبة فقط ولا يضم قيمة البضاعة', () => {
  const one = ok(calculate({ tab: 'parcel', text: 'عطر 800 ريال' }));
  assert.equal(one.items[0].pricePer, 800);
  assert.equal(one.items[0].customs, 0);
  assert.equal(one.items[0].vat, 122);
  assert.equal(one.items[0].pay, 122);
  assert.equal(one.items[0].total, one.items[0].customs + one.items[0].vat);
  assert.ok(one.items[0].pay < one.items[0].totalOutside);

  const many = ok(calculate({
    tab: 'parcel',
    text: 'عطر شانيل وثلاثة عطر ديور',
    quotes: { 'عطر شانيل': 700, 'ثلاثة عطر ديور': 580 },
  }));
  const fees = many.items.reduce((sum, item) => sum + item.pay, 0);
  const goods = many.items.reduce((sum, item) => sum + item.totalOutside, 0);
  assert.equal(many.items.length, 2);
  assert.equal(fees, many.items.reduce((sum, item) => sum + item.customs + item.vat, 0));
  assert.ok(many.items.every(item => item.total === item.customs + item.vat));
  assert.ok(fees < goods);
});

test('سعة التخزين واللون والحجم تبقى مع المنتج', () => {
  const storage = ok(calculate({ tab: 'traveler', text: 'ايفون 17 و 256 جيجا' }));
  assert.equal(storage.items.length, 1);
  assert.match(storage.items[0].name, /17/);
  assert.match(storage.items[0].name, /256/);
  assert.equal(storage.items[0].priceSource, 'missing');
  assert.equal(storage.items[0].pay, 0);

  const line = ok(calculate({ tab: 'traveler', text: 'ايفون 15\n256 جيجا' }));
  assert.equal(line.items.length, 1);
  assert.match(line.items[0].name, /256/);

  const english = ok(calculate({ tab: 'traveler', text: 'iphone 15, 256 gb' }));
  assert.equal(english.items.length, 1);
  assert.match(english.items[0].name, /256/);

  const color = ok(calculate({ tab: 'traveler', text: 'ايفون 16، اسود' }));
  assert.equal(color.items.length, 1);
  assert.match(color.items[0].name, /أسود/);

  const bottle = ok(calculate({ tab: 'traveler', text: 'عطر ديور و 100 مل' }));
  assert.equal(bottle.items.length, 1);
  assert.equal(bottle.items[0].sizeMl, 100);

  const two = ok(calculate({ tab: 'traveler', text: 'ايفون 256 جيجا وماك بوك اير' }));
  assert.equal(two.items.length, 2);
  assert.match(two.items[0].name, /256/);
  assert.equal(two.items[1].name, 'ماك بوك اير');
});
