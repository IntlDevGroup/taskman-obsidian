/**
 * Task templates for TaskMan.
 * Templates can include variables like {{today}}, {{+7d}}, {{+2w}}
 */

export interface TaskTemplate {
  name: string;
  tasks: string[];
}

/**
 * Parse a template variable and return the calculated date.
 * Supported: {{today}}, {{tomorrow}}, {{+Nd}}, {{+Nw}}, {{+Nm}}
 */
function parseTemplateDate(variable: string, baseDate: Date): string {
  const inner = variable.slice(2, -2).trim().toLowerCase();

  const result = new Date(baseDate);

  if (inner === "today") {
    // Already set to baseDate
  } else if (inner === "tomorrow") {
    result.setDate(result.getDate() + 1);
  } else if (inner.startsWith("+")) {
    const match = inner.match(/^\+(\d+)([dwm])$/);
    if (match) {
      const num = parseInt(match[1]);
      const unit = match[2];

      switch (unit) {
        case "d":
          result.setDate(result.getDate() + num);
          break;
        case "w":
          result.setDate(result.getDate() + num * 7);
          break;
        case "m":
          result.setMonth(result.getMonth() + num);
          break;
      }
    }
  }

  // Format as YYYYMMDD
  const y = result.getFullYear();
  const m = String(result.getMonth() + 1).padStart(2, "0");
  const d = String(result.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Apply template variables to a task line.
 */
function applyVariables(line: string, baseDate: Date): string {
  return line.replace(/\{\{[^}]+\}\}/g, (match) => {
    return parseTemplateDate(match, baseDate);
  });
}

/**
 * Expand a template into task lines.
 */
export function expandTemplate(
  template: TaskTemplate,
  baseDate: Date = new Date()
): string[] {
  return template.tasks.map((task) => {
    const expanded = applyVariables(task, baseDate);
    // Ensure it starts with checkbox format
    if (!expanded.startsWith("- [ ]")) {
      return `- [ ] ${expanded}`;
    }
    return expanded;
  });
}

/**
 * Parse template definitions from markdown.
 * Format:
 * ## Template Name
 * - [ ] Task one {{+7d}}
 * - [ ] Task two {{+14d}}
 */
export function parseTemplates(content: string): TaskTemplate[] {
  const templates: TaskTemplate[] = [];
  let currentTemplate: TaskTemplate | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // New template header
    if (trimmed.startsWith("## ")) {
      if (currentTemplate && currentTemplate.tasks.length > 0) {
        templates.push(currentTemplate);
      }
      currentTemplate = {
        name: trimmed.slice(3).trim(),
        tasks: [],
      };
      continue;
    }

    // Task line in template
    if (currentTemplate && (trimmed.startsWith("- [ ]") || trimmed.startsWith("- []"))) {
      currentTemplate.tasks.push(trimmed);
    }
  }

  // Don't forget last template
  if (currentTemplate && currentTemplate.tasks.length > 0) {
    templates.push(currentTemplate);
  }

  return templates;
}

/**
 * Default built-in templates.
 */
export const DEFAULT_TEMPLATES: TaskTemplate[] = [
  {
    name: "Weekly Review",
    tasks: [
      "- [ ] Review completed tasks {{today}}",
      "- [ ] Process inbox {{today}}",
      "- [ ] Plan next week {{today}}",
      "- [ ] Update goals {{today}}",
    ],
  },
  {
    name: "New Project",
    tasks: [
      "- [ ] Define project scope {{+1d}}",
      "- [ ] Create timeline {{+3d}}",
      "- [ ] Identify stakeholders {{+2d}}",
      "- [ ] Kickoff meeting {{+7d}}",
      "- [ ] First milestone {{+14d}}",
    ],
  },
  {
    name: "Meeting Follow-up",
    tasks: [
      "- [ ] Send meeting notes {{today}}",
      "- [ ] Create action items {{today}}",
      "- [ ] Schedule follow-up {{+7d}}",
    ],
  },
];
