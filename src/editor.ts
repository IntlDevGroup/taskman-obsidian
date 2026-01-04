import { TFile } from "obsidian";
import type { App } from "obsidian";
import { FileWriteQueue } from "./writeQueue";
import type { IndexedTask, RecurrenceRule } from "./types";
import { normalizeForMatch } from "./hash";
import { formatTodoMeta, parseTodoMeta, stripTodoMeta } from "./parser";

function generateId(): string {
  // Short, locally unique ID
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

function toggleCheckbox(line: string): string {
  return line.replace(/^(\s*- )\[( |x|X)\]/, (_m, prefix: string, check: string) =>
    check.toLowerCase() === "x" ? `${prefix}[ ]` : `${prefix}[x]`
  );
}

function isTodoLine(line: string): boolean {
  // Checkbox format (date optional now)
  return /^(\s*)- \[( |x|X)\]\s+/.test(line);
}

function findByStableId(lines: string[], stableId: string): number {
  const needle = `<!--todo:id=${stableId};`;
  return lines.findIndex((l) => l.includes(needle));
}

function findEphemeralMatch(lines: string[], task: IndexedTask): number | null {
  const needle = normalizeForMatch(stripTodoMeta(task.rawLine));
  const matches = lines
    .map((l, i) => ({ i, l }))
    .filter(
      ({ l }) => isTodoLine(l) && normalizeForMatch(stripTodoMeta(l)) === needle
    );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].i;

  // Multiple matches: choose closest to prior line hint
  return matches.reduce((best, cur) =>
    Math.abs(cur.i - task.lineNoHint) < Math.abs(best.i - task.lineNoHint)
      ? cur
      : best
  ).i;
}

/**
 * Calculate the next occurrence date for a recurring task.
 */
function calculateNextOccurrence(
  currentDate: string,
  recurrence: RecurrenceRule
): string {
  const current = new Date(currentDate + "T00:00:00");

  switch (recurrence.type) {
    case "day":
      current.setDate(current.getDate() + recurrence.interval);
      break;
    case "week":
      current.setDate(current.getDate() + recurrence.interval * 7);
      break;
    case "month":
      current.setMonth(current.getMonth() + recurrence.interval);
      break;
    case "year":
      current.setFullYear(current.getFullYear() + recurrence.interval);
      break;
    case "weekday":
      // Move to next weekday
      do {
        current.setDate(current.getDate() + 1);
      } while (current.getDay() === 0 || current.getDay() === 6);
      break;
    case "custom":
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        // Find next matching day of week
        const startDay = current.getDay();
        for (let i = 1; i <= 7; i++) {
          const checkDay = (startDay + i) % 7;
          if (recurrence.daysOfWeek.includes(checkDay)) {
            current.setDate(current.getDate() + i);
            break;
          }
        }
      }
      break;
  }

  return formatDate(current);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateCompact(date: string): string {
  return date.replace(/-/g, "");
}

/**
 * Replace the date in a task line with a new date.
 */
function replaceDateInLine(line: string, oldDate: string, newDate: string): string {
  const oldCompact = oldDate.replace(/-/g, "");
  const newCompact = newDate.replace(/-/g, "");
  return line.replace(oldCompact, newCompact);
}

export class TaskEditor {
  private app: App;
  private queue = new FileWriteQueue();

  constructor(app: App) {
    this.app = app;
  }

