import logger, { type Logger } from '@wdio/logger'

/**
 * Single namespaced logger for the entire driver. Channel name `pw` so it
 * can be enabled/disabled via WDIO's standard `logLevels` config:
 *
 *   logLevels: { pw: 'debug' }
 */
export const log: Logger = logger('pw')
