/**
 * Known SauceDemo accounts. The site's behavior changes per-account —
 * locked_out can't log in, problem_user shows broken UI, etc.
 *
 * Source: https://www.saucedemo.com (login page lists these publicly)
 */
export const users = {
  standard: { username: 'standard_user', password: 'secret_sauce' },
  lockedOut: { username: 'locked_out_user', password: 'secret_sauce' },
  problem: { username: 'problem_user', password: 'secret_sauce' },
  performanceGlitch: { username: 'performance_glitch_user', password: 'secret_sauce' },
  errorUser: { username: 'error_user', password: 'secret_sauce' },
  visualUser: { username: 'visual_user', password: 'secret_sauce' },
} as const

export type UserKey = keyof typeof users
