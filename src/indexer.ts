import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { IndexSnapshot, IndexedTask, ParseError } from "./types";
import { fnv1a32, normalizeForMatch } from "./hash";
import {
  parseTodoLine,
  parseTodoMeta,
  stripTodoMeta,
  isTodoLineCandidate,
} from "./parser";
import { parseNaturalDate, formatDateCompact } from "./dateParser";
import type { TaskmanCache } from "./cache";
import { CACHE_VERSION } from "./cache";

/**
 * Convert simple format "todo X tomorrow" to "- [ ] X 20260105"
 * Removes the "todo" keyword and converts natural language dates to YYYYMMDD.
 */
function normalizeToCheckboxFormat(line: string): string {
  const trimmed = line.trim();

  // Already has checkbox - check if it still has "todo" keyword to remove
  if (/^- \[( |x|X)\]/.test(trimmed)) {
    // Remove "todo" keyword if present
    const withoutTodo = line.replace(/(\- \[( |x|X)\]\s+)todo\s+/i, "$1");
    return withoutTodo;
  }

  // Simple format - starts with "todo"
  if (/^todo\s+\S/i.test(trimmed)) {
    // Preserve leading whitespace
    const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? "";
    // Remove "todo" keyword
    const withoutTodo = trimmed.replace(/^todo\s+/i, "");

    // Try to parse and convert natural language date to YYYYMMDD
    const { date, remainingText } = parseNaturalDate(withoutTodo);

    if (date) {
      const dateStr = formatDateCompact(date);
      return `${leadingWhitespace}- [ ] ${remainingText} ${dateStr}`;
    }

    // No date found, just convert to checkbox
    return `${leadingWhitespace}- [ ] ${withoutTodo}`;
  }

  return line;
}

function isMarkdownFile(file: TFile): boolean {
  return file.extension.toLowerCase() === "md";
}

export class TaskIndexer {
  private app: App;
  private snapshot: IndexSnapshot;
  private errors: ParseError[] = [];
  private fileDebounce = new Map<string, number>();
  private cache: TaskmanCache | null = null;

  /**
   * @param onIndexChange Called after any index mutation. Use to trigger UI rerenders.
   */
  constructor(
    app: App,
    private onIndexChange?: () => void
  ) {
    this.app = app;
    this.snapshot = {
      tasksByStableId: new Map(),
      tasksByEphemeralId: new Map(),
      fileToTaskIds: new Map(),
    };
  }

  getSnapshot(): IndexSnapshot {
    return this.snapshot;
  }

  getErrors(): ParseError[] {
    return this.errors.slice();
  }

  setCache(cache: TaskmanCache | null) {
    this.cache = cache;
  }

  getCache(): TaskmanCache | null {
    return this.cache;
  }

  async buildInitialIndex(
    loadFileTextHash: (file: TFile) => Promise<{ content: string; hash: string }>
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();

    if (!this.cache || this.cache.v !== CACHE_VERSION) {
      this.cache = { v: CACHE_VERSION, files: {} };
    }

    // Clear current index
    this.snapshot = {
      tasksByStableId: new Map(),
      tasksByEphemeralId: new Map(),
      fileToTaskIds: new Map(),
    };
    this.errors = [];

    // First pass: hydrate from cache where mtime matches
    for (const f of files) {
      const cached = this.cache.files[f.path];
      if (cached && cached.mtime === f.stat.mtime) {
        this.applyCachedFile(cached);
      }
    }

    // Second pass: parse files not satisfied by cache
    for (const f of files) {
      const cached = this.cache.files[f.path];
      if (cached && cached.mtime === f.stat.mtime) continue;
      await this.reindexFileInternal(f, loadFileTextHash, false);
    }

    // Single callback after full build
    this.onIndexChange?.();
  }

