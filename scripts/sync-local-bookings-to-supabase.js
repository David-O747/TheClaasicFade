/**
 * One-way copy: data/bookings-store.json → Supabase public.bookings
 * Skips rows whose booking_id already exists in Supabase.
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or publishable) in .env
 * Set CLASSICFADE_USE_LOCAL_BOOKINGS=0 for new bookings to go to Supabase only.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const STORE = path.join(__dirname, '..', 'data', 'bookings-store.json');
const url = process.env.SUPABASE_URL || '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or key in .env');
  process.exit(1);
}

if (String(process.env.CLASSICFADE_USE_LOCAL_BOOKINGS || '').trim() === '1') {
  console.warn(
    '[warn] CLASSICFADE_USE_LOCAL_BOOKINGS=1 — new bookings still go to JSON. Set to 0 after sync if you want Supabase only.'
  );
}

async function main() {
  let raw;
  try {
    raw = fs.readFileSync(STORE, 'utf8');
  } catch (e) {
    console.error('No local store at', STORE);
    process.exit(1);
  }
  const j = JSON.parse(raw);
  const bookings = Array.isArray(j.bookings) ? j.bookings : [];
  if (!bookings.length) {
    console.log('No local bookings to sync.');
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of bookings) {
    const bid = String(row.booking_id || '').trim();
    if (!bid) continue;

    const { data: existing } = await supabase
      .from('bookings')
      .select('booking_id')
      .eq('booking_id', bid)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const payload = {
      booking_id: bid,
      service: row.service,
      date: row.date,
      time: row.time,
      barber: row.barber,
      price: row.price != null ? Number(row.price) : 0,
      voucher: row.voucher || null,
      status: row.status || 'pending',
      client_name: row.client_name,
      client_email: row.client_email,
      client_phone: row.client_phone,
      client_message: row.client_message || null
    };

    const { error } = await supabase.from('bookings').insert(payload);
    if (error) {
      console.error('[fail]', bid, error.message);
      failed++;
    } else {
      inserted++;
    }
  }

  console.log('Done. inserted:', inserted, 'skipped (already in DB):', skipped, 'failed:', failed);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
