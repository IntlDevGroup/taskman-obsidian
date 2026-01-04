import type { DailyStats, StatsStore, IndexedTask } from "./types";

/**
 * Create default stats store.
 */
export function createDefaultStats(): StatsStore {
  return {
    daily: {},
    streaks: {
      current: 0,
      longest: 0,
      lastCompleteDay: "",
    },
  };
}

/**
 * Get today's date string in YYYY-MM-DD format.
 */
function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Get yesterday's date string.
 */
function getYesterdayStr(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Record a task completion.
 */
export function recordCompletion(stats: StatsStore): StatsStore {
  const today = getTodayStr();

  // Update daily stats
  if (!stats.daily[today]) {
    stats.daily[today] = { date: today, completed: 0, created: 0, overdue: 0 };
  }
  stats.daily[today].completed++;

  // Update streaks
  updateStreak(stats);

  return stats;
}

/**
 * Record task creation.
 */
export function recordCreation(stats: StatsStore): StatsStore {
  const today = getTodayStr();

  if (!stats.daily[today]) {
    stats.daily[today] = { date: today, completed: 0, created: 0, overdue: 0 };
  }
  stats.daily[today].created++;

  return stats;
}

/**
 * Update streak calculation.
 */
function updateStreak(stats: StatsStore): void {
  const today = getTodayStr();
  const yesterday = getYesterdayStr();

  // If we already recorded for today, just return
  if (stats.streaks.lastCompleteDay === today) {
    return;
  }

  // Check if streak continues
  if (
    stats.streaks.lastCompleteDay === yesterday ||
    stats.streaks.lastCompleteDay === ""
  ) {
    // Streak continues or starts
    stats.streaks.current++;
  } else {
    // Streak broken, start new
    stats.streaks.current = 1;
  }

  stats.streaks.lastCompleteDay = today;

  // Update longest streak
  if (stats.streaks.current > stats.streaks.longest) {
    stats.streaks.longest = stats.streaks.current;
  }
}

/**
 * Get stats for the last N days.
 */
export function getRecentStats(stats: StatsStore, days: number): DailyStats[] {
  const result: DailyStats[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    result.push(
      stats.daily[dateStr] || { date: dateStr, completed: 0, created: 0, overdue: 0 }
    );
  }

  return result.reverse();
}

/**
 * Calculate weekly summary.
 */
export function getWeeklySummary(stats: StatsStore): {
  completed: number;
  created: number;
  avgPerDay: number;
  bestDay: { date: string; count: number } | null;
} {
  const recent = getRecentStats(stats, 7);

  let completed = 0;
  let created = 0;
  let bestDay: { date: string; count: number } | null = null;

  for (const day of recent) {
    completed += day.completed;
    created += day.created;

    if (!bestDay || day.completed > bestDay.count) {
      bestDay = { date: day.date, count: day.completed };
    }
  }

  return {
    completed,
    created,
    avgPerDay: Math.round((completed / 7) * 10) / 10,
    bestDay: bestDay && bestDay.count > 0 ? bestDay : null,
  };
}

/**
 * Clean up old stats (older than 90 days).
 */
export function cleanupOldStats(stats: StatsStore): StatsStore {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

  const newDaily: Record<string, DailyStats> = {};
  for (const [date, data] of Object.entries(stats.daily)) {
    if (date >= cutoffStr) {
      newDaily[date] = data;
    }
  }

  return {
    ...stats,
    daily: newDaily,
  };
}

/**
 * Calculate overdue count and store it.
 */
export function updateOverdueCount(
  stats: StatsStore,
  tasks: IndexedTask[]
): StatsStore {
  const today = getTodayStr();

  const overdue = tasks.filter(
    (t) => !t.checked && t.dueYmd && t.dueYmd < today
  ).length;

  if (!stats.daily[today]) {
    stats.daily[today] = { date: today, completed: 0, created: 0, overdue: 0 };
  }
  stats.daily[today].overdue = overdue;

  return stats;
}
