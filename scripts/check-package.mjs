import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "resource-cache-package-"));
try {
  const [archive] = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const shipped = new Set(archive.files.map((file) => file.path));
  for (const file of ["index", "oomol"]) {
    for (const extension of ["mjs", "cjs", "d.mts", "d.cts"]) assert(shipped.has(`dist/${file}.${extension}`));
  }
  assert(!archive.files.some((file) => file.path.startsWith("test/") || file.path.endsWith(".test.ts")));

  const packageDir = join(temporary, "node_modules", "@oomol-lab", "resource-cache");
  await mkdir(packageDir, { recursive: true });
  execFileSync("tar", ["-xzf", join(temporary, archive.filename), "-C", packageDir, "--strip-components=1"]);
  await symlink(join(root, "node_modules", "idb-keyval"), join(temporary, "node_modules", "idb-keyval"));

  const fixture = (await readFile(join(root, "test", "public-types.ts"), "utf8"))
    .replaceAll('"../src/index"', '"@oomol-lab/resource-cache"')
    .replaceAll('"../src/oomol"', '"@oomol-lab/resource-cache/oomol"');
  await writeFile(join(temporary, "consumer.mts"), fixture);
  await writeFile(join(temporary, "consumer.cts"), fixture);
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ESNext",
      "--lib",
      "ESNext,DOM",
      "consumer.mts",
      "consumer.cts",
    ],
    { cwd: temporary, stdio: "pipe" },
  );

  await writeFile(
    join(temporary, "smoke.mjs"),
    `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as esm from "@oomol-lab/resource-cache";
import * as oomol from "@oomol-lab/resource-cache/oomol";
const require = createRequire(import.meta.url);
const cjs = require("@oomol-lab/resource-cache");
assert.deepEqual(Object.keys(oomol), []);
assert.deepEqual(Object.keys(require("@oomol-lab/resource-cache/oomol")), []);
for (const api of [esm, cjs]) {
  assert.deepEqual(Object.keys(api).sort(), ["createPersistentCache", "createSessionCache"]);
  const options = { namespace: "smoke", schemaVersion: 1, maxAge: 100, key: query => query, decode: value => value,
    load: async query => ({ modified: true, data: query, etag: null }) };
  const persistent = api.createPersistentCache(options);
  assert.equal(await persistent.get("loaded without browser storage"), "loaded without browser storage");
  await persistent.dispose();
  const session = api.createSessionCache({ ...options, sessionId: "login" });
  assert.equal(await session.get("session memory"), "session memory");
  await assert.rejects(session.dispose());
}
`,
  );
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: temporary, stdio: "pipe" });
  console.log("Packed ESM/CJS entrypoints, declarations, type-only OOMOL exports and storage-free loading passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
