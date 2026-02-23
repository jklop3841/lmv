export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly headers?: Record<string, string>;

  constructor(
    message: string,
    statusCode: number,
    details?: unknown,
    headers?: Record<string, string>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.headers = headers;
  }
}

export class SchemaValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, currentETag: string) {
    super(message, 409, { current_etag: currentETag }, { ETag: currentETag });
  }
}

export class PatchApplyError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(message, 422, details);
  }
}

export class StorageCorruptionError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(message, 500, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super(message, 401);
  }
}
