export interface ErrorDetails {
  status?: number | undefined;
  code?: string | undefined;
  apiRequestId?: string | undefined;
  executionId?: string | undefined;
  cause?: unknown;
}

export class AutotiaError extends Error {
  public status?: number | undefined;
  public code?: string | undefined;
  public apiRequestId?: string | undefined;
  public executionId?: string | undefined;

  public constructor(message: string, details: ErrorDetails = {}) {
    super(
      message,
      details.cause !== undefined ? { cause: details.cause } : undefined,
    );
    this.name = new.target.name;
    this.status = details.status;
    this.code = details.code;
    this.apiRequestId = details.apiRequestId;
    this.executionId = details.executionId;
  }
}

export class BadRequestError extends AutotiaError {}
export class AuthenticationError extends AutotiaError {}
export class PermissionDeniedError extends AutotiaError {}
export class NotFoundError extends AutotiaError {}
export class ConflictError extends AutotiaError {}
export class UnprocessableEntityError extends AutotiaError {}
export class QuotaExceededError extends AutotiaError {}
export class RateLimitError extends AutotiaError {}
export class InternalServerError extends AutotiaError {}
export class AutotiaConnectionError extends AutotiaError {}
export class WaiterTimeoutError extends AutotiaError {}
export class ValuationFailedError extends AutotiaError {}

export function makeHttpError(
  status: number,
  envelope?: unknown,
  bodyText?: string,
): AutotiaError {
  let code: string | undefined;
  let description: string | undefined;
  let apiRequestId: string | undefined;
  let executionId: string | undefined;

  if (envelope && typeof envelope === "object") {
    const env = envelope as Record<string, unknown>;
    if (typeof env.apiRequestId === "string") apiRequestId = env.apiRequestId;
    if (typeof env.executionId === "string") executionId = env.executionId;
    if (env.error && typeof env.error === "object") {
      const err = env.error as Record<string, unknown>;
      if (typeof err.code === "string") code = err.code;
      if (typeof err.description === "string") description = err.description;
    }
  }

  const message =
    description ??
    (bodyText && bodyText.trim().length > 0
      ? bodyText.trim()
      : "La API devolvió un error HTTP.");
  const details: ErrorDetails = {
    status,
    code,
    apiRequestId,
    executionId,
  };

  if (status === 400) return new BadRequestError(message, details);
  if (status === 401) return new AuthenticationError(message, details);
  if (status === 403) return new PermissionDeniedError(message, details);
  if (status === 404) return new NotFoundError(message, details);
  if (status === 409) return new ConflictError(message, details);
  if (status === 422) return new UnprocessableEntityError(message, details);
  if (status === 429) {
    if (code === "quota_exceeded" || code === "company_quota_exceeded") {
      return new QuotaExceededError(message, details);
    }
    return new RateLimitError(message, details);
  }
  if (status === 503 || status === 504)
    return new InternalServerError(message, details);
  return new AutotiaError(message, details);
}
