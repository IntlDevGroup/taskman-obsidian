import { App, Modal, Setting, Notice, TextComponent } from "obsidian";
import { parseNaturalDate, formatDateYmd } from "./dateParser";
import type { TaskTemplate } from "./templates";
import type { Priority } from "./types";

export class AddTaskModal extends Modal {
  private title = "";
  private dueDate = "";
  private onSubmit: (title: string, dueDate: string) => void;

  constructor(
    app: App,
    onSubmit: (title: string, dueDate: string) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;

    // Default due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.dueDate = tomorrow.toISOString().split("T")[0];
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Add Task" });

    new Setting(contentEl)
      .setName("Task")
      .setDesc("What do you need to do?")
      .addText((text) =>
        text
          .setPlaceholder("Buy groceries")
          .onChange((value) => {
            this.title = value;
          })
      );

    new Setting(contentEl)
      .setName("Due date")
      .addText((text) =>
        text
          .setValue(this.dueDate)
          .setPlaceholder("YYYY-MM-DD")
          .onChange((value) => {
            this.dueDate = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Add Task")
          .setCta()
          .onClick(() => {
            if (!this.title.trim()) {
              new Notice("Please enter a task title");
              return;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(this.dueDate)) {
              new Notice("Date must be YYYY-MM-DD format");
              return;
            }
            this.close();
            this.onSubmit(this.title.trim(), this.dueDate);
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Quick capture modal with natural language parsing.
 */
export class QuickCaptureModal extends Modal {
  private input = "";
  private previewEl: HTMLElement | null = null;
  private onSubmit: (
    title: string,
    dueDate: string | null,
    priority: Priority,
    tags: string[]
  ) => void;

  constructor(
    app: App,
    onSubmit: (
      title: string,
      dueDate: string | null,
      priority: Priority,
      tags: string[]
    ) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("taskman-quick-capture");

    contentEl.createEl("h2", { text: "Quick Add Task" });

    // Single input field
    const inputSetting = new Setting(contentEl)
      .setName("Task")
      .setDesc("Type naturally: 'Buy milk tomorrow #errands !'");

    let textComponent: TextComponent;
    inputSetting.addText((text) => {
      textComponent = text;
      text
        .setPlaceholder("Buy groceries tomorrow #personal")
        .onChange((value) => {
          this.input = value;
          this.updatePreview();
        });

      // Handle enter key
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.submit();
        }
      });

      // Focus the input
      setTimeout(() => text.inputEl.focus(), 10);
    });

    // Preview area
    this.previewEl = contentEl.createEl("div", { cls: "taskman-capture-preview" });
    this.updatePreview();

    // Submit button
    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Add Task (Enter)")
          .setCta()
          .onClick(() => this.submit())
      );
  }

  private updatePreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();

    if (!this.input.trim()) {
      this.previewEl.createEl("span", {
        text: "Type a task to see preview...",
        cls: "taskman-preview-hint",
      });
      return;
    }

    const parsed = this.parseInput();

    const preview = this.previewEl.createEl("div", { cls: "taskman-preview-content" });

    // Title
    preview.createEl("div", {
      text: `📝 ${parsed.title || "(no title)"}`,
      cls: "taskman-preview-title",
    });

    // Date
    if (parsed.dueDate) {
      preview.createEl("div", {
        text: `📅 ${parsed.dueDate}`,
        cls: "taskman-preview-date",
      });
    }

    // Priority
    if (parsed.priority > 0) {
      const icons = ["", "🟡", "🟠", "🔴"];
      const labels = ["", "Low", "Medium", "High"];
      preview.createEl("div", {
        text: `${icons[parsed.priority]} ${labels[parsed.priority]} priority`,
        cls: "taskman-preview-priority",
      });
    }

    // Tags
    if (parsed.tags.length > 0) {
      preview.createEl("div", {
        text: `🏷️ ${parsed.tags.map((t) => "#" + t).join(" ")}`,
        cls: "taskman-preview-tags",
      });
    }
  }

  private parseInput(): {
    title: string;
    dueDate: string | null;
    priority: Priority;
    tags: string[];
  } {
    let text = this.input.trim();
    let priority: Priority = 0;
    const tags: string[] = [];

    // Extract priority
    const priorityMatch = text.match(/\s*(!!!|!!|!)\s*$/);
    if (priorityMatch) {
      priority = priorityMatch[1].length as Priority;
      text = text.slice(0, -priorityMatch[0].length).trim();
    }

    // Extract tags
    const tagMatches = text.matchAll(/#(\w+)/g);
    for (const m of tagMatches) {
      tags.push(m[1]);
    }
    text = text.replace(/#\w+/g, "").trim();

    // Parse natural date
    const { date, remainingText } = parseNaturalDate(text);

    return {
      title: remainingText.replace(/\s+/g, " ").trim(),
      dueDate: date ? formatDateYmd(date) : null,
      priority,
      tags,
    };
  }

  private submit() {
    const parsed = this.parseInput();

    if (!parsed.title) {
      new Notice("Please enter a task title");
      return;
    }

    this.close();
    this.onSubmit(parsed.title, parsed.dueDate, parsed.priority, parsed.tags);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Template picker modal.
 */
export class TemplatePickerModal extends Modal {
  private templates: TaskTemplate[];
  private onSelect: (template: TaskTemplate) => void;

  constructor(
    app: App,
    templates: TaskTemplate[],
    onSelect: (template: TaskTemplate) => void
  ) {
    super(app);
    this.templates = templates;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Insert Template" });

    if (this.templates.length === 0) {
      contentEl.createEl("p", { text: "No templates available." });
      return;
    }

    for (const template of this.templates) {
      const item = contentEl.createEl("div", { cls: "taskman-template-item" });

      item.createEl("div", { text: template.name, cls: "taskman-template-name" });
      item.createEl("div", {
        text: `${template.tasks.length} tasks`,
        cls: "taskman-template-count",
      });

      item.addEventListener("click", () => {
        this.close();
        this.onSelect(template);
      });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Daily planning modal.
 */
export class DailyPlanningModal extends Modal {
  private tasks: { title: string; dueYmd: string | null; priority: number }[];
  private onComplete: (topTasks: string[]) => void;

  constructor(
    app: App,
    tasks: { title: string; dueYmd: string | null; priority: number }[],
    onComplete: (topTasks: string[]) => void
  ) {
    super(app);
    this.tasks = tasks;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("taskman-daily-planning");

    const today = new Date().toISOString().split("T")[0];
    const todayTasks = this.tasks.filter((t) => t.dueYmd === today);
    const overdue = this.tasks.filter((t) => t.dueYmd && t.dueYmd < today);

    contentEl.createEl("h2", { text: "🌅 Good Morning!" });

    // Summary
    const summary = contentEl.createEl("div", { cls: "taskman-planning-summary" });
    summary.createEl("p", {
      text: `You have ${todayTasks.length} tasks due today.`,
    });
    if (overdue.length > 0) {
      summary.createEl("p", {
        text: `⚠️ ${overdue.length} tasks are overdue.`,
        cls: "taskman-overdue",
      });
    }

    // Task list
    contentEl.createEl("h3", { text: "Today's Tasks" });
    const list = contentEl.createEl("div", { cls: "taskman-planning-list" });

    for (const task of [...overdue, ...todayTasks].slice(0, 10)) {
      const item = list.createEl("div", { cls: "taskman-planning-task" });
      if (task.priority > 0) {
        const icons = ["", "🟡", "🟠", "🔴"];
        item.createEl("span", { text: icons[task.priority] });
      }
      item.createEl("span", { text: task.title });
    }

    // MIT selection hint
    contentEl.createEl("h3", { text: "Pick Your Top 3 MITs" });
    contentEl.createEl("p", {
      text: "Focus on your Most Important Tasks first.",
      cls: "taskman-hint",
    });

    // Close button
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Start My Day").setCta().onClick(() => {
        this.close();
        this.onComplete([]);
      })
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Weekly review modal.
 */
export class WeeklyReviewModal extends Modal {
  private completedCount: number;
  private overdueCount: number;
  private upcomingCount: number;
  private onSaveReview: (notes: string) => void;

  constructor(
    app: App,
    stats: { completedCount: number; overdueCount: number; upcomingCount: number },
    onSaveReview: (notes: string) => void
  ) {
    super(app);
    this.completedCount = stats.completedCount;
    this.overdueCount = stats.overdueCount;
    this.upcomingCount = stats.upcomingCount;
    this.onSaveReview = onSaveReview;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("taskman-weekly-review");

    contentEl.createEl("h2", { text: "📊 Weekly Review" });

    // Stats
    const stats = contentEl.createEl("div", { cls: "taskman-review-stats" });
    stats.createEl("div", {
      text: `✅ Completed: ${this.completedCount} tasks`,
      cls: "taskman-stat-completed",
    });
    stats.createEl("div", {
      text: `⚠️ Overdue: ${this.overdueCount} tasks`,
      cls: "taskman-stat-overdue",
    });
    stats.createEl("div", {
      text: `📅 Upcoming: ${this.upcomingCount} tasks`,
      cls: "taskman-stat-upcoming",
    });

    // Reflection prompts
    contentEl.createEl("h3", { text: "Reflection" });

    const prompts = [
      "What went well this week?",
      "What could be improved?",
      "What will you focus on next week?",
    ];

    let notes = "";
    for (const prompt of prompts) {
      new Setting(contentEl)
        .setName(prompt)
        .addTextArea((text) =>
          text.setPlaceholder("Your thoughts...").onChange((value) => {
            notes = value;
          })
        );
    }

    // Actions
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Save Review").setCta().onClick(() => {
          this.close();
          this.onSaveReview(notes);
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Skip").onClick(() => {
          this.close();
        })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
