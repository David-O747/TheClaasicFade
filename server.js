const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const ADMIN_IDENTIFIER = String(process.env.ADMIN_IDENTIFIER || 'DOLA-ADMIN');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'dolapade747@gmail.com');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'Hush3838!');
const FIXED_ADMIN_IDENTIFIER = 'dola-admin';
const FIXED_ADMIN_EMAIL = 'dolapade747@gmail.com';
const FIXED_ADMIN_PASSWORD = 'Hush3838!';
const APP_SECRET = String(process.env.APP_SECRET || 'classicfade-dev-secret-change-me');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[WARN] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — using local JSON store under ./data/');
}

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'bookings-store.json');

function readLocalStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return { bookings: [], auths: [] };
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      bookings: Array.isArray(j.bookings) ? j.bookings : [],
      auths: Array.isArray(j.auths) ? j.auths : []
    };
  } catch (e) {
    return { bookings: [], auths: [] };
  }
}

function writeLocalStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[WARN] Could not persist local store:', e && e.message ? e.message : e);
  }
}

/** In-memory copy synced to disk on writes (single-process dev server). */
let localStoreCache = null;
function getLocalStore() {
  if (!localStoreCache) localStoreCache = readLocalStore();
  return localStoreCache;
}

function saveLocalStore() {
  writeLocalStore(localStoreCache);
}

function useLocalDb() {
  if (String(process.env.CLASSICFADE_USE_LOCAL_BOOKINGS || '').trim() === '1') return true;
  return !supabase;
}

