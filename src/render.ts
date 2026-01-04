import type { App } from "obsidian";
import type {
  IndexSnapshot,
  TaskmanOptions,
  IndexedTask,
  ParseError,
  Priority,
  StatsStore,
} from "./types";

const PRIORITY_ICONS: Record<Priority, string> = {
  0: "",
  1: "🟡",
  2: "🟠",
  3: "🔴",
};

const STATUS_ICONS = {
  active: "",
  waiting: "⏳",
  blocked: "🚫",
};

export function parseTaskmanOptions(source: string): TaskmanOptions {
  const opts: TaskmanOptions = {
    show: "active",
    sort: "dueAsc",
    groupBy: "file",
    view: "default",
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();

    switch (key) {
      case "show":
        if (["active", "done", "doneAll", "all", "errors"].includes(val)) {
          opts.show = val as TaskmanOptions["show"];
        }
        break;
      case "sort":
        if (["dueAsc", "dueDesc", "fileAsc", "titleAsc", "priority"].includes(val)) {
          opts.sort = val as TaskmanOptions["sort"];
        }
        break;
      case "groupBy":
        if (["none", "due", "file", "priority", "project", "status"].includes(val)) {
          opts.groupBy = val as TaskmanOptions["groupBy"];
        }
        break;
      case "view":
        if (["default", "today", "week", "calendar", "kanban", "stats"].includes(val)) {
          opts.view = val as TaskmanOptions["view"];
        }
        break;
      case "month":
        if (/^\d{4}-\d{2}$/.test(val)) {
          opts.month = val;
        }
        break;
      case "tags":
        opts.tags = val.split(",").map((t) => t.trim().replace(/^#/, ""));
        break;
      case "context":
        opts.contexts = val.split(",").map((c) => c.trim().replace(/^@/, ""));
        break;
      case "project":
        opts.project = val.replace(/^\+/, "");
        break;
      case "priority":
        const priorityMatch = val.match(/>=?\s*(\d)/);
        if (priorityMatch) {
          opts.priorityMin = parseInt(priorityMatch[1]) as Priority;
        }
        break;
      case "due":
        if (["overdue", "today", "thisWeek", "nextWeek"].includes(val)) {
          opts.dueFilter = val as "overdue" | "today" | "thisWeek" | "nextWeek";
        } else if (val.includes("..")) {
          const [start, end] = val.split("..");
          opts.dueFilter = { start: start.trim(), end: end.trim() };
        }
        break;
      case "status":
        if (["active", "waiting", "blocked"].includes(val)) {
          opts.statusFilter = val as "active" | "waiting" | "blocked";
        }
        break;
      case "search":
        opts.search = val.replace(/^["']|["']$/g, "");
        break;
    }
  }

  return opts;
}

function filterTasks(tasks: IndexedTask[], options: TaskmanOptions): IndexedTask[] {
  const today = getTodayStr();
  const thirtyDaysAgo = addDaysStr(today, -30);

  return tasks.filter((t) => {
    // Show filter
    if (options.show === "active" && t.checked) return false;
    if (options.show === "done" && !t.checked) return false;
    if (options.show === "doneAll" && !t.checked) return false;

    // For "done" (not "doneAll"), filter to last 30 days
    if (options.show === "done" && t.checked) {
      if (t.completedDate && t.completedDate < thirtyDaysAgo) return false;
    }

    // Tags filter
    if (options.tags?.length) {
      if (!options.tags.some((tag) => t.tags.includes(tag))) return false;
    }

    // Contexts filter
    if (options.contexts?.length) {
      if (!options.contexts.some((ctx) => t.contexts.includes(ctx))) return false;
    }

    // Project filter
    if (options.project) {
      if (t.project !== options.project) return false;
    }

    // Priority filter
    if (options.priorityMin !== undefined) {
      if (t.priority < options.priorityMin) return false;
    }

    // Status filter
    if (options.statusFilter) {
      if (t.status !== options.statusFilter) return false;
    }

    // Search filter
    if (options.search) {
      if (!t.title.toLowerCase().includes(options.search.toLowerCase())) return false;
    }

    // Due date filter
    if (options.dueFilter) {
      if (!t.dueYmd) return false;

      if (options.dueFilter === "overdue") {
        if (t.dueYmd >= today) return false;
      } else if (options.dueFilter === "today") {
        if (t.dueYmd !== today) return false;
      } else if (options.dueFilter === "thisWeek") {
        const weekEnd = getWeekEnd(new Date());
        if (t.dueYmd < today || t.dueYmd > weekEnd) return false;
      } else if (options.dueFilter === "nextWeek") {
        const nextWeekStart = addDaysStr(getWeekEnd(new Date()), 1);
        const nextWeekEnd = addDaysStr(nextWeekStart, 6);
        if (t.dueYmd < nextWeekStart || t.dueYmd > nextWeekEnd) return false;
      } else if (typeof options.dueFilter === "object") {
        if (t.dueYmd < options.dueFilter.start || t.dueYmd > options.dueFilter.end)
          return false;
      }
    }

    return true;
  });
}

function sortTasks(
  tasks: IndexedTask[],
  sort: TaskmanOptions["sort"]
): IndexedTask[] {
  const arr = tasks.slice();

  switch (sort) {
    case "dueAsc":
      arr.sort((a, b) => {
        if (!a.dueYmd && !b.dueYmd) return 0;
        if (!a.dueYmd) return 1;
        if (!b.dueYmd) return -1;
        return a.dueYmd.localeCompare(b.dueYmd);
      });
      break;
    case "dueDesc":
      arr.sort((a, b) => {
        if (!a.dueYmd && !b.dueYmd) return 0;
        if (!a.dueYmd) return 1;
        if (!b.dueYmd) return -1;
        return b.dueYmd.localeCompare(a.dueYmd);
      });
      break;
    case "fileAsc":
      arr.sort((a, b) => a.filePath.localeCompare(b.filePath));
      break;
    case "titleAsc":
      arr.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "priority":
      arr.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        // Secondary sort by due date
        if (!a.dueYmd && !b.dueYmd) return 0;
        if (!a.dueYmd) return 1;
        if (!b.dueYmd) return -1;
        return a.dueYmd.localeCompare(b.dueYmd);
      });
      break;
  }

  return arr;
}

function groupKey(task: IndexedTask, groupBy: TaskmanOptions["groupBy"]): string {
  switch (groupBy) {
    case "file":
      // Extract just the filename without .md extension
      const filename = task.filePath.split("/").pop() ?? task.filePath;
      return filename.replace(/\.md$/i, "");
    case "due":
      return task.dueYmd ?? "No date";
    case "priority":
      const labels = ["None", "Low", "Medium", "High"];
      return `${PRIORITY_ICONS[task.priority]} ${labels[task.priority]}`;
    case "project":
      return task.project ? `+${task.project}` : "No project";
    case "status":
      return task.status.charAt(0).toUpperCase() + task.status.slice(1);
    default:
      return "";
  }
}

function getDueStatus(dueYmd: string | null): string {
  if (!dueYmd) return "taskman-no-date";

  const today = getTodayStr();
  const diff = dateDiffDays(today, dueYmd);

  if (diff < 0) return "taskman-overdue";
  if (diff === 0) return "taskman-today";
  if (diff <= 3) return "taskman-soon";
  return "taskman-future";
}

// ============== Main Render Function ==============

export function renderTaskmanBlock(args: {
  app: App;
  container: HTMLElement;
  options: TaskmanOptions;
  snapshot: IndexSnapshot;
  errors: ParseError[];
  stats?: StatsStore;
  onToggle: (task: IndexedTask) => void;
  onReschedule?: (task: IndexedTask, newDate: string) => void;
}) {
  const { app, container, options, snapshot, errors, stats, onToggle, onReschedule } = args;
  container.empty();
  container.addClass("taskman-container");

  if (options.show === "errors") {
    renderErrors(container, errors);
    return;
  }

  const allTasks: IndexedTask[] = [
    ...snapshot.tasksByStableId.values(),
    ...snapshot.tasksByEphemeralId.values(),
  ];

  // Route to appropriate view
  switch (options.view) {
    case "today":
      renderTodayView({ app, container, tasks: allTasks, onToggle, onReschedule });
      break;
    case "week":
      renderWeekView({ app, container, tasks: allTasks, onToggle });
      break;
    case "calendar":
      renderCalendarView({ app, container, tasks: allTasks, options, onToggle });
      break;
    case "kanban":
      renderKanbanView({ app, container, tasks: allTasks, onToggle });
      break;
    case "stats":
      renderStatsView({ container, tasks: allTasks, stats });
      break;
    default:
      renderDefaultView({ app, container, tasks: allTasks, options, onToggle, onReschedule });
  }
}

// ============== Default View ==============

function renderDefaultView(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  options: TaskmanOptions;
  onToggle: (task: IndexedTask) => void;
  onReschedule?: (task: IndexedTask, newDate: string) => void;
}) {
  const { app, container, tasks, options, onToggle, onReschedule } = args;

  const filtered = filterTasks(tasks, options);
  const sorted = sortTasks(filtered, options.sort);

  if (sorted.length === 0) {
    container.createEl("div", { text: "No tasks.", cls: "taskman-empty" });
    return;
  }

  if (options.groupBy === "none") {
    renderTaskList({ app, container, tasks: sorted, onToggle, onReschedule });
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
    const header = container.createEl("div", { cls: "taskman-group-header" });

    // Master checkbox to toggle all tasks in this group
    const masterCb = header.createEl("input");
    masterCb.type = "checkbox";
    masterCb.className = "taskman-master-checkbox";
    const uncheckedCount = list.filter(t => !t.checked).length;
    masterCb.checked = uncheckedCount === 0;
    masterCb.indeterminate = uncheckedCount > 0 && uncheckedCount < list.length;

    // Use a copy of the list to avoid closure issues
    const tasksToToggle = [...list];
    masterCb.addEventListener("click", (e) => {
      e.stopPropagation();
      // Toggle all tasks to match the NEW state (after click)
      const newState = masterCb.checked;
      for (const task of tasksToToggle) {
        if (task.checked !== newState) {
          onToggle(task);
        }
      }
    });

    header.createEl("span", { text: k || "Tasks" });

    renderTaskList({ app, container, tasks: list, onToggle, onReschedule });
  }
}

// ============== Today View ==============

function renderTodayView(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  onToggle: (task: IndexedTask) => void;
  onReschedule?: (task: IndexedTask, newDate: string) => void;
}) {
  const { app, container, tasks, onToggle, onReschedule } = args;
  const today = getTodayStr();

  const active = tasks.filter((t) => !t.checked);

  const overdue = active.filter((t) => t.dueYmd && t.dueYmd < today);
  const todayTasks = active.filter((t) => t.dueYmd === today);
  const upcoming = active.filter((t) => {
    if (!t.dueYmd) return false;
    const diff = dateDiffDays(today, t.dueYmd);
    return diff > 0 && diff <= 3;
  });

  // Sort each group by priority
  const sortByPriority = (a: IndexedTask, b: IndexedTask) => b.priority - a.priority;
  overdue.sort(sortByPriority);
  todayTasks.sort(sortByPriority);
  upcoming.sort((a, b) => {
    if (a.dueYmd !== b.dueYmd) return a.dueYmd!.localeCompare(b.dueYmd!);
    return b.priority - a.priority;
  });

  // Header with stats
  const total = overdue.length + todayTasks.length;
  const header = container.createEl("div", { cls: "taskman-today-header" });
  header.createEl("span", { text: `📋 Today: ${todayTasks.length} tasks` });
  if (overdue.length > 0) {
    header.createEl("span", {
      text: ` • ⚠️ ${overdue.length} overdue`,
      cls: "taskman-overdue-count",
    });
  }

  // Total estimated time
  const totalMinutes = [...overdue, ...todayTasks].reduce(
    (sum, t) => sum + (t.estimate?.minutes ?? 0),
    0
  );
  if (totalMinutes > 0) {
    header.createEl("span", {
      text: ` • ⏱️ ${formatMinutes(totalMinutes)}`,
      cls: "taskman-time-total",
    });
    if (totalMinutes > 480) {
      header.createEl("span", {
        text: " (> 8h!)",
        cls: "taskman-time-warning",
      });
    }
  }

  // Overdue section
  if (overdue.length > 0) {
    container.createEl("div", { text: "⚠️ Overdue", cls: "taskman-section-header taskman-overdue" });
    renderTaskList({ app, container, tasks: overdue, onToggle, onReschedule });
  }

  // Today section
  if (todayTasks.length > 0) {
    container.createEl("div", { text: "📅 Today", cls: "taskman-section-header" });
    renderTaskList({ app, container, tasks: todayTasks, onToggle, onReschedule });
  } else if (overdue.length === 0) {
    container.createEl("div", { text: "No tasks for today!", cls: "taskman-empty" });
  }

  // Upcoming preview
  if (upcoming.length > 0) {
    container.createEl("div", { text: "📆 Upcoming", cls: "taskman-section-header taskman-dimmed" });
    renderTaskList({ app, container, tasks: upcoming, onToggle, onReschedule, dimmed: true });
  }
}

