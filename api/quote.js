import { quotePayload } from '../server/quote.mjs';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method', prices: [] });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.status(200).json(await quotePayload(body));
  } catch (error) {
    res.status(200).json({ ok: false, reason: 'upstream', detail: 'bad json', prices: [] });
  }
}
