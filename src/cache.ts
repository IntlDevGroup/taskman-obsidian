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
      | "lineNoHint"
      | "rawLine"
      | "filePath"
    >
  >;
  errors: ParseError[];
};

export type TaskmanCache = {
  v: number;
  files: Record<string, CachedFile>;
};

export const CACHE_VERSION = 1;