// ============== Week View ==============

function renderWeekView(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  onToggle: (task: IndexedTask) => void;
}) {
  const { app, container, tasks, onToggle } = args;
  const today = new Date();
  const todayStr = getTodayStr();

  // Get start of week (Monday)
  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday = 1
  startOfWeek.setDate(today.getDate() + diff);

  const active = tasks.filter((t) => !t.checked);

  // Overdue section
  const overdue = active.filter((t) => t.dueYmd && t.dueYmd < todayStr);
  if (overdue.length > 0) {
    const overdueSection = container.createEl("div", { cls: "taskman-week-overdue" });
    overdueSection.createEl("div", { text: `⚠️ Overdue (${overdue.length})`, cls: "taskman-section-header" });
    for (const t of overdue.slice(0, 5)) {
      renderCompactTask(overdueSection, t, onToggle);
    }
    if (overdue.length > 5) {
      overdueSection.createEl("div", { text: `+${overdue.length - 5} more`, cls: "taskman-more" });
    }
  }

  // Week grid
  const grid = container.createEl("div", { cls: "taskman-week-grid" });

  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    const dateStr = formatDateStr(date);

    const column = grid.createEl("div", { cls: "taskman-week-day" });
    if (dateStr === todayStr) {
      column.addClass("taskman-week-today");
    }

    // Header
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const header = column.createEl("div", { cls: "taskman-week-day-header" });
    header.createEl("span", { text: dayNames[date.getDay()], cls: "taskman-day-name" });
    header.createEl("span", { text: String(date.getDate()), cls: "taskman-day-num" });

    // Tasks for this day
    const dayTasks = active.filter((t) => t.dueYmd === dateStr);
    dayTasks.sort((a, b) => b.priority - a.priority);

    for (const t of dayTasks) {
      renderCompactTask(column, t, onToggle);
    }

    if (dayTasks.length === 0) {
      column.createEl("div", { text: "-", cls: "taskman-empty-day" });
    }
  }
}

