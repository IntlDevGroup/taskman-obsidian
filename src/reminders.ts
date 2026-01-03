import { Notice } from "obsidian";
import type { IndexedTask } from "./types";
import type { TaskmanSettings } from "./settings";

export type ReminderKey = string; // format: "taskId:YYYY-MM-DD:HH:MM"

export interface ReminderState {
  fired: Record<string, number>; // key -> timestamp when fired
}

export interface ScheduledReminder {
  task: IndexedTask;
  fireAt: Date;
  key: ReminderKey;
}

/**
 * Compute all reminder times for a task based on settings.
 */
export function computeRemindersForTask(
  task: IndexedTask,
  settings: TaskmanSettings
): ScheduledReminder[] {
  if (task.checked) return []; // no reminders for completed tasks

  const reminders: ScheduledReminder[] = [];
  const [hours, minutes] = settings.reminderTime.split(":").map(Number);

  for (const daysBefore of settings.remindDaysBefore) {
    // Parse due date
    const dueDate = new Date(task.dueYmd + "T00:00:00");
    
    // Subtract days
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - daysBefore);
    reminderDate.setHours(hours, minutes, 0, 0);

    const taskId = task.stableId || task.ephemeralId;
    const key: ReminderKey = `${taskId}:${task.dueYmd}:${daysBefore}`;

    reminders.push({
      task,
      fireAt: reminderDate,
      key,
    });
  }

  return reminders;
}

/**
 * Get all upcoming reminders from the task index.
 */
export function getAllUpcomingReminders(
  tasks: IndexedTask[],
  settings: TaskmanSettings,
  firedKeys: Set<string>,
  horizonDays: number = 30
): ScheduledReminder[] {
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const all: ScheduledReminder[] = [];

  for (const task of tasks) {
    const reminders = computeRemindersForTask(task, settings);
    for (const r of reminders) {
      // Skip if already fired
      if (firedKeys.has(r.key)) continue;
      // Skip if in the past (but keep for missed reminder check)
      // Skip if too far in the future
      if (r.fireAt > horizon) continue;
      all.push(r);
    }
  }

  // Sort by fire time
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  return all;
}

/**
 * Find the next reminder that should fire.
 */
export function getNextReminder(
  reminders: ScheduledReminder[]
): ScheduledReminder | null {
  const now = new Date();
  for (const r of reminders) {
    if (r.fireAt > now) {
      return r;
    }
  }
  return null;
}

/**
 * Find reminders that were missed (in the past, not fired).
 */
export function getMissedReminders(
  reminders: ScheduledReminder[],
  windowHours: number
): ScheduledReminder[] {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  return reminders.filter((r) => r.fireAt >= windowStart && r.fireAt <= now);
}

/**
 * Show a notification for a task.
 */
export function showTaskNotification(
  task: IndexedTask,
  useSystemNotification: boolean,
  prefix: string = ""
): void {
  const title = prefix ? `${prefix}: ${task.title}` : task.title;
  const body = `Due: ${task.dueYmd}`;

  // Always show in-app notice
  new Notice(`📋 ${title}\n${body}`, 10000);

  // Also show system notification if enabled
  if (useSystemNotification && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(`TaskMan: ${title}`, {
        body,
        icon: "📋",
        tag: task.stableId || task.ephemeralId, // prevents duplicates
      });
    }
  }
}

/**
 * Show a digest notification for multiple missed tasks.
 */
export function showDigestNotification(
  tasks: IndexedTask[],
  useSystemNotification: boolean
): void {
  const message = `You have ${tasks.length} overdue/upcoming tasks`;

  new Notice(`📋 ${message}`, 10000);

  if (useSystemNotification && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("TaskMan", {
        body: message,
        icon: "📋",
      });
    }
  }
}

/**
 * Clean up old fired entries (older than 7 days).
 */
export function cleanupFiredRegistry(
  fired: Record<string, number>
): Record<string, number> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const cleaned: Record<string, number> = {};
  
  for (const [key, timestamp] of Object.entries(fired)) {
    if (timestamp > cutoff) {
      cleaned[key] = timestamp;
    }
  }
  
  return cleaned;
}