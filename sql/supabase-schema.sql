
-- create table if not exists public.bookings (
--   id bigint generated always as identity primary key,
--   booking_id text not null unique,
--   service text not null,
--   date text not null,
--   time text not null,
--   barber text not null default 'Jordan Blake',
--   price numeric(10,2) not null default 0,
--   voucher text null,
--   status text not null default 'pending',
--   client_name text not null,
--   client_email text not null,
--   client_phone text not null,
--   client_message text null,
--   created_at timestamptz not null default now()
-- );

-- create table if not exists public.customer_auth (
--   booking_id text primary key references public.bookings(booking_id) on delete cascade,
--   client_email text not null,
--   pass_hash text not null,
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now()
-- );

-- create index if not exists idx_bookings_booking_id on public.bookings(booking_id);
-- create index if not exists idx_bookings_client_email on public.bookings(client_email);
-- create index if not exists idx_customer_auth_booking_id on public.customer_auth(booking_id);
