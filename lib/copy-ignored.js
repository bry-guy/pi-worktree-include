import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function root(path) {
  return (await git(path, "rev-parse", "--show-toplevel")).toString().trim();
}

async function commonDir(path) {
  const raw = (await git(path, "rev-parse", "--git-common-dir")).toString().trim();
  return realpath(resolve(path, raw));
}

function files(output) {
  return new Set(output.toString().split("\0").filter(Boolean));
}

async function stat(path) {
  return lstat(path).catch(error => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export async function copyIgnored(sourcePath, targetPath) {
  const source = await realpath(await root(resolve(sourcePath)));
  const target = await realpath(await root(resolve(targetPath)));
  if (source === target || await commonDir(source) !== await commonDir(target)) {
    throw new Error("Source and target must be distinct worktrees of the same repository");
  }

  const manifest = join(source, ".worktreeinclude");
  const manifestStat = await stat(manifest);
  if (!manifestStat) return { copied: [], status: "No .worktreeinclude in source checkout" };
  if (!manifestStat.isFile()) throw new Error(".worktreeinclude must be a regular file");

  const selected = files(await git(source, "ls-files", "-o", "-i", "-z", `--exclude-from=${manifest}`));
  const ignored = files(await git(source, "ls-files", "-o", "-i", "-z", "--exclude-standard"));
  const trackedTarget = files(await git(target, "ls-files", "-c", "-z"));
  const planned = [];
  const skipped = [];

  for (const name of selected) {
    if (!ignored.has(name)) continue;
    if (isAbsolute(name) || name.split(/[\\/]/).some(part => part === ".." || part === ".git") || name.includes("\\")) throw new Error(`Invalid include path: ${name}`);
    const from = join(source, name);
    const to = join(target, name);
    if (!relative(source, from) || relative(source, from).startsWith(`..${sep}`)) throw new Error(`Invalid include path: ${name}`);
    if (trackedTarget.has(name) || [...trackedTarget].some(path => path.startsWith(`${name}/`) || name.startsWith(`${path}/`))) continue;
    const sourceStat = await stat(from);
    if (sourceStat?.isSymbolicLink()) throw new Error(`Source symlink is not supported: ${name}`);
    if (!sourceStat?.isFile()) continue;
    if ((await realpath(from)) !== from) throw new Error(`Source escapes checkout: ${name}`);

    let parent = dirname(to);
    while (parent !== target) {
      if (await stat(join(source, relative(target, parent), ".git")) || await stat(join(parent, ".git"))) {
        throw new Error(`Nested repository is not supported: ${name}`);
      }
      const parentStat = await stat(parent);
      if (parentStat && !parentStat.isDirectory()) throw new Error(`Destination parent is not a directory: ${name}`);
      parent = dirname(parent);
    }
    if (await stat(to)) {
      skipped.push(name);
      continue;
    }
    planned.push({ name, from, to });
  }

  for (const { from, to } of planned) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to, constants.COPYFILE_EXCL);
  }
  return { copied: planned.map(({ name }) => name), skipped, status: `${planned.length} file(s) copied, ${skipped.length} existing file(s) skipped` };
}
