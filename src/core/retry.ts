import type { CallOptions } from "./types.js";

export interface RetrySettings {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function getRetrySettings(
  options?: CallOptions,
  clientMaxRetries = 2,
): RetrySettings {
  return {
    maxRetries:
      options?.maxRetries !== undefined ? options.maxRetries : clientMaxRetries,
    baseDelayMs: 100,
    maxDelayMs: 10000,
  };
}

export function retryDelay(
  retryCount: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** retryCount);
  return Math.floor(random() * (ceiling + 1));
}

export function retryAfterDelay(
  value: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  const parsed =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Date.parse(value) - now;
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(10000, parsed)
    : undefined;
}

export function isTransient(error: Error): boolean {
  const name = error.name;
  return (
    name === "RateLimitError" ||
    name === "InternalServerError" ||
    name === "AutotiaConnectionError"
  );
}
