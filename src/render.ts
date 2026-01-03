import type { App } from "obsidian";
import type {
  IndexSnapshot,
  TaskmanOptions,
  IndexedTask,
  ParseError,
} from "./types";

export function parseTaskmanOptions(source: string): TaskmanOptions {
  const opts: TaskmanOptions = {
    show: "active",
    sort: "dueAsc",
    groupBy: "none",
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();

    if (
      key === "show" &&
      (val === "active" || val === "done" || val === "all" || val === "errors")
    ) {
      opts.show = val;
    }
    if (
      key === "sort" &&
      (val === "dueAsc" ||
        val === "dueDesc" ||
        val === "fileAsc" ||
        val === "titleAsc")
    ) {
      opts.sort = val;
    }
    if (
      key === "groupBy" &&
      (val === "none" || val === "due" || val === "file")
    ) {
      opts.groupBy = val;
    }
  }

  return opts;
}

function sortTasks(
  tasks: IndexedTask[],
  sort: TaskmanOptions["sort"]
): IndexedTask[] {
  const arr = tasks.slice();
  if (sort === "dueAsc") arr.sort((a, b) => a.dueYmd.localeCompare(b.dueYmd));
  if (sort === "dueDesc") arr.sort((a, b) => b.dueYmd.localeCompare(a.dueYmd));
  if (sort === "fileAsc")
    arr.sort((a, b) => a.filePath.localeCompare(b.filePath));
  if (sort === "titleAsc") arr.sort((a, b) => a.title.localeCompare(b.title));
  return arr;
}

function groupKey(task: IndexedTask, groupBy: TaskmanOptions["groupBy"]): string {
  if (groupBy === "file") return task.filePath;
  if (groupBy === "due") return task.dueYmd;
  return "";
}

export function renderTaskmanBlock(args: {
  app: App;
  container: HTMLElement;
  options: TaskmanOptions;
  snapshot: IndexSnapshot;
  errors: ParseError[];
  onToggle: (task: IndexedTask) => void;
}) {
  const { app, container, options, snapshot, errors, onToggle } = args;
  container.empty();

  const header = container.createEl("div", { text: "TaskMan" });
  header.style.fontWeight = "600";
  header.style.marginBottom = "8px";

  if (options.show === "errors") {
    renderErrors(container, errors);
    return;
  }

  const allTasks: IndexedTask[] = [
    ...snapshot.tasksByStableId.values(),
    ...snapshot.tasksByEphemeralId.values(),
  ];

  const filtered = allTasks.filter((t) => {
    if (options.show === "active") return !t.checked;
    if (options.show === "done") return t.checked;
    return true;
  });

  const sorted = sortTasks(filtered, options.sort);

  if (options.groupBy === "none") {
    renderTaskList({ app, container, tasks: sorted, onToggle });
    return;
  }

  const groups = new Map<string, IndexedTask[]>();
  for (const t of sorted) {
    const k = groupKey(t, options.groupBy);
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }

  for (const [k, list] of groups) {
    const h = container.createEl("div", { text: k || "Tasks" });
    h.style.marginTop = "10px";
    h.style.fontWeight = "600";
    renderTaskList({ app, container, tasks: list, onToggle });
  }
}

function renderTaskList(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  onToggle: (task: IndexedTask) => void;
}) {
  const { app, container, tasks, onToggle } = args;

  if (tasks.length === 0) {
    container.createEl("div", { text: "No tasks." });
    return;
  }

  const ul = container.createEl("ul");
  ul.style.listStyle = "none";
  ul.style.paddingLeft = "0";

  for (const t of tasks) {
    const li = ul.createEl("li");
    li.style.display = "flex";
    li.style.gap = "8px";
    li.style.alignItems = "center";
    li.style.padding = "4px 0";

    const cb = li.createEl("input");
    cb.type = "checkbox";
    cb.checked = t.checked;
    cb.addEventListener("change", () => onToggle(t));

    const text = li.createEl("span", { text: `${t.title} (${t.dueYmd})` });
    text.style.flex = "1";

    const link = li.createEl("a", { text: t.filePath, cls: "internal-link" });
    link.style.opacity = "0.7";
    link.style.fontSize = "0.9em";
    link.style.cursor = "pointer";
    link.href = "#";

    link.addEventListener("click", (e) => {
      e.preventDefault();
      // Open the source file at the task's line
      (app.workspace as any).openLinkText("", t.filePath, false, {
        eState: { line: t.lineNoHint },
      });
    });
  }
}

function renderErrors(container: HTMLElement, errors: ParseError[]) {
  if (errors.length === 0) {
    container.createEl("div", { text: "No errors." });
    return;
  }

  const ul = container.createEl("ul");
  for (const e of errors) {
    ul.createEl("li", {
      text: `${e.filePath}:${e.lineNo + 1} — ${e.reason}`,
    });
  }
}