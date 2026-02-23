import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_NAME;

if (!tag) {
  process.exit(0);
}

if (!tag.startsWith("v")) {
  console.error("Tag must start with v");
  process.exit(1);
}

const tagVersion = tag.slice(1);

if (tagVersion !== pkg.version) {
  console.error(`Version mismatch: tag=${tagVersion} pkg=${pkg.version}`);
  process.exit(1);
}

console.log("Version OK:", tagVersion);
