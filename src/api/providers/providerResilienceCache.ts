export interface ProviderResilienceOptions {
  successTtlMs: number;
  failureBaseBackoffMs: number;
  failureMaxBackoffMs: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface FailureEntry {
  count: number;
  nextRetryAt: number;
}

export class ProviderResilienceCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly failures = new Map<string, FailureEntry>();

  constructor(private readonly options: ProviderResilienceOptions) {}

  getFresh(key: string, now: number = Date.now()): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt > now) {
      return entry.value;
    }
    return undefined;
  }

  getAny(key: string): T | undefined {
    return this.cache.get(key)?.value;
  }

  canAttempt(key: string, now: number = Date.now()): boolean {
    const failure = this.failures.get(key);
    if (!failure) {
      return true;
    }
    return now >= failure.nextRetryAt;
  }

  onSuccess(key: string, value: T, now: number = Date.now()): void {
    this.cache.set(key, {
      value,
      expiresAt: now + this.options.successTtlMs,
    });
    this.failures.delete(key);
  }

  onFailure(key: string, now: number = Date.now()): void {
    const prev = this.failures.get(key);
    const count = (prev?.count ?? 0) + 1;
    const delay = Math.min(
      this.options.failureMaxBackoffMs,
      this.options.failureBaseBackoffMs * Math.pow(2, count - 1)
    );
    this.failures.set(key, {
      count,
      nextRetryAt: now + delay,
    });
  }
}
