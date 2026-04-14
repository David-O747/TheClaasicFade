const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const FROM_EMAIL = String(process.env.FROM_EMAIL || '').trim();

function logFallback(label, payload) {
  console.log('[email:' + label + '] RESEND_API_KEY or FROM_EMAIL not set — would send:', JSON.stringify(payload, null, 2));
}

function bookingTableHtml({ bookingId, clientName, service, barber, date, time, total }) {
  const totalStr = total != null ? String(total) : '-';
  return (
    '<table role="presentation" cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,sans-serif;">' +
    '<tr><td style="border-bottom:1px solid #eee;"><strong>Booking ID</strong></td><td style="border-bottom:1px solid #eee;">' + bookingId + '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #eee;"><strong>Service</strong></td><td style="border-bottom:1px solid #eee;">' + service + '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #eee;"><strong>Barber</strong></td><td style="border-bottom:1px solid #eee;">' + barber + '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #eee;"><strong>Date</strong></td><td style="border-bottom:1px solid #eee;">' + date + '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #eee;"><strong>Time</strong></td><td style="border-bottom:1px solid #eee;">' + time + '</td></tr>' +
    '<tr><td><strong>Total</strong></td><td>' + totalStr + '</td></tr>' +
    '</table>'
  );
}

async function sendBookingConfirmation(payload) {
  const {
    bookingId,
    clientName,
    email,
    service,
    barber,
    date,
    time,
    total
  } = payload || {};
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    logFallback('confirmation', payload);
    return { ok: false, skipped: true };
  }
  let Resend;
  try {
    Resend = require('resend').Resend;
  } catch (e) {
    console.warn('[email] resend package not installed:', e && e.message);
    logFallback('confirmation', payload);
    return { ok: false, skipped: true };
  }
  const resend = new Resend(RESEND_API_KEY);
  const subject = 'Booking Confirmed – ' + bookingId;
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">' +
    '<h1 style="color:#1a1a1a;font-size:22px;">The Classic Fade</h1>' +
    '<p>Hi ' + (clientName || 'there') + ', your booking is confirmed!</p>' +
    '<p style="font-size:28px;font-weight:800;margin:16px 0;">' + bookingId + '</p>' +
    bookingTableHtml({ bookingId, clientName, service, barber, date, time, total }) +
    '<p style="margin-top:24px;color:#555;font-size:14px;">Need to change anything? Reply to this email.</p>' +
    '</div>';
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html
    });
    if (error) {
      console.error('[email] Resend error:', error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e && e.message);
    return { ok: false, error: e && e.message };
  }
}

async function sendCancellationEmail(payload) {
  const { bookingId, clientName, email, service, date, time } = payload || {};
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    logFallback('cancellation', payload);
    return { ok: false, skipped: true };
  }
  let Resend;
  try {
    Resend = require('resend').Resend;
  } catch (e) {
    console.warn('[email] resend package not installed:', e && e.message);
    logFallback('cancellation', payload);
    return { ok: false, skipped: true };
  }
  const resend = new Resend(RESEND_API_KEY);
  const subject = 'Booking Cancelled – ' + bookingId;
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">' +
    '<h1 style="color:#1a1a1a;font-size:22px;">The Classic Fade</h1>' +
    '<p>Hi ' + (clientName || 'there') + ', your booking <strong>' + bookingId + '</strong> for <strong>' +
    (service || '') + '</strong> on <strong>' + (date || '') + '</strong> at <strong>' + (time || '') +
    '</strong> has been cancelled.</p>' +
    '</div>';
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html
    });
    if (error) {
      console.error('[email] Resend cancellation error:', error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.error('[email] cancellation send failed:', e && e.message);
    return { ok: false, error: e && e.message };
  }
}

module.exports = { sendBookingConfirmation, sendCancellationEmail };
