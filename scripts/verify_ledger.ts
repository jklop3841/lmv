import { getConfig } from "../src/config";
import { LMVStorage } from "../src/storage";

async function main(): Promise<void> {
  const config = getConfig();
  const storage = new LMVStorage(config.dataDir, config.passphrase);
  await storage.initialize();

  const ledger = await storage.verifyLedger();
  const state = await storage.getCurrentState();
  console.log(
    JSON.stringify(
      {
        ok: true,
        entries: ledger.entries,
        ledger_cursor: ledger.ledger_cursor,
        snapshot_cursor: state.snapshot_cursor,
        memory_version: state.memory.version
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify_ledger failed: ${message}`);
  process.exit(1);
});