// ============== Calendar View ==============

function renderCalendarView(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  options: TaskmanOptions;
  onToggle: (task: IndexedTask) => void;
}) {
  const { container, tasks, options } = args;

  // Determine which month to show
  let year: number, month: number;
  if (options.month) {
    [year, month] = options.month.split("-").map(Number);
    month -= 1; // 0-indexed
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const todayStr = getTodayStr();

  const active = tasks.filter((t) => !t.checked);

  // Header with navigation
  const header = container.createEl("div", { cls: "taskman-calendar-header" });
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  header.createEl("span", { text: `${monthNames[month]} ${year}`, cls: "taskman-calendar-title" });

  // Calendar grid
  const grid = container.createEl("div", { cls: "taskman-calendar-grid" });

  // Day name headers
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const name of dayNames) {
    grid.createEl("div", { text: name, cls: "taskman-calendar-dayname" });
  }

  // Calculate starting position (0 = Monday)
  let startPos = firstDay.getDay() - 1;
  if (startPos < 0) startPos = 6;

  // Empty cells before first day
  for (let i = 0; i < startPos; i++) {
    grid.createEl("div", { cls: "taskman-calendar-day taskman-calendar-empty" });
  }

  // Days of month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayTasks = active.filter((t) => t.dueYmd === dateStr);

    const cell = grid.createEl("div", { cls: "taskman-calendar-day" });
    if (dateStr === todayStr) {
      cell.addClass("taskman-calendar-today");
    }
    if (dayTasks.length > 0) {
      cell.addClass("taskman-calendar-has-tasks");
    }

    cell.createEl("span", { text: String(day), cls: "taskman-calendar-date" });

    if (dayTasks.length > 0) {
      const indicator = cell.createEl("span", {
        text: String(dayTasks.length),
        cls: "taskman-calendar-count",
      });

      // Tooltip with task titles
      const tooltip = dayTasks.map((t) => `• ${t.title}`).join("\n");
      cell.setAttribute("title", tooltip);
    }
  }
}

