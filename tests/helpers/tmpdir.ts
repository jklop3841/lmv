import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function makeTempDataDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeTempDataDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}
