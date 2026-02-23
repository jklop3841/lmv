import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  type BinaryLike
} from "node:crypto";
import { SchemaValidationError, StorageCorruptionError } from "./errors";
import { envelopeSchema } from "./schema";
import type { AADContext, EnvelopeV1 } from "./types";

const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 32
} as const;

function toBase64(value: Buffer): string {
  return value.toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function aadToBuffer(context: AADContext): Buffer {
  return Buffer.from(JSON.stringify(context), "utf8");
}

function decodeAAD(aadB64: string): AADContext {
  const raw = fromBase64(aadB64).toString("utf8");
  return JSON.parse(raw) as AADContext;
}

async function deriveRecordKey(
  passphrase: string,
  salt: Buffer,
  info: "vault" | "ledger"
): Promise<Buffer> {
  const master = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      passphrase as BinaryLike,
      salt as BinaryLike,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: 256 * 1024 * 1024
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(derivedKey));
      }
    );
  });

  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(info, "utf8"), 32));
}

export async function encryptEnvelope(
  payload: unknown,
  passphrase: string,
  info: "vault" | "ledger",
  aadContext: AADContext
): Promise<EnvelopeV1> {
  const salt = randomBytes(16);
  const key = await deriveRecordKey(passphrase, salt, info);
  const iv = randomBytes(12);
  const aad = aadToBuffer(aadContext);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    kdf: {
      name: "scrypt",
      N: 32768,
      r: 8,
      p: 1,
      keylen: 32,
      salt_b64: toBase64(salt)
    },
    hkdf: {
      name: "hkdf-sha256",
      info
    },
    aead: {
      alg: "aes-256-gcm",
      iv_b64: toBase64(iv),
      tag_b64: toBase64(tag),
      aad_b64: toBase64(aad)
    },
    ciphertext_b64: toBase64(ciphertext)
  };
}

export async function decryptEnvelope(
  rawEnvelope: unknown,
  passphrase: string,
  expectedInfo: "vault" | "ledger"
): Promise<{ payload: unknown; aad: AADContext; envelope: EnvelopeV1 }> {
  const parsed = envelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) {
    throw new SchemaValidationError("Invalid envelope format", parsed.error.flatten());
  }
  const envelope = parsed.data;

  if (envelope.hkdf.info !== expectedInfo) {
    throw new StorageCorruptionError("Envelope hkdf.info mismatch");
  }

  const salt = fromBase64(envelope.kdf.salt_b64);
  const key = await deriveRecordKey(passphrase, salt, envelope.hkdf.info);
  const iv = fromBase64(envelope.aead.iv_b64);
  const tag = fromBase64(envelope.aead.tag_b64);
  const aad = fromBase64(envelope.aead.aad_b64);
  const ciphertext = fromBase64(envelope.ciphertext_b64);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return {
      payload: JSON.parse(plaintext),
      aad: decodeAAD(envelope.aead.aad_b64),
      envelope
    };
  } catch (error) {
    throw new StorageCorruptionError("Failed to decrypt envelope", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}
