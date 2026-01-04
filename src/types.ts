export type TodoCheck = " " | "x" | "X";

// Priority levels: 0=none, 1=low(!), 2=medium(!!), 3=high(!!!)
export type Priority = 0 | 1 | 2 | 3;

// Task status
export type TaskStatus = "active" | "waiting" | "blocked";

// Recurrence rule
export type RecurrenceRule = {
  type: "day" | "week" | "month" | "year" | "weekday" | "custom";
  interval: number; // every N days/weeks/months
  daysOfWeek?: number[]; // 0-6 for custom days (0=Sunday)
  originalText: string; // preserve the original recurrence text
};

// Time estimate
export type TimeEstimate = {
  minutes: number;
  display: string; // "2h", "15m", "3d"
};

export type ParsedTodoLine = {
  checked: boolean;
  title: string;
  dueRaw: string | null; // YYYYMMDD or null if no date
  dueYmd: string | null; // YYYY-MM-DD or null if no date
  markerIndex: number;
  dateIndex: number;
  priority: Priority;
  tags: string[];
  contexts: string[];
  project: string | null;
  recurrence: RecurrenceRule | null;
  estimate: TimeEstimate | null;
  status: TaskStatus;
  waitingOn: string | null;
  blockedBy: string | null;
};

export type TodoMeta = {
  id: string;
  v: number;
  done?: string; // completion date for recurring tasks
};

export type IndexedTask = {
  // Identity
  stableId?: string;
  ephemeralId: string;
  filePath: string;

  // Display + behavior
  checked: boolean;
  title: string;
  dueRaw: string | null;
  dueYmd: string | null;
  completedDate: string | null; // YYYY-MM-DD when task was completed

  // Priority, tags, status
  priority: Priority;
  tags: string[];
  contexts: string[];
  project: string | null;

  // Recurrence
  recurrence: RecurrenceRule | null;

  // Time estimate
  estimate: TimeEstimate | null;

  // Status (active, waiting, blocked)
  status: TaskStatus;
  waitingOn: string | null;
  blockedBy: string | null;

  // Source tracking
  lineNoHint: number;
  rawLine: string;

  // Nesting
  indentLevel: number;
};

export type IndexSnapshot = {
  tasksByStableId: Map<string, IndexedTask>;
  tasksByEphemeralId: Map<string, IndexedTask>;
  fileToTaskIds: Map<string, Set<string>>; // stores stableId if present else ephemeralId
};

export type TaskmanOptions = {
  show: "active" | "done" | "doneAll" | "all" | "errors";
  sort: "dueAsc" | "dueDesc" | "fileAsc" | "titleAsc" | "priority";
  groupBy: "none" | "due" | "file" | "priority" | "project" | "status";

  // View type
  view: "default" | "today" | "week" | "calendar" | "kanban" | "stats";

  // Calendar-specific
  month?: string; // YYYY-MM format

  // Filters
  tags?: string[];
  contexts?: string[];
  project?: string;
  priorityMin?: Priority;
  dueFilter?:
    | "overdue"
    | "today"
    | "thisWeek"
    | "nextWeek"
    | { start: string; end: string };
  statusFilter?: TaskStatus;
  search?: string;
};

export type ParseError = {
  filePath: string;
  lineNo: number;
  line: string;
  reason: string;
};

// Statistics types
export type DailyStats = {
  date: string; // YYYY-MM-DD
  completed: number;
  created: number;
  overdue: number;
};

export type StatsStore = {
  daily: Record<string, DailyStats>;
  streaks: {
    current: number;
    longest: number;
    lastCompleteDay: string;
  };
};
