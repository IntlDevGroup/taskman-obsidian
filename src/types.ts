export type TodoCheck = " " | "x" | "X";

export type ParsedTodoLine = {
  checked: boolean;
  title: string;
  dueRaw: string; // YYYYMMDD
  dueYmd: string; // YYYY-MM-DD
  markerIndex: number;
  dateIndex: number;
};

export type TodoMeta = {
  id: string;
  v: number;
};

export type IndexedTask = {
  // Identity
  stableId?: string; // from comment
  ephemeralId: string; // filePath + hash(normalizedLine) + occurrenceIndex
  filePath: string;

  // Display + behavior
  checked: boolean;
  title: string;
  dueRaw: string;
  dueYmd: string;

  // Source tracking (non-identity hints)
  lineNoHint: number;
  rawLine: string;
};

export type IndexSnapshot = {
  tasksByStableId: Map<string, IndexedTask>;
  tasksByEphemeralId: Map<string, IndexedTask>;
  fileToTaskIds: Map<string, Set<string>>; // stores stableId if present else ephemeralId
};

export type TaskmanOptions = {
  show: "active" | "done" | "all" | "errors";
  sort: "dueAsc" | "dueDesc" | "fileAsc" | "titleAsc";
  groupBy: "none" | "due" | "file";
};

export type ParseError = {
  filePath: string;
  lineNo: number;
  line: string;
  reason: string;
};