  attachListeners(
    loadFileTextHash: (file: TFile) => Promise<{ content: string; hash: string }>
  ): void {
    const vault = this.app.vault;

    vault.on("modify", (file) => {
      if (!(file instanceof TFile) || !isMarkdownFile(file)) return;
      this.debouncedReindex(file, loadFileTextHash);
    });

    vault.on("create", (file) => {
      if (!(file instanceof TFile) || !isMarkdownFile(file)) return;
      this.debouncedReindex(file, loadFileTextHash);
    });

    vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || !isMarkdownFile(file)) return;
      this.handleRename(oldPath, file.path);
      this.debouncedReindex(file, loadFileTextHash);
    });

    vault.on("delete", (file) => {
      if (!(file instanceof TFile) || !isMarkdownFile(file)) return;
      this.removeFile(file.path);
      this.onIndexChange?.();
    });
  }

  private debouncedReindex(
    file: TFile,
    loadFileTextHash: (file: TFile) => Promise<{ content: string; hash: string }>
  ) {
    const prev = this.fileDebounce.get(file.path);
    if (prev) window.clearTimeout(prev);

    const handle = window.setTimeout(() => {
      this.fileDebounce.delete(file.path);
      void this.reindexFile(file, loadFileTextHash);
    }, 400);

    this.fileDebounce.set(file.path, handle);
  }

  /**
   * Public reindex method. Triggers onIndexChange callback.
   */
  async reindexFile(
    file: TFile,
    loadFileTextHash: (file: TFile) => Promise<{ content: string; hash: string }>
  ): Promise<void> {
    await this.reindexFileInternal(file, loadFileTextHash, true);
  }

  /**
   * Internal reindex. Optionally skips callback (used during batch buildInitialIndex).
   */
  private async reindexFileInternal(
    file: TFile,
    loadFileTextHash: (file: TFile) => Promise<{ content: string; hash: string }>,
    fireCallback: boolean
  ): Promise<void> {
    const { content, hash } = await loadFileTextHash(file);

    // Cache check: if content hash matches, reuse cached tasks
    const cached = this.cache?.files[file.path];
    if (cached && cached.contentHash === hash) {
      cached.mtime = file.stat.mtime;
      this.applyCachedFile(cached);
      if (fireCallback) this.onIndexChange?.();
      return;
    }

   // Full parse
    this.removeFile(file.path);

    const lines = content.split("\n");
    let needsRewrite = false;

    // Check if any lines need converting to checkbox format
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const normalized = normalizeToCheckboxFormat(line);
      if (normalized !== line) {
        lines[i] = normalized;
        needsRewrite = true;
      }
    }

    // Write back if we converted any simple format lines
    if (needsRewrite) {
      const newContent = lines.join("\n");
      await this.app.vault.modify(file, newContent);
      // Don't continue parsing - the modify will trigger another reindex
      return;
    }

    const normalizedCount = new Map<string, number>();
    const tasks: IndexedTask[] = [];
    const fileErrors: ParseError[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!isTodoLineCandidate(line)) continue;

      const parsed = parseTodoLine(line);
      if (!parsed) {
        fileErrors.push({
          filePath: file.path,
          lineNo: i,
          line,
          reason: "Invalid todo format",
        });
        continue;
      }

      const meta = parseTodoMeta(line);
      const normalized = normalizeForMatch(stripTodoMeta(line));
      const occ = (normalizedCount.get(normalized) ?? 0) + 1;
      normalizedCount.set(normalized, occ);

      const ephemeralId = `${file.path}:${fnv1a32(normalized)}:${occ}`;

      // Calculate indent level (count leading spaces / 2 or tabs)
      const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? "";
      const indentLevel = Math.floor(leadingWhitespace.replace(/\t/g, "  ").length / 2);

      const task: IndexedTask = {
        stableId: meta?.id,
        ephemeralId,
        filePath: file.path,
        checked: parsed.checked,
        title: parsed.title,
        dueRaw: parsed.dueRaw,
        dueYmd: parsed.dueYmd,
        completedDate: meta?.done ?? null,
        priority: parsed.priority,
        tags: parsed.tags,
        contexts: parsed.contexts,
        project: parsed.project,
        recurrence: parsed.recurrence,
        estimate: parsed.estimate,
        status: parsed.status,
        waitingOn: parsed.waitingOn,
        blockedBy: parsed.blockedBy,
        lineNoHint: i,
        rawLine: line,
        indentLevel,
      };
      tasks.push(task);
    }

    for (const t of tasks) this.addTask(t);
    for (const e of fileErrors) this.errors.push(e);

    // Update cache
    if (this.cache) {
      this.cache.files[file.path] = {
        path: file.path,
        mtime: file.stat.mtime,
        contentHash: hash,
        tasks: tasks.map((t) => ({
          stableId: t.stableId,
          ephemeralId: t.ephemeralId,
          checked: t.checked,
          title: t.title,
          dueRaw: t.dueRaw,
          dueYmd: t.dueYmd,
          completedDate: t.completedDate,
          priority: t.priority,
          tags: t.tags,
          contexts: t.contexts,
          project: t.project,
          recurrence: t.recurrence,
          estimate: t.estimate,
          status: t.status,
          waitingOn: t.waitingOn,
          blockedBy: t.blockedBy,
          lineNoHint: t.lineNoHint,
          rawLine: t.rawLine,
          filePath: t.filePath,
          indentLevel: t.indentLevel,
        })),
        errors: fileErrors,
      };
    }

    if (fireCallback) this.onIndexChange?.();
  }

  private applyCachedFile(cached: TaskmanCache["files"][string]) {
    this.removeFile(cached.path);

    for (const t of cached.tasks) {
      const task: IndexedTask = {
        ...t,
        filePath: cached.path,
        indentLevel: t.indentLevel ?? 0,
        completedDate: t.completedDate ?? null,
        priority: t.priority ?? 0,
        tags: t.tags ?? [],
        contexts: t.contexts ?? [],
        project: t.project ?? null,
        recurrence: t.recurrence ?? null,
        estimate: t.estimate ?? null,
        status: t.status ?? "active",
        waitingOn: t.waitingOn ?? null,
        blockedBy: t.blockedBy ?? null,
      };
      this.addTask(task);
    }

    for (const e of cached.errors) {
      this.errors.push(e);
    }
  }

  private addTask(task: IndexedTask) {
    const fileSet =
      this.snapshot.fileToTaskIds.get(task.filePath) ?? new Set<string>();
    this.snapshot.fileToTaskIds.set(task.filePath, fileSet);

    if (task.stableId) {
      // Collision check: if stable ID already exists, treat duplicate as error
      if (!this.snapshot.tasksByStableId.has(task.stableId)) {
        this.snapshot.tasksByStableId.set(task.stableId, task);
        fileSet.add(task.stableId);
      } else {
        this.errors.push({
          filePath: task.filePath,
          lineNo: task.lineNoHint,
          line: task.rawLine,
          reason: `Duplicate stable id: ${task.stableId}`,
        });
        // Still index via ephemeral so task is visible
        this.snapshot.tasksByEphemeralId.set(task.ephemeralId, task);
        fileSet.add(task.ephemeralId);
      }
    } else {
      this.snapshot.tasksByEphemeralId.set(task.ephemeralId, task);
      fileSet.add(task.ephemeralId);
    }
  }

  private removeFile(path: string) {
    const ids = this.snapshot.fileToTaskIds.get(path);
    if (!ids) return;

    for (const id of ids) {
      // id may be stableId or ephemeralId; delete from both maps (no-op if not present)
      this.snapshot.tasksByStableId.delete(id);
      this.snapshot.tasksByEphemeralId.delete(id);
    }

    this.snapshot.fileToTaskIds.delete(path);

    // Also clear file-scoped errors
    this.errors = this.errors.filter((e) => e.filePath !== path);

    // Also clear from cache
    if (this.cache?.files[path]) {
      delete this.cache.files[path];
    }
  }

  private handleRename(oldPath: string, newPath: string) {
    // Drop old file index entries; file will be reindexed under new path
    this.removeFile(oldPath);

    // Move cache entry
    if (this.cache?.files[oldPath]) {
      this.cache.files[newPath] = {
        ...this.cache.files[oldPath],
        path: newPath,
      };
      delete this.cache.files[oldPath];
    }
  }
}
