/**
 * Host half of the AI Usage Monitor.
 *
 * It contributes two Session projections and nothing else: no tool, no model
 * request, no shell command, no session-log write. Every figure the panel shows
 * is folded from durable events the Harness already logs, so opening, resizing,
 * or revisiting the panel costs zero model calls.
 *
 * @module dsh-ai-usage-monitor
 */

import { createRoutesUnit, createTurnsUnit, normalizeConfig } from './src/units.js'

/** The projection registry is the only Host dependency of this bundle. */
export const inject = ['sessionProjections']

/**
 * Register the route-attributed and per-task usage units.
 *
 * Both registrations ride the plugin's own fiber: unloading the bundle releases
 * them, and the registry keeps each Session's last cell until the key registers
 * again. Registration is awaited so the first client baseline already carries
 * the values.
 * @param ctx - Host context carrying the projection registry.
 * @param rawConfig - the bundle row's configuration.
 */
export async function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const units = [createRoutesUnit(), createTurnsUnit(config)]
  await Promise.all(units.map(unit => ctx.sessionProjections.register(unit)))
}
