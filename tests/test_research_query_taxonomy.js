const assert = require('node:assert/strict');
const {
  CATEGORIES,
  KEYWORD_AXES,
  SYNONYM_GROUPS,
  aliasesFor,
  buildOfficialSearchQuery,
  buildSearchQuery,
} = require('../scripts/research-query-taxonomy');

assert.ok(CATEGORIES.small_business_economy);
assert.ok(CATEGORIES.local_commerce);
assert.ok(CATEGORIES.marketing_distribution);
assert.ok(CATEGORIES.field_issue);
assert.ok(KEYWORD_AXES.subject.includes('소상공인'));
assert.ok(KEYWORD_AXES.issue.includes('수수료'));
assert.ok(SYNONYM_GROUPS.some((group) => group.includes('배달앱') && group.includes('배달 플랫폼')));
assert.ok(aliasesFor('소상공인 지원').includes('자영업자'));

const keyword = { keyword: '배달앱 수수료', category: 'small_business_economy' };
assert.match(buildSearchQuery(keyword, 'explore'), /배달 플랫폼/);
assert.match(buildSearchQuery(keyword, 'precision'), /소상공인 자영업 매출 비용 경영/);
const verification = buildOfficialSearchQuery(keyword);
assert.match(verification, /site:semas\.or\.kr/);
assert.match(verification, /site:bok\.or\.kr/);
assert.match(verification, /filetype:pdf/);
assert.match(verification, /filetype:hwp/);
assert.match(buildOfficialSearchQuery({ keyword: '표시광고', category: 'policy' }), /site:ftc\.go\.kr/);
assert.match(buildOfficialSearchQuery({ keyword: '전통시장', category: 'local_commerce' }), /site:ftc\.go\.kr/);

process.stdout.write('Research query taxonomy checks passed.\n');
