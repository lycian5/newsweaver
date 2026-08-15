'use strict';

function recoveryDecision({ targetRuns = [], baselineRuns = [], minStored = 20, ratio = 0.6 } = {}) {
  const running = targetRuns.find((run) => run.status === 'running');
  if (running) return { shouldRecover: false, reason: 'main_run_still_running', threshold: null };

  const completedRecovery = targetRuns.find((run) => (
    run.collection_mode === 'previous_day_recovery' && run.status === 'succeeded'
  ));
  if (completedRecovery) return { shouldRecover: false, reason: 'recovery_already_succeeded', threshold: null };

  const mainRun = targetRuns.find((run) => run.collection_mode === 'previous_day');
  const baseline = baselineRuns
    .map((run) => Number(run.stored_count))
    .filter((count) => Number.isFinite(count) && count >= 0);
  const baselineMedian = median(baseline);
  const threshold = Math.max(
    positiveNumber(minStored, 20),
    Math.floor(baselineMedian * positiveNumber(ratio, 0.6))
  );

  if (!mainRun) return { shouldRecover: true, reason: 'main_run_missing', threshold, baselineMedian };
  if (mainRun.status === 'failed') return { shouldRecover: true, reason: 'main_run_failed', threshold, baselineMedian };
  if (mainRun.status === 'partial') return { shouldRecover: true, reason: 'main_run_partial', threshold, baselineMedian };
  if (Array.isArray(mainRun.source_failures) && mainRun.source_failures.length) {
    return { shouldRecover: true, reason: 'source_failure', threshold, baselineMedian };
  }
  if (Number(mainRun.stored_count || 0) < threshold) {
    return { shouldRecover: true, reason: 'stored_count_below_threshold', threshold, baselineMedian };
  }
  return { shouldRecover: false, reason: 'main_run_healthy', threshold, baselineMedian };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = { median, recoveryDecision };
