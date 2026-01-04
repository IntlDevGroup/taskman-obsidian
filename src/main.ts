import {
  Plugin,
  TFile,
  MarkdownRenderChild,
  Notice,
  type MarkdownPostProcessorContext,
} from "obsidian";

import { TaskIndexer } from "./indexer";
import { TaskEditor } from "./editor";
import { parseTaskmanOptions, renderTaskmanBlock } from "./render";
import type { TaskmanOptions, IndexedTask, StatsStore } from "./types";
import type { TaskmanCache } from "./cache";
import { fnv1a32 } from "./hash";
import {
  TaskmanSettingTab,
  DEFAULT_SETTINGS,
  type TaskmanSettings,
} from "./settings";
import {
  getAllUpcomingReminders,
  getNextReminder,
  getMissedReminders,
  showTaskNotification,
  showDigestNotification,
  cleanupFiredRegistry,
  type ReminderState,
} from "./reminders";
import {
  AddTaskModal,
  QuickCaptureModal,
  TemplatePickerModal,
  DailyPlanningModal,
  WeeklyReviewModal,
} from "./modal";
import { createDefaultStats, recordCompletion, cleanupOldStats } from "./stats";
import { DEFAULT_TEMPLATES, parseTemplates, expandTemplate } from "./templates";
import { generateICS, downloadICS } from "./icsExport";

type RenderedBlock = {
  container: HTMLElement;
  options: TaskmanOptions;
  ctx: MarkdownPostProcessorContext;
};

interface TaskmanData {
  cache: TaskmanCache | null;
  settings: TaskmanSettings;
  reminders: ReminderState;
  stats: StatsStore;
  lastDailyPrompt?: string;
}

export default class TaskManPlugin extends Plugin {
  private indexer!: TaskIndexer;
  private editor!: TaskEditor;
  private renderedBlocks: RenderedBlock[] = [];

  settings!: TaskmanSettings;
  private reminderState!: ReminderState;
  private statsStore!: StatsStore;
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDailyPrompt?: string;

  // Helper: cached read for initial index build (fast)
  private loadFileTextHashCached = async (file: TFile) => {
    const content = await this.app.vault.cachedRead(file);
    return { content, hash: fnv1a32(content) };
  };

  // Helper: fresh read for event-driven updates (accurate)
  private loadFileTextHashFresh = async (file: TFile) => {
    const content = await this.app.vault.read(file);
    return { content, hash: fnv1a32(content) };
  };

  async onload() {
    console.log("TaskMan: Loading plugin");

    // Load saved data
    const saved = (await this.loadData()) as TaskmanData | null;
    this.settings = saved?.settings ?? { ...DEFAULT_SETTINGS };
    this.reminderState = saved?.reminders ?? { fired: {} };
    this.statsStore = saved?.stats ?? createDefaultStats();
    this.lastDailyPrompt = saved?.lastDailyPrompt;

    // Clean up old data
    this.reminderState.fired = cleanupFiredRegistry(this.reminderState.fired);
    this.statsStore = cleanupOldStats(this.statsStore);

    // Indexer callback triggers UI rerender for external changes
    this.indexer = new TaskIndexer(this.app, () => {
      this.rerenderAllBlocks();
      this.rescheduleReminders();
    });
    this.editor = new TaskEditor(this.app);

    // Set cache from saved data
    this.indexer.setCache(saved?.cache ?? null);

    // Initial index build: cached reads for speed
    await this.indexer.buildInitialIndex(this.loadFileTextHashCached);

    // Attach file listeners: fresh reads for correctness
    this.indexer.attachListeners(this.loadFileTextHashFresh);

    // Register the taskman code block processor
    this.registerMarkdownCodeBlockProcessor("taskman", (source, el, ctx) => {
      const options = parseTaskmanOptions(source);

      const block: RenderedBlock = { container: el, options, ctx };
      this.renderedBlocks.push(block);

      // Ensure cleanup when block is unloaded
      const plugin = this;
      ctx.addChild(
        new (class extends MarkdownRenderChild {
          constructor(containerEl: HTMLElement) {
            super(containerEl);
          }
          onunload() {
            const idx = plugin.renderedBlocks.findIndex(
              (b) => b.container === this.containerEl
            );
            if (idx !== -1) plugin.renderedBlocks.splice(idx, 1);
          }
        })(el)
      );

      this.renderBlock(el, options);
    });

    // Add settings tab
    this.addSettingTab(new TaskmanSettingTab(this.app, this));

    // Register commands
    this.registerCommands();

    // Check for missed reminders on startup
    this.checkMissedReminders();

    // Start reminder scheduler
    this.rescheduleReminders();

    // Check for daily planning prompt
    this.checkDailyPlanningPrompt();

    // Save data after initial load
    await this.saveAllData();

    console.log("TaskMan: Plugin loaded");
  }

  private registerCommands() {
    // Rebuild index
    this.addCommand({
      id: "taskman-rebuild-index",
      name: "Rebuild index",
      callback: async () => {
        await this.indexer.buildInitialIndex(this.loadFileTextHashCached);
        this.rerenderAllBlocks();
        this.rescheduleReminders();
        await this.saveAllData();
        new Notice("TaskMan: Index rebuilt");
      },
    });

    // Add todo (original)
    this.addCommand({
      id: "taskman-add-todo",
      name: "Add todo with deadline",
      callback: () => {
        this.showAddTaskModal();
      },
    });

    // Quick capture (natural language)
    this.addCommand({
      id: "taskman-quick-capture",
      name: "Quick add task",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "t" }],
      callback: () => {
        this.showQuickCaptureModal();
      },
    });

    // Today view
    this.addCommand({
      id: "taskman-today-view",
      name: "Open Today view",
      callback: () => {
        this.openTodayView();
      },
    });

    // Week view
    this.addCommand({
      id: "taskman-week-view",
      name: "Open Week view",
      callback: () => {
        this.insertCodeBlock({ view: "week" });
      },
    });

    // Stats view
    this.addCommand({
      id: "taskman-stats-view",
      name: "Open Statistics",
      callback: () => {
        this.insertCodeBlock({ view: "stats" });
      },
    });

    // Insert template
    this.addCommand({
      id: "taskman-insert-template",
      name: "Insert task template",
      callback: () => {
        this.showTemplatePickerModal();
      },
    });

    // Daily planning
    this.addCommand({
      id: "taskman-daily-planning",
      name: "Start daily planning",
      callback: () => {
        this.showDailyPlanningModal();
      },
    });

    // Weekly review
    this.addCommand({
      id: "taskman-weekly-review",
      name: "Start weekly review",
      callback: () => {
        this.showWeeklyReviewModal();
      },
    });

    // Export to ICS
    this.addCommand({
      id: "taskman-export-ics",
      name: "Export tasks to calendar (ICS)",
      callback: () => {
        this.exportToICS();
      },
    });

    // Reschedule to tomorrow
    this.addCommand({
      id: "taskman-reschedule-tomorrow",
      name: "Reschedule selected task to tomorrow",
      checkCallback: (checking) => {
        // Only available when there's a selection with a task
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return false;
        if (checking) return true;
        // Implementation would need cursor context
        new Notice("Select a task in a TaskMan view to reschedule");
        return true;
      },
    });

    // Reschedule to next week
    this.addCommand({
      id: "taskman-reschedule-next-week",
      name: "Reschedule selected task to next week",
      checkCallback: (checking) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return false;
        if (checking) return true;
        new Notice("Select a task in a TaskMan view to reschedule");
        return true;
      },
    });
  }

  async onunload() {
    if (this.reminderTimer) {
      clearTimeout(this.reminderTimer);
    }
    await this.saveAllData();
    console.log("TaskMan: Plugin unloaded");
  }

  async saveSettings() {
    await this.saveAllData();
  }

  private async saveAllData() {
    const data: TaskmanData = {
      cache: this.indexer.getCache(),
      settings: this.settings,
      reminders: this.reminderState,
      stats: this.statsStore,
      lastDailyPrompt: this.lastDailyPrompt,
    };
    await this.saveData(data);
  }

  private renderBlock(container: HTMLElement, options: TaskmanOptions) {
    renderTaskmanBlock({
      app: this.app,
      container,
      options,
      snapshot: this.indexer.getSnapshot(),
      errors: this.indexer.getErrors(),
      stats: this.statsStore,
      onToggle: (task) => void this.handleToggle(task),
      onReschedule: (task, newDate) => void this.handleReschedule(task, newDate),
    });
  }

  private rerenderAllBlocks() {
    for (const { container, options } of this.renderedBlocks) {
      this.renderBlock(container, options);
    }
  }

  private async handleToggle(task: IndexedTask) {
    const wasChecked = task.checked;
    const result = await this.editor.toggleTask(task);

    if (!result.success) {
      new Notice(`TaskMan: toggle failed. ${result.error ?? ""}`.trim());
      return;
    }

    // Track completion for stats
    if (!wasChecked && this.settings.statsEnabled) {
      this.statsStore = recordCompletion(this.statsStore);
    }

    const f = this.app.vault.getAbstractFileByPath(task.filePath);
    if (f instanceof TFile) {
      await this.indexer.reindexFile(f, this.loadFileTextHashFresh);
      await this.saveAllData();
    }

    // Show undo notice
    const action = wasChecked ? "unchecked" : "completed";
    const fragment = document.createDocumentFragment();
    fragment.appendText(`Task ${action}: "${task.title.slice(0, 30)}${task.title.length > 30 ? "..." : ""}" `);

    const undoBtn = document.createElement("button");
    undoBtn.textContent = "Undo";
    undoBtn.className = "mod-warning";
    undoBtn.style.marginLeft = "8px";
    undoBtn.style.cursor = "pointer";

    let undoClicked = false;
    undoBtn.addEventListener("click", async () => {
      if (undoClicked) return;
      undoClicked = true;

      // Toggle back
      const undoResult = await this.editor.toggleTask({
        ...task,
        checked: !wasChecked, // Now it's the opposite, so toggle back
      });

      if (undoResult.success) {
        new Notice("Undone!");
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (file instanceof TFile) {
          await this.indexer.reindexFile(file, this.loadFileTextHashFresh);
          await this.saveAllData();
        }
      } else {
        new Notice("Undo failed");
      }
    });

    fragment.appendChild(undoBtn);
    new Notice(fragment, 15000);
  }

  private async handleReschedule(task: IndexedTask, newDate: string) {
    const result = await this.editor.rescheduleTask(task, newDate);

    if (!result.success) {
      new Notice(`TaskMan: reschedule failed. ${result.error ?? ""}`.trim());
      return;
    }

    new Notice(`Rescheduled to ${newDate}`);

    const f = this.app.vault.getAbstractFileByPath(task.filePath);
    if (f instanceof TFile) {
      await this.indexer.reindexFile(f, this.loadFileTextHashFresh);
      await this.saveAllData();
    }
  }

  // ============ Modal Methods ============

  private showAddTaskModal() {
    const modal = new AddTaskModal(this.app, async (title, dueDate) => {
      await this.addTaskToDestination(title, dueDate);
    });
    modal.open();
  }

  private showQuickCaptureModal() {
    const modal = new QuickCaptureModal(
      this.app,
      async (title, dueDate, priority, tags) => {
        await this.addTaskToDestination(title, dueDate, { priority, tags });
      }
    );
    modal.open();
  }

  private async addTaskToDestination(
    title: string,
    dueDate: string | null,
    options?: { priority?: number; tags?: string[]; project?: string }
  ) {
    // Determine destination file
    let file = this.app.workspace.getActiveFile();

    if (this.settings.defaultTaskDestination === "inbox") {
      const inboxPath = this.settings.inboxFile;
      const existingFile = this.app.vault.getAbstractFileByPath(inboxPath);
      if (existingFile instanceof TFile) {
        file = existingFile;
      } else {
        // Create inbox file
        file = await this.app.vault.create(inboxPath, `# Inbox\n\n`);
      }
    }

    if (!file) {
      // No file open, create one
      file = await this.app.vault.create("Tasks.md", `# Tasks\n\n`);
      await this.app.workspace.openLinkText(file.path, "", false);
    }

    // Build task line
    let line = `- [ ] `;
    if (options?.priority && options.priority > 0) {
      line += "!".repeat(options.priority) + " ";
    }
    line += title;
    if (options?.tags) {
      for (const tag of options.tags) {
        line += ` #${tag}`;
      }
    }
    if (options?.project) {
      line += ` +${options.project}`;
    }
    if (dueDate) {
      const dateCompact = dueDate.replace(/-/g, "");
      line += ` ${dateCompact}`;
    }

    // Append to file
    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, content.trimEnd() + "\n" + line + "\n");

    new Notice(`Added: ${title}`);
  }

  private async showTemplatePickerModal() {
    // Load templates
    let templates = [...DEFAULT_TEMPLATES];

    if (this.settings.templateFile) {
      const templateFile = this.app.vault.getAbstractFileByPath(
        this.settings.templateFile
      );
      if (templateFile instanceof TFile) {
        const content = await this.app.vault.read(templateFile);
        const userTemplates = parseTemplates(content);
        templates = [...userTemplates, ...templates];
      }
    }

    const modal = new TemplatePickerModal(this.app, templates, async (template) => {
      const lines = expandTemplate(template);
      await this.insertLines(lines);
      new Notice(`Inserted ${template.name} (${lines.length} tasks)`);
    });
    modal.open();
  }

  private showDailyPlanningModal() {
    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    const activeTasks = allTasks
      .filter((t) => !t.checked)
      .map((t) => ({
        title: t.title,
        dueYmd: t.dueYmd,
        priority: t.priority,
      }));

    const modal = new DailyPlanningModal(this.app, activeTasks, () => {
      // Mark today as prompted
      const today = new Date().toISOString().split("T")[0];
      this.lastDailyPrompt = today;
      void this.saveAllData();
    });
    modal.open();
  }

  private showWeeklyReviewModal() {
    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    const today = new Date().toISOString().split("T")[0];

    const completedCount = allTasks.filter((t) => t.checked).length;
    const overdueCount = allTasks.filter(
      (t) => !t.checked && t.dueYmd && t.dueYmd < today
    ).length;
    const upcomingCount = allTasks.filter(
      (t) => !t.checked && t.dueYmd && t.dueYmd >= today
    ).length;

    const modal = new WeeklyReviewModal(
      this.app,
      { completedCount, overdueCount, upcomingCount },
      (notes) => {
        // Could save notes to a file
        if (notes) {
          new Notice("Review saved!");
        }
      }
    );
    modal.open();
  }

  private checkDailyPlanningPrompt() {
    if (!this.settings.showDailyPlanningPrompt) return;

    const today = new Date().toISOString().split("T")[0];
    if (this.lastDailyPrompt === today) return;

    // Show after a delay to let the app settle
    setTimeout(() => {
      this.showDailyPlanningModal();
    }, 2000);
  }

  private openTodayView() {
    // Insert a today view code block in the current file
    this.insertCodeBlock({ view: "today" });
  }

  private async insertCodeBlock(options: Partial<TaskmanOptions>) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No file open");
      return;
    }

    // Build code block
    const lines = ["```taskman"];
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("```");

    await this.insertLines(lines);
  }

  private async insertLines(lines: string[]) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No file open");
      return;
    }

    const content = await this.app.vault.read(file);
    await this.app.vault.modify(
      file,
      content.trimEnd() + "\n\n" + lines.join("\n") + "\n"
    );
  }

  private exportToICS() {
    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    const tasksWithDates = allTasks.filter((t) => t.dueYmd);

    if (tasksWithDates.length === 0) {
      new Notice("No tasks with dates to export");
      return;
    }

    const icsContent = generateICS(tasksWithDates);
    downloadICS(icsContent);
    new Notice(`Exported ${tasksWithDates.length} tasks to ICS`);
  }

  // ============ Reminder Methods ============

  rescheduleReminders() {
    if (this.reminderTimer) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }

    if (!this.settings.remindersEnabled) return;

    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    const firedKeys = new Set(Object.keys(this.reminderState.fired));

    const reminders = getAllUpcomingReminders(
      allTasks,
      this.settings,
      firedKeys
    );

    const next = getNextReminder(reminders);
    if (!next) return;

    const delay = Math.max(0, next.fireAt.getTime() - Date.now());

    console.log(
      `TaskMan: Next reminder for "${next.task.title}" in ${Math.round(
        delay / 1000 / 60
      )} minutes`
    );

    this.reminderTimer = setTimeout(() => {
      this.fireReminder(next);
    }, delay);
  }

  private fireReminder(reminder: { task: IndexedTask; key: string }) {
    showTaskNotification(
      reminder.task,
      this.settings.useSystemNotifications,
      "Reminder"
    );

    this.reminderState.fired[reminder.key] = Date.now();
    void this.saveAllData();

    this.rescheduleReminders();
  }

  private checkMissedReminders() {
    if (!this.settings.remindersEnabled) return;

    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    const firedKeys = new Set(Object.keys(this.reminderState.fired));

    const reminders = getAllUpcomingReminders(
      allTasks,
      this.settings,
      firedKeys
    );

    const missed = getMissedReminders(
      reminders,
      this.settings.missedReminderWindowHours
    );

    if (missed.length === 0) return;

    for (const r of missed) {
      this.reminderState.fired[r.key] = Date.now();
    }
    void this.saveAllData();

    if (missed.length <= this.settings.missedDigestThreshold) {
      for (const r of missed) {
        showTaskNotification(
          r.task,
          this.settings.useSystemNotifications,
          "Missed"
        );
      }
    } else {
      const tasks = missed.map((r) => r.task);
      showDigestNotification(tasks, this.settings.useSystemNotifications);
    }
  }

  sendTestNotification() {
    const testTask: IndexedTask = {
      stableId: "test",
      ephemeralId: "test",
      filePath: "test.md",
      checked: false,
      title: "Test Task",
      dueRaw: "20260115",
      dueYmd: "2026-01-15",
      priority: 2,
      tags: ["test"],
      contexts: [],
      project: null,
      recurrence: null,
      estimate: { minutes: 30, display: "30m" },
      status: "active",
      waitingOn: null,
      blockedBy: null,
      lineNoHint: 0,
      rawLine: "- [ ] Test Task 20260115",
      indentLevel: 0,
    };

    showTaskNotification(
      testTask,
      this.settings.useSystemNotifications,
      "Test"
    );
  }
}
