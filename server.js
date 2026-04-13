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
  console.warn('[WARN] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

function ensureDbReady(res) {
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
  if (!ensureDbReady(res)) return;
  try {
    const { error } = await supabase.from('bookings').select('booking_id').limit(1);
    if (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Database query failed.' });
    }
    return res.json({ ok: true, db: true });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Unknown error';
    const cause = e && e.cause && e.cause.message ? String(e.cause.message) : '';
    return res.status(500).json({ ok: false, error: msg + (cause ? ' (' + cause + ')' : '') });
  }
});

app.post('/api/bookings', async (req, res) => {
  if (!ensureDbReady(res)) return;
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
    for (let i = 0; i < 4; i++) {
      const { data: found } = await supabase
        .from('bookings')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (!found) break;
      bookingId = randomBookingId();
    }

    const row = {
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
      client_message: String(client.message || '').trim() || null
    };

    const { error } = await supabase.from('bookings').insert(row);
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
  if (!ensureDbReady(res)) return;
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
  if (!ensureDbReady(res)) return;
  try {
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const password = String(req.body.password || '');
    if (!bookingId || !password) {
      return res.status(400).json({ ok: false, error: 'Booking ID and password are required.' });
    }

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
    return res.json({ ok: true, token, booking });
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
  if (!ensureDbReady(res)) return;
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, bookings: data || [] });
});

app.patch('/api/admin/bookings/:bookingId', ensureAdmin, async (req, res) => {
  if (!ensureDbReady(res)) return;
  const bookingId = String(req.params.bookingId || '').trim().toUpperCase();
  const body = req.body || {};
  const patch = {
    date: String(body.date || '').trim(),
    time: String(body.time || '').trim(),
    barber: String(body.barber || '').trim(),
    status: String(body.status || '').trim() || 'pending'
  };
  const { error } = await supabase.from('bookings').update(patch).eq('booking_id', bookingId);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

app.delete('/api/admin/bookings/:bookingId', ensureAdmin, async (req, res) => {
  if (!ensureDbReady(res)) return;
  const bookingId = String(req.params.bookingId || '').trim().toUpperCase();
  const { error } = await supabase.from('bookings').delete().eq('booking_id', bookingId);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

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
