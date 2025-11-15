// File: server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const crypto = require('crypto');
const moment = require('moment-timezone');
const qrcode = require('qrcode');
const app = express();
const PORT = process.env.PORT || 3000;

// Konfigurasi
const config = {
  egg: "16",
  nestid: "5",
  loc: "1",
  domain: process.env.PTERODACTYL_DOMAIN,
  apikey: process.env.PTERODACTYL_API_KEY,
  atlantic: "https://atlantich2h.com",
  apikeyh2h: process.env.ATLANTIC_API_KEY
};

// Simpan order sementara (di production gunakan database)
const orders = new Map();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');

// Helper functions
const tanggal = () => {
  return moment().tz('Asia/Jakarta').format('dddd, DD MMMM YYYY');
};

const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Routes
app.get('/', (req, res) => {
  res.render('index', {
    ramOptions: {
      '1gb': 1000, '2gb': 2000, '3gb': 3000, 
      '4gb': 4000, '5gb': 5000, '6gb': 6000,
      '7gb': 7000, '8gb': 8000, '10gb': 10000,
      'unli': 11000
    }
  });
});

app.post('/order', async (req, res) => {
  const { username, ram } = req.body;
  const sessionId = req.session.id;

  if (orders.has(sessionId)) {
    return res.status(400).json({ 
      error: "Masih ada transaksi yang belum diselesaikan!" 
    });
  }

  // Validasi RAM
  const ramPrices = {
    '1gb': 1000, '2gb': 2000, '3gb': 3000, 
    '4gb': 4000, '5gb': 5000, '6gb': 6000,
    '7gb': 7000, '8gb': 8000, '10gb': 10000,
    'unli': 11000
  };

  if (!ramPrices[ram]) {
    return res.status(400).json({ error: "Pilihan RAM tidak valid" });
  }

  const amount = ramPrices[ram];
  const reffId = `${Date.now()}${crypto.randomInt(100, 999)}`;

  try {
    // Buat deposit di AtlanticH2H
    const depositRes = await fetch(`${config.atlantic}/deposit/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: config.apikeyh2h,
        reff_id: reffId,
        nominal: amount,
        type: 'ewallet',
        metode: 'QRISFAST'
      })
    });

    const depositData = await depositRes.json();
    
    if (!depositData.data?.qr_string) {
      return res.status(500).json({ error: depositData.message || 'Gagal membuat QRIS' });
    }

    // Simpan order
    orders.set(sessionId, {
      id: depositData.data.id,
      username,
      ram,
      amount,
      qrString: depositData.data.qr_string,
      createdAt: Date.now(),
      status: 'pending'
    });

    // Generate QR Code image
    const qrImage = await qrcode.toDataURL(depositData.data.qr_string);

    res.json({
      qrImage,
      amount,
      username,
      ram,
      orderId: reffId
    });

  } catch (error) {
    console.log('Order error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

app.get('/check-order', async (req, res) => {
  const sessionId = req.session.id;
  const order = orders.get(sessionId);

  if (!order) {
    return res.json({ status: 'not_found' });
  }

  try {
    // Cek status pembayaran
    const statusRes = await fetch(`${config.atlantic}/deposit/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 
        api_key: config.apikeyh2h, 
        id: order.id 
      })
    });

    const statusData = await statusRes.json();
    const paymentStatus = statusData.data?.status;

    if (paymentStatus === 'success') {
      // Buat panel jika pembayaran sukses
      const panelData = await createPanel(order.username, order.ram);
      order.status = 'completed';
      order.panelData = panelData;
      
      res.json({ 
        status: 'success', 
        panelData 
      });
      
    } else if (['failed', 'cancel'].includes(paymentStatus)) {
      order.status = 'failed';
      res.json({ status: 'failed' });
    } else {
      res.json({ status: 'pending' });
    }

  } catch (error) {
    console.log('Check order error:', error);
    res.status(500).json({ error: 'Error checking order status' });
  }
});

// Fungsi untuk membuat panel
async function createPanel(username, ram) {
  const serverConfigs = {
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

  const config = serverConfigs[ram];
  const email = `${username}@gmail.com`;
  const name = `${capitalize(username)} Server`;
  const password = username + crypto.randomBytes(2).toString('hex');

  // Buat user di Pterodactyl
  const userRes = await fetch(`${config.domain}/api/application/users`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apikey}`
    },
    body: JSON.stringify({
      email,
      username,
      first_name: name,
      last_name: "Server",
      language: "en",
      password
    })
  });

  const userData = await userRes.json();
  if (userData.errors) throw new Error(userData.errors[0].detail);
  
  // Dapatkan egg information
  const eggRes = await fetch(
    `${config.domain}/api/application/nests/${config.nestid}/eggs/${config.egg}`, 
    {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apikey}`
      }
    }
  );

  const eggData = await eggRes.json();
  const startupCmd = eggData.attributes.startup;

  // Buat server
  const serverRes = await fetch(`${config.domain}/api/application/servers`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apikey}`,
    },
    body: JSON.stringify({
      name: name,
      description: `Dibuat pada ${tanggal()}`,
      user: userData.attributes.id,
      egg: parseInt(config.egg),
      docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
      startup: startupCmd,
      environment: {
        INST: "npm",
        USER_UPLOAD: "0",
        AUTO_UPDATE: "0",
        CMD_RUN: "npm start"
      },
      limits: {
        memory: config.ram,
        swap: 0,
        disk: config.disk,
        io: 500,
        cpu: config.cpu
      },
      feature_limits: {
        databases: 5,
        backups: 5,
        allocations: 5
      },
      deploy: {
        locations: [parseInt(config.loc)],
        dedicated_ip: false,
        port_range: [],
      }
    })
  });

  const serverData = await serverRes.json();
  if (serverData.errors) throw new Error(serverData.errors[0].detail);

  return {
    serverId: serverData.attributes.id,
    name: name,
    username: username,
    password: password,
    loginUrl: config.domain,
    ram: config.ram === "0" ? "Unlimited" : `${config.ram.slice(0, 2)}GB`,
    cpu: config.cpu === "0" ? "Unlimited" : `${config.cpu}%`,
    disk: config.disk === "0" ? "Unlimited" : `${config.disk.slice(0, 2)}GB`,
    expiry: moment().add(1, 'months').format('YYYY-MM-DD')
  };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});