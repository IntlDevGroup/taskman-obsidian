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
import type { TaskmanOptions, IndexedTask } from "./types";
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
import { AddTaskModal } from "./modal";

type RenderedBlock = {
  container: HTMLElement;
  options: TaskmanOptions;
  ctx: MarkdownPostProcessorContext;
};

interface TaskmanData {
  cache: TaskmanCache | null;
  settings: TaskmanSettings;
  reminders: ReminderState;
}

export default class TaskManPlugin extends Plugin {
  private indexer!: TaskIndexer;
  private editor!: TaskEditor;
  private renderedBlocks: RenderedBlock[] = [];
  
  settings!: TaskmanSettings;
  private reminderState!: ReminderState;
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Clean up old fired entries
    this.reminderState.fired = cleanupFiredRegistry(this.reminderState.fired);

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

    // Add commands
    this.addCommand({
      id: "taskman-rebuild-index",
      name: "Rebuild TaskMan index",
      callback: async () => {
        await this.indexer.buildInitialIndex(this.loadFileTextHashCached);
        this.rerenderAllBlocks();
        this.rescheduleReminders();
        await this.saveAllData();
        new Notice("TaskMan: Index rebuilt");
        
      },
    });
    this.addCommand({
      id: "taskman-add-todo",
      name: "Add todo with deadline",
      callback: () => {
        this.showAddTaskModal();
      },
    });
    
    

    // Check for missed reminders on startup
    this.checkMissedReminders();

    // Start reminder scheduler
    this.rescheduleReminders();

    // Save data after initial load
    await this.saveAllData();

    console.log("TaskMan: Plugin loaded");
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
      onToggle: (task) => void this.handleToggle(task),
    });
  }

  private rerenderAllBlocks() {
    for (const { container, options } of this.renderedBlocks) {
      this.renderBlock(container, options);
    }
  }

  private async handleToggle(task: IndexedTask) {
    const result = await this.editor.toggleTask(task);

    if (!result.success) {
      new Notice(`TaskMan: toggle failed. ${result.error ?? ""}`.trim());
      return;
    }

    const f = this.app.vault.getAbstractFileByPath(task.filePath);
    if (f instanceof TFile) {
      await this.indexer.reindexFile(f, this.loadFileTextHashFresh);
      // Rerender happens via indexer callback
      await this.saveAllData();
    }
  }

  // --- Reminder Methods ---

  rescheduleReminders() {
    // Clear existing timer
    if (this.reminderTimer) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }

    if (!this.settings.remindersEnabled) return;

    // Get all tasks
    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    // Get fired keys
    const firedKeys = new Set(Object.keys(this.reminderState.fired));

    // Compute upcoming reminders
    const reminders = getAllUpcomingReminders(
      allTasks,
      this.settings,
      firedKeys
    );

    // Find next one
    const next = getNextReminder(reminders);
    if (!next) return;

    // Schedule it
    const delay = Math.max(0, next.fireAt.getTime() - Date.now());
    
    console.log(
      `TaskMan: Next reminder for "${next.task.title}" in ${Math.round(delay / 1000 / 60)} minutes`
    );

    this.reminderTimer = setTimeout(() => {
      this.fireReminder(next);
    }, delay);
  }

  private fireReminder(reminder: { task: IndexedTask; key: string }) {
    // Show notification
    showTaskNotification(
      reminder.task,
      this.settings.useSystemNotifications,
      "Reminder"
    );

    // Mark as fired
    this.reminderState.fired[reminder.key] = Date.now();
    void this.saveAllData();

    // Schedule next
    this.rescheduleReminders();
  }

  private checkMissedReminders() {
    if (!this.settings.remindersEnabled) return;

    // Get all tasks
    const snapshot = this.indexer.getSnapshot();
    const allTasks: IndexedTask[] = [
      ...snapshot.tasksByStableId.values(),
      ...snapshot.tasksByEphemeralId.values(),
    ];

    // Get fired keys
    const firedKeys = new Set(Object.keys(this.reminderState.fired));

    // Compute all reminders (including past ones)
    const reminders = getAllUpcomingReminders(
      allTasks,
      this.settings,
      firedKeys
    );

    // Find missed ones
    const missed = getMissedReminders(
      reminders,
      this.settings.missedReminderWindowHours
    );

    if (missed.length === 0) return;

    // Mark all as fired
    for (const r of missed) {
      this.reminderState.fired[r.key] = Date.now();
    }
    void this.saveAllData();

    // Show notifications
    if (missed.length <= this.settings.missedDigestThreshold) {
      // Individual notifications
      for (const r of missed) {
        showTaskNotification(
          r.task,
          this.settings.useSystemNotifications,
          "Missed"
        );
      }
    } else {
      // Digest notification
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
  private showAddTaskModal() {
    const modal = new AddTaskModal(this.app, async (title, dueDate) => {
      // Format: YYYYMMDD
      const dueRaw = dueDate.replace(/-/g, "");
      const line = `- [ ] ${title} ${dueRaw}`;
      
      // Get active file or create new one
      let file = this.app.workspace.getActiveFile();
      
      if (!file) {
        // No file open, create one
        file = await this.app.vault.create(
          "Tasks.md",
          `# Tasks\n\n${line}\n`
        );
        await this.app.workspace.openLinkText(file.path, "", false);
        new Notice("Created Tasks.md with your new task");
        return;
      }
      
      // Append to current file
      const content = await this.app.vault.read(file);
      await this.app.vault.modify(file, content + "\n" + line);
      new Notice(`Added: ${title}`);
    });
    modal.open();
  }
}