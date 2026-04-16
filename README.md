# TheClaasicFade

Classic Fade barbershop website and booking platform built with Express, vanilla JS, Bootstrap, and Supabase-ready APIs.

## Features

- Responsive marketing pages (`Home`, `Gallery`, `Booking`, `Login`, `Admin`).
- Booking flow with barber/service/time-slot selection.
- Admin endpoints for bookings, services, barbers, blocked slots, and vouchers.
- Dual persistence mode:
  - Supabase (preferred production mode)
  - Local JSON fallback in `data/bookings-store.json`
- Optional email notifications through Resend.

## Tech Stack

- Node.js + Express
- Vanilla JavaScript + Bootstrap 5
- Sass (`scss/main.scss` -> `public/css/main.css`)
- Supabase (`@supabase/supabase-js`)

## Project Structure

```text
.
├── public/                 # Static site files served by Express
│   ├── index.html
│   ├── booking.html
│   ├── booking-details.html
│   ├── admin.html
│   ├── login.html
│   ├── gallery.html
│   ├── css/
│   ├── js/
│   ├── Images/
│   ├── gallery_images/
│   └── landing_images/
├── server.js               # API + static file server
├── scss/                   # Sass source
├── scripts/                # Utility scripts
├── sql/                    # Supabase schema
├── lib/                    # Server helpers (email)
└── data/                   # Local booking store fallback
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Run the app:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000
```

## Environment Variables

See `.env.example` for defaults.

- `PORT` - server port (default `3000`)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - server-side Supabase key (recommended for backend)
- `SUPABASE_PUBLISHABLE_KEY` - fallback key used in this project
- `APP_SECRET` - token/signing secret for internal auth flow
- `ADMIN_IDENTIFIER`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` - admin credentials
- `RESEND_API_KEY`, `FROM_EMAIL` - optional email confirmation/cancellation sender
- `CLASSICFADE_USE_LOCAL_BOOKINGS`
  - `0` (default): use Supabase when available
  - `1`: force local JSON mode in `data/bookings-store.json`

## Scripts

- `npm run dev` - start server
- `npm start` - start server
- `npm run css:build` - compile Sass once
- `npm run sass` - watch Sass and recompile on changes
- `npm run sass:build` - compile compressed CSS
- `npm run sync:bookings` - one-way sync local bookings to Supabase

## API Overview

### Health

- `GET /api/health`
- `GET /api/health/db`

### Public Booking

- `POST /api/contact`
- `GET /api/services`
- `GET /api/barbers`
- `GET /api/availability`
- `GET /api/availability-month`
- `POST /api/validate-voucher`
- `POST /api/bookings`
- `POST /api/customer/set-password`
- `POST /api/customer/login`

### Admin

- `POST /api/admin/login`
- `GET/PATCH/DELETE /api/admin/bookings/:bookingId`
- `GET/POST/PATCH/DELETE /api/admin/services/:id`
- `GET/POST/PATCH/DELETE /api/admin/barbers/:id`
- `GET/POST/DELETE /api/admin/blocked-slots/:id`
- `GET/POST/PATCH/DELETE /api/admin/vouchers/:id`

## Deployment Notes

- This app serves static files from `public/`.
- In production, set secure values for admin credentials and `APP_SECRET`.
- Prefer `SUPABASE_SERVICE_ROLE_KEY` on the server for full DB operations.
- If moving from local mode to Supabase mode, run:

```bash
npm run sync:bookings
```

## License

Private/internal project (no public license specified).
