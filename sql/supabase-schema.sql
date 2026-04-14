
-- Legacy reference: bookings + customer_auth (create in Supabase if not already present)
-- create table if not exists public.bookings ( ... );
-- create table if not exists public.customer_auth ( ... );

-- ---------------------------------------------------------------------------
-- New tables: services, barbers, blocked_slots, vouchers
-- Run in Supabase SQL editor. Adjust if tables already exist.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create table if not exists public.services (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  price numeric not null,
  duration_minutes int not null,
  active boolean default true,
  created_at timestamptz default now(),
  constraint services_name_unique unique (name)
);

create table if not exists public.barbers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  active boolean default true,
  created_at timestamptz default now(),
  constraint barbers_name_unique unique (name)
);

create table if not exists public.blocked_slots (
  id uuid default gen_random_uuid() primary key,
  barber_name text not null,
  date date not null,
  time text not null,
  created_at timestamptz default now()
);

create table if not exists public.vouchers (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  discount_percent numeric not null,
  active boolean default true,
  created_at timestamptz default now()
);

alter table public.services enable row level security;
alter table public.barbers enable row level security;

drop policy if exists "public read services" on public.services;
create policy "public read services"
  on public.services for select
  using (true);

drop policy if exists "public read barbers" on public.barbers;
create policy "public read barbers"
  on public.barbers for select
  using (active = true);

-- Seed (idempotent)
insert into public.services (name, description, price, duration_minutes, active)
select 'Wash and Cut', 'Relaxing wash, precise cut and hot towel finish.', 28, 60, true
where not exists (select 1 from public.services s where s.name = 'Wash and Cut');

insert into public.services (name, description, price, duration_minutes, active)
select v.name, v.description, v.price, v.duration_minutes, true
from (values
  ('Haircut', 'Tailored haircut with clean neck finish.', 23, 45),
  ('Clipper Cut', 'Single-grade clipper cut with sharp edges.', 18, 30),
  ('Beard Shape & Lineup', 'Sharp beard contour and lineup.', 14, 25),
  ('Kids Haircut', 'Clean taper for children under 12.', 18, 35),
  ('Line Up Only', 'Front line and temple detailing.', 10, 20),
  ('Hot Towel Shave', 'Traditional shave with steam towel.', 22, 40)
) as v(name, description, price, duration_minutes)
where not exists (select 1 from public.services s where s.name = v.name);

insert into public.barbers (name, active)
select x.name, true
from (values
  ('Jordan Blake'),
  ('David Wright'),
  ('Simon Cesay')
) as x(name)
where not exists (select 1 from public.barbers b where b.name = x.name);

-- Prevent double bookings (expects bookings.date as text or date-compatible)
create or replace function public.claim_slot(
  p_date date,
  p_time text,
  p_barber text
) returns boolean
language plpgsql
stable
as $$
declare
  slot_taken int;
begin
  select count(*)::int into slot_taken
  from public.bookings
  where (bookings.date)::date = p_date
    and bookings.time = p_time
    and bookings.barber = p_barber
    and lower(coalesce(bookings.status, '')) <> 'cancelled';

  return slot_taken = 0;
end;
$$;
