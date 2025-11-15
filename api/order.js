// File: api/order.js
const fetch = require('node-fetch');
const qrcode = require('qrcode');
const crypto = require('crypto');

const RAM_PRICES = {
  '1gb': 1000, '2gb': 2000, '3gb': 3000,
  '4gb': 4000, '5gb': 5000, '6gb': 6000,
  '7gb': 7000, '8gb': 8000, '10gb': 10000,
  'unli': 11000
};

const ATLANTIC_BASE = process.env.ATLANTIC_BASE || 'https://atlantich2h.com';
const ATLANTIC_API_KEY = process.env.ATLANTIC_API_KEY;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, ram } = req.body || (await getJsonBody(req));
    if (!username || !ram) return res.status(400).json({ error: 'username and ram are required' });

    const amount = RAM_PRICES[ram];
    if (!amount) return res.status(400).json({ error: 'Pilihan RAM tidak valid' });

    const reffId = `${Date.now()}${crypto.randomInt(100, 999)}`;

    // Create deposit
    const params = new URLSearchParams();
    params.append('api_key', ATLANTIC_API_KEY);
    params.append('reff_id', reffId);
    params.append('nominal', amount);
    params.append('type', 'ewallet');
    params.append('metode', 'QRISFAST');

    const createRes = await fetch(`${ATLANTIC_BASE}/deposit/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const createData = await createRes.json();
    if (!createData || !createData.data || !createData.data.qr_string) {
      console.error('Atlantic create deposit error:', createData);
      return res.status(500).json({ error: createData?.message || 'Gagal membuat deposit di Atlantic' });
    }

    const depositId = createData.data.id;
    const qrString = createData.data.qr_string;
    const qrImage = await qrcode.toDataURL(qrString);

    // Return deposit info (no server-side session; client stores depositId/reffId)
    return res.json({
      success: true,
      depositId,
      reffId,
      amount,
      username,
      ram,
      qrImage
    });

  } catch (err) {
    console.error('order.js error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// helper to parse body if needed
function getJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}