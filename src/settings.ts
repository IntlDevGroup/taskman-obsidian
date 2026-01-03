import { App, PluginSettingTab, Setting } from "obsidian";
import type TaskManPlugin from "./main";

export interface TaskmanSettings {
  // Reminders
  remindersEnabled: boolean;
  reminderTime: string; // "HH:MM" format, e.g., "09:00"
  remindDaysBefore: number[]; // e.g., [0, 1] = day-of and 1 day before
  
  // Missed reminders
  missedReminderWindowHours: number; // check this many hours back on startup
  missedDigestThreshold: number; // show digest if more than this many missed
  
  // Notifications
  useSystemNotifications: boolean; // true = OS notifications, false = Obsidian Notice only
}

export const DEFAULT_SETTINGS: TaskmanSettings = {
  remindersEnabled: true,
  reminderTime: "09:00",
  remindDaysBefore: [0, 1], // day-of and 1 day before
  missedReminderWindowHours: 12,
  missedDigestThreshold: 3,
  useSystemNotifications: true,
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

    // --- Reminders Section ---
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
            // Validate HH:MM format
            if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
              this.plugin.settings.reminderTime = value;
              await this.plugin.saveSettings();
              this.plugin.rescheduleReminders();
            }
          })
      );

    new Setting(containerEl)
      .setName("Remind days before")
      .setDesc("Comma-separated days before due date (0 = day of, 1 = day before)")
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

    // --- Missed Reminders Section ---
    containerEl.createEl("h3", { text: "Missed Reminders" });

    new Setting(containerEl)
      .setName("Catch-up window (hours)")
      .setDesc("On startup, show reminders missed within this many hours")
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

    new Setting(containerEl)
      .setName("Digest threshold")
      .setDesc("If more than this many missed, show summary instead of individual alerts")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.missedDigestThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.missedDigestThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Notifications Section ---
    containerEl.createEl("h3", { text: "Notification Style" });

    new Setting(containerEl)
      .setName("Use system notifications")
      .setDesc("Show OS-level notifications (requires permission). If off, shows in-app notices only.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSystemNotifications)
          .onChange(async (value) => {
            if (value) {
              // Request permission
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

    // --- Test Button ---
    containerEl.createEl("h3", { text: "Test" });

    new Setting(containerEl)
      .setName("Test notification")
      .setDesc("Send a test notification to verify it's working")
      .addButton((button) =>
        button.setButtonText("Send Test").onClick(() => {
          this.plugin.sendTestNotification();
        })
      );
  }
}