// ============== Kanban View ==============

function renderKanbanView(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  onToggle: (task: IndexedTask) => void;
}) {
  const { app, container, tasks, onToggle } = args;
  const today = getTodayStr();
  const weekFromNow = addDaysStr(today, 7);
  const weekAgo = addDaysStr(today, -7);

  const active = tasks.filter((t) => !t.checked);
  const recentlyDone = tasks.filter(
    (t) => t.checked // Could filter by completion date if tracked
  ).slice(0, 10);

  // Categorize
  const todayOrOverdue = active.filter((t) => !t.dueYmd || t.dueYmd <= today);
  const thisWeek = active.filter((t) => t.dueYmd && t.dueYmd > today && t.dueYmd <= weekFromNow);
  const backlog = active.filter((t) => t.dueYmd && t.dueYmd > weekFromNow);

  const kanban = container.createEl("div", { cls: "taskman-kanban" });

  // Today column
  const todayCol = kanban.createEl("div", { cls: "taskman-kanban-column" });
  todayCol.createEl("div", { text: `📅 Today (${todayOrOverdue.length})`, cls: "taskman-kanban-header" });
  for (const t of todayOrOverdue) {
    renderKanbanCard(todayCol, t, app, onToggle);
  }

  // This Week column
  const weekCol = kanban.createEl("div", { cls: "taskman-kanban-column" });
  weekCol.createEl("div", { text: `📆 This Week (${thisWeek.length})`, cls: "taskman-kanban-header" });
  for (const t of thisWeek) {
    renderKanbanCard(weekCol, t, app, onToggle);
  }

  // Backlog column
  const backlogCol = kanban.createEl("div", { cls: "taskman-kanban-column" });
  backlogCol.createEl("div", { text: `📋 Backlog (${backlog.length})`, cls: "taskman-kanban-header" });
  for (const t of backlog) {
    renderKanbanCard(backlogCol, t, app, onToggle);
  }

  // Done column
  const doneCol = kanban.createEl("div", { cls: "taskman-kanban-column taskman-kanban-done" });
  doneCol.createEl("div", { text: `✅ Done (${recentlyDone.length})`, cls: "taskman-kanban-header" });
  for (const t of recentlyDone) {
    renderKanbanCard(doneCol, t, app, onToggle);
  }
}

