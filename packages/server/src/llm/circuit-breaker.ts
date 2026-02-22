/**
 * Circuit breaker for LLM provider calls.
 *
 * Three states:
 *   CLOSED  → normal operation, requests flow through
 *   OPEN    → provider is failing, reject immediately
 *   HALF_OPEN → timeout elapsed, allow one test request
 *
 * Keyed by provider string (e.g. "anthropic", "openai").
 */

enum CircuitState {
  Closed = "CLOSED",
  Open = "OPEN",
  HalfOpen = "HALF_OPEN",
}

class CircuitBreaker {
  private state = CircuitState.Closed;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;

  constructor(failureThreshold = 3, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = CircuitState.Closed;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = CircuitState.Open;
    }
  }

  canAttempt(): boolean {
    if (this.state === CircuitState.Closed) return true;

    if (this.state === CircuitState.Open) {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HalfOpen;
        return true;
      }
      return false;
    }

    // HalfOpen — allow one test request
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /** Milliseconds until the circuit will transition from OPEN to HALF_OPEN, or 0 if not open */
  get remainingCooldownMs(): number {
    if (this.state !== CircuitState.Open) return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.resetTimeoutMs - elapsed);
  }
}

// Singleton registry
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(provider: string): CircuitBreaker {
  let breaker = breakers.get(provider);
  if (!breaker) {
    breaker = new CircuitBreaker();
    breakers.set(provider, breaker);
  }
  return breaker;
}

export function isProviderAvailable(provider: string): boolean {
  return getCircuitBreaker(provider).canAttempt();
}
