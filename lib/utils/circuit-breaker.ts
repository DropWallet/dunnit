/**
 * Circuit Breaker Pattern for Steam API
 * 
 * Prevents hammering a failing API during outages (e.g., Steam maintenance).
 * Trips after consecutive 5xx errors and stops all API calls for a cooldown period.
 * 
 * This protects:
 * - Server's outgoing socket pool
 * - API key reputation
 * - Prevents cascading failures during Steam outages
 */

export interface CircuitBreakerState {
  isOpen: boolean; // Circuit is open (tripped) - reject all requests
  failureCount: number; // Consecutive 5xx errors
  lastFailureTime: Date | null; // When circuit was last tripped
  cooldownMs: number; // How long to wait before attempting again
}

class SteamAPICircuitBreaker {
  private state: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: null,
    cooldownMs: 5 * 60 * 1000, // 5 minutes default cooldown
  };

  private readonly FAILURE_THRESHOLD = 5; // Trip after 5 consecutive 5xx errors
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

  /**
   * Check if circuit is open (tripped)
   * If cooldown period has passed, attempt to close the circuit
   */
  isCircuitOpen(): boolean {
    if (!this.state.isOpen) {
      return false;
    }

    // Check if cooldown period has passed
    if (this.state.lastFailureTime) {
      const timeSinceFailure = Date.now() - this.state.lastFailureTime.getTime();
      if (timeSinceFailure >= this.COOLDOWN_MS) {
        // Cooldown passed - close circuit and reset
        console.log('[Circuit Breaker] ⚡ Cooldown period passed, closing circuit');
        this.reset();
        return false;
      }
    }

    return true;
  }

  /**
   * Record a successful API call
   * Resets failure count and closes circuit if open
   */
  recordSuccess(): void {
    if (this.state.failureCount > 0) {
      console.log(`[Circuit Breaker] ✅ Success recorded, resetting failure count (was ${this.state.failureCount})`);
      this.state.failureCount = 0;
    }
    
    if (this.state.isOpen) {
      console.log('[Circuit Breaker] ✅ Circuit closed after successful call');
      this.state.isOpen = false;
      this.state.lastFailureTime = null;
    }
  }

  /**
   * Record a 5xx error (server error)
   * Increments failure count and trips circuit if threshold reached
   */
  recordFailure(): void {
    this.state.failureCount++;
    
    if (this.state.failureCount >= this.FAILURE_THRESHOLD) {
      if (!this.state.isOpen) {
        console.log(`[Circuit Breaker] 🔴 Circuit OPENED after ${this.state.failureCount} consecutive 5xx errors`);
        this.state.isOpen = true;
        this.state.lastFailureTime = new Date();
      }
    } else {
      console.log(`[Circuit Breaker] ⚠️ Failure recorded (${this.state.failureCount}/${this.FAILURE_THRESHOLD} before trip)`);
    }
  }

  /**
   * Record a non-5xx error (client error, network error, etc.)
   * These don't count toward circuit trip (only 5xx server errors do)
   */
  recordNonServerError(): void {
    // Non-5xx errors don't trip the circuit
    // But we still reset on success to allow recovery
  }

  /**
   * Reset circuit breaker state
   */
  reset(): void {
    this.state = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: null,
      cooldownMs: this.COOLDOWN_MS,
    };
  }

  /**
   * Get current state (for debugging/monitoring)
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

// Singleton instance
let circuitBreaker: SteamAPICircuitBreaker | null = null;

export function getCircuitBreaker(): SteamAPICircuitBreaker {
  if (!circuitBreaker) {
    circuitBreaker = new SteamAPICircuitBreaker();
  }
  return circuitBreaker;
}

/**
 * Check if error is a 5xx server error
 */
export function isServerError(error: any): boolean {
  if (error instanceof Error) {
    // Check if error message contains status code
    const statusMatch = error.message.match(/Steam API error: (\d+)/);
    if (statusMatch) {
      const statusCode = parseInt(statusMatch[1], 10);
      return statusCode >= 500 && statusCode < 600;
    }
  }
  return false;
}
