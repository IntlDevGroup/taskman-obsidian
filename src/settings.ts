import { App, PluginSettingTab, Setting } from "obsidian";
import type TaskManPlugin from "./main";

export interface TaskmanSettings {
  // Reminders
  remindersEnabled: boolean;
  reminderTime: string; // "HH:MM" format
  remindDaysBefore: number[];

  // Missed reminders
  missedReminderWindowHours: number;
  missedDigestThreshold: number;

  // Notifications
  useSystemNotifications: boolean;

  // Natural language dates
  naturalLanguageDates: boolean;
  weekStartsOn: 0 | 1; // 0=Sunday, 1=Monday

  // Display options
  showPriorityIndicators: boolean;
  showTagPills: boolean;
  showTimeEstimates: boolean;
  showRecurrenceIndicator: boolean;

  // Task destination
  defaultTaskDestination: "active" | "inbox" | "daily";
  inboxFile: string;

  // Recurring tasks
  autoCreateNextRecurrence: boolean;

  // Statistics
  statsEnabled: boolean;
  streakDefinition: "any" | "all" | "minimum";
  streakMinimumTasks: number;

  // Planning prompts
  showDailyPlanningPrompt: boolean;
  showWeeklyReviewPrompt: boolean;
  weeklyReviewDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  // Templates
  templateFile: string;
}

export const DEFAULT_SETTINGS: TaskmanSettings = {
  // Reminders
  remindersEnabled: true,
  reminderTime: "09:00",
  remindDaysBefore: [0, 1],
  missedReminderWindowHours: 12,
  missedDigestThreshold: 3,
  useSystemNotifications: true,

  // Natural language dates
  naturalLanguageDates: true,
  weekStartsOn: 1,

  // Display
  showPriorityIndicators: true,
  showTagPills: true,
  showTimeEstimates: true,
  showRecurrenceIndicator: true,

  // Task destination
  defaultTaskDestination: "active",
  inboxFile: "Inbox.md",

  // Recurring
  autoCreateNextRecurrence: true,

  // Statistics
  statsEnabled: true,
  streakDefinition: "any",
  streakMinimumTasks: 1,

  // Planning
  showDailyPlanningPrompt: false,
  showWeeklyReviewPrompt: false,
  weeklyReviewDay: 0, // Sunday

  // Templates
  templateFile: "",
};

export class TaskmanSettingTab extends PluginSettingTab {
  plugin: TaskManPlugin;

