import { getConfig } from "./config";
import { LMVStorage } from "./storage";
import { createServer } from "./server";

async function main(): Promise<void> {
  const config = getConfig();
  const storage = new LMVStorage(config.dataDir, config.passphrase);
  await storage.initialize();

  const app = createServer(storage, config.writeToken);
  await app.listen({
    host: config.host,
    port: config.port
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal startup error: ${message}`);
  process.exit(1);
});