  async toggleTask(
    task: IndexedTask
  ): Promise<{ success: boolean; error?: string }> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return { success: false, error: "File not found." };
    }

    try {
      await this.queue.enqueue(task.filePath, async () => {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        let idx: number | null = null;

        if (task.stableId) {
          const found = findByStableId(lines, task.stableId);
          if (found === -1) {
            // Task deleted or ID removed
            return;
          }
          idx = found;
        } else {
          idx = findEphemeralMatch(lines, task);
          if (idx === null) return;
        }

        let line = lines[idx];

        // Tag on interaction (add stable ID if missing)
        let meta = parseTodoMeta(line);
        if (!meta) {
          meta = { id: generateId(), v: 1 };
        }

        // Check if completing or uncompleting
        const isCompleting = !task.checked;
        const hasRecurrence = task.recurrence !== null;

        if (isCompleting) {
          // Set completion date
          const today = formatDate(new Date());
          meta.done = today;
        } else {
          // Uncompleting - remove done date
          delete meta.done;
        }

        // Update meta in line
        const base = stripTodoMeta(line).trimEnd();
        line = `${base} ${formatTodoMeta(meta)}`;

        if (isCompleting && hasRecurrence && task.dueYmd && task.recurrence) {
          // Toggle to complete
          line = toggleCheckbox(line);
          lines[idx] = line;

          // Create next occurrence
          const nextDate = calculateNextOccurrence(task.dueYmd, task.recurrence);
          const nextDateCompact = formatDateCompact(nextDate);

          // Build new task line
          const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? "";
          let newLine = `${leadingWhitespace}- [ ] ${task.title} ${nextDateCompact}`;

          // Add recurrence back
          newLine += ` ${task.recurrence.originalText}`;

          // Add new stable ID
          const newMeta = { id: generateId(), v: 1 };
          newLine += ` ${formatTodoMeta(newMeta)}`;

          // Insert after current line
          lines.splice(idx + 1, 0, newLine);
        } else {
          // Normal toggle
          line = toggleCheckbox(line);
          lines[idx] = line;
        }

        const newContent = lines.join("\n");

        if (newContent !== content) {
          await this.app.vault.modify(file, newContent);
        }
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * Reschedule a task to a new date (or add a date if none exists).
   */
  async rescheduleTask(
    task: IndexedTask,
    newDate: string // YYYY-MM-DD format
  ): Promise<{ success: boolean; error?: string }> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      return { success: false, error: "File not found." };
    }

    try {
      await this.queue.enqueue(task.filePath, async () => {
        const content = await this.app.vault.read(file);
        const lines = content.split("\n");

        let idx: number | null = null;

        if (task.stableId) {
          const found = findByStableId(lines, task.stableId);
          if (found === -1) return;
          idx = found;
        } else {
          idx = findEphemeralMatch(lines, task);
          if (idx === null) return;
        }

        let line = lines[idx];

        if (task.dueYmd) {
          // Replace existing date
          line = replaceDateInLine(line, task.dueYmd, newDate);
        } else {
          // Add date to task that has none
          const newDateCompact = newDate.replace(/-/g, "");
          const meta = parseTodoMeta(line);
          if (meta) {
            // Insert date before the metadata comment
            const metaStr = formatTodoMeta(meta);
            line = line.replace(metaStr, `${newDateCompact} ${metaStr}`);
          } else {
            // Append date to end of line
            line = `${line.trimEnd()} ${newDateCompact}`;
          }
        }

        // Add stable ID if missing
        let meta = parseTodoMeta(line);
        if (!meta) {
          meta = { id: generateId(), v: 1 };
          const base = stripTodoMeta(line).trimEnd();
          line = `${base} ${formatTodoMeta(meta)}`;
        }

        lines[idx] = line;
        const newContent = lines.join("\n");

        if (newContent !== content) {
          await this.app.vault.modify(file, newContent);
        }
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * Add a new task to a file.
   */
  async addTask(
    filePath: string,
    title: string,
    dueDate: string | null,
    options?: {
      priority?: number;
      tags?: string[];
      project?: string;
      estimate?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return { success: false, error: "File not found." };
    }

    try {
      await this.queue.enqueue(filePath, async () => {
        const content = await this.app.vault.read(file);

        // Build task line
        let line = `- [ ] `;

        // Priority at start
        if (options?.priority && options.priority > 0) {
          line += "!".repeat(options.priority) + " ";
        }

        line += title;

        // Tags
        if (options?.tags) {
          for (const tag of options.tags) {
            line += ` #${tag}`;
          }
        }

        // Project
        if (options?.project) {
          line += ` +${options.project}`;
        }

        // Due date
        if (dueDate) {
          const dateCompact = dueDate.replace(/-/g, "");
          line += ` ${dateCompact}`;
        }

        // Time estimate
        if (options?.estimate) {
          line += ` ~${options.estimate}`;
        }

        const newContent = content.trimEnd() + "\n" + line + "\n";
        await this.app.vault.modify(file, newContent);
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
}
