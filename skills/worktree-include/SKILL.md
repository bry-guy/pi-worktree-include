---
name: worktree-include
description: Use after creating a Git worktree to populate selected Git-ignored local files from the source checkout. Also use when asked to copy .worktreeinclude files into an existing worktree.
---

# Worktree include

After you create a worktree, call `worktree_include` with its absolute target path and the source checkout path. The tool reads `.worktreeinclude` in the source checkout. It is safe to call if the manifest is absent or the target already contains the selected files.

This is guidance, not a Git hook: worktrees created outside this Pi conversation do not trigger the tool automatically. Do not read or display the copied files' contents. If the tool reports an error, report it instead of replacing existing target files.