function renderKanbanCard(
  container: HTMLElement,
  task: IndexedTask,
  app: App,
  onToggle: (task: IndexedTask) => void
) {
  const card = container.createEl("div", { cls: "taskman-kanban-card" });
  if (task.checked) card.addClass("taskman-done");

  // Checkbox
  const cb = card.createEl("input");
  cb.type = "checkbox";
  cb.checked = task.checked;
  cb.addEventListener("click", (e) => e.stopPropagation());
  cb.addEventListener("change", () => onToggle(task));

  // Content
  const content = card.createEl("div", { cls: "taskman-kanban-content" });

  // Priority + Title
  const titleRow = content.createEl("div", { cls: "taskman-kanban-title" });
  if (task.priority > 0) {
    titleRow.createEl("span", { text: PRIORITY_ICONS[task.priority], cls: "taskman-priority" });
  }
  titleRow.createEl("span", { text: task.title });

  // Metadata row
  const meta = content.createEl("div", { cls: "taskman-kanban-meta" });
  if (task.dueYmd) {
    const status = getDueStatus(task.dueYmd);
    meta.createEl("span", { text: task.dueYmd, cls: `taskman-due ${status}` });
  }
  if (task.estimate) {
    meta.createEl("span", { text: `⏱️${task.estimate.display}`, cls: "taskman-estimate" });
  }

  // Tags
  if (task.tags.length > 0) {
    const tagsEl = content.createEl("div", { cls: "taskman-tags" });
    for (const tag of task.tags.slice(0, 3)) {
      tagsEl.createEl("span", { text: `#${tag}`, cls: "taskman-tag" });
    }
  }
}

