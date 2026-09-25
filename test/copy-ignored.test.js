import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { copyIgnored } from "../lib/copy-ignored.js";

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

async function fixtures(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-worktree-include-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "source");
  const target = join(dir, "target");
  await mkdir(source);
  git(source, "init", "-q", "-b", "main");
  await writeFile(join(source, ".gitignore"), "*.env\nprivate/\n");
  await writeFile(join(source, "tracked.txt"), "tracked");
  git(source, "add", ".gitignore", "tracked.txt");
  git(source, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial");
  git(source, "worktree", "add", "-qb", "feature", target);
  return { dir, source, target };
}

test("missing manifest is a no-op; copies selected ignored files, not tracked/unignored files", async t => {
  const { source, target } = await fixtures(t);
  assert.deepEqual((await copyIgnored(source, target)).copied, []);
  await writeFile(join(source, ".worktreeinclude"), "*.env\ntracked.txt\nplain.txt\n");
  await writeFile(join(source, "a.env"), "source");
  await writeFile(join(source, "plain.txt"), "unignored");
  assert.deepEqual((await copyIgnored(source, target)).copied, ["a.env"]);
  assert.equal(await readFile(join(target, "a.env"), "utf8"), "source");
  await writeFile(join(source, "a.env"), "changed");
  assert.deepEqual((await copyIgnored(source, target)).skipped, ["a.env"]);
  assert.equal(await readFile(join(target, "a.env"), "utf8"), "source");
});

test("Gitignore-style nested patterns and negations filter source ignored files", async t => {
  const { source, target } = await fixtures(t);
  await mkdir(join(source, "private", "nested"), { recursive: true });
  await writeFile(join(source, ".worktreeinclude"), "private/*\n!private/skip.env\nprivate/nested/*.env\n");
  await writeFile(join(source, "private", "a.env"), "one");
  await writeFile(join(source, "private", "skip.env"), "two");
  await writeFile(join(source, "private", "nested", "b.env"), "three");
  const { copied } = await copyIgnored(source, target);
  assert.deepEqual(copied.sort(), ["private/a.env", "private/nested/b.env"]);
});

test("preserves destinations including tracked files deleted from target", async t => {
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".worktreeinclude"), "*.env\ntracked.txt\n");
  await writeFile(join(source, "a.env"), "source");
  await writeFile(join(target, "a.env"), "target");
  await rm(join(target, "tracked.txt"));
  const { copied, skipped } = await copyIgnored(source, target);
  assert.deepEqual(copied, []);
  assert.deepEqual(skipped, ["a.env"]);
  assert.equal(await readFile(join(target, "a.env"), "utf8"), "target");
  await assert.rejects(readFile(join(target, "tracked.txt")), { code: "ENOENT" });
});

test("rejects unrelated repos, symlinked source files, symlinked target parents", async t => {
  const { dir, source, target } = await fixtures(t);
  const other = join(dir, "other");
  await mkdir(other);
  git(other, "init", "-q");
  await assert.rejects(copyIgnored(source, other), /same repository/);
  await writeFile(join(source, ".worktreeinclude"), "*.env\nprivate/*\n");
  await writeFile(join(dir, "outside.env"), "secret");
  await symlink(join(dir, "outside.env"), join(source, "outside.env"));
  await assert.rejects(copyIgnored(source, target), /Source symlink is not supported/);
  await rm(join(source, "outside.env"));
  await mkdir(join(source, "private"));
  await writeFile(join(source, "private", "inside.env"), "source");
  await symlink(dir, join(target, "private"));
  await assert.rejects(copyIgnored(source, target), /Destination parent is not a directory/);
  await assert.rejects(readFile(join(dir, "inside.env")), { code: "ENOENT" });
});

test("does not recreate files or ancestors tracked only in target", async t => {
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".worktreeinclude"), "private/*\n*.env\n");
  await mkdir(join(source, "private"));
  await writeFile(join(source, "private", "a.env"), "source");
  await writeFile(join(source, "target.env"), "source");
  await writeFile(join(target, "private"), "tracked parent");
  await writeFile(join(target, "target.env"), "tracked target");
  git(target, "add", "-f", "private", "target.env");
  git(target, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "target files");
  await rm(join(target, "private"));
  await rm(join(target, "target.env"));
  assert.deepEqual((await copyIgnored(source, target)).copied, []);
  await assert.rejects(readFile(join(target, "private")), { code: "ENOENT" });
  await assert.rejects(readFile(join(target, "target.env")), { code: "ENOENT" });
});

test("does not replace target-tracked descendants with a source file", async t => {
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".gitignore"), "config\n");
  await writeFile(join(source, ".worktreeinclude"), "config\n");
  await writeFile(join(source, "config"), "source");
  await mkdir(join(target, "config"));
  await writeFile(join(target, "config", "local.json"), "tracked");
  git(target, "add", "config/local.json");
  git(target, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "tracked descendant");
  await rm(join(target, "config"), { recursive: true });
  assert.deepEqual((await copyIgnored(source, target)).copied, []);
  await assert.rejects(readFile(join(target, "config")), { code: "ENOENT" });
});

test("registered tool resolves relative paths from the session cwd", async t => {
  const piRoot = process.env.PI_CODING_AGENT_ROOT;
  if (!piRoot) return t.skip("Set PI_CODING_AGENT_ROOT to the installed Pi package for the callback smoke test");
  const { createJiti } = createRequire(join(piRoot, "package.json"))("jiti");
  const requirePi = createRequire(join(piRoot, "package.json"));
  const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "../extensions/worktree-include.js");
  const extension = await createJiti(join(piRoot, "package.json"), { alias: { typebox: requirePi.resolve("typebox") } }).import(extensionPath, { default: true });
  let tool;
  extension({ registerTool: registered => { tool = registered; }, registerCommand() {} });
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".worktreeinclude"), "*.env\n");
  await writeFile(join(source, "local.env"), "synthetic");
  const result = await tool.execute("test", { target: "../target", source: "." }, undefined, undefined, { cwd: source });
  assert.deepEqual(result.details.copied, ["local.env"]);
  assert.equal(await readFile(join(target, "local.env"), "utf8"), "synthetic");
});

test("Pi loads and executes the slash command with relative paths", async t => {
  if (spawnSync("pi", ["--version"], { encoding: "utf8" }).error) return t.skip("Pi CLI is not on PATH");
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".worktreeinclude"), "*.env\n");
  await writeFile(join(source, "local.env"), "synthetic");
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync("pi", ["--no-extensions", "--no-skills", "--offline", "-e", packagePath, "--print", "/worktree-include ../target ."], {
    cwd: source, encoding: "utf8", timeout: 45000, env: { ...process.env, PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(target, "local.env"), "utf8"), "synthetic");
});

test("rejects nested destination Git metadata", async t => {
  const { source, target } = await fixtures(t);
  await writeFile(join(source, ".worktreeinclude"), "private/*\n");
  await mkdir(join(source, "private"));
  await writeFile(join(source, "private", "a.env"), "source");
  await mkdir(join(target, "private"));
  git(join(target, "private"), "init", "-q");
  await assert.rejects(copyIgnored(source, target), /Nested repository/);
});
