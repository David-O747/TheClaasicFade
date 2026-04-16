const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const { sendBookingConfirmation, sendCancellationEmail } = require('./lib/email');

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

const ALL_SLOT_TIMES = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'];

const HARDCODED_SERVICES = [
  { id: 'local-svc-haircut', name: 'Haircut', description: 'Tailored haircut with clean neck finish.', price: 23, duration_minutes: 45, active: true },
  { id: 'local-svc-wash', name: 'Wash and Cut', description: 'Relaxing wash, precise cut and hot towel finish.', price: 28, duration_minutes: 60, active: true },
  { id: 'local-svc-clipper', name: 'Clipper Cut', description: 'Single-grade clipper cut with sharp edges.', price: 18, duration_minutes: 30, active: true },
  { id: 'local-svc-beard', name: 'Beard Shape & Lineup', description: 'Sharp beard contour and lineup.', price: 14, duration_minutes: 25, active: true },
  { id: 'local-svc-kids', name: 'Kids Haircut', description: 'Clean taper for children under 12.', price: 18, duration_minutes: 35, active: true },
  { id: 'local-svc-lineup', name: 'Line Up Only', description: 'Front line and temple detailing.', price: 10, duration_minutes: 20, active: true },
  { id: 'local-svc-shave', name: 'Hot Towel Shave', description: 'Traditional shave with steam towel.', price: 22, duration_minutes: 40, active: true }
];

const HARDCODED_BARBERS = [
  { id: 'local-br-1', name: 'Jordan Blake', active: true },
  { id: 'local-br-2', name: 'David Wright', active: true },
  { id: 'local-br-3', name: 'Simon Cesay', active: true }
];

function emptyStore() {
  return {
    bookings: [],
    auths: [],
    blocked_slots: [],
    vouchers: [],
    services: [],
    barbers: []
  };
}

function readLocalStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const j = JSON.parse(raw);
    const e = emptyStore();
    e.bookings = Array.isArray(j.bookings) ? j.bookings : [];
    e.auths = Array.isArray(j.auths) ? j.auths : [];
    e.blocked_slots = Array.isArray(j.blocked_slots) ? j.blocked_slots : [];
    e.vouchers = Array.isArray(j.vouchers) ? j.vouchers : [];
    e.services = Array.isArray(j.services) ? j.services : [];
    e.barbers = Array.isArray(j.barbers) ? j.barbers : [];
    return e;
  } catch (err) {
    return emptyStore();
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

let localStoreCache = null;
function getLocalStore() {
  if (!localStoreCache) {
    localStoreCache = readLocalStore();
    let seeded = false;
    if (!localStoreCache.barbers.length) {
      localStoreCache.barbers = HARDCODED_BARBERS.map(b => ({ ...b }));
      seeded = true;
    }
    if (!localStoreCache.services.length) {
      localStoreCache.services = HARDCODED_SERVICES.map(s => ({ ...s }));
      seeded = true;
    }
    if (seeded) saveLocalStore();
  }
  return localStoreCache;
}

function saveLocalStore() {
  writeLocalStore(localStoreCache);
}

function useLocalDb() {
  if (String(process.env.CLASSICFADE_USE_LOCAL_BOOKINGS || '').trim() === '1') return true;
  return !supabase;
}

function newLocalUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

function localServicesList(store) {
  if (store.services && store.services.length) return store.services.filter(s => s.active !== false);
  return HARDCODED_SERVICES.filter(s => s.active !== false);
}

function localBarbersList(store) {
  if (store.barbers && store.barbers.length) return store.barbers.filter(b => b.active !== false);
  return HARDCODED_BARBERS.filter(b => b.active !== false);
}

function localSlotAvailable(store, dateStr, timeStr, barberStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  const barber = String(barberStr || '').trim();
  const blocked = (store.blocked_slots || []).some(
    s =>
      String(s.barber_name || '').trim() === barber &&
      String(s.date || '').trim() === d &&
      String(s.time || '').trim() === t
  );
  if (blocked) return false;
  const taken = (store.bookings || []).some(b => {
    if (String(b.date || '').trim() !== d) return false;
    if (String(b.time || '').trim() !== t) return false;
    if (String(b.barber || '').trim() !== barber) return false;
    const st = String(b.status || 'pending').toLowerCase();
    return st !== 'cancelled';
  });
  return !taken;
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

async function supabaseSlotAvailable(dateStr, timeStr, barberStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  const barber = String(barberStr || '').trim();
  const { data: blk, error: blkErr } = await supabase
    .from('blocked_slots')
    .select('id')
    .eq('date', d)
    .eq('time', t)
    .eq('barber_name', barber)
    .maybeSingle();
  if (blkErr) console.warn('[slot] blocked_slots query:', blkErr.message);
  if (blk) return false;

  const { data: rpcData, error: rpcErr } = await supabase.rpc('claim_slot', {
    p_date: d,
    p_time: t,
    p_barber: barber
  });
  if (!rpcErr && typeof rpcData === 'boolean') return rpcData;

  const { count, error: cErr } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('date', d)
    .eq('time', t)
    .eq('barber', barber)
    .neq('status', 'cancelled');
  if (cErr) {
    console.warn('[slot] bookings count fallback:', cErr.message);
    return false;
  }
  return (count || 0) === 0;
}

/** True if this barber has at least one free standard slot on date (read-only; no RPC). */
function localDayHasAnyFreeSlot(store, dateStr, barberStr) {
  return ALL_SLOT_TIMES.some(time => localSlotAvailable(store, dateStr, time, barberStr));
}

async function supabaseDayHasAnyFreeSlot(dateStr, barberStr) {
  const d = String(dateStr || '').trim();
  const barber = String(barberStr || '').trim();
  const { data: blks, error: bErr } = await supabase
    .from('blocked_slots')
    .select('time')
    .eq('date', d)
    .eq('barber_name', barber);
  if (bErr) console.warn('[avail-month] blocked_slots:', bErr.message);
  const blocked = new Set((blks || []).map(x => String(x.time || '').trim()));
  const { data: books, error: bkErr } = await supabase
    .from('bookings')
    .select('time')
    .eq('date', d)
    .eq('barber', barber)
    .neq('status', 'cancelled');
  if (bkErr) console.warn('[avail-month] bookings:', bkErr.message);
  const taken = new Set((books || []).map(x => String(x.time || '').trim()));
  return ALL_SLOT_TIMES.some(t => !blocked.has(t) && !taken.has(t));
}

app.use(cors());
app.use(express.json());

function ensureSupabaseReady(res) {
  if (supabase) return true;
  res.status(500).json({ ok: false, error: 'Database is not configured. Set Supabase env values.' });
  return false;
}

/** Turn low-level Node/undici fetch errors into actionable text for the browser. */
function friendlyDbError(e) {
  const cause = e && e.cause && e.cause.message ? String(e.cause.message) : '';
  const m = String((e && e.message) || cause || e || '');
  if (/fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND|getaddrinfo|ETIMEDOUT|ECONNRESET|network|socket|TLS|certificate|SSL/i.test(m + cause)) {
    return (
      'Cannot reach Supabase from this machine (network or URL/key issue). ' +
      'For local demos without the cloud database, set CLASSICFADE_USE_LOCAL_BOOKINGS=1 in .env, restart the server, and try again.'
    );
  }
  const out = m.length > 220 ? m.slice(0, 220) + '…' : m;
  return out || 'Database error.';
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function randomBookingId() {
  return 'CF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function parseBookingStartMs(dateStr, timeStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NaN;
  if (!/^\d{2}:\d{2}$/.test(t)) return NaN;
  const ms = new Date(`${d}T${t}:00`).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** Booking lifecycle based on slot time; cancellation stays manual. */
function autoStatusForBooking(row, nowMs) {
  const current = String((row && row.status) || 'pending').toLowerCase().trim();
  if (current === 'cancelled') return 'cancelled';
  const startMs = parseBookingStartMs(row && row.date, row && row.time);
  if (!Number.isFinite(startMs)) return current || 'pending';
  const durationMs = 45 * 60 * 1000;
  const endMs = startMs + durationMs;
  if (nowMs < startMs) return 'confirmed';
  if (nowMs >= startMs && nowMs < endMs) return 'active';
  return 'completed';
}

function normalizeStatusValue(s) {
  const v = String(s || '').toLowerCase().trim();
  if (['pending', 'confirmed', 'active', 'completed', 'cancelled'].indexOf(v) >= 0) return v;
  return '';
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

app.post('/api/contact', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const subject = String(b.subject || '').trim();
    const message = String(b.message || '').trim();

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ ok: false, error: 'name, email, subject and message are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email format.' });
    }
    if (message.length < 10 || message.length > 500) {
      return res.status(400).json({ ok: false, error: 'Message must be between 10 and 500 characters.' });
    }

    if (!ensureSupabaseReady(res)) return;
    const { error } = await supabase.from('contact_messages').insert({
      name,
      email,
      subject,
      message
    });
    if (error) return res.status(500).json({ ok: false, error: error.message || 'Could not save message.' });
    return res.json({ ok: true });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Server error saving contact message.';
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/api/services', async (_req, res) => {
  try {
    if (useLocalDb()) {
      const list = localServicesList(getLocalStore()).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: Number(s.price),
        duration_minutes: Number(s.duration_minutes)
      }));
      return res.json({ ok: true, services: list });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('services').select('*').eq('active', true).order('name');
    if (error) {
      const list = HARDCODED_SERVICES.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        duration_minutes: s.duration_minutes
      }));
      return res.json({ ok: true, services: list, note: 'fallback_hardcoded' });
    }
    return res.json({ ok: true, services: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error loading services.' });
  }
});

