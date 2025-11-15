// File: api/check-order.js
const fetch = require('node-fetch');
const crypto = require('crypto');
const moment = require('moment-timezone');

const ATLANTIC_BASE = process.env.ATLANTIC_BASE || 'https://atlantich2h.com';
const ATLANTIC_API_KEY = process.env.ATLANTIC_API_KEY;

const PT_DOMAIN = process.env.PTERODACTYL_DOMAIN;
const PT_API_KEY = process.env.PTERODACTYL_API_KEY;
const EGG = process.env.EGG || "1";
const NESTID = process.env.NESTID || "5";
const LOC = process.env.LOC || "1";

const SERVER_CONFIGS = {
  '1gb': { ram: "1125", disk: "1125", cpu: "30" },
  '2gb': { ram: "2125", disk: "2125", cpu: "60" },
  '3gb': { ram: "3125", disk: "3125", cpu: "80" },
  '4gb': { ram: "4125", disk: "4125", cpu: "90" },
  '5gb': { ram: "5125", disk: "5125", cpu: "100" },
  '6gb': { ram: "6125", disk: "6125", cpu: "120" },
  '7gb': { ram: "7125", disk: "7125", cpu: "130" },
  '8gb': { ram: "8125", disk: "8125", cpu: "150" },
  '10gb': { ram: "10125", disk: "10125", cpu: "200" },
  'unli': { ram: "0", disk: "0", cpu: "0" }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { depositId, username, ram } = req.body || (await getJsonBody(req));
    if (!depositId) return res.status(400).json({ error: 'depositId required' });

    // cek status deposit
    const params = new URLSearchParams();
    params.append('api_key', ATLANTIC_API_KEY);
    params.append('id', depositId);

    const statusRes = await fetch(`${ATLANTIC_BASE}/deposit/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const statusData = await statusRes.json();
    const paymentStatus = statusData?.data?.status;
    if (!paymentStatus) {
      console.error('statusData', statusData);
      return res.status(500).json({ error: 'Gagal membaca status pembayaran' });
    }

    if (paymentStatus === 'success') {
      // lakukan pembuatan panel
      if (!username || !ram) {
        return res.status(400).json({ error: 'username and ram are required to create panel' });
      }

      const serverConfig = SERVER_CONFIGS[ram];
      if (!serverConfig) return res.status(400).json({ error: 'Invalid ram option' });

      try {
        const panelData = await createPanel(username, serverConfig);
        return res.json({ status: 'success', panelData });
      } catch (err) {
        console.error('createPanel error', err);
        return res.status(500).json({ error: 'Gagal membuat panel', detail: err.message });
      }

    } else if (['failed', 'cancel'].includes(paymentStatus)) {
      return res.json({ status: 'failed' });
    } else {
      return res.json({ status: 'pending' });
    }

  } catch (err) {
    console.error('check-order.js error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

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

// createPanel uses Pterodactyl application API
async function createPanel(username, serverConfig) {
  if (!PT_DOMAIN || !PT_API_KEY) throw new Error('Pterodactyl config missing');

  const email = `${username}@gmail.com`;
  const name = `${capitalize(username)} Server`;
  const password = username + crypto.randomBytes(2).toString('hex');

  // create user
  const userRes = await fetch(`${PT_DOMAIN}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PT_API_KEY}`
    },
    body: JSON.stringify({
      email,
      username,
      first_name: name,
      last_name: 'Server',
      language: 'en',
      password
    })
  });
  const userData = await userRes.json();
  if (userData.errors) throw new Error(userData.errors[0].detail || JSON.stringify(userData.errors));

  const userId = userData.attributes.id;

  // get egg startup
  const eggRes = await fetch(`${PT_DOMAIN}/api/application/nests/${NESTID}/eggs/${EGG}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PT_API_KEY}`
    }
  });
  const eggData = await eggRes.json();
  const startupCmd = eggData?.attributes?.startup || '';

  // create server
  const serverBody = {
    name: name,
    description: `Dibuat pada ${moment().tz('Asia/Jakarta').format('dddd, DD MMMM YYYY')}`,
    user: userId,
    egg: parseInt(EGG),
    docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
    startup: startupCmd,
    environment: {
      INST: "npm",
      USER_UPLOAD: "0",
      AUTO_UPDATE: "0",
      CMD_RUN: "npm start"
    },
    limits: {
      memory: serverConfig.ram,
      swap: 0,
      disk: serverConfig.disk,
      io: 500,
      cpu: serverConfig.cpu
    },
    feature_limits: {
      databases: 5,
      backups: 5,
      allocations: 5
    },
    deploy: {
      locations: [parseInt(LOC)],
      dedicated_ip: false,
      port_range: []
    }
  };

  const serverRes = await fetch(`${PT_DOMAIN}/api/application/servers`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PT_API_KEY}`
    },
    body: JSON.stringify(serverBody)
  });

  const serverData = await serverRes.json();
  if (serverData.errors) throw new Error(serverData.errors[0].detail || JSON.stringify(serverData.errors));

  return {
    serverId: serverData.attributes.id,
    name,
    username,
    password,
    loginUrl: PT_DOMAIN,
    ram: serverConfig.ram === "0" ? "Unlimited" : `${serverConfig.ram.slice(0,2)}GB`,
    cpu: serverConfig.cpu === "0" ? "Unlimited" : `${serverConfig.cpu}%`,
    disk: serverConfig.disk === "0" ? "Unlimited" : `${serverConfig.disk.slice(0,2)}GB`,
    expiry: moment().add(1, 'months').format('YYYY-MM-DD')
  };
}

function capitalize(s) {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}