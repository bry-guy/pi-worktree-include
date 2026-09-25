# pi-worktree-include

Bring your local, Git-ignored files into a new worktree without copying everything. This Pi extension uses the same [`.worktreeinclude` convention as Claude Code](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees).

Install from Git (npm: `pi install npm:pi-worktree-include`, once published):

```sh
pi install git:github.com/bry-guy/pi-worktree-include
```

In your repository root, add `.worktreeinclude` with Gitignore-style patterns:

```gitignore
.env.local
config/local.json
```

After creating a worktree, ask Pi to populate its local files, or run:

```text
/worktree-include <target-worktree> [source-checkout]
```

The source defaults to your current checkout. Only files that match `.worktreeinclude` **and** are Git-ignored are copied; existing target files are never overwritten. No manifest means no copies. Source symlinks cause an error. This tool does not create worktrees or change Pi's working directory.
