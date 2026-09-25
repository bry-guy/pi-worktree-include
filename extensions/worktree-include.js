import { resolve } from "node:path";
import { Type } from "typebox";
import { copyIgnored } from "../lib/copy-ignored.js";

export default function (pi) {
  pi.registerTool({
    name: "worktree_include",
    label: "Worktree include",
    description: "Copy files selected by .worktreeinclude and ignored by Git from a source checkout into an existing worktree. Never overwrites target files. Call after creating a worktree.",
    parameters: Type.Object({
      target: Type.String({ description: "Path inside the destination worktree" }),
      source: Type.Optional(Type.String({ description: "Path inside the source checkout (defaults to session cwd)" })),
    }),
    async execute(_id, { target, source }, _signal, _update, ctx) {
      const result = await copyIgnored(resolve(ctx.cwd, source ?? "."), resolve(ctx.cwd, target));
      return { content: [{ type: "text", text: `${result.status}${result.copied.length ? `: ${result.copied.join(", ")}` : ""}` }], details: result };
    },
  });

  pi.registerCommand("worktree-include", {
    description: "Copy selected Git-ignored files to an existing worktree: /worktree-include <target> [source]",
    async handler(args, ctx) {
      const [target, source, ...extra] = args.trim().split(/\s+/);
      if (!target || extra.length) throw new Error("Usage: /worktree-include <target> [source]");
      const result = await copyIgnored(resolve(ctx.cwd, source ?? "."), resolve(ctx.cwd, target));
      ctx.ui.notify(result.status, "info");
    },
  });
}
