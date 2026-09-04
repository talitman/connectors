export interface BackoffPolicy {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
  /** Fraction of the delay used as +/- jitter, 0..1. */
  jitter?: number;
  random?: () => number;
}

export interface Backoff {
  /** Delay in ms before the given 1-based attempt. */
  delayFor(attempt: number): number;
}

export function exponentialBackoff(policy: BackoffPolicy = {}): Backoff {
  const initial = policy.initialMs ?? 1000;
  const max = policy.maxMs ?? 60_000;
  const factor = policy.factor ?? 2;
  const jitter = policy.jitter ?? 0.2;
  const random = policy.random ?? Math.random;
  return {
    delayFor(attempt) {
      const exponent = Math.max(0, attempt - 1);
      const base = Math.min(max, initial * factor ** exponent);
      const spread = base * jitter;
      const jittered = base - spread + random() * 2 * spread;
      return Math.min(max, Math.round(jittered));
    },
  };
}
