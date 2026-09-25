# pi-worktree-include

Bring your local, Git-ignored files into a new worktree without copying everything. This Pi extension uses the same [`.worktreeinclude` convention as Claude Code](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees).

Install with Pi:

```sh
pi install npm:pi-worktree-include
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

The source defaults to your current checkout. Only files that match `.worktreeinclude` **and** are Git-ignored are copied; existing target files are never overwritten. No manifest means no copies. File symlinks (even to paths outside the checkout) remain symlinks to the same target; dangling links cause an error, and directory symlinks are not copied. This tool does not create worktrees or change Pi's working directory.

## Release

Update the version in `package.json` for each subsequent release, then run `mise run release` (or `mise release`) from this repository. It runs the checks, refuses to publish an existing version (or if npm cannot confirm availability), and publishes to npm; approve npm's browser prompt if asked.