// ============== Stats View ==============

function renderStatsView(args: {
  container: HTMLElement;
  tasks: IndexedTask[];
  stats?: StatsStore;
}) {
  const { container, tasks, stats } = args;

  const total = tasks.length;
  const completed = tasks.filter((t) => t.checked).length;
  const active = total - completed;
  const today = getTodayStr();
  const overdue = tasks.filter((t) => !t.checked && t.dueYmd && t.dueYmd < today).length;

  const statsEl = container.createEl("div", { cls: "taskman-stats" });

  // Summary cards
  const cards = statsEl.createEl("div", { cls: "taskman-stats-cards" });

  const card1 = cards.createEl("div", { cls: "taskman-stats-card" });
  card1.createEl("div", { text: String(active), cls: "taskman-stats-number" });
  card1.createEl("div", { text: "Active", cls: "taskman-stats-label" });

  const card2 = cards.createEl("div", { cls: "taskman-stats-card" });
  card2.createEl("div", { text: String(completed), cls: "taskman-stats-number" });
  card2.createEl("div", { text: "Completed", cls: "taskman-stats-label" });

  const card3 = cards.createEl("div", { cls: "taskman-stats-card taskman-stats-warning" });
  card3.createEl("div", { text: String(overdue), cls: "taskman-stats-number" });
  card3.createEl("div", { text: "Overdue", cls: "taskman-stats-label" });

  // Completion rate
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const card4 = cards.createEl("div", { cls: "taskman-stats-card" });
  card4.createEl("div", { text: `${rate}%`, cls: "taskman-stats-number" });
  card4.createEl("div", { text: "Completion", cls: "taskman-stats-label" });

  // Streak info
  if (stats?.streaks) {
    const streakEl = statsEl.createEl("div", { cls: "taskman-streak" });
    if (stats.streaks.current > 0) {
      streakEl.createEl("span", { text: `🔥 ${stats.streaks.current}-day streak!` });
    }
    streakEl.createEl("span", {
      text: ` Best: ${stats.streaks.longest} days`,
      cls: "taskman-streak-best",
    });
  }

  // By priority breakdown
  const byPriority = statsEl.createEl("div", { cls: "taskman-stats-section" });
  byPriority.createEl("div", { text: "By Priority", cls: "taskman-stats-title" });
  const priorityCounts = [0, 0, 0, 0];
  for (const t of tasks.filter((t) => !t.checked)) {
    priorityCounts[t.priority]++;
  }
  const priorityLabels = ["None", "Low (!)", "Medium (!!)", "High (!!!)"];
  for (let i = 3; i >= 0; i--) {
    if (priorityCounts[i] > 0) {
      byPriority.createEl("div", {
        text: `${PRIORITY_ICONS[i as Priority]} ${priorityLabels[i]}: ${priorityCounts[i]}`,
      });
    }
  }
}

// ============== Task List Renderer ==============

