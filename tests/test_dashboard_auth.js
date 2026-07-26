const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.CRON_SECRET = 'cron-secret-for-session-tests-1234567890';
process.env.DASHBOARD_PASSWORD = 'dashboard-password-1234';

const {
  assertCronAuth,
  createDashboardSessionCookie,
  verifyDashboardPassword,
  verifyDashboardSession,
} = require('../lib/cronAuth');

assert.equal(verifyDashboardPassword('dashboard-password-1234'), true);
assert.equal(verifyDashboardPassword('wrong-password'), false);

const now = Date.now();
const setCookie = createDashboardSessionCookie(now);
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /Secure/);
assert.match(setCookie, /SameSite=Lax/);
const cookie = setCookie.split(';')[0];
const request = { headers: { cookie } };
assert.equal(verifyDashboardSession(request, now + 1000), true);
assert.equal(verifyDashboardSession(request, now + 8 * 24 * 60 * 60 * 1000), false);
assert.doesNotThrow(() => assertCronAuth(request));
assert.doesNotThrow(() => assertCronAuth({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
assert.throws(() => assertCronAuth({ headers: {} }), /Unauthorized/);

for (const page of ['vps-collector.html', 'research-briefs.html', 'coanews-draft.html']) {
  const source = fs.readFileSync(require.resolve(`../docs/${page}`), 'utf8');
  assert.match(source, /auth-session\.js/);
  assert.match(source, /CoaAuth\.requireSession/);
  assert.doesNotMatch(source, /CRON_SECRET/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/);
}

const login = fs.readFileSync(require.resolve('../docs/admin-login.html'), 'utf8');
assert.match(login, /관리자 로그인/);
assert.match(login, /action: 'login'/);

process.stdout.write('Dashboard session authentication checks passed.\n');
