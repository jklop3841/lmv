import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getConfig } from "../src/config";
import { LMVStorage } from "../src/storage";
import type { LmvMeta } from "../src/types";

const envSchema = z.object({
  LMV_NEW_PASSPHRASE: z.string().min(1)
});

function suffix(): string {
  return `${Date.now()}_${randomBytes(4).toString("hex")}`;
}

async function exists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function safeCleanupDir(dirPath: string): Promise<void> {
  if (await exists(dirPath)) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const parsedEnv = envSchema.safeParse(process.env);
  if (!parsedEnv.success) {
    throw new Error("LMV_NEW_PASSPHRASE is required");
  }
  const oldPassphrase = config.passphrase;
  const newPassphrase = parsedEnv.data.LMV_NEW_PASSPHRASE;
  if (oldPassphrase === newPassphrase) {
    throw new Error("LMV_NEW_PASSPHRASE must be different from LMV_PASSPHRASE");
  }

  const storageOld = new LMVStorage(config.dataDir, oldPassphrase);
  await storageOld.initialize();

  // Validate and load current plaintext state first.
  const snapshot = await storageOld.readVaultPlain();
  const ledgerEntries = await storageOld.readLedgerPlain();
  const oldMeta = await storageOld.readMeta();
  await storageOld.verifyLedger();
  await storageOld.getCurrentState();

  const rotatedMeta: LmvMeta = {
    ...oldMeta,
    updated_at: new Date().toISOString()
  };

  const runId = suffix();
  const stageDir = path.join(config.dataDir, `.reencrypt_stage_${runId}`);
  await fs.mkdir(stageDir, { recursive: true });
  const storageStage = new LMVStorage(stageDir, newPassphrase);
  await storageStage.rewriteEncryptedData(snapshot, ledgerEntries, rotatedMeta);
  await storageStage.verifyLedger();
  await storageStage.getCurrentState();

  const files = ["vault.enc", "ledger.jsonl.enc", "meta.json"];
  const backupMap = new Map<string, string>();
  let swapped = false;

  try {
    for (const file of files) {
      const src = path.join(config.dataDir, file);
      const bak = path.join(config.dataDir, `${file}.bak.${runId}`);
      if (await exists(src)) {
        await fs.rename(src, bak);
        backupMap.set(file, bak);
      }
    }

    for (const file of files) {
      const staged = path.join(stageDir, file);
      const dst = path.join(config.dataDir, file);
      await fs.rename(staged, dst);
    }
    swapped = true;

    const storageNew = new LMVStorage(config.dataDir, newPassphrase);
    await storageNew.verifyLedger();
    await storageNew.getCurrentState();

    for (const bakPath of backupMap.values()) {
      if (await exists(bakPath)) {
        await fs.unlink(bakPath);
      }
    }
  } catch (error) {
    if (swapped) {
      for (const file of files) {
        const dst = path.join(config.dataDir, file);
        if (await exists(dst)) {
          await fs.unlink(dst);
        }
      }
    }
    for (const [file, bakPath] of backupMap.entries()) {
      const dst = path.join(config.dataDir, file);
      if (await exists(bakPath)) {
        await fs.rename(bakPath, dst);
      }
    }
    throw error;
  } finally {
    await safeCleanupDir(stageDir);
  }

  console.log("Re-encryption completed and verified.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`reencrypt failed: ${message}`);
  process.exit(1);
});