function renderTaskList(args: {
  app: App;
  container: HTMLElement;
  tasks: IndexedTask[];
  onToggle: (task: IndexedTask) => void;
  onReschedule?: (task: IndexedTask, newDate: string) => void;
  dimmed?: boolean;
}) {
  const { app, container, tasks, onToggle, onReschedule, dimmed } = args;

  for (const t of tasks) {
    const row = container.createEl("div", { cls: "taskman-task" });
    if (dimmed) row.addClass("taskman-dimmed");
    if (t.checked) row.addClass("taskman-done");
    if (t.status === "waiting") row.addClass("taskman-waiting");
    if (t.status === "blocked") row.addClass("taskman-blocked");

    // Indent
    if (t.indentLevel > 0) {
      row.style.marginLeft = `${t.indentLevel * 20}px`;
    }

    // Checkbox
    const cb = row.createEl("input");
    cb.type = "checkbox";
    cb.checked = t.checked;
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => onToggle(t));

    // Status icon
    if (t.status !== "active") {
      row.createEl("span", { text: STATUS_ICONS[t.status], cls: "taskman-status-icon" });
    }

    // Priority icon
    if (t.priority > 0) {
      row.createEl("span", {
        text: PRIORITY_ICONS[t.priority],
        cls: `taskman-priority taskman-priority-${t.priority}`,
      });
    }

    // Title
    row.createEl("span", { text: t.title, cls: "taskman-task-title" });

    // Recurrence icon
    if (t.recurrence) {
      const recur = row.createEl("span", { text: "🔁", cls: "taskman-recurrence" });
      recur.setAttribute("title", t.recurrence.originalText);
    }

    // Tags
    for (const tag of t.tags) {
      row.createEl("span", { text: `#${tag}`, cls: "taskman-tag" });
    }

    // Contexts
    for (const ctx of t.contexts) {
      row.createEl("span", { text: `@${ctx}`, cls: "taskman-context" });
    }

    // Project
    if (t.project) {
      row.createEl("span", { text: `+${t.project}`, cls: "taskman-project" });
    }

    // Time estimate
    if (t.estimate) {
      row.createEl("span", { text: `⏱️${t.estimate.display}`, cls: "taskman-estimate" });
    }

    // Due date
    const status = getDueStatus(t.dueYmd);
    const dueText = t.dueYmd ?? "No date";
    const dueEl = row.createEl("span", { text: dueText, cls: "taskman-due" });
    dueEl.addClass(status);

    // Reschedule buttons (on hover)
    if (onReschedule && !t.checked) {
      const reschedule = row.createEl("span", { cls: "taskman-reschedule" });
      const tomorrow = addDaysStr(getTodayStr(), 1);
      const nextWeek = addDaysStr(getTodayStr(), 7);

      const btn1 = reschedule.createEl("button", { text: "→Tom", cls: "taskman-reschedule-btn" });
      btn1.addEventListener("click", (e) => {
        e.stopPropagation();
        onReschedule(t, tomorrow);
      });

      const btn2 = reschedule.createEl("button", { text: "→+1w", cls: "taskman-reschedule-btn" });
      btn2.addEventListener("click", (e) => {
        e.stopPropagation();
        onReschedule(t, nextWeek);
      });
    }

    // File link
    const link = row.createEl("a", { text: t.filePath, cls: "taskman-file internal-link" });
    link.href = "#";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      (app.workspace as any).openLinkText("", t.filePath, false, {
        eState: { line: t.lineNoHint },
      });
    });
  }
}

function renderCompactTask(
  container: HTMLElement,
  task: IndexedTask,
  onToggle: (task: IndexedTask) => void
) {
  const row = container.createEl("div", { cls: "taskman-task-compact" });
  if (task.checked) row.addClass("taskman-done");

  const cb = row.createEl("input");
  cb.type = "checkbox";
  cb.checked = task.checked;
  cb.addEventListener("click", (e) => e.stopPropagation());
  cb.addEventListener("change", () => onToggle(task));

  if (task.priority > 0) {
    row.createEl("span", { text: PRIORITY_ICONS[task.priority] });
  }

  row.createEl("span", { text: task.title, cls: "taskman-task-title" });
}

function renderErrors(container: HTMLElement, errors: ParseError[]) {
  if (errors.length === 0) {
    container.createEl("div", { text: "No errors.", cls: "taskman-empty" });
    return;
  }

  const ul = container.createEl("ul");
  for (const e of errors) {
    ul.createEl("li", {
      text: `${e.filePath}:${e.lineNo + 1} — ${e.reason}`,
    });
  }
}

// ============== Utility Functions ==============

function getTodayStr(): string {
  const now = new Date();
  return formatDateStr(now);
}

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysStr(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return formatDateStr(date);
}

function dateDiffDays(from: string, to: string): number {
  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

function getWeekEnd(date: Date): string {
  const dayOfWeek = date.getDay();
  const daysUntilSunday = 7 - dayOfWeek;
  const result = new Date(date);
  result.setDate(date.getDate() + (daysUntilSunday === 7 ? 0 : daysUntilSunday));
  return formatDateStr(result);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