app.get('/api/barbers', async (_req, res) => {
  try {
    if (useLocalDb()) {
      const list = localBarbersList(getLocalStore()).map(b => ({ id: b.id, name: b.name }));
      return res.json({ ok: true, barbers: list });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('barbers').select('*').eq('active', true).order('name');
    if (error) {
      const list = HARDCODED_BARBERS.map(b => ({ id: b.id, name: b.name }));
      return res.json({ ok: true, barbers: list, note: 'fallback_hardcoded' });
    }
    return res.json({ ok: true, barbers: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error loading barbers.' });
  }
});

app.get('/api/availability', async (req, res) => {
  const date = String(req.query.date || '').trim();
  const barber = String(req.query.barber || '').trim();
  if (!date || !barber) {
    return res.status(400).json({ ok: false, error: 'date and barber query params are required.' });
  }
  try {
    if (useLocalDb()) {
      const store = getLocalStore();
      const slots = ALL_SLOT_TIMES.map(time => ({
        time,
        available: localSlotAvailable(store, date, time, barber)
      }));
      return res.json({ ok: true, slots });
    }
    if (!ensureSupabaseReady(res)) return;
    const slots = [];
    for (const time of ALL_SLOT_TIMES) {
      const okSlot = await supabaseSlotAvailable(date, time, barber);
      slots.push({ time, available: okSlot });
    }
    return res.json({ ok: true, slots });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error checking availability.' });
  }
});

app.get('/api/availability-month', async (req, res) => {
  const year = parseInt(String(req.query.year || ''), 10);
  const month = parseInt(String(req.query.month || ''), 10);
  const barber = String(req.query.barber || '').trim();
  if (!year || !month || month < 1 || month > 12 || !barber) {
    return res.status(400).json({ ok: false, error: 'year, month (1-12), and barber are required.' });
  }
  try {
    const lastDay = new Date(year, month, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];

    if (useLocalDb()) {
      const store = getLocalStore();
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(`${dateStr}T00:00:00`);
        if (dateObj < today) {
          days.push({ date: dateStr, anyAvailable: false, past: true });
          continue;
        }
        days.push({
          date: dateStr,
          anyAvailable: localDayHasAnyFreeSlot(store, dateStr, barber),
          past: false
        });
      }
      return res.json({ ok: true, days });
    }

    if (!ensureSupabaseReady(res)) return;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(`${dateStr}T00:00:00`);
      if (dateObj < today) {
        days.push({ date: dateStr, anyAvailable: false, past: true });
        continue;
      }
      const anyAvailable = await supabaseDayHasAnyFreeSlot(dateStr, barber);
      days.push({ date: dateStr, anyAvailable, past: false });
    }
    return res.json({ ok: true, days });
  } catch (e) {
    console.error('[availability-month]', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error building month availability.' });
  }
});

app.post('/api/validate-voucher', async (req, res) => {
  const code = String((req.body && req.body.code) || '').trim();
  if (!code) return res.status(400).json({ ok: false, valid: false, error: 'code required' });
  const norm = code.toUpperCase();
  try {
    if (useLocalDb()) {
      const store = getLocalStore();
      const v = (store.vouchers || []).find(
        x => String(x.code || '').toUpperCase() === norm && x.active !== false
      );
      if (!v) return res.json({ ok: true, valid: false });
      return res.json({ ok: true, valid: true, discount_percent: Number(v.discount_percent) });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data: rows, error } = await supabase.from('vouchers').select('code, discount_percent').eq('active', true);
    if (error) return res.json({ ok: true, valid: false });
    const found = (rows || []).find(r => String(r.code || '').toLowerCase() === code.toLowerCase());
    if (!found) return res.json({ ok: true, valid: false });
    return res.json({ ok: true, valid: true, discount_percent: Number(found.discount_percent) });
  } catch (e) {
    return res.status(500).json({ ok: false, valid: false, error: 'Server error.' });
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

    const dateStr = String(b.date || '').trim();
    const timeStr = String(b.time || '').trim();
    const barberStr = String(b.barber || '').trim() || 'Jordan Blake';

    if (useLocalDb()) {
      const store = getLocalStore();
      if (!localSlotAvailable(store, dateStr, timeStr, barberStr)) {
        return res.status(409).json({ ok: false, error: 'slot_taken' });
      }
    } else {
      if (!ensureSupabaseReady(res)) return;
    }

    let bookingId = randomBookingId();
    let row = {
      booking_id: bookingId,
      service: String(b.service || '').trim(),
      date: dateStr,
      time: timeStr,
      barber: barberStr,
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
      if (!localSlotAvailable(store, dateStr, timeStr, barberStr)) {
        return res.status(409).json({ ok: false, error: 'slot_taken' });
      }
      store.bookings.unshift({ ...row });
      saveLocalStore();
    } else {
      try {
        const free = await supabaseSlotAvailable(dateStr, timeStr, barberStr);
        if (!free) {
          return res.status(409).json({ ok: false, error: 'slot_taken' });
        }
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
      } catch (e) {
        console.error('[POST /api/bookings] Supabase error:', e && e.message ? e.message : e);
        return res.status(503).json({ ok: false, error: friendlyDbError(e) });
      }
    }

    const totalStr = '£' + row.price;
    sendBookingConfirmation({
      bookingId: row.booking_id,
      clientName: row.client_name,
      email: row.client_email,
      service: row.service,
      barber: row.barber,
      date: row.date,
      time: row.time,
      total: totalStr
    }).catch(() => {});

    return res.json({ ok: true, bookingId: row.booking_id });
  } catch (e) {
    console.error('[POST /api/bookings]', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: friendlyDbError(e) });
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
    const nowMs = Date.now();
    let changed = false;
    (store.bookings || []).forEach(row => {
      const next = autoStatusForBooking(row, nowMs);
      if (next && String(row.status || '').toLowerCase() !== next) {
        row.status = next;
        changed = true;
      }
    });
    if (changed) saveLocalStore();
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
  const rows = data || [];
  const nowMs = Date.now();
  const updates = [];
  rows.forEach(row => {
    const next = autoStatusForBooking(row, nowMs);
    if (next && String(row.status || '').toLowerCase() !== next) {
      row.status = next;
      updates.push({ booking_id: row.booking_id, status: next });
    }
  });
  for (const u of updates) {
    await supabase.from('bookings').update({ status: u.status }).eq('booking_id', u.booking_id);
  }
  return res.json({ ok: true, bookings: rows });
});

app.patch('/api/admin/bookings/:bookingId', ensureAdmin, async (req, res) => {
  const bookingId = String(req.params.bookingId || '').trim().toUpperCase();
  const body = req.body || {};
  const patch = {};
  if (body.date != null) patch.date = String(body.date || '').trim();
  if (body.time != null) patch.time = String(body.time || '').trim();
  if (body.barber != null) patch.barber = String(body.barber || '').trim();
  if (body.status != null) {
    const st = normalizeStatusValue(body.status);
    if (!st) return res.status(400).json({ ok: false, error: 'Invalid status.' });
    patch.status = st;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ ok: false, error: 'No fields to update.' });
  }

  let prevRow = null;
  if (useLocalDb()) {
    const store = getLocalStore();
    const row = store.bookings.find(x => String(x.booking_id || '').toUpperCase() === bookingId);
    if (!row) return res.status(404).json({ ok: false, error: 'Booking not found.' });
    prevRow = { ...row };
    Object.assign(row, patch);
    saveLocalStore();
  } else {
    if (!ensureSupabaseReady(res)) return;
    const { data: before, error: gErr } = await supabase.from('bookings').select('*').eq('booking_id', bookingId).maybeSingle();
    if (gErr) return res.status(500).json({ ok: false, error: gErr.message });
    if (!before) return res.status(404).json({ ok: false, error: 'Booking not found.' });
    prevRow = before;
    const { error } = await supabase.from('bookings').update(patch).eq('booking_id', bookingId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
  }

  const newSt = String((patch.status != null ? patch.status : (prevRow && prevRow.status)) || '').toLowerCase();
  const oldSt = String((prevRow && prevRow.status) || 'pending').toLowerCase();
  if (newSt === 'cancelled' && oldSt !== 'cancelled' && prevRow) {
    sendCancellationEmail({
      bookingId: prevRow.booking_id,
      clientName: prevRow.client_name,
      email: prevRow.client_email,
      service: prevRow.service,
      date: patch.date || prevRow.date,
      time: patch.time || prevRow.time
    }).catch(() => {});
  }

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

/* -------- Admin: services -------- */
app.get('/api/admin/services', ensureAdmin, async (_req, res) => {
  try {
    if (useLocalDb()) {
      const list = localServicesList(getLocalStore());
      return res.json({ ok: true, services: list });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('services').select('*').order('name');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, services: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/admin/services', ensureAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const row = {
    id: newLocalUuid(),
    name,
    description: String(b.description || '').trim() || null,
    price: Number(b.price || 0),
    duration_minutes: Number(b.duration_minutes || 30),
    active: true,
    created_at: new Date().toISOString()
  };
  if (useLocalDb()) {
    const store = getLocalStore();
    store.services.push(row);
    saveLocalStore();
    return res.json({ ok: true, service: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const insert = { name: row.name, description: row.description, price: row.price, duration_minutes: row.duration_minutes, active: true };
  const { data, error } = await supabase.from('services').insert(insert).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, service: data });
});

app.patch('/api/admin/services/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const b = req.body || {};
  const patch = {};
  if (b.name != null) patch.name = String(b.name).trim();
  if (b.description != null) patch.description = String(b.description).trim();
  if (b.price != null) patch.price = Number(b.price);
  if (b.duration_minutes != null) patch.duration_minutes = Number(b.duration_minutes);
  if (b.active != null) patch.active = !!b.active;
  if (useLocalDb()) {
    const store = getLocalStore();
    const row = store.services.find(s => String(s.id) === id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    Object.assign(row, patch);
    saveLocalStore();
    return res.json({ ok: true, service: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase.from('services').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true, service: data });
});

app.delete('/api/admin/services/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (useLocalDb()) {
    const store = getLocalStore();
    const n = store.services.length;
    store.services = store.services.filter(s => String(s.id) !== id);
    if (store.services.length === n) return res.status(404).json({ ok: false, error: 'Not found' });
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

/* -------- Admin: barbers -------- */
app.get('/api/admin/barbers', ensureAdmin, async (_req, res) => {
  try {
    if (useLocalDb()) {
      return res.json({ ok: true, barbers: getLocalStore().barbers });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('barbers').select('*').order('name');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, barbers: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/admin/barbers', ensureAdmin, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const row = { id: newLocalUuid(), name, active: true, created_at: new Date().toISOString() };
  if (useLocalDb()) {
    const store = getLocalStore();
    store.barbers.push(row);
    saveLocalStore();
    return res.json({ ok: true, barber: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase.from('barbers').insert({ name, active: true }).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, barber: data });
});

app.patch('/api/admin/barbers/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const b = req.body || {};
  const patch = {};
  if (b.name != null) patch.name = String(b.name).trim();
  if (b.active != null) patch.active = !!b.active;
  if (useLocalDb()) {
    const store = getLocalStore();
    const row = store.barbers.find(x => String(x.id) === id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    Object.assign(row, patch);
    saveLocalStore();
    return res.json({ ok: true, barber: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase.from('barbers').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true, barber: data });
});

app.delete('/api/admin/barbers/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (useLocalDb()) {
    const store = getLocalStore();
    const n = store.barbers.length;
    store.barbers = store.barbers.filter(x => String(x.id) !== id);
    if (store.barbers.length === n) return res.status(404).json({ ok: false, error: 'Not found' });
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('barbers').delete().eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

/* -------- Admin: blocked slots -------- */
app.get('/api/admin/blocked-slots', ensureAdmin, async (_req, res) => {
  try {
    if (useLocalDb()) {
      return res.json({ ok: true, blocked_slots: getLocalStore().blocked_slots || [] });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('blocked_slots').select('*').order('date', { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, blocked_slots: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/admin/blocked-slots', ensureAdmin, async (req, res) => {
  const b = req.body || {};
  const barber_name = String(b.barber_name || '').trim();
  const date = String(b.date || '').trim();
  const time = String(b.time || '').trim();
  if (!barber_name || !date || !time) return res.status(400).json({ ok: false, error: 'barber_name, date, time required' });
  const row = { id: newLocalUuid(), barber_name, date, time, created_at: new Date().toISOString() };
  if (useLocalDb()) {
    const store = getLocalStore();
    store.blocked_slots.push(row);
    saveLocalStore();
    return res.json({ ok: true, blocked_slot: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase.from('blocked_slots').insert({ barber_name, date, time }).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, blocked_slot: data });
});

app.delete('/api/admin/blocked-slots/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (useLocalDb()) {
    const store = getLocalStore();
    const n = store.blocked_slots.length;
    store.blocked_slots = store.blocked_slots.filter(x => String(x.id) !== id);
    if (store.blocked_slots.length === n) return res.status(404).json({ ok: false, error: 'Not found' });
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('blocked_slots').delete().eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

/* -------- Admin: vouchers -------- */
app.get('/api/admin/vouchers', ensureAdmin, async (_req, res) => {
  try {
    if (useLocalDb()) {
      return res.json({ ok: true, vouchers: getLocalStore().vouchers || [] });
    }
    if (!ensureSupabaseReady(res)) return;
    const { data, error } = await supabase.from('vouchers').select('*').order('code');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, vouchers: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/admin/vouchers', ensureAdmin, async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim();
  const discount_percent = Number(b.discount_percent);
  if (!code || Number.isNaN(discount_percent)) return res.status(400).json({ ok: false, error: 'code and discount_percent required' });
  const row = { id: newLocalUuid(), code, discount_percent, active: true, created_at: new Date().toISOString() };
  if (useLocalDb()) {
    const store = getLocalStore();
    if (store.vouchers.some(v => String(v.code).toUpperCase() === code.toUpperCase())) {
      return res.status(400).json({ ok: false, error: 'code exists' });
    }
    store.vouchers.push(row);
    saveLocalStore();
    return res.json({ ok: true, voucher: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase
    .from('vouchers')
    .insert({ code, discount_percent, active: true })
    .select()
    .single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, voucher: data });
});

app.patch('/api/admin/vouchers/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const b = req.body || {};
  const patch = {};
  if (b.active != null) patch.active = !!b.active;
  if (useLocalDb()) {
    const store = getLocalStore();
    const row = store.vouchers.find(v => String(v.id) === id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    Object.assign(row, patch);
    saveLocalStore();
    return res.json({ ok: true, voucher: row });
  }
  if (!ensureSupabaseReady(res)) return;
  const { data, error } = await supabase.from('vouchers').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true, voucher: data });
});

app.delete('/api/admin/vouchers/:id', ensureAdmin, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (useLocalDb()) {
    const store = getLocalStore();
    const n = store.vouchers.length;
    store.vouchers = store.vouchers.filter(v => String(v.id) !== id);
    if (store.vouchers.length === n) return res.status(404).json({ ok: false, error: 'Not found' });
    saveLocalStore();
    return res.json({ ok: true });
  }
  if (!ensureSupabaseReady(res)) return;
  const { error } = await supabase.from('vouchers').delete().eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(404).send('Not found');
  }
  const rel = req.path === '/' || req.path === '' ? 'index.html' : req.path.replace(/^\//, '');
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(path.resolve(publicDir))) {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(file, err => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`Classic Fade server running on http://localhost:${PORT}`);
});
