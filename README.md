<div align="center">
TheClassicFade
Barbershop booking platform — live at theclassicfadee.netlify.app

<img width="894" height="709" alt="Screenshot 2026-04-24 at 08 44 34" src="https://github.com/user-attachments/assets/21fcbe61-586a-4431-bcb0-b023bffea781" />


  
</div>

A full stack barbershop website with online booking, admin management and email notifications.
Features

Responsive pages — Home, Gallery, Booking, Login and Admin
Booking flow with barber, service and time slot selection
Admin dashboard for managing bookings, services, barbers, blocked slots and vouchers
Email confirmations and cancellations via Resend
Supabase backend with local JSON fallback

Tech Stack

Node.js + Express — backend server
Vanilla JavaScript + Bootstrap 5 — frontend
Sass — styling
Supabase — database and auth


<div align="center">
Built by David-O747
</div>
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
