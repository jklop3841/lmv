import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, SchemaValidationError, UnauthorizedError } from "./errors";
import { jsonPatchSchema, type JsonPatchInput } from "./schema";
import { LMVStorage } from "./storage";

const ledgerQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.string().optional()
});

function parseContentType(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.split(";")[0].trim().toLowerCase();
}

export function createServer(storage: LMVStorage, writeToken?: string) {
  const app = Fastify({
    logger: true
  });
  app.writeToken = writeToken;

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/memory", async (_request, reply) => {
    const state = await storage.getCurrentState();
    const etag = LMVStorage.etagForVersion(state.memory.version);
    reply.header("ETag", etag);
    return {
      memory: state.memory,
      snapshot_cursor: state.snapshot_cursor,
      ledger_cursor: state.ledger_cursor
    };
  });

  app.patch("/v1/memory", async (request: FastifyRequest, reply: FastifyReply) => {
    const authMode = requireWriteAuth(request, app.writeToken);
    if (parseContentType(request.headers["content-type"]) !== "application/json-patch+json") {
      throw new SchemaValidationError("Content-Type must be application/json-patch+json");
    }

    const ifMatch = request.headers["if-match"];
    if (typeof ifMatch !== "string" || ifMatch.trim().length === 0) {
      throw new SchemaValidationError("If-Match header is required");
    }

    const parsedPatch = jsonPatchSchema.safeParse(request.body);
    if (!parsedPatch.success) {
      throw new SchemaValidationError("Invalid JSON Patch body", parsedPatch.error.flatten());
    }

    const actor = String(request.headers["x-lmv-actor"] ?? "unknown");
    const reason = String(request.headers["x-lmv-reason"] ?? "unspecified");

    const result = await storage.patchMemory({
      ifMatchHeader: ifMatch,
      patch: parsedPatch.data as JsonPatchInput,
      actor,
      reason,
      auth: authMode
    });

    const etag = LMVStorage.etagForVersion(result.state.memory.version);
    reply.header("ETag", etag);
    return {
      memory: result.state.memory,
      applied_entry_cursor: result.applied_entry_cursor,
      snapshot_cursor: result.state.snapshot_cursor,
      ledger_cursor: result.state.ledger_cursor
    };
  });

  app.get("/v1/ledger", async (request) => {
    const parsed = ledgerQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new SchemaValidationError("Invalid ledger query", parsed.error.flatten());
    }

    const since = parsed.data.since ? Number.parseInt(parsed.data.since, 10) : 0;
    const limit = parsed.data.limit ? Number.parseInt(parsed.data.limit, 10) : 100;
    if (!Number.isInteger(since) || since < 0) {
      throw new SchemaValidationError("since must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new SchemaValidationError("limit must be a positive integer");
    }

    return storage.getLedger(since, limit);
  });

  app.post("/v1/snapshot", async (request) => {
    requireWriteAuth(request, app.writeToken);
    return storage.snapshot();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      if (error.headers) {
        for (const [k, v] of Object.entries(error.headers)) {
          reply.header(k, v);
        }
      }
      reply.status(error.statusCode).send({
        error: error.message,
        ...((error.details as Record<string, unknown> | undefined) ?? {})
      });
      return;
    }

    requestLogError(error, reply);
    reply.status(500).send({
      error: "Internal server error"
    });
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    writeToken?: string;
  }
}

function requireWriteAuth(
  request: FastifyRequest,
  writeToken: string | undefined
): "none" | "token" {
  if (!writeToken) {
    return "none";
  }
  const header = request.headers.authorization;
  if (typeof header !== "string" || header.length === 0) {
    throw new UnauthorizedError("Missing Authorization header");
  }
  const m = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!m || m[1] !== writeToken) {
    throw new UnauthorizedError("Invalid write token");
  }
  return "token";
}

function requestLogError(error: unknown, reply: FastifyReply): void {
  if (error instanceof Error) {
    reply.log.error({ err: error }, "request failed");
    return;
  }
  reply.log.error({ err: String(error) }, "request failed");
}
