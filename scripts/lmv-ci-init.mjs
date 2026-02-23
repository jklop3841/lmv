import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflows = join(root, ".github", "workflows");
mkdirSync(workflows, { recursive: true });

const releasePath = join(workflows, "release.yml");
if (!existsSync(releasePath)) {
  writeFileSync(
    releasePath,
    [
      "name: lmv-release",
      "",
      "on:",
      "  push:",
      "    tags:",
      "      - \"v*.*.*\"",
      "",
      "permissions:",
      "  contents: read",
      "",
      "jobs:",
      "  publish:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 20",
      "    steps:",
      "      - name: Checkout",
      "        uses: actions/checkout@v4",
      "      - name: Setup Node",
      "        uses: actions/setup-node@v4",
      "        with:",
      "          node-version: \"20\"",
      "          registry-url: \"https://registry.npmjs.org\"",
      "          cache: \"npm\"",
      "      - name: Install",
      "        run: npm ci",
      "      - name: Test",
      "        run: npm test",
      "      - name: Build",
      "        run: npm run build",
      "      - name: Verify version",
      "        run: node scripts/assert-version.mjs",
      "      - name: Verify dist exists",
      "        run: |",
      "          if [ ! -d dist ]; then",
      "            echo \"dist missing\"",
      "            exit 1",
      "          fi",
      "      - name: Publish (dry-run)",
      "        run: npm publish --dry-run",
      ""
    ].join("\n"),
    "utf8"
  );
}

console.log("lmv-ci-init completed");
