import { healthPayload } from '../server/quote.mjs';

export default function handler(_req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json(healthPayload());
}
