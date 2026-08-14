'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  gradeSource,
  validateBriefForPreparation,
} = require('../lib/editorialPolicy');

const now = '2026-08-14T03:00:00.000Z';
const cluster = {
  category: 'ai_business',
  representative_title: '생성형 AI 업무 자동화 시장 확대',
  last_seen_at: '2026-08-14T02:30:00.000Z',
};
const media = (domain, extra = {}) => ({
  url: `https://${domain}/article`,
  source_domain: domain,
  source_type: 'media',
  source_layer: 'signal',
  authority_score: 55,
  quality_score: 60,
  verification_status: 'needs_verification',
  published_at: '2026-08-14T01:00:00.000Z',
  ...extra,
});

assert.equal(gradeSource(media('news.example')), 'C');
assert.equal(gradeSource(media('verified.example', { verification_status: 'verified' })), 'B');
assert.equal(gradeSource(media('agency.go.kr', { source_type: 'official', authority_score: 95 })), 'A');
assert.equal(gradeSource(media('community.example', { source_type: 'community', authority_score: 25, quality_score: 20 })), 'D');

const noEvidence = validateBriefForPreparation(cluster, [], [], { now });
assert.equal(noEvidence.stage, 'blocked');
assert.equal(noEvidence.can_prepare, false);
assert.match(noEvidence.blockers[0], /근거 기사/);

const oneMedia = validateBriefForPreparation(cluster, [media('first.example')], [], { now });
assert.equal(oneMedia.stage, 'reviewable');
assert.equal(oneMedia.can_prepare, true);
assert.equal(oneMedia.ready, false);
assert.match(oneMedia.warnings.join(' '), /독립 발행처/);

const twoMedia = validateBriefForPreparation(cluster, [media('first.example'), media('second.example')], [], { now });
assert.equal(twoMedia.stage, 'ready');
assert.equal(twoMedia.can_prepare, true);

const oneVerified = validateBriefForPreparation(cluster, [media('verified.example', { verification_status: 'verified' })], [], { now });
assert.equal(oneVerified.stage, 'reviewable');
assert.equal(oneVerified.source_grades.B, 1);

const communityOnly = validateBriefForPreparation(cluster, [media('community.example', {
  source_type: 'community', authority_score: 25, quality_score: 20,
})], [], { now });
assert.equal(communityOnly.stage, 'blocked');
assert.match(communityOnly.blockers.join(' '), /등급 D/);

const policy = validateBriefForPreparation({
  ...cluster,
  category: 'policy',
  event_date: '2026-08-14',
}, [media('agency.go.kr', { source_type: 'official', source_layer: 'official', authority_score: 95 })], [], { now });
assert.equal(policy.stage, 'ready');
assert.equal(policy.can_prepare, true);

const api = fs.readFileSync(require.resolve('../api/editorial/drafts'), 'utf8');
const page = fs.readFileSync(require.resolve('../docs/research-briefs.html'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260814_editorial_policy.sql'), 'utf8');
const backfill = fs.readFileSync(require.resolve('../scripts/backfill-editorial-policy'), 'utf8');
assert.match(api, /validation\.can_prepare/);
assert.match(api, /validation_stage/);
assert.match(page, /검토 후 기사 준비 가능/);
assert.match(page, /validation\.can_prepare/);
assert.match(page, /source_grade/);
assert.match(migration, /source_grade/);
assert.match(migration, /validation_stage/);
assert.match(backfill, /--apply/);
assert.match(backfill, /mode: applyChanges \? 'apply' : 'dry-run'/);

process.stdout.write('Editorial policy checks passed.\n');
