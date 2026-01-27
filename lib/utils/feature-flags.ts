/**
 * Feature Flags for Performance Improvements
 *
 * Set to false to disable a feature if it causes issues in production
 */

export const FEATURE_FLAGS = {
  // Phase 1: Quick Wins
  PARALLEL_INITIAL_FETCHES: true, // Fetch user/stats/games in parallel
  PROGRESSIVE_UI: true,            // Show skeleton UI immediately
  REMOVE_SYNC_MODAL_DELAY: true,  // Remove 300ms delay before showing sync modal

  // Phase 2: Database Optimization
  SQL_AGGREGATION_STATS: true,    // Use SQL COUNT queries for statistics

  // Phase 3: Rate Limiting
  BATCH_ACHIEVEMENTS: false,       // Use batch endpoint for achievements (not implemented yet)
} as const;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[feature];
}
