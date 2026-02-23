import { z } from "zod";

export const jsonPatchOperationSchema = z
  .object({
    op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
    path: z.string().min(1),
    from: z.string().min(1).optional(),
    value: z.unknown().optional()
  })
  .superRefine((item, ctx) => {
    if ((item.op === "move" || item.op === "copy") && !item.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "move/copy requires from"
      });
    }
    if ((item.op === "add" || item.op === "replace" || item.op === "test") && !("value" in item)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "add/replace/test requires value"
      });
    }
  });

export const jsonPatchSchema = z.array(jsonPatchOperationSchema);
export type JsonPatchInput = z.infer<typeof jsonPatchSchema>;

export const blocksSchema = z
  .object({
    identity: z.unknown(),
    methodology: z.unknown(),
    projects: z.unknown(),
    rules: z.unknown()
  })
  .passthrough();

export const memorySchema = z.object({
  version: z.number().int().nonnegative(),
  blocks: blocksSchema,
  updated_at: z.string().datetime()
});

export const vaultSnapshotSchema = z.object({
  uid: z.string().min(1),
  schema_version: z.number().int().positive(),
  memory: memorySchema,
  snapshot_cursor: z.number().int().nonnegative(),
  updated_at: z.string().datetime()
});

export const ledgerEntrySchema = z.object({
  cursor: z.number().int().positive(),
  ts: z.string().datetime(),
  actor: z.string().min(1),
  base_version: z.number().int().nonnegative(),
  new_version: z.number().int().nonnegative(),
  reason: z.string().min(1),
  auth: z.enum(["none", "token"]).optional(),
  patch: jsonPatchSchema,
  prev_hash: z.string(),
  entry_hash: z.string()
});

export const envelopeSchema = z.object({
  v: z.literal(1),
  kdf: z.object({
    name: z.literal("scrypt"),
    N: z.literal(32768),
    r: z.literal(8),
    p: z.literal(1),
    keylen: z.literal(32),
    salt_b64: z.string().min(1)
  }),
  hkdf: z.object({
    name: z.literal("hkdf-sha256"),
    info: z.enum(["vault", "ledger"])
  }),
  aead: z.object({
    alg: z.literal("aes-256-gcm"),
    iv_b64: z.string().min(1),
    tag_b64: z.string().min(1),
    aad_b64: z.string().min(1)
  }),
  ciphertext_b64: z.string().min(1)
});

export const metaSchema = z.object({
  schema_version: z.literal(1),
  kdf: z.object({
    name: z.literal("scrypt"),
    N: z.literal(32768),
    r: z.literal(8),
    p: z.literal(1),
    keylen: z.literal(32)
  }),
  hkdf: z.object({
    name: z.literal("hkdf-sha256"),
    infos: z.tuple([z.literal("vault"), z.literal("ledger")])
  }),
  envelope_version: z.literal(1),
  updated_at: z.string().datetime()
});