function normalizeBookingForClient(row) {
  if (!row) return null;
  return {
    id: row.booking_id,
    booking_id: row.booking_id,
    service: row.service,
    date: row.date,
    time: row.time,
    barber: row.barber,
    status: row.status || 'pending',
    price: row.price,
    client_message: row.client_message,
    client: {
      name: row.client_name,
      email: row.client_email,
      phone: row.client_phone,
      message: row.client_message
    }
  };
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

app.use(cors());
app.use(express.json());

function ensureSupabaseReady(res) {
  if (supabase) return true;
  res.status(500).json({ ok: false, error: 'Database is not configured. Set Supabase env values.' });
  return false;
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function randomBookingId() {
  return 'CF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', APP_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const raw = Buffer.from(payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function getBearer(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function ensureAdmin(req, res, next) {
  const token = getBearer(req);
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'admin') {
    return res.status(401).json({ ok: false, error: 'Unauthorized admin request.' });
  }
  req.admin = decoded;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'classicfade-api' });
});

app.get('/api/health/db', async (_req, res) => {
  if (useLocalDb()) {
    return res.json({ ok: true, db: 'local-json', path: STORE_FILE });
  }
  if (!ensureSupabaseReady(res)) return;
  try {
    const { error } = await supabase.from('bookings').select('booking_id').limit(1);
    if (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Database query failed.' });
    }
    return res.json({ ok: true, db: 'supabase' });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Unknown error';
    const cause = e && e.cause && e.cause.message ? String(e.cause.message) : '';
    return res.status(500).json({ ok: false, error: msg + (cause ? ' (' + cause + ')' : '') });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const b = req.body || {};
    const client = b.client || {};
    const required = [b.service, b.date, b.time, client.name, client.email, client.phone];
    if (required.some(v => !String(v || '').trim())) {
      return res.status(400).json({ ok: false, error: 'Missing required booking fields.' });
    }
    const email = String(client.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email format.' });
    }

    let bookingId = randomBookingId();
    let row = {
      booking_id: bookingId,
      service: String(b.service || '').trim(),
      date: String(b.date || '').trim(),
      time: String(b.time || '').trim(),
      barber: String(b.barber || '').trim() || 'Jordan Blake',
      price: Number(b.price || 0),
      voucher: String(b.voucher || '').trim() || null,
      status: 'pending',
      client_name: String(client.name || '').trim(),
      client_email: email,
      client_phone: String(client.phone || '').trim(),
      client_message: String(client.message || '').trim() || null,
      created_at: new Date().toISOString()
    };

    if (useLocalDb()) {
      const store = getLocalStore();
      for (let i = 0; i < 8; i++) {
        if (!store.bookings.some(x => x.booking_id === bookingId)) break;
        bookingId = randomBookingId();
        row.booking_id = bookingId;
      }
      store.bookings.unshift({ ...row });
      saveLocalStore();
      return res.json({ ok: true, bookingId });
    }

    if (!ensureSupabaseReady(res)) return;
    for (let i = 0; i < 4; i++) {
      const { data: found } = await supabase
        .from('bookings')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (!found) break;
      bookingId = randomBookingId();
      row = { ...row, booking_id: bookingId };
    }

    const { created_at, ...insertRow } = row;
    const { error } = await supabase.from('bookings').insert(insertRow);
    if (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Failed to save booking.' });
    }
    return res.json({ ok: true, bookingId });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Server error creating booking.';
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.post('/api/customer/set-password', async (req, res) => {
  try {
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!/^CF-[A-F0-9]{6}$/.test(bookingId)) {
      return res.status(400).json({ ok: false, error: 'Invalid booking ID format.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email format.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
    }

    if (useLocalDb()) {
      const store = getLocalStore();
      const booking = store.bookings.find(x => String(x.booking_id || '').toUpperCase() === bookingId);
      if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found.' });
      if (String(booking.client_email || '').toLowerCase() !== email) {
        return res.status(400).json({ ok: false, error: 'Email does not match booking.' });
      }
      const passHash = hashText(password);
      const idx = store.auths.findIndex(a => String(a.booking_id || '').toUpperCase() === bookingId);
      const payload = { booking_id: bookingId, client_email: email, pass_hash: passHash };
      if (idx >= 0) store.auths[idx] = payload;
      else store.auths.push(payload);
      saveLocalStore();
      return res.json({ ok: true });
    }

    if (!ensureSupabaseReady(res)) return;
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('booking_id, client_email')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (bErr) return res.status(500).json({ ok: false, error: bErr.message });
    if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found.' });
    if (String(booking.client_email || '').toLowerCase() !== email) {
      return res.status(400).json({ ok: false, error: 'Email does not match booking.' });
    }

    const passHash = hashText(password);
    const payload = { booking_id: bookingId, client_email: email, pass_hash: passHash };
    const { error: upErr } = await supabase
      .from('customer_auth')
      .upsert(payload, { onConflict: 'booking_id' });
    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error setting password.' });
  }
});

app.post('/api/customer/login', async (req, res) => {
  try {
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const password = String(req.body.password || '');
    if (!bookingId || !password) {
      return res.status(400).json({ ok: false, error: 'Booking ID and password are required.' });
    }

    if (useLocalDb()) {
      const store = getLocalStore();
      const auth = store.auths.find(a => String(a.booking_id || '').toUpperCase() === bookingId);
      if (!auth || auth.pass_hash !== hashText(password)) {
        return res.status(401).json({ ok: false, error: 'Invalid booking ID or password.' });
      }
      const booking = store.bookings.find(x => String(x.booking_id || '').toUpperCase() === bookingId);
      if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found.' });
      const token = signToken({ role: 'customer', bookingId, exp: Date.now() + 1000 * 60 * 60 * 8 });
      return res.json({ ok: true, token, booking: normalizeBookingForClient(booking) });
    }

    if (!ensureSupabaseReady(res)) return;
    const { data: auth, error: aErr } = await supabase
      .from('customer_auth')
      .select('booking_id, pass_hash')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
    if (!auth || auth.pass_hash !== hashText(password)) {
      return res.status(401).json({ ok: false, error: 'Invalid booking ID or password.' });
    }

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (bErr) return res.status(500).json({ ok: false, error: bErr.message });
    if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found.' });

    const token = signToken({ role: 'customer', bookingId, exp: Date.now() + 1000 * 60 * 60 * 8 });
    return res.json({ ok: true, token, booking: normalizeBookingForClient(booking) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error in customer login.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const idOk = identifier === FIXED_ADMIN_IDENTIFIER || identifier === FIXED_ADMIN_EMAIL;
  const passOk = password === FIXED_ADMIN_PASSWORD;
  if (!idOk || !passOk) {
    return res.status(401).json({ ok: false, error: 'Invalid admin credentials.' });
  }
  const token = signToken({ role: 'admin', id: ADMIN_IDENTIFIER, exp: Date.now() + 1000 * 60 * 60 * 12 });
  return res.json({ ok: true, token });
});

app.get('/api/admin/bookings', ensureAdmin, async (_req, res) => {
  if (useLocalDb()) {
    const store = getLocalStore();
    const rows = [...store.bookings].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
    return res.json({ ok: true, bookings: rows });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, bookings: data || [] });
});

app.patch('/api/admin/bookings/:bookingId', ensureAdmin, async (req, res) => {
  const bookingId = String(req.params.bookingId || '').trim().toUpperCase();
  const body = req.body || {};
  const patch = {
    date: String(body.date || '').trim(),
    time: String(body.time || '').trim(),
    barber: String(body.barber || '').trim(),
    status: String(body.status || '').trim() || 'pending'
  };
  if (useLocalDb()) {
    const store = getLocalStore();
    const row = store.bookings.find(x => String(x.booking_id || '').toUpperCase() === bookingId);
    if (!row) return res.status(404).json({ ok: false, error: 'Booking not found.' });
    Object.assign(row, patch);
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('bookings').update(patch).eq('booking_id', bookingId);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

app.delete('/api/admin/bookings/:bookingId', ensureAdmin, async (req, res) => {
  const bookingId = String(req.params.bookingId || '').trim().toUpperCase();
  if (useLocalDb()) {
    const store = getLocalStore();
    const before = store.bookings.length;
    store.bookings = store.bookings.filter(x => String(x.booking_id || '').toUpperCase() !== bookingId);
    store.auths = store.auths.filter(a => String(a.booking_id || '').toUpperCase() !== bookingId);
    if (store.bookings.length === before) return res.status(404).json({ ok: false, error: 'Booking not found.' });
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('bookings').delete().eq('booking_id', bookingId);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

app.use(express.static(path.join(__dirname)));

app.use((req, res) => {
  const safePath = req.path === '/' ? '/index.html' : req.path;
  const file = path.join(__dirname, safePath);
  res.sendFile(file, err => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`Classic Fade server running on http://localhost:${PORT}`);
});
