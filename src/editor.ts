import { TFile } from "obsidian";
import type { App } from "obsidian";
import { FileWriteQueue } from "./writeQueue";
import type { IndexedTask } from "./types";
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
  return line.replace(/^- \[( |x|X)\]/, (_m, g1: string) =>
    g1.toLowerCase() === "x" ? "- [ ]" : "- [x]"
  );
}

function isTodoLine(line: string): boolean {
  return /^- \[( |x|X)\]\s+.*\btodo\b/i.test(line) && /\b\d{8}\b/.test(line);
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
          const base = stripTodoMeta(line).trimEnd();
          line = `${base} ${formatTodoMeta(meta)}`;
        }

        // Toggle checkbox
        line = toggleCheckbox(line);

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
}