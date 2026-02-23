import { getConfig } from "../src/config";
import type { JsonPatchInput } from "../src/schema";
import { LMVStorage } from "../src/storage";

interface CliOptions {
  force: boolean;
  acknowledged: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    force: argv.includes("--force"),
    acknowledged: argv.includes("--i-know-what-i-am-doing")
  };
}

function buildSeedBlocks() {
  return {
    identity: {
      name: "LMV Seed Identity",
      purpose: "Local encrypted memory vault"
    },
    methodology: {
      principles: ["versioned-memory", "append-only-ledger", "encrypted-at-rest"]
    },
    projects: {
      active: []
    },
    rules: {
      security: ["passphrase-from-env-only", "snapshot-and-ledger-encrypted"]
    }
  };
}

function makeSeedPatch(
  currentBlocks: Record<string, unknown>,
  nextBlocks: Record<string, unknown>
): JsonPatchInput {
  const ops: JsonPatchInput = [];
  for (const [key, value] of Object.entries(nextBlocks)) {
    const path = `/${key}`;
    if (Object.prototype.hasOwnProperty.call(currentBlocks, key)) {
      ops.push({ op: "replace", path, value });
    } else {
      ops.push({ op: "add", path, value });
    }
  }
  return ops;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const storage = new LMVStorage(config.dataDir, config.passphrase);
  await storage.initialize();
  const state = await storage.getCurrentState();
  const seed = buildSeedBlocks();

  const same = JSON.stringify(state.memory.blocks) === JSON.stringify(seed);
  if (same) {
    console.log("Seed already applied. No changes.");
    return;
  }

  const emptyVersion = state.memory.version === 0;
  if (!emptyVersion && !options.force) {
    console.log("Memory already initialized. Use --force --i-know-what-i-am-doing to overwrite seed blocks.");
    return;
  }

  if (options.force && !options.acknowledged) {
    throw new Error("Forced overwrite requires --i-know-what-i-am-doing");
  }

  const patch = makeSeedPatch(
    state.memory.blocks as Record<string, unknown>,
    seed as Record<string, unknown>
  );
  const ifMatch = LMVStorage.etagForVersion(state.memory.version);
  const result = await storage.patchMemory({
    ifMatchHeader: ifMatch,
    patch,
    actor: "init_seed",
    reason: options.force ? "force-seed-overwrite" : "initial-seed",
    auth: "none"
  });
  console.log(
    `Seed applied. new_version=${result.state.memory.version} entry_cursor=${result.applied_entry_cursor}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`init_seed failed: ${message}`);
  process.exit(1);
});
