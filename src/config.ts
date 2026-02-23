import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  LMV_PASSPHRASE: z.string().min(1),
  PORT: z.string().optional(),
  LMV_PORT: z.string().optional(),
  DATA_DIR: z.string().optional(),
  LMV_DATA_DIR: z.string().optional(),
  LMV_WRITE_TOKEN: z.string().optional()
});

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  passphrase: string;
  writeToken?: string;
}

export function getConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("LMV_PASSPHRASE is required. Refusing to start.");
  }

  const portRaw = parsed.data.LMV_PORT ?? parsed.data.PORT ?? "8787";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    host: "0.0.0.0",
    port,
    dataDir:
      parsed.data.LMV_DATA_DIR || parsed.data.DATA_DIR
        ? path.resolve(parsed.data.LMV_DATA_DIR ?? parsed.data.DATA_DIR ?? "data")
        : path.resolve(process.cwd(), "data"),
    passphrase: parsed.data.LMV_PASSPHRASE,
    writeToken: parsed.data.LMV_WRITE_TOKEN
  };
}
