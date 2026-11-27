# octodo tasks

## What this source contains

This repo tracks its own work in `.octodo/`, one folder per task with a `task.md` inside, committed to git. `octo ls` lists them and `octo show PU-n` shows one.

- The task body: the problem, the plan, decisions, and notes, often written before the code.
- Frontmatter: `id` (such as `PU-12`), `title`, `status`, `priority`, `tags`, `due`, `created`.
- The list folder (`.octodo/tasks/receipts/`) says what area it belongs to.
- The git history of the file: when the task was written, when its plan changed, and when it moved to done. A move between lists is a rename in git.

## How to search it

Use `octo show` to read tasks by id. Use git and `rg` for history and full-text search.

```bash
# Tasks that mention a term, in any status or list
rg -l -i '<term>' .octodo

# A task's file wherever it lives now (file names start with the id)
find .octodo -name 'PU-12-*'

# The task's full history through status moves and renames
git log --follow -p -- "$(find .octodo -name 'PU-12-*')"

# Commits that mention the task id
git log --all --oneline --grep 'PU-12'

# When text first appeared in any task (the plan, a decision)
git log -S '<exact phrase>' --oneline -- .octodo
```

Read the whole task body and its diff history, not just the title. A task's plan often changed after the code started, and the diff shows that.

### Deleted tasks

A task deleted from `.octodo/` is still in git, and a deleted task is often the most useful evidence: work that was dropped, merged into another task, or abandoned. Search history, not just the working tree.

```bash
# Every task file ever deleted, with the commit that deleted it
git log --diff-filter=D --name-only --format='%h %cs %s' -- .octodo

# Deleted tasks that mentioned a term (the commit that removed the text)
git log --all -S '<term>' --format='%h %cs %s' -- .octodo

# A task's history by id, even when no file matches it today
git log --all --format='%h %cs %s' -- ':(glob).octodo/**/PU-12-*'

# Read a deleted task as it was just before the commit that deleted it
git show <deleting-commit>^:<path>
```

Say why a task disappeared when the history shows it: the deleting commit's message, a task that took over its content, or the code that made it moot.

## What good evidence looks like here

- A task body that states the problem the target code solves, or the approach it chose and why.
- A plan in the body that changed between commits, showing a decision that was revised.
- A commit that moves the task to done in the same change as the target code.
- Tags or a list that place the work in a larger effort.

## Common pitfalls

- **Ids, not paths.** File names and folders change when a task moves, or the title changes. Search by id.
- **The working tree is not the whole record.** No match in `.octodo/` today is not a null result until you have searched the deleted tasks too.
- **Stale plans.** A task written before the code may describe a plan that changed. Cross-check against the commits.

## What to return

For each relevant task: the id and title, the quoted motivation or decision from the body with the commit where it appeared, its status and list (or the commit that deleted it), and the commits that link it to the target code.
