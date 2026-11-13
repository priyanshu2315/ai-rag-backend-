export const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 120_000;

// How long to wait before retrying a rate-limited (429) request, or null when the
// error is not a retryable rate limit. Gemini states the delay in the message
// ("Please retry in 54.9s") or in RetryInfo; other providers send Retry-After.
export function rateLimitWaitMs(error) {
  if (error?.status !== 429) return null;
  const details =
    (error.message ?? "") + " " + JSON.stringify(error.error ?? "");
  // A daily quota (Gemini "PerDay", Groq "tokens per day (TPD)") will not reset in time.
  if (/PerDay|per day|\bTPD\b|\bRPD\b/i.test(details)) return null;
  const stated =
    details.match(/retry in ([\d.]+)\s*s/i)?.[1] ??
    details.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)?.[1];
  const header =
    error.headers?.get?.("retry-after") ?? error.headers?.["retry-after"];
  const seconds =
    stated != null ? Number(stated) : header != null ? Number(header) : 60;
  return Math.min(
    Math.ceil((Number.isFinite(seconds) ? seconds : 60) * 1000) + 1000,
    MAX_RATE_LIMIT_WAIT_MS,
  );
}

// Sends a model request; a per-minute rate limit waits as long as the provider asks
// and retries, at most MAX_RATE_LIMIT_RETRIES times. A daily quota fails at once.
export async function withRateLimitRetry(send, onRateLimited = () => { }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const waitMs = rateLimitWaitMs(error);
      if (waitMs == null || attempt > MAX_RATE_LIMIT_RETRIES) throw error;
      await onRateLimited({ attempt, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
