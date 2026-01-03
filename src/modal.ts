import { App, Modal, Setting } from "obsidian";

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