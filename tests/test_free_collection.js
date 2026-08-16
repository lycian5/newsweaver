const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  findClusterMatch,
  normalizeAndDedupe,
  normalizeArticle,
  normalizeUrl,
} = require('../lib/freeCollection');

assert.equal(
  normalizeUrl('HTTPS://Example.com/news/?utm_source=x&b=2&a=1#top'),
  'https://example.com/news?a=1&b=2'
);
assert.equal(normalizeUrl('ftp://example.com/file'), '');

const now = '2026-08-14T00:00:00.000Z';
const normalized = normalizeArticle({
  category: 'policy',
  source: 'naver_news',
  title: '  2026년   소상공인 지원사업 공고  ',
  url: 'https://example.com/notice?utm_campaign=test',
  summary: '<p>지원 규모 30억원</p>',
  published_at: '2026-08-14T09:00:00+09:00',
  discovery_channel: 'google_news',
  publisher_name: '예시경제',
  publisher_url: 'https://publisher.example.com',
}, { now });
assert.equal(normalized.reason, null);
assert.equal(normalized.row.url, 'https://example.com/notice');
assert.equal(normalized.row.normalized_title, '2026년 소상공인 지원사업 공고');
assert.equal(normalized.row.published_at, now);
assert.equal(normalized.row.url_hash.length, 64);
assert.equal(normalized.row.title_hash.length, 64);
assert.equal(normalized.row.content_fingerprint.length, 64);
assert.equal(normalized.row.discovery_channel, 'google_news');
assert.equal(normalized.row.publisher_name, '예시경제');
assert.equal(normalized.row.source_domain, 'publisher.example.com');

const batch = normalizeAndDedupe([
  { category: 'policy', source: 'rss', title: '소상공인 지원사업 공고', url: 'https://example.com/a?utm_source=one', published_at: now },
  { category: 'policy', source: 'rss', title: '다른 제목', url: 'https://example.com/a?gclid=two', published_at: now },
  { category: 'policy', source: 'rss', title: '소상공인 지원사업 공고', url: 'https://example.com/b', published_at: now },
  { category: 'policy', source: 'rss', title: '무효 URL', url: 'not-a-url', published_at: now },
], { now });
assert.equal(batch.funnel.discovered, 4);
assert.equal(batch.funnel.normalized, 3);
assert.equal(batch.funnel.unique, 1);
assert.deepEqual(batch.funnel.rejection_counts, {
  invalid_url: 1,
  invalid_title: 0,
  duplicate_url: 1,
  duplicate_title: 1,
});

const match = findClusterMatch({
  category: 'ai_business',
  title: '오픈AI GPT-6 기업용 AI 에이전트 출시',
  published_at: '2026-08-14T01:00:00Z',
  event_fingerprint: 'new',
}, [
  { id: 1, category: 'ai_business', representative_title: '오픈AI 기업 사용자 정책 발표', event_date: '2026-08-14', fingerprint: 'old-1' },
  { id: 2, category: 'ai_business', representative_title: '오픈AI, GPT-6 기업용 AI 에이전트 공개', event_date: '2026-08-14', fingerprint: 'old-2' },
]);
assert.equal(match.cluster.id, 2);
assert.equal(match.method, 'title_date');
assert.ok(match.score >= 0.55);

const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260814_collection_foundation.sql'), 'utf8');
assert.match(migration, /create table if not exists collection_runs/);
assert.match(migration, /normalized_title/);
assert.match(migration, /cluster_match_score/);

const cron = fs.readFileSync(require.resolve('../api/cron/collect.js'), 'utf8');
const agent = fs.readFileSync(require.resolve('../scripts/agent-reach-collect.js'), 'utf8');
assert.match(cron, /normalizeAndDedupe/);
assert.match(agent, /findClusterMatch/);
assert.match(agent, /collection_runs/);
assert.match(agent, /ensureEventFingerprint/);
assert.match(agent, /fingerprint가 없습니다/);

process.stdout.write('Free collection foundation checks passed.\n');
