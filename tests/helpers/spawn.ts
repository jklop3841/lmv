import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { waitForHealth } from "./http";

export interface SpawnedServer {
  process: ChildProcessByStdio<null, Readable, Readable>;
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function startServer(params: {
  workdir: string;
  port: number;
  dataDir: string;
  passphrase: string;
  writeToken?: string;
}): Promise<SpawnedServer> {
  const baseUrl = `http://127.0.0.1:${params.port}`;
  const child = spawn(
    process.execPath,
    [path.join(params.workdir, "dist", "src", "index.js")],
    {
      cwd: params.workdir,
      env: {
        ...process.env,
        LMV_PASSPHRASE: params.passphrase,
        LMV_PORT: String(params.port),
        LMV_DATA_DIR: params.dataDir,
        LMV_WRITE_TOKEN: params.writeToken ?? ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let startupError = "";
  child.stderr.on("data", (chunk) => {
    startupError += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl, 10000);
  } catch (error) {
    await stopProcess(child);
    throw new Error(
      `Failed to start server at ${baseUrl}. ${error instanceof Error ? error.message : String(error)} ${startupError}`
    );
  }

  return {
    process: child,
    baseUrl,
    stop: async () => stopProcess(child)
  };
}

async function stopProcess(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
