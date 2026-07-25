'use strict';

const { getSupabase } = require('../../lib/supabase');
const { assertCronAuth } = require('../../lib/cronAuth');
const { normalizeSchedule, scheduleFromRow } = require('../../lib/collectionSchedule');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    assertCronAuth(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  try {
    if (req.method === 'GET') return getSchedule(res);
    if (req.method === 'PUT') return saveSchedule(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[operations/schedule]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function getSchedule(res) {
  const { data, error } = await getSupabase()
    .from('collection_schedules')
    .select('enabled,daily_time,timezone,updated_at')
    .eq('key', 'agent_reach')
    .maybeSingle();
  if (error) throw error;
  return res.status(200).json({ schedule: { ...scheduleFromRow(data), updatedAt: data?.updated_at || null } });
}

async function saveSchedule(req, res) {
  const schedule = normalizeSchedule(req.body || {});
  const { data, error } = await getSupabase()
    .from('collection_schedules')
    .upsert({
      key: 'agent_reach',
      enabled: schedule.enabled,
      daily_time: schedule.dailyTime,
      timezone: schedule.timezone,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    .select('enabled,daily_time,timezone,updated_at')
    .single();
  if (error) throw error;
  return res.status(200).json({ schedule: { ...scheduleFromRow(data), updatedAt: data.updated_at } });
}
