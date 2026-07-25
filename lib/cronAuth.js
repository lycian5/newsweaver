const { createHmac, timingSafeEqual } = require('node:crypto');

const SESSION_COOKIE = 'coa_admin_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function assertCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const header = req.headers?.authorization || '';
  if (header === `Bearer ${secret}` || verifyDashboardSession(req)) return;

  const err = new Error('Unauthorized');
  err.statusCode = 401;
  throw err;
}

function verifyDashboardPassword(password) {
  const expected = process.env.DASHBOARD_PASSWORD || '';
  return expected.length >= 12 && safeEqual(String(password || ''), expected);
}

function createDashboardSessionCookie(now = Date.now()) {
  const secret = dashboardSigningSecret();
  if (!secret) throw new Error('CRON_SECRET and DASHBOARD_PASSWORD are required for dashboard sessions');
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_MAX_AGE * 1000 })).toString('base64url');
  const signature = sign(payload, secret);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

function clearDashboardSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function verifyDashboardSession(req, now = Date.now()) {
  const secret = dashboardSigningSecret();
  if (!secret) return false;
  const token = parseCookies(req.headers?.cookie || '')[SESSION_COOKIE];
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload, secret))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.exp) && data.exp > now;
  } catch (_) {
    return false;
  }
}

function sessionSecret() {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.CRON_SECRET || '';
}

function dashboardSigningSecret() {
  const secret = sessionSecret();
  const password = process.env.DASHBOARD_PASSWORD || '';
  if (!secret || password.length < 12) return '';
  return createHmac('sha256', secret).update(password).digest('base64url');
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function parseCookies(header) {
  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  assertCronAuth,
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
};
