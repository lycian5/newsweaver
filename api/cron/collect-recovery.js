const { assertCronAuth } = require('../../lib/cronAuth');
const { getSupabase } = require('../../lib/supabase');
const { buildCollectionWindow } = require('../../lib/collectionWindow');
const { recoveryDecision } = require('../../lib/collectionRecovery');

module.exports = async (req, res) => {
  try {
    assertCronAuth(req);
  } catch (error) {
    res.status(error.statusCode || 401).json({ error: error.message });
    return;
  }

  const window = buildCollectionWindow({ mode: 'previous_day', targetDate: req.query?.targetDate });
  let supabase;
  try {
    supabase = getSupabase();
  } catch (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const columns = 'status,stored_count,source_failures,started_at,collection_mode,target_date';
  const [{ data: targetRuns, error: targetError }, { data: baselineRuns, error: baselineError }] = await Promise.all([
    supabase.from('collection_runs')
      .select(columns)
      .eq('target_date', window.targetDate)
      .in('collection_mode', ['previous_day', 'previous_day_recovery'])
      .order('started_at', { ascending: false })
      .limit(20),
    supabase.from('collection_runs')
      .select('stored_count,started_at')
      .eq('collection_mode', 'previous_day')
      .lt('target_date', window.targetDate)
      .order('started_at', { ascending: false })
      .limit(7),
  ]);

  if (targetError || baselineError) {
    res.status(500).json({
      error: `previous-day collection migration is required: ${(targetError || baselineError).message}`,
    });
    return;
  }

  const decision = recoveryDecision({
    targetRuns: targetRuns || [],
    baselineRuns: baselineRuns || [],
    minStored: process.env.PREVIOUS_DAY_MIN_STORED || 20,
    ratio: process.env.PREVIOUS_DAY_RECOVERY_RATIO || 0.6,
  });
  if (!decision.shouldRecover) {
    res.status(200).json({ skipped: true, targetDate: window.targetDate, ...decision });
    return;
  }

  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host) {
    res.status(500).json({ error: 'Request host is unavailable' });
    return;
  }
  const protocol = req.headers?.['x-forwarded-proto'] || 'https';
  const url = new URL(`${protocol}://${host}/api/cron/collect`);
  url.searchParams.set('mode', 'previous_day_recovery');
  url.searchParams.set('targetDate', window.targetDate);
  url.searchParams.set('recoveryReason', decision.reason);
  const authorization = req.headers?.authorization || (process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : '');
  const response = await fetch(url, {
    headers: authorization ? { authorization } : {},
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  res.status(response.ok ? 200 : response.status).json({
    skipped: false,
    targetDate: window.targetDate,
    decision,
    recovery: body,
  });
};
