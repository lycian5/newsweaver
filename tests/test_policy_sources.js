const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../lib/policySources'), 'utf8');
const publicDataSource = fs.readFileSync(require.resolve('../lib/publicDataSources'), 'utf8');
const { normalizeNotice } = require('../lib/publicDataSources');

assert.match(source, /https:\/\/www\.moel\.go\.kr\/news\/enews\/report\/enewsList\.do/);
assert.match(publicDataSource, /1421000\/bizinfo\/pblancBsnsService/);
assert.match(publicDataSource, /B552735\/kisedKstartupService01\/getAnnouncementInformation01/);
assert.match(publicDataSource, /DATA_GO_KR_SERVICE_KEY/);
assert.deepEqual(
  normalizeNotice({ name: 'K-Startup API', category: 'startup', includeSummary: true }, {
    biz_pbanc_nm: '예비창업패키지 모집',
    detl_pg_url: 'https://www.k-startup.go.kr/example',
    biz_prv_dscn: '사업화 지원',
    pbanc_ntce_dt: '20260731',
  }),
  {
    source: 'K-Startup API',
    category: 'startup',
    title: '예비창업패키지 모집',
    url: 'https://www.k-startup.go.kr/example',
    summary: '사업화 지원',
    published_at: '2026-07-31T00:00:00.000Z',
  },
);

process.stdout.write('Policy source checks passed.\n');
