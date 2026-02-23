import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, acc);
    } else {
      acc.push(p);
    }
  }
}

const root = "dist";
const files = [];

try {
  walk(root, files);
} catch {
  console.error(`[lmv] dist folder not found: ${root}`);
  process.exit(1);
}

const tests = files.filter((p) => p.endsWith(".test.js") || p.endsWith(".spec.js"));

if (tests.length === 0) {
  console.error("[lmv] No test files found under dist/**");
  console.error("[lmv] Hint: ensure TypeScript build emits tests into dist.");
  process.exit(1);
}

console.log(`[lmv] Found ${tests.length} test files`);
const r = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(r.status ?? 1);
