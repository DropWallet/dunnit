/**
 * Rate Limiter / Concurrency Control for Steam API
 *
 * Provides controlled batching to prevent overwhelming Steam's
 * undocumented per-endpoint rate limits while maximizing throughput.
 *
 * Design:
 * - Processes items in batches of N with configurable concurrency
 * - Adds delay between batches to spread load
 * - Each item can fail independently without breaking the batch
 */

export interface BatchResult<T> {
  appId: number;
  result: T | null;
  error?: string;
}

/**
 * Process an array of items with concurrency control.
 *
 * @param items - Items to process
 * @param concurrency - Max parallel operations per batch
 * @param delayMs - Delay between batches in milliseconds
 * @param fn - Async function to run per item
 * @returns Array of results (preserves order, includes errors)
 */
export async function batchWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T) => Promise<R>
): Promise<Array<{ item: T; result: R | null; error?: string }>> {
  const results: Array<{ item: T; result: R | null; error?: string }> = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          const result = await fn(item);
          return { item, result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`[Rate Limiter] Failed processing item:`, errorMessage);
          return { item, result: null, error: errorMessage };
        }
      })
    );

    results.push(...batchResults);

    // Delay between batches (not after the last one)
    if (i + concurrency < items.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Configuration for batch achievement fetching.
 *
 * Tuned for Steam API safety:
 * - 10 concurrent: Each game = 3 API calls, so 30 calls per batch
 * - 200ms delay: Spreads load, ~150 calls/second max
 * - 50 max batch size: Prevents Vercel function timeouts
 */
export const BATCH_CONFIG = {
  CONCURRENCY: 10,    // Parallel Steam API calls per batch
  DELAY_MS: 200,      // Delay between batches
  MAX_BATCH_SIZE: 50, // Max games per single request
} as const;
