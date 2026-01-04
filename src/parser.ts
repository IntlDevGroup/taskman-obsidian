import type {
  ParsedTodoLine,
  TodoMeta,
  Priority,
  RecurrenceRule,
  TimeEstimate,
  TaskStatus,
} from "./types";
import { parseNaturalDate, formatDateCompact, formatDateYmd } from "./dateParser";

/**
 * Parse the hidden metadata comment from a task line.
 * Format: <!--todo:id=abc123;v=1--> or <!--todo:id=abc123;v=1;done=2026-01-01-->
 */
export function parseTodoMeta(line: string): TodoMeta | null {
  const m = line.match(/<!--todo:id=([a-z0-9]+);v=(\d+)(?:;done=([0-9-]+))?-->/i);
  if (!m) return null;
  return {
    id: m[1],
    v: Number(m[2]) || 1,
    done: m[3] || undefined,
  };
}

/**
 * Format metadata as an HTML comment.
 */
export function formatTodoMeta(meta: TodoMeta): string {
  let s = `<!--todo:id=${meta.id};v=${meta.v}`;
  if (meta.done) {
    s += `;done=${meta.done}`;
  }
  s += "-->";
  return s;
}

/**
 * Remove the metadata comment from a line.
 */
export function stripTodoMeta(line: string): string {
  return line.replace(/\s*<!--todo:.*?-->\s*$/i, "").trimEnd();
}

/**
 * Quick check if a line might be a todo (before full parsing).
 */
export function isTodoLineCandidate(line: string): boolean {
  const trimmed = line.trim();

  // Checkbox format
  if (/^- \[( |x|X)\]/.test(trimmed)) {
    return true;
  }

  // Simple format: starts with "todo"
  if (/^todo\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Parse priority markers (!, !!, !!!) from anywhere in text.
 */
function parsePriority(text: string): { priority: Priority; remainingText: string } {
  let priority: Priority = 0;
  let remaining = text;

  // Match !!! or !! or ! (standalone, not part of !waiting or !blocked)
  // Look for priority at start, end, or surrounded by spaces
  const match = remaining.match(/(?:^|\s)(!!!|!!|!)(?:\s|$)/);
  if (match) {
    // Make sure it's not !waiting or !blocked
    const fullMatch = remaining.slice(match.index!);
    if (!/^(\s)?(!!!|!!|!)(waiting|blocked)/i.test(fullMatch)) {
      priority = match[1].length as Priority;
      remaining = remaining.slice(0, match.index!) + remaining.slice(match.index! + match[0].length);
      remaining = remaining.replace(/\s+/g, " ").trim();
    }
  }

  return { priority, remainingText: remaining };
}

/**
 * Parse tags (#tag), contexts (@context), and projects (+Project).
 */
function parseTagsAndContexts(text: string): {
  tags: string[];
  contexts: string[];
  project: string | null;
  remainingText: string;
} {
  const tags: string[] = [];
  const contexts: string[] = [];
  let project: string | null = null;

  // Extract all #tags, @contexts, +Projects
  let remaining = text;

  // Tags: #word
  const tagMatches = remaining.matchAll(/#(\w+)/g);
  for (const m of tagMatches) {
    tags.push(m[1]);
  }
  remaining = remaining.replace(/#\w+/g, "");

  // Contexts: @word
  const contextMatches = remaining.matchAll(/@(\w+)/g);
  for (const m of contextMatches) {
    contexts.push(m[1]);
  }
  remaining = remaining.replace(/@\w+/g, "");

  // Project: +Word (only keep first one)
  const projectMatch = remaining.match(/\+(\w+)/);
  if (projectMatch) {
    project = projectMatch[1];
  }
  remaining = remaining.replace(/\+\w+/g, "");

  // Clean up extra spaces
  remaining = remaining.replace(/\s+/g, " ").trim();

  return { tags, contexts, project, remainingText: remaining };
}

/**
 * Parse recurrence rules from anywhere: every day, every week, every 2 weeks, every weekday, every mon wed fri
 */
function parseRecurrence(text: string): {
  recurrence: RecurrenceRule | null;
  remainingText: string;
} {
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // "every mon wed fri" pattern
  const customDaysMatch = text.match(
    /(?:^|\s)(every\s+(?:(?:sun|mon|tue|wed|thu|fri|sat)\s*)+)(?:\s|$)/i
  );
  if (customDaysMatch) {
    const daysStr = customDaysMatch[1].toLowerCase();
    const daysOfWeek: number[] = [];
    for (const day of dayNames) {
      if (daysStr.includes(day)) {
        daysOfWeek.push(dayNames.indexOf(day));
      }
    }
    if (daysOfWeek.length > 0) {
      return {
        recurrence: {
          type: "custom",
          interval: 1,
          daysOfWeek,
          originalText: customDaysMatch[1].trim(),
        },
        remainingText: text.replace(customDaysMatch[0], " ").replace(/\s+/g, " ").trim(),
      };
    }
  }

  // "every weekday" pattern
  const weekdayMatch = text.match(/(?:^|\s)(every\s+weekday)(?:\s|$)/i);
  if (weekdayMatch) {
    return {
      recurrence: {
        type: "weekday",
        interval: 1,
        daysOfWeek: [1, 2, 3, 4, 5],
        originalText: weekdayMatch[1].trim(),
      },
      remainingText: text.replace(weekdayMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  // "every N days/weeks/months/years" pattern
  const intervalMatch = text.match(
    /(?:^|\s)(every\s+(\d+)?\s*(day|week|month|year)s?)(?:\s|$)/i
  );
  if (intervalMatch) {
    const interval = intervalMatch[2] ? parseInt(intervalMatch[2]) : 1;
    const type = intervalMatch[3].toLowerCase() as "day" | "week" | "month" | "year";
    return {
      recurrence: {
        type,
        interval,
        originalText: intervalMatch[1].trim(),
      },
      remainingText: text.replace(intervalMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  return { recurrence: null, remainingText: text };
}

/**
 * Parse time estimates from anywhere: ~2h, ~15m, ~3d
 */
function parseTimeEstimate(text: string): {
  estimate: TimeEstimate | null;
  remainingText: string;
} {
  const match = text.match(/(?:^|\s)(~(\d+)([mhd]))(?:\s|$)/i);
  if (!match) {
    return { estimate: null, remainingText: text };
  }

  const value = parseInt(match[2]);
  const unit = match[3].toLowerCase();

  let minutes: number;
  switch (unit) {
    case "m":
      minutes = value;
      break;
    case "h":
      minutes = value * 60;
      break;
    case "d":
      minutes = value * 60 * 8; // 8-hour workday
      break;
    default:
      return { estimate: null, remainingText: text };
  }

  return {
    estimate: { minutes, display: match[1].slice(1) },
    remainingText: text.replace(match[0], " ").replace(/\s+/g, " ").trim(),
  };
}

/**
 * Parse status from anywhere: !waiting, !waiting:@person, !blocked:TaskRef
 */
function parseStatus(text: string): {
  status: TaskStatus;
  waitingOn: string | null;
  blockedBy: string | null;
  remainingText: string;
} {
  // !blocked:Something
  const blockedMatch = text.match(/(?:^|\s)(!blocked:(\S+))(?:\s|$)/i);
  if (blockedMatch) {
    return {
      status: "blocked",
      waitingOn: null,
      blockedBy: blockedMatch[2],
      remainingText: text.replace(blockedMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  // !blocked (without specific reference)
  const blockedSimpleMatch = text.match(/(?:^|\s)(!blocked)(?:\s|$)/i);
  if (blockedSimpleMatch) {
    return {
      status: "blocked",
      waitingOn: null,
      blockedBy: null,
      remainingText: text.replace(blockedSimpleMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  // !waiting:@person
  const waitingOnMatch = text.match(/(?:^|\s)(!waiting:(@?\S+))(?:\s|$)/i);
  if (waitingOnMatch) {
    return {
      status: "waiting",
      waitingOn: waitingOnMatch[2],
      blockedBy: null,
      remainingText: text.replace(waitingOnMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  // just "!waiting"
  const waitingMatch = text.match(/(?:^|\s)(!waiting)(?:\s|$)/i);
  if (waitingMatch) {
    return {
      status: "waiting",
      waitingOn: null,
      blockedBy: null,
      remainingText: text.replace(waitingMatch[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  return { status: "active", waitingOn: null, blockedBy: null, remainingText: text };
}

/**
 * Parse a todo line into its components.
 * Returns null if the line doesn't match the expected format.
 */
export function parseTodoLine(line: string): ParsedTodoLine | null {
  if (!isTodoLineCandidate(line)) return null;

  const base = stripTodoMeta(line).trim();

  let checked = false;
  let textAfterCheckbox: string;

  // Check if it's checkbox format
  const checkMatch = base.match(/^- \[( |x|X)\]\s*/);
  if (checkMatch) {
    const checkedChar = checkMatch[1];
    checked = checkedChar.toLowerCase() === "x";
    textAfterCheckbox = base.slice(checkMatch[0].length).trim();
  } else {
    // Simple format - no checkbox, treat as unchecked
    checked = false;
    textAfterCheckbox = base;
  }

  // Remove "todo" keyword if present at start
  textAfterCheckbox = textAfterCheckbox.replace(/^todo\s+/i, "");

  if (!textAfterCheckbox) return null;

  // Parse elements from end to start (order matters)
  // 1. Priority (!, !!, !!!) - must be before date so "today !!!" works
  const { priority, remainingText: afterPriority } = parsePriority(textAfterCheckbox);

  // 2. Status (waiting/blocked)
  const { status, waitingOn, blockedBy, remainingText: afterStatus } =
    parseStatus(afterPriority);

  // 3. Time estimate (~2h)
  const { estimate, remainingText: afterEstimate } = parseTimeEstimate(afterStatus);

  // 4. Recurrence (every week)
  const { recurrence, remainingText: afterRecurrence } =
    parseRecurrence(afterEstimate);

  // 5. Natural date parsing
  const { date, remainingText: afterDate } = parseNaturalDate(afterRecurrence);

  // 6. Tags, contexts, projects
  const { tags, contexts, project, remainingText: title } =
    parseTagsAndContexts(afterDate);

  if (!title) return null;

  let dueRaw: string | null = null;
  let dueYmd: string | null = null;

  if (date) {
    dueRaw = formatDateCompact(date);
    dueYmd = formatDateYmd(date);
  }

  return {
    checked,
    title,
    dueRaw,
    dueYmd,
    markerIndex: -1,
    dateIndex: -1,
    priority,
    tags,
    contexts,
    project,
    recurrence,
    estimate,
    status,
    waitingOn,
    blockedBy,
  };
}

/**
 * Validate a YYYYMMDD date string.
 */
export function isValidYmdCompact(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;

  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));

  if (m < 1 || m > 12 || d < 1 || d > 31) return false;

  // Full calendar validation
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}
