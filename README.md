# pi-worktree-include

A Pi extension and skill for copying selected local files into an existing Git worktree. It does not create worktrees or change Pi's working directory.

Install from Git:

```sh
pi install git:github.com/bry-guy/pi-worktree-include
```

Add `.worktreeinclude` at the source checkout's repo root using Gitignore patterns:

```gitignore
.env.local
config/local.json
```

Only files that match the manifest **and** are Git-ignored in the source checkout are copied. Tracked files are never copied. Unlike pi-ez-worktree's includes, these are independent copies, not symlinks; paths outside the source checkout are not supported. Source symlinks are rejected; nested repositories are not copied. The manifest is optional: without it, nothing is copied. Existing target files are left untouched, and target-tracked paths are never replaced. The skill tells the agent to run the tool after it creates a worktree; no Git hooks or transparent tool routing are installed.

Ask Pi to create a worktree and populate its ignored files, or explicitly run `/worktree-include <target-worktree> [source-checkout]`. The model-callable `worktree_include` tool accepts `target` and optional `source`; omitted source defaults to the session checkout. The target must be a separate worktree of the same Git repository. The command accepts paths without spaces; for paths with spaces, use the model-callable tool.

To test locally without changing Pi's global configuration:

```sh
npm run check
pi -e ~/dev/pi-worktree-include
```

For the optional registered-tool callback test, set `PI_CODING_AGENT_ROOT` to your installed `@earendil-works/pi-coding-agent` package directory before running `npm run check`. Without it, that test is skipped. The CLI integration test requires `pi` on `PATH`.
