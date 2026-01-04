import type { IndexedTask, ParseError } from "./types";

export type CachedFile = {
  path: string;
  mtime: number;
  contentHash: string;
  tasks: Array<
    Pick<
      IndexedTask,
      | "stableId"
      | "ephemeralId"
      | "checked"
      | "title"
      | "dueRaw"
      | "dueYmd"
      | "completedDate"
      | "priority"
      | "tags"
      | "contexts"
      | "project"
      | "recurrence"
      | "estimate"
      | "status"
      | "waitingOn"
      | "blockedBy"
      | "lineNoHint"
      | "rawLine"
      | "filePath"
      | "indentLevel"
    >
  >;
  errors: ParseError[];
};

export type TaskmanCache = {
  v: number;
  files: Record<string, CachedFile>;
};

// Increment when cache format changes
export const CACHE_VERSION = 3;
