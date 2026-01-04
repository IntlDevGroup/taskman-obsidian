/**
 * Natural language date parser for TaskMan.
 * Parses dates like "tomorrow", "next friday", "in 3 days", "dec 15", etc.
 */

export type ParsedDate = {
  date: Date;
  matchedText: string;
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_ABBREVS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Parse a natural language date from anywhere in the text.
 * Returns the parsed date and remaining text (title).
 */
export function parseNaturalDate(text: string): {
  date: Date | null;
  remainingText: string;
} {
  const trimmed = text.trim();

  // Try YYYYMMDD format first (existing format) - anywhere in text
  const yyyymmddMatch = trimmed.match(/(?:^|\s)(\d{8})(?:\s|$)/);
  if (yyyymmddMatch) {
    const dateStr = yyyymmddMatch[1];
    const y = parseInt(dateStr.slice(0, 4));
    const m = parseInt(dateStr.slice(4, 6)) - 1;
    const d = parseInt(dateStr.slice(6, 8));
    const date = new Date(y, m, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m &&
      date.getDate() === d
    ) {
      const remaining = trimmed.replace(yyyymmddMatch[0], " ").replace(/\s+/g, " ").trim();
      return { date, remainingText: remaining };
    }
  }

  // Try natural language patterns (anywhere in text)
  const patterns: Array<{
    regex: RegExp;
    parse: (match: RegExpMatchArray) => Date | null;
  }> = [
    // "today"
    {
      regex: /(?:^|\s)(today)(?:\s|$)/i,
      parse: () => getToday(),
    },
    // "tomorrow"
    {
      regex: /(?:^|\s)(tomorrow)(?:\s|$)/i,
      parse: () => addDays(getToday(), 1),
    },
    // "yesterday"
    {
      regex: /(?:^|\s)(yesterday)(?:\s|$)/i,
      parse: () => addDays(getToday(), -1),
    },
    // "next week"
    {
      regex: /(?:^|\s)(next\s+week)(?:\s|$)/i,
      parse: () => addDays(getToday(), 7),
    },
    // "next month"
    {
      regex: /(?:^|\s)(next\s+month)(?:\s|$)/i,
      parse: () => addMonths(getToday(), 1),
    },
    // "end of week"
    {
      regex: /(?:^|\s)(end\s+of\s+week)(?:\s|$)/i,
      parse: () => getEndOfWeek(getToday()),
    },
    // "end of month"
    {
      regex: /(?:^|\s)(end\s+of\s+month)(?:\s|$)/i,
      parse: () => getEndOfMonth(getToday()),
    },
    // "in X days"
    {
      regex: /(?:^|\s)(in\s+(\d+)\s+days?)(?:\s|$)/i,
      parse: (m) => addDays(getToday(), parseInt(m[2])),
    },
    // "in X weeks"
    {
      regex: /(?:^|\s)(in\s+(\d+)\s+weeks?)(?:\s|$)/i,
      parse: (m) => addDays(getToday(), parseInt(m[2]) * 7),
    },
    // "in X months"
    {
      regex: /(?:^|\s)(in\s+(\d+)\s+months?)(?:\s|$)/i,
      parse: (m) => addMonths(getToday(), parseInt(m[2])),
    },
    // "next monday", "next tuesday", etc.
    {
      regex: new RegExp(`(?:^|\\s)(next\\s+(${DAY_NAMES.join("|")}))(?:\\s|$)`, "i"),
      parse: (m) => getNextDayOfWeek(m[2], true),
    },
    // "this monday", "this friday", etc.
    {
      regex: new RegExp(`(?:^|\\s)(this\\s+(${DAY_NAMES.join("|")}))(?:\\s|$)`, "i"),
      parse: (m) => getNextDayOfWeek(m[2], false),
    },
    // Just day name: "monday", "friday", etc. - assumes next occurrence
    {
      regex: new RegExp(`(?:^|\\s)(${DAY_NAMES.join("|")})(?:\\s|$)`, "i"),
      parse: (m) => getNextDayOfWeek(m[1], false),
    },
    // "dec 15", "january 1", etc. (current or next year)
    {
      regex: new RegExp(
        `(?:^|\\s)((?:${[...MONTH_NAMES, ...MONTH_ABBREVS].join("|")})\\s+(\\d{1,2}))(?:\\s|$)`,
        "i"
      ),
      parse: (m) => parseMonthDay(m[1].split(/\s+/)[0], parseInt(m[2]), null),
    },
    // "dec 15 2027", "january 1 2026", etc.
    {
      regex: new RegExp(
        `(?:^|\\s)((?:${[...MONTH_NAMES, ...MONTH_ABBREVS].join("|")})\\s+(\\d{1,2})\\s+(\\d{4}))(?:\\s|$)`,
        "i"
      ),
      parse: (m) => parseMonthDay(m[1].split(/\s+/)[0], parseInt(m[2]), parseInt(m[3])),
    },
    // "15 dec", "1 january", etc.
    {
      regex: new RegExp(
        `(?:^|\\s)((\\d{1,2})\\s+(${[...MONTH_NAMES, ...MONTH_ABBREVS].join("|")}))(?:\\s|$)`,
        "i"
      ),
      parse: (m) => parseMonthDay(m[3], parseInt(m[2]), null),
    },
    // "15 dec 2027"
    {
      regex: new RegExp(
        `(?:^|\\s)((\\d{1,2})\\s+(${[...MONTH_NAMES, ...MONTH_ABBREVS].join("|")})\\s+(\\d{4}))(?:\\s|$)`,
        "i"
      ),
      parse: (m) => parseMonthDay(m[3], parseInt(m[2]), parseInt(m[4])),
    },
  ];

  for (const { regex, parse } of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      const date = parse(match);
      if (date) {
        // Remove the matched date phrase from text
        const remaining = trimmed.replace(match[0], " ").replace(/\s+/g, " ").trim();
        return { date, remainingText: remaining };
      }
    }
  }

  // No date found
  return { date: null, remainingText: trimmed };
}

/**
 * Format a Date to YYYYMMDD string.
 */
export function formatDateCompact(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Format a Date to YYYY-MM-DD string.
 */
export function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Helper functions

function getToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getEndOfWeek(date: Date): Date {
  const dayOfWeek = date.getDay();
  const daysUntilSunday = 7 - dayOfWeek;
  return addDays(date, daysUntilSunday === 7 ? 0 : daysUntilSunday);
}

function getEndOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getNextDayOfWeek(dayName: string, forceNext: boolean): Date {
  const today = getToday();
  const todayDow = today.getDay();

  let targetDow = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (targetDow === -1) {
    targetDow = DAY_ABBREVS.indexOf(dayName.toLowerCase().slice(0, 3));
  }

  let daysAhead = targetDow - todayDow;

  if (forceNext) {
    // "next monday" always means the one in the next week
    if (daysAhead <= 0) daysAhead += 7;
    daysAhead += 7; // skip to next week
    daysAhead -= 7; // actually just get next occurrence in next 7 days for "next X"
    if (daysAhead <= 0) daysAhead += 7;
  } else {
    // "monday" or "this monday" means the next occurrence
    if (daysAhead <= 0) daysAhead += 7;
  }

  return addDays(today, daysAhead);
}

function parseMonthDay(
  monthStr: string,
  day: number,
  year: number | null
): Date | null {
  const monthLower = monthStr.toLowerCase();
  let month = MONTH_NAMES.indexOf(monthLower);
  if (month === -1) {
    month = MONTH_ABBREVS.indexOf(monthLower.slice(0, 3));
  }
  if (month === -1) return null;

  const today = getToday();
  let targetYear = year ?? today.getFullYear();

  // If no year specified and the date has passed this year, use next year
  if (year === null) {
    const candidate = new Date(targetYear, month, day);
    if (candidate < today) {
      targetYear++;
    }
  }

  const date = new Date(targetYear, month, day);

  // Validate the date is real
  if (date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}
