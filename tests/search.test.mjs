import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/calc.ts';
import { appleBuyUrl, appleListedPrice, fragranceIdentity, pickApplePrice, titleMatchesFragrance } from '../server/quote.mjs';

const html = [
  '"price":{"fullPrice":4299.00},"category":"iphone","name":"iPhone 17 256GB Lavender"',
  '"price":{"fullPrice":5299.00},"category":"iphone","name":"iPhone 17 512GB Black"',
  '"price":{"fullPrice":5999.00},"category":"iphone","name":"iPhone 17 Pro 256GB"',
].join(',');

test('آيفون 17 سعة 256 يذهب لصفحة أبل ويقرأ سعر هذه السعة فقط', () => {
  assert.equal(appleBuyUrl('آيفون 17 256 جيجا'), 'https://www.apple.com/sa/shop/buy-iphone/iphone-17');
  assert.equal(appleBuyUrl('iPhone 17 Pro Max'), 'https://www.apple.com/sa/shop/buy-iphone/iphone-17-pro-max');
  assert.equal(appleBuyUrl('ماك بوك اير'), 'https://www.apple.com/sa/shop/buy-mac/macbook-air');
  const hit = pickApplePrice(html, 'آيفون 17 256 جيجا');
  assert.equal(hit.price, 4299);
  assert.match(hit.name, /256GB/);
  assert.equal(hit.name.includes('Pro'), false);
  assert.equal(pickApplePrice(html, 'آيفون 17 برو 256 جيجا').price, 5999);
  assert.equal(appleListedPrice('"seoPrice":5999.00,"other":{"seoPrice":6999.00}', 'ماك بوك اير'), 5999);
  assert.equal(appleListedPrice('"seoPrice":5999.00', 'ماك بوك اير 512 جيجا'), null);
});

test('ليبر أو دو بارفيوم ٩٠ مل يطابق الزجاجة نفسها ويرفض التركيز أو الحجم المختلف', () => {
  const identity = fragranceIdentity('10 × YSL Libre Eau de Parfum, 90 ml');
  assert.equal(identity.brand, 'ysl');
  assert.equal(identity.line, 'libre');
  assert.equal(identity.concentration, 'edp');
  assert.equal(identity.ml, 90);
  assert.equal(identity.query.includes('10'), false);
  const exact = 'Yves Saint Laurent Libre For Women 90ml - Eau de Parfum';
  assert.equal(titleMatchesFragrance(exact, identity), true);
  assert.equal(titleMatchesFragrance('Yves Saint Laurent Libre Intense Eau De Parfum For Women, 90ml', identity), false);
  assert.equal(titleMatchesFragrance('Yves Saint Laurent Libre for Women Eau de Parfum 50ml', identity), false);
  assert.equal(titleMatchesFragrance('YSL Libre L Eau Nue F EDP 90ML', identity), false);
  const arabic = fragranceIdentity('عطر ليبر أو دو بارفيوم ٩٠ مل ايف سان لوران');
  assert.equal(arabic.line, 'libre');
  assert.equal(arabic.concentration, 'edp');
  assert.equal(arabic.ml, 90);
  assert.equal(titleMatchesFragrance(exact, arabic), true);
  const parsed = calculate({ tab: 'traveler', text: '10 × YSL Libre Eau de Parfum, 90 ml' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].qty, 10);
  assert.equal(parsed.items[0].sizeMl, 90);
  assert.equal(/^10\b/.test(parsed.items[0].name), false);
});

test('بلو دي شانيل ٢٠٠ مل يبقى بلو ولا يطابق شانيل شانس', () => {
  const identity = fragranceIdentity('شريت ١٠ عطور بلو دي شانيل ٢٠٠ مل');
  assert.equal(identity.brand, 'chanel');
  assert.equal(identity.line, 'bleu');
  assert.equal(identity.ml, 200);
  assert.equal(identity.query.includes('Chance'), false);
  assert.equal(titleMatchesFragrance('Chanel Bleu de Chanel Eau de Parfum 200ml', identity), true);
  assert.equal(titleMatchesFragrance('Chanel Chance Eau de Parfum 200ml', identity), false);
  assert.equal(titleMatchesFragrance('Chanel Bleu de Chanel Eau de Toilette 100ml', identity), false);
  assert.equal(titleMatchesFragrance('Chanel Bleu De Shower Gel, 200 Ml', identity), false);
  const parsed = calculate({ tab: 'traveler', text: 'شريت ١٠ عطور بلو دي شانيل ٢٠٠ مل' });
  assert.equal(parsed.ok, true);
  assert.match(parsed.items[0].name, /Bleu de Chanel/);
  assert.equal(parsed.items[0].name.includes('شانس'), false);
  assert.equal(/Chanel Chance/i.test(parsed.items[0].name), false);
});
