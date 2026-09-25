import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const preflight = join(project, "scripts/check-release-version.js");

async function fakeNpm(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const command = join(dir, "npm");
  await writeFile(command, `#!/bin/sh
if [ "$1" = view ]; then
  case "$MOCK_RESULT" in
    published) printf '"%s"\\n' "$MOCK_VERSION"; exit 0 ;;
    missing) printf '{"error":{"code":"E404"}}\\n'; exit 1 ;;
    auth) printf '{"error":{"code":"E401"}}\\n'; exit 1 ;;
    network) printf '{"error":{"code":"EAI_AGAIN"}}\\n'; exit 1 ;;
    malformed) printf '{'; exit 1 ;;
    unexpected) printf '"unexpected"\\n'; exit 0 ;;
    false404) printf '{"error":{"code":"E404"}}\\n'; exit 0 ;;
    signal) kill -TERM $$ ;;
  esac
fi
if [ "$1" = publish ]; then printf 'publish\\n' >> "$MOCK_LOG"; exit 0; fi
exit 2
`);
  await chmod(command, 0o755);
  const { version } = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  return {
    dir,
    log: join(dir, "publish.log"),
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, MOCK_VERSION: version, npm_config_registry: "http://127.0.0.1:1/" },
  };
}

test("release preflight only accepts a confirmed missing version", async t => {
  const mock = await fakeNpm(t);
  for (const [response, allowed] of [["published", false], ["missing", true], ["auth", false], ["network", false], ["malformed", false], ["unexpected", false], ["false404", false], ["signal", false]]) {
    const result = spawnSync(process.execPath, [preflight], {
      cwd: project, encoding: "utf8", timeout: 20000, env: { ...mock.env, MOCK_RESULT: response },
    });
    assert.equal(result.status, allowed ? 0 : 1, `${response}: ${result.stderr}`);
    if (response === "published") assert.match(result.stderr, /already published; update package.json's version/);
  }
});

test("mise release never publishes when the preflight rejects", async t => {
  if (spawnSync("mise", ["--version"], { encoding: "utf8" }).error) return t.skip("mise is not installed");
  const mock = await fakeNpm(t);
  const fixture = join(mock.dir, "fixture");
  await mkdir(join(fixture, "scripts"), { recursive: true });
  await copyFile(preflight, join(fixture, "scripts/check-release-version.js"));
  await copyFile(join(project, "package.json"), join(fixture, "package.json"));
  const config = await readFile(join(project, "mise.toml"), "utf8");
  assert.match(config, /depends = \["check"\]/);
  assert.match(config, /raw = true/);
  assert.match(config, /"node scripts\/check-release-version\.js",\s*"npm publish --access public"/);
  await writeFile(join(fixture, "mise.toml"), config
    .replace('"node scripts/check-release-version.js"', JSON.stringify('PATH="$MOCK_BIN:$PATH" node scripts/check-release-version.js'))
    .replace('"npm publish --access public"', JSON.stringify('printf publish > "$MOCK_LOG"')));
  const env = { ...mock.env, MOCK_BIN: mock.dir, MOCK_LOG: mock.log, MOCK_RESULT: "published", MISE_TRUSTED_CONFIG_PATHS: fixture };
  const blocked = spawnSync("mise", ["run", "--skip-deps", "release"], { cwd: fixture, env, encoding: "utf8", timeout: 20000 });
  assert.notEqual(blocked.status, 0, blocked.stderr);
  assert.match(blocked.stderr, /already published; update package.json's version/);
  await assert.rejects(readFile(mock.log), { code: "ENOENT" });
  const allowed = spawnSync("mise", ["run", "--skip-deps", "release"], { cwd: fixture, env: { ...env, MOCK_RESULT: "missing" }, encoding: "utf8", timeout: 20000 });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(await readFile(mock.log, "utf8"), "publish");
});
