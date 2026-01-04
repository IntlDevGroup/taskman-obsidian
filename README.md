# TaskMan

A to-do list plugin for Obsidian that collects tasks from all your notes and shows them in one place.

---

## What It Does

TaskMan finds every task you write across your entire vault and displays them together. You can see what's due today, this week, or view everything on a calendar. When you check off a task in the list, the original note updates automatically.

---

## Writing Tasks

Type `todo` followed by what you need to do:

```
todo Buy groceries
```

TaskMan converts this into a checkbox:

```
- [ ] Buy groceries
```

### Adding Due Dates

Put a date at the end:

```
todo Buy groceries tomorrow
todo Call mom next friday
todo Dentist appointment in 3 days
todo Submit report 20260115
```

Supported date formats:
- `today`, `tomorrow`
- `monday`, `tuesday`, etc. (next occurrence)
- `next week`, `next month`
- `in 3 days`, `in 2 weeks`
- `jan 15`, `march 3`
- `20260115` (January 15, 2026)

### Priority

Add exclamation marks at the end to indicate importance:

```
todo Fix bug !!!
```

- `!` = low priority
- `!!` = medium priority
- `!!!` = high priority

### Tags

Use `#` to categorize tasks:

```
todo Buy milk #errands
todo Read chapter 5 #school #reading
```

### Projects

Use `+` to group related tasks:

```
todo Write outline +thesis
todo Gather sources +thesis
```

### Contexts

Use `@` to indicate where or how you'll do something:

```
todo Call insurance @phone
todo Pick up prescription @errands
```

### Time Estimates

Use `~` to note how long something takes:

```
todo Review document ~30m
todo Write report ~2h
```

- `~15m` = 15 minutes
- `~2h` = 2 hours
- `~1d` = 1 day

### Recurring Tasks

Add a repeat schedule:

```
todo Take medication every day
todo Team meeting every monday
todo Pay rent every month
```

When you complete a recurring task, the next occurrence is created automatically.

### Status

Mark tasks that are blocked:

```
todo Review draft !waiting
todo Start phase 2 !blocked
```

---

## Viewing Tasks

Add a code block to any note to display tasks:

````
```taskman
show: active
```
````

### Options

**show** - which tasks to display
- `active` - incomplete tasks
- `done` - completed tasks
- `all` - everything
- `errors` - tasks with parsing problems

**view** - how to display them
- `default` - simple list
- `today` - tasks due today, grouped by time
- `week` - 7-day grid
- `calendar` - monthly calendar
- `kanban` - columns for Todo, In Progress, Waiting, Done
- `stats` - completion statistics

**sort** - ordering
- `dueAsc` - earliest due first
- `dueDesc` - latest due first
- `titleAsc` - alphabetical
- `fileAsc` - by source file

**groupBy** - how to group
- `none` - no grouping
- `due` - by due date
- `file` - by source file

### Filtering

Show only specific tasks:

````
```taskman
show: active
tags: errands
priority: 3
project: thesis
context: phone
status: waiting
search: report
dueBefore: 20260120
dueAfter: 20260101
```
````

All filters are optional. Use any combination.

---

## Commands

Open the command palette (Cmd+P on Mac, Ctrl+P on Windows) and search for:

- **Quick capture task** - Opens a popup to add a task quickly
- **Show today's tasks** - Opens a view of today's tasks
- **Show this week** - Opens the weekly view
- **Show statistics** - Opens completion stats
- **Insert task template** - Insert a pre-made set of tasks
- **Start daily planning** - Morning planning prompt
- **Weekly review** - End-of-week review prompt
- **Export tasks to ICS** - Download tasks as a calendar file
- **Reschedule to tomorrow** - Move selected task to tomorrow
- **Reschedule to next week** - Move selected task to next week

---

## Settings

Go to Settings > TaskMan to configure:

**Reminders**
- Enable/disable notifications
- Set reminder time (e.g., 9:00 AM)
- Days before due date to remind (e.g., 0, 1 for day-of and day-before)

**Display**
- Show/hide priority indicators
- Show/hide tags
- Show/hide time estimates

**Task Capture**
- Where new tasks go: active file, inbox file, or daily note
- Inbox file path

**Recurring Tasks**
- Automatically create next occurrence when completing

**Statistics**
- Enable completion tracking
- Streak calculation method

**Planning**
- Show daily planning prompt on startup
- Show weekly review prompt

---

## Examples

### A Simple Task List

````
```taskman
show: active
sort: dueAsc
```
````

### Today's Focus

````
```taskman
view: today
```
````

### Project Dashboard

````
```taskman
show: active
project: thesis
sort: dueAsc
```
````

### Weekly Planning

````
```taskman
view: week
```
````

### High Priority Only

````
```taskman
show: active
priority: 3
```
````

### Errands List

````
```taskman
show: active
tags: errands
context: out
```
````

---

## Task Syntax Reference

| Syntax | Meaning |
|--------|---------|
| `todo Task name` | Basic task |
| `tomorrow`, `next friday` | Due date |
| `20260115` | Due January 15, 2026 |
| `!`, `!!`, `!!!` | Priority (low, medium, high) |
| `#tag` | Tag |
| `+project` | Project |
| `@context` | Context |
| `~2h` | Time estimate |
| `every day` | Repeats daily |
| `every week` | Repeats weekly |
| `every month` | Repeats monthly |
| `!waiting` | Waiting status |
| `!blocked` | Blocked status |

---

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/taskman/` folder
2. Enable the plugin in Settings > Community Plugins
3. Start writing tasks with `todo`