  constructor(app: App, plugin: TaskManPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "TaskMan Settings" });

    // ============ Reminders ============
    containerEl.createEl("h3", { text: "Reminders" });

    new Setting(containerEl)
      .setName("Enable reminders")
      .setDesc("Show notifications for upcoming tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.remindersEnabled)
          .onChange(async (value) => {
            this.plugin.settings.remindersEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.rescheduleReminders();
          })
      );

    new Setting(containerEl)
      .setName("Reminder time")
      .setDesc("Time of day to show reminders (24-hour format)")
      .addText((text) =>
        text
          .setPlaceholder("09:00")
          .setValue(this.plugin.settings.reminderTime)
          .onChange(async (value) => {
            if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
              this.plugin.settings.reminderTime = value;
              await this.plugin.saveSettings();
              this.plugin.rescheduleReminders();
            }
          })
      );

    new Setting(containerEl)
      .setName("Remind days before")
      .setDesc("Comma-separated days before due date (0 = day of)")
      .addText((text) =>
        text
          .setPlaceholder("0, 1")
          .setValue(this.plugin.settings.remindDaysBefore.join(", "))
          .onChange(async (value) => {
            const days = value
              .split(",")
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => !isNaN(n) && n >= 0);
            if (days.length > 0) {
              this.plugin.settings.remindDaysBefore = days;
              await this.plugin.saveSettings();
              this.plugin.rescheduleReminders();
            }
          })
      );

    // ============ Notifications ============
    containerEl.createEl("h3", { text: "Notifications" });

    new Setting(containerEl)
      .setName("Use system notifications")
      .setDesc("Show OS-level notifications")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSystemNotifications)
          .onChange(async (value) => {
            if (value) {
              const permission = await Notification.requestPermission();
              if (permission !== "granted") {
                toggle.setValue(false);
                return;
              }
            }
            this.plugin.settings.useSystemNotifications = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Missed reminder window (hours)")
      .setDesc("On startup, show reminders missed within this time")
      .addSlider((slider) =>
        slider
          .setLimits(1, 48, 1)
          .setValue(this.plugin.settings.missedReminderWindowHours)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.missedReminderWindowHours = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Date Parsing ============
    containerEl.createEl("h3", { text: "Date Parsing" });

    new Setting(containerEl)
      .setName("Natural language dates")
      .setDesc("Parse dates like 'tomorrow', 'next friday', 'in 3 days'")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.naturalLanguageDates)
          .onChange(async (value) => {
            this.plugin.settings.naturalLanguageDates = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Week starts on")
      .setDesc("First day of the week for views")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("0", "Sunday")
          .addOption("1", "Monday")
          .setValue(String(this.plugin.settings.weekStartsOn))
          .onChange(async (value) => {
            this.plugin.settings.weekStartsOn = parseInt(value) as 0 | 1;
            await this.plugin.saveSettings();
          })
      );

    // ============ Display ============
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Show priority indicators")
      .setDesc("Display priority icons (🔴 🟠 🟡)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPriorityIndicators)
          .onChange(async (value) => {
            this.plugin.settings.showPriorityIndicators = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show tags")
      .setDesc("Display #tags and @contexts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTagPills)
          .onChange(async (value) => {
            this.plugin.settings.showTagPills = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show time estimates")
      .setDesc("Display time estimates (~2h)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTimeEstimates)
          .onChange(async (value) => {
            this.plugin.settings.showTimeEstimates = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Task Capture ============
    containerEl.createEl("h3", { text: "Task Capture" });

    new Setting(containerEl)
      .setName("Default task destination")
      .setDesc("Where to add tasks from quick capture")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("active", "Active file")
          .addOption("inbox", "Inbox file")
          .addOption("daily", "Daily note")
          .setValue(this.plugin.settings.defaultTaskDestination)
          .onChange(async (value) => {
            this.plugin.settings.defaultTaskDestination = value as
              | "active"
              | "inbox"
              | "daily";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Inbox file")
      .setDesc("File path for inbox destination")
      .addText((text) =>
        text
          .setPlaceholder("Inbox.md")
          .setValue(this.plugin.settings.inboxFile)
          .onChange(async (value) => {
            this.plugin.settings.inboxFile = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Recurring Tasks ============
    containerEl.createEl("h3", { text: "Recurring Tasks" });

    new Setting(containerEl)
      .setName("Auto-create next occurrence")
      .setDesc("Automatically create next task when completing recurring tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCreateNextRecurrence)
          .onChange(async (value) => {
            this.plugin.settings.autoCreateNextRecurrence = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Statistics ============
    containerEl.createEl("h3", { text: "Statistics & Streaks" });

    new Setting(containerEl)
      .setName("Enable statistics")
      .setDesc("Track completion stats and streaks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.statsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.statsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Streak definition")
      .setDesc("What counts as a streak day")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("any", "Complete at least 1 task")
          .addOption("all", "Complete all tasks due")
          .addOption("minimum", "Complete minimum number")
          .setValue(this.plugin.settings.streakDefinition)
          .onChange(async (value) => {
            this.plugin.settings.streakDefinition = value as "any" | "all" | "minimum";
            await this.plugin.saveSettings();
          })
      );

    // ============ Planning Prompts ============
    containerEl.createEl("h3", { text: "Planning Prompts" });

    new Setting(containerEl)
      .setName("Daily planning prompt")
      .setDesc("Show daily planning modal on first open")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDailyPlanningPrompt)
          .onChange(async (value) => {
            this.plugin.settings.showDailyPlanningPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Weekly review prompt")
      .setDesc("Show weekly review reminder")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showWeeklyReviewPrompt)
          .onChange(async (value) => {
            this.plugin.settings.showWeeklyReviewPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Templates ============
    containerEl.createEl("h3", { text: "Templates" });

    new Setting(containerEl)
      .setName("Template file")
      .setDesc("File containing task templates (leave empty for built-in templates)")
      .addText((text) =>
        text
          .setPlaceholder("templates/tasks.md")
          .setValue(this.plugin.settings.templateFile)
          .onChange(async (value) => {
            this.plugin.settings.templateFile = value;
            await this.plugin.saveSettings();
          })
      );

    // ============ Test ============
    containerEl.createEl("h3", { text: "Test" });

    new Setting(containerEl)
      .setName("Test notification")
      .setDesc("Send a test notification")
      .addButton((button) =>
        button.setButtonText("Send Test").onClick(() => {
          this.plugin.sendTestNotification();
        })
      );
  }
}
