import type { ParsedTodoLine, TodoMeta } from "./types";

/**
 * Parse the hidden metadata comment from a task line.
 * Format: <!--todo:id=abc123;v=1-->
 */
export function parseTodoMeta(line: string): TodoMeta | null {
  const m = line.match(/<!--todo:id=([a-z0-9]+);v=(\d+)-->/i);
  if (!m) return null;
  return { id: m[1], v: Number(m[2]) || 1 };
}

/**
 * Format metadata as an HTML comment.
 */
export function formatTodoMeta(meta: TodoMeta): string {
  return `<!--todo:id=${meta.id};v=${meta.v}-->`;
}

/**
 * Remove the metadata comment from a line.
 */
export function stripTodoMeta(line: string): string {
  return line.replace(/\s*<!--todo:.*?-->\s*$/i, "").trimEnd();
}

/**
 * Quick check if a line might be a todo (before full parsing).
 * Supports:
 *   - [ ] Task 20260115           (checkbox + date)
 *   - [ ] todo Task 20260115      (legacy with todo keyword)
 *   todo Task 20260115             (simple format, will be converted)
 */
export function isTodoLineCandidate(line: string): boolean {
  const trimmed = line.trim();

  // Checkbox format with 8-digit date at end
  if (/^- \[( |x|X)\]/.test(trimmed) && /\b\d{8}\b/.test(trimmed)) {
    return true;
  }

  // Simple format: starts with "todo"
  if (/^todo\b/i.test(trimmed) && /\b\d{8}\b/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Parse a todo line into its components.
 * Returns null if the line doesn't match the expected format.
 *
 * Supports:
 *   - [ ] Task title here 20260115       (standard)
 *   - [ ] todo Task title here 20260115  (legacy)
 *   todo Task title here 20260115         (simple, will be converted)
 */
export function parseTodoLine(line: string): ParsedTodoLine | null {
  if (!isTodoLineCandidate(line)) return null;

  const base = stripTodoMeta(line).trim();

  let checked = false;
  let textAfterCheckbox: string;

  // Check if it's checkbox format
  const checkMatch = base.match(/^- \[( |x|X)\]\s+/);
  if (checkMatch) {
    const checkedChar = checkMatch[1];
    checked = checkedChar.toLowerCase() === "x";
    textAfterCheckbox = base.replace(/^- \[( |x|X)\]\s+/, "").trim();
  } else {
    // Simple format - no checkbox, treat as unchecked
    checked = false;
    textAfterCheckbox = base;
  }

  // Remove "todo" keyword if present at start
  textAfterCheckbox = textAfterCheckbox.replace(/^todo\s+/i, "");

  // Tokenize the rest
  const tokens = textAfterCheckbox.split(/\s+/);

  // Find last 8-digit token as due date
  let dateIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d{8}$/.test(tokens[i])) {
      dateIndex = i;
      break;
    }
  }
  if (dateIndex === -1) return null;

  const dueRaw = tokens[dateIndex];
  if (!isValidYmdCompact(dueRaw)) return null;

  // Title is everything before the date
  const titleTokens = tokens.slice(0, dateIndex);
  const title = titleTokens.join(" ").trim();
  if (!title) return null;

  const dueYmd = `${dueRaw.slice(0, 4)}-${dueRaw.slice(4, 6)}-${dueRaw.slice(6, 8)}`;

  return { checked, title, dueRaw, dueYmd, markerIndex: -1, dateIndex };
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
