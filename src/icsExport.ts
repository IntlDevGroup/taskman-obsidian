import type { IndexedTask } from "./types";

/**
 * Generate an ICS (iCalendar) file from tasks.
 */
export function generateICS(tasks: IndexedTask[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TaskMan//Obsidian Plugin//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:TaskMan Tasks",
  ];

  for (const task of tasks) {
    if (!task.dueYmd) continue;

    const event = generateVEvent(task);
    lines.push(...event);
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Generate a VEVENT for a single task.
 */
function generateVEvent(task: IndexedTask): string[] {
  const uid = task.stableId || task.ephemeralId;
  const dateCompact = task.dueYmd!.replace(/-/g, "");
  const now = new Date();
  const dtstamp = formatICSDateTime(now);

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${uid}@taskman.obsidian`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dateCompact}`,
    `SUMMARY:${escapeICS(task.title)}`,
  ];

  // Add description with metadata
  const descParts: string[] = [];
  if (task.priority > 0) {
    const priorityLabels = ["", "Low Priority", "Medium Priority", "High Priority"];
    descParts.push(priorityLabels[task.priority]);
  }
  if (task.tags.length > 0) {
    descParts.push(`Tags: ${task.tags.map((t) => "#" + t).join(" ")}`);
  }
  if (task.project) {
    descParts.push(`Project: +${task.project}`);
  }
  if (task.estimate) {
    descParts.push(`Estimate: ${task.estimate.display}`);
  }
  descParts.push(`File: ${task.filePath}`);

  if (descParts.length > 0) {
    lines.push(`DESCRIPTION:${escapeICS(descParts.join("\\n"))}`);
  }

  // Map priority to ICS priority (1-9, lower is higher priority)
  if (task.priority > 0) {
    const icsPriority = 4 - task.priority; // 3->1, 2->2, 1->3
    lines.push(`PRIORITY:${icsPriority}`);
  }

  // Status
  if (task.checked) {
    lines.push("STATUS:COMPLETED");
  } else {
    lines.push("STATUS:NEEDS-ACTION");
  }

  // Categories from tags
  if (task.tags.length > 0) {
    lines.push(`CATEGORIES:${task.tags.join(",")}`);
  }

  lines.push("END:VEVENT");
  return lines;
}

/**
 * Format a Date as ICS DTSTAMP.
 */
function formatICSDateTime(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Escape special characters for ICS.
 */
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Download ICS file (for browser environment).
 */
export function downloadICS(content: string, filename: string = "taskman-tasks.ics"): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate Apple Reminders URL scheme.
 * Note: This is limited functionality as Reminders doesn't have a full URL scheme.
 */
export function generateRemindersURL(task: IndexedTask): string {
  // x-apple-reminderkit URL scheme (limited)
  const title = encodeURIComponent(task.title);
  const notes = encodeURIComponent(`From: ${task.filePath}`);

  // Note: This is for basic reminder creation
  // More complex integration would require Shortcuts
  return `x-apple-reminderkit://create?title=${title}&notes=${notes}`;
}

/**
 * Generate Shortcuts-compatible text for batch import.
 */
export function generateShortcutsInput(tasks: IndexedTask[]): string {
  return tasks
    .filter((t) => t.dueYmd && !t.checked)
    .map((t) => {
      const parts = [t.title, t.dueYmd!];
      if (t.priority > 0) {
        parts.push(`priority:${t.priority}`);
      }
      return parts.join("|");
    })
    .join("\n");
}
