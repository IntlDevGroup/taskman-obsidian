# CLAUDE.md - TaskMan Obsidian Plugin

## Project Overview

TaskMan is an Obsidian plugin that provides a global todo list with deadlines and reminders. It indexes tasks across the entire vault and displays them in a unified view.

## Quick Start for Development

```bash
# Set your vault path
export OBSIDIAN_VAULT="/path/to/your/vault"

# Start dev container
docker compose up

# In container, run dev build
npm run dev
```

## Task Syntax

**Simple format (auto-converts):**

```
todo Buy groceries 20260115
```

**Converted format:**

```
- [ ] Buy groceries 20260115
```

**With stable ID (added on interaction):**

```
- [ ] Buy groceries 20260115 <!--todo:id=abc123;v=1-->
```

**Nested tasks:**

```
- [ ] Main project 20260115
    - [ ] Sub task one 20260116
    - [ ] Sub task two 20260120
```

## Code Block Usage

```markdown
```taskman
show: active
sort: dueAsc
groupBy: due
```
```

**Options:**

- `show`: `active` | `done` | `all` | `errors`
- `sort`: `dueAsc` | `dueDesc` | `fileAsc` | `titleAsc`
- `groupBy`: `none` | `due` | `file`

## File Structure

```
taskman-obsidian/
├── src/
│   ├── main.ts        # Plugin entry point, lifecycle, commands
│   ├── types.ts       # TypeScript type definitions
│   ├── parser.ts      # Task line parsing and validation
│   ├── hash.ts        # FNV-1a hashing for task IDs
│   ├── indexer.ts     # Vault-wide task indexing, file watching
│   ├── writeQueue.ts  # Per-file write queue (prevents race conditions)
│   ├── editor.ts      # Task toggling and file modification
│   ├── render.ts      # Code block rendering
│   ├── cache.ts       # Cache types for persistence
│   ├── settings.ts    # Settings tab and defaults
│   ├── modal.ts       # Add task modal
│   └── reminders.ts   # Reminder scheduling and notifications
├── manifest.json      # Obsidian plugin manifest
├── package.json       # Node dependencies
├── tsconfig.json      # TypeScript config
├── esbuild.config.mjs # Build configuration
├── styles.css         # Plugin styles
├── Dockerfile         # Dev container image
├── docker-compose.yml # Dev container orchestration
└── .devcontainer/
    └── devcontainer.json  # VS Code dev container config
```

## Key Concepts

### Task Identity

Tasks have two types of IDs:

1. **Stable ID** - Stored in HTML comment, survives edits

   ```
   <!--todo:id=abc123;v=1-->
   ```
1. **Ephemeral ID** - Generated from `filePath:hash:occurrence`
- Used until task is interacted with
- Then stable ID is added

### Two-Way Sync

- Check task in To-Do view → updates original file
- Edit task in original file → To-Do view updates
- Uses file change listeners with debouncing

### Write Queue

All file modifications go through `FileWriteQueue` to prevent race conditions when multiple tasks are toggled quickly.

### Auto-Conversion

The indexer automatically converts simple format to checkbox format:

- `todo X 20260115` → `- [ ] X 20260115`
- Happens on file index, triggers re-index after modification

### Reminders

- Computed from due date + settings (time, days before)
- Uses `setTimeout` to next reminder (not polling)
- Fires system notifications + in-app notices
- Catches up on missed reminders at startup

## Common Tasks

### Add a new setting

1. Add to `TaskmanSettings` interface in `settings.ts`
1. Add default in `DEFAULT_SETTINGS`
1. Add UI in `TaskmanSettingTab.display()`
1. Use via `this.plugin.settings.settingName`

### Add a new command

In `main.ts` `onload()`:

```ts
this.addCommand({
  id: "taskman-my-command",
  name: "My new command",
  callback: () => {
    // do something
  },
});
```

### Modify task parsing

Edit `src/parser.ts`:

- `isTodoLineCandidate()` - quick check
- `parseTodoLine()` - full parsing

### Change task display

Edit `src/render.ts`:

- `renderTaskmanBlock()` - main container
- `renderTaskList()` - individual tasks

## Debugging

1. Open Obsidian dev console: `Cmd+Option+I`
1. Plugin logs prefixed with `TaskMan:`
1. Check for red errors after interactions

## Testing Changes

1. Save file (auto-rebuilds if `npm run dev` running)
1. In Obsidian: `Cmd+P` → "Reload app without saving"
1. Test the feature

## Build for Release

```bash
npm run build
```

Outputs to `/vault-plugin/`:

- `main.js`
- `manifest.json`
- `styles.css`

## Known Limitations

- Reminders only fire when Obsidian is open (iOS/mobile limitation)
- Task cache is per-device (each device rebuilds on first use)
- Date format is YYYYMMDD only (no time support yet)

## Future Ideas

- [ ] Recurring tasks
- [ ] Time-based reminders (not just date)
- [ ] Task priority levels
- [ ] Tags/categories
- [ ] Calendar view
- [ ] Drag and drop reordering
