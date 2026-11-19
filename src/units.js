/**
 * The two Session projection units this bundle contributes.
 *
 * - `aiUsageRoutes` attributes provider-reported usage to the provider/model
 *   that produced it, split by the pricing period the call ran in. Its view is a
 *   Session-list summary value, so historical per-model breakdowns need neither
 *   an open Session nor any model request.
 * - `aiUsageTurns` attributes the same usage to the Turn ("task") it belongs to.
 *
 * Both mirror the official `tokenUsage` fold's replacement rule: one settlement
 * owns one `(turn, step)` slot, so a re-settled or retried attempt replaces its
 * predecessor instead of accumulating on top of it. `llm/retry-started` closes
 * the slot, which makes a genuinely separate billed attempt add its own usage.
 * Reasoning tokens are recorded beside output and never added to them.
 *
 * @module dsh-ai-usage-monitor/units
 */

import { z } from 'zod'
import {
  PERIODS,
  UNKNOWN_ROUTE,
  addBuckets,
  billedTokens,
  bucketsEqual,
  bucketsFrom,
  emptyBuckets,
  isCount,
  isSettlement,
  ratePeriod,
  routeKey,
  splitRouteKey,
  subtractBuckets,
  usageOf,
} from './fold.js'

const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
})

const totalsSchema = bucketsSchema.extend({
  calls: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
})

/** The slot a settled sample occupies, so a later settlement can replace it. */
const slotSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  key: z.string(),
  period: z.enum(PERIODS),
  buckets: bucketsSchema,
})

const routeSchema = z.object({
  provider: z.string(),
  model: z.string(),
})

/** @returns one empty contributed route entry. */
function emptyContribution() {
  return { peak: emptyBuckets(), offPeak: emptyBuckets(), calls: 0, retries: 0 }
}

/**
 * Add one settled sample to a route table.
 * @param byRoute - route table, never mutated.
 * @param key - route key.
 * @param period - pricing period of the sample.
 * @param buckets - sample buckets.
 * @returns the new route table.
 */
function contribute(byRoute, key, period, buckets) {
  const previous = Object.hasOwn(byRoute, key) ? byRoute[key] : emptyContribution()
  const entry = {
    peak: period === 'peak' ? addBuckets(previous.peak, buckets) : previous.peak,
    offPeak: period === 'offPeak' ? addBuckets(previous.offPeak, buckets) : previous.offPeak,
    calls: previous.calls + 1,
    retries: previous.retries,
  }
  return { ...byRoute, [key]: entry }
}

/**
 * Remove one previously counted sample from a route table.
 * @param byRoute - route table, never mutated.
 * @param slot - the sample being replaced.
 * @returns the new route table, without an entry whose counts are all zero.
 */
function withdraw(byRoute, slot) {
  if (!Object.hasOwn(byRoute, slot.key)) return byRoute
  const previous = byRoute[slot.key]
  const entry = {
    peak: slot.period === 'peak' ? subtractBuckets(previous.peak, slot.buckets) : previous.peak,
    offPeak: slot.period === 'offPeak' ? subtractBuckets(previous.offPeak, slot.buckets) : previous.offPeak,
    calls: Math.max(0, previous.calls - 1),
    retries: previous.retries,
  }
  if (entry.calls > 0 || billedTokens(entry.peak) > 0 || billedTokens(entry.offPeak) > 0) {
    return { ...byRoute, [slot.key]: entry }
  }
  const next = { ...byRoute }
  delete next[slot.key]
  return next
}

/** @returns the route table with one route's retry counter bumped. */
function bumpRetries(byRoute, key) {
  if (key === null) return byRoute
  const previous = Object.hasOwn(byRoute, key) ? byRoute[key] : emptyContribution()
  return { ...byRoute, [key]: { ...previous, retries: previous.retries + 1 } }
}

/**
 * Resolve the route one settlement must be attributed to.
 * @param event - settlement event.
 * @param active - route of the newest request envelope.
 * @returns the route plus its wire key.
 */
function settleRoute(event, active) {
  const source = event.type === 'assistant/message'
    ? (event.data ?? {}).message?.source
    : undefined
  const named = source !== null && typeof source === 'object'
    && typeof source.provider === 'string' && source.provider !== ''
    && typeof source.model === 'string' && source.model !== ''
    ? { provider: source.provider, model: source.model }
    : undefined
  const route = named ?? active
  if (route === undefined || route === null) {
    return { provider: 'unknown', model: 'unknown', key: UNKNOWN_ROUTE }
  }
  return { provider: route.provider, model: route.model, key: routeKey(route.provider, route.model) }
}

/**
 * The `aiUsageRoutes` unit.
 * @returns the projection definition.
 */
export function createRoutesUnit() {
  return {
    key: 'aiUsageRoutes',
    stateVersion: 1,
    stateSchema: z.object({
      byRoute: z.record(z.string(), z.object({
        peak: bucketsSchema,
        offPeak: bucketsSchema,
        calls: z.number().int().nonnegative(),
        retries: z.number().int().nonnegative(),
      })),
      last: slotSchema.nullable(),
      lastRoute: routeSchema.nullable(),
      contextWindow: z.number().int().positive().nullable(),
    }),
    init: () => ({ byRoute: {}, last: null, lastRoute: null, contextWindow: null }),
    apply: (state, event) => {
      if (event.type === 'request/context') {
        const data = event.data ?? {}
        const provider = typeof data.provider === 'string' ? data.provider : ''
        const model = typeof data.model === 'string' ? data.model : ''
        const lastRoute = provider !== '' && model !== '' ? { provider, model } : state.lastRoute
        const contextWindow = isCount(data.contextWindow) && data.contextWindow > 0
          ? data.contextWindow
          : state.contextWindow
        if (lastRoute === state.lastRoute && contextWindow === state.contextWindow) return state
        return { ...state, lastRoute, contextWindow }
      }
      if (event.type === 'llm/retry-started') {
        const { turn, step } = event.data ?? {}
        if (!isCount(turn) || !isCount(step)) return state
        const matches = state.last !== null && state.last.turn === turn && state.last.step === step
        const key = matches
          ? state.last.key
          : state.lastRoute === null ? null : routeKey(state.lastRoute.provider, state.lastRoute.model)
        const byRoute = bumpRetries(state.byRoute, key)
        const last = matches ? null : state.last
        if (byRoute === state.byRoute && last === state.last) return state
        return { ...state, byRoute, last }
      }
      if (!isSettlement(event, true)) return state
      const buckets = bucketsFrom(usageOf(event))
      if (buckets === undefined) return state
      const { turn, step } = event.data ?? {}
      if (!isCount(turn) || !isCount(step)) return state
      const period = ratePeriod(event.time)
      const route = settleRoute(event, state.lastRoute)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null
        && previous.key === route.key
        && previous.period === period
        && bucketsEqual(previous.buckets, buckets)) return state
      let byRoute = state.byRoute
      if (previous !== null) byRoute = withdraw(byRoute, previous)
      byRoute = contribute(byRoute, route.key, period, buckets)
      return { ...state, byRoute, last: { turn, step, key: route.key, period, buckets } }
    },
    wire: {
      viewSchema: z.object({
        totals: totalsSchema,
        routes: z.array(z.object({
          provider: z.string(),
          model: z.string(),
          peak: bucketsSchema,
          offPeak: bucketsSchema,
          calls: z.number().int().nonnegative(),
          retries: z.number().int().nonnegative(),
        })),
        lastRoute: routeSchema.nullable(),
        contextWindow: z.number().int().positive().nullable(),
      }),
      view: (state) => {
        let totals = emptyBuckets()
        let calls = 0
        let retries = 0
        const routes = []
        for (const key of Object.keys(state.byRoute)) {
          const entry = state.byRoute[key]
          const { provider, model } = splitRouteKey(key)
          totals = addBuckets(totals, addBuckets(entry.peak, entry.offPeak))
          calls += entry.calls
          retries += entry.retries
          routes.push({
            provider, model, peak: entry.peak, offPeak: entry.offPeak, calls: entry.calls, retries: entry.retries,
          })
        }
        routes.sort((left, right) => {
          const delta = billedTokens(addBuckets(right.peak, right.offPeak))
            - billedTokens(addBuckets(left.peak, left.offPeak))
          return delta !== 0 ? delta : `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`)
        })
        return {
          totals: { ...totals, calls, retries },
          routes,
          lastRoute: state.lastRoute,
          contextWindow: state.contextWindow,
        }
      },
    },
  }
}

/** @returns one empty per-task route contribution. */
function emptyTurnContribution() {
  return { peak: emptyBuckets(), offPeak: emptyBuckets(), calls: 0 }
}

/**
 * The `aiUsageTurns` unit: the same settlements attributed to their Turn.
 *
 * Its view is deliberately not a Session-list summary: per-task rows are only
 * read for the Session the panel is watching.
 * @param config - resolved plugin configuration (`trackAttempts`, `maxTurns`).
 * @returns the projection definition.
 */
export function createTurnsUnit(config) {
  const trackAttempts = config.trackAttempts
  const maxTurns = config.maxTurns
  return {
    key: 'aiUsageTurns',
    stateVersion: 1,
    stateSchema: z.object({
      turns: z.array(z.object({
        turn: z.number().int().nonnegative(),
        calls: z.number().int().nonnegative(),
        retries: z.number().int().nonnegative(),
        byRoute: z.record(z.string(), z.object({
          peak: bucketsSchema,
          offPeak: bucketsSchema,
          calls: z.number().int().nonnegative(),
        })),
      })),
      last: slotSchema.nullable(),
      lastRoute: routeSchema.nullable(),
    }),
    init: () => ({ turns: [], last: null, lastRoute: null }),
    apply: (state, event) => {
      if (event.type === 'request/context') {
        const data = event.data ?? {}
        const provider = typeof data.provider === 'string' ? data.provider : ''
        const model = typeof data.model === 'string' ? data.model : ''
        if (provider === '' || model === '') return state
        if (state.lastRoute !== null
          && state.lastRoute.provider === provider
          && state.lastRoute.model === model) return state
        return { ...state, lastRoute: { provider, model } }
      }
      if (event.type === 'llm/retry-started') {
        const { turn, step } = event.data ?? {}
        if (!isCount(turn) || !isCount(step)) return state
        const index = state.turns.findIndex(entry => entry.turn === turn)
        if (index === -1) return state
        const turns = state.turns.slice()
        turns[index] = { ...turns[index], retries: turns[index].retries + 1 }
        const last = state.last !== null && state.last.turn === turn && state.last.step === step ? null : state.last
        return { ...state, turns, last }
      }
      if (!isSettlement(event, trackAttempts)) return state
      const buckets = bucketsFrom(usageOf(event))
      if (buckets === undefined) return state
      const { turn, step } = event.data ?? {}
      if (!isCount(turn) || !isCount(step)) return state
      const period = ratePeriod(event.time)
      const route = settleRoute(event, state.lastRoute)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null
        && previous.key === route.key
        && previous.period === period
        && bucketsEqual(previous.buckets, buckets)) return state
      let turns = state.turns.slice()
      let index = turns.findIndex(entry => entry.turn === turn)
      if (index === -1) {
        turns.push({ turn, calls: 0, retries: 0, byRoute: {} })
        if (turns.length > maxTurns) turns = turns.slice(turns.length - maxTurns)
        index = turns.findIndex(entry => entry.turn === turn)
      }
      const entry = turns[index]
      let byRoute = entry.byRoute
      let calls = entry.calls
      if (previous !== null) {
        if (Object.hasOwn(byRoute, previous.key)) {
          const previousEntry = byRoute[previous.key]
          const updated = {
            peak: previous.period === 'peak'
              ? subtractBuckets(previousEntry.peak, previous.buckets)
              : previousEntry.peak,
            offPeak: previous.period === 'offPeak'
              ? subtractBuckets(previousEntry.offPeak, previous.buckets)
              : previousEntry.offPeak,
            calls: Math.max(0, previousEntry.calls - 1),
          }
          const next = { ...byRoute }
          if (updated.calls === 0 && billedTokens(updated.peak) === 0 && billedTokens(updated.offPeak) === 0) {
            delete next[previous.key]
          } else {
            next[previous.key] = updated
          }
          byRoute = next
        }
        calls = Math.max(0, calls - 1)
      }
      const contribution = Object.hasOwn(byRoute, route.key) ? byRoute[route.key] : emptyTurnContribution()
      byRoute = {
        ...byRoute,
        [route.key]: {
          peak: period === 'peak' ? addBuckets(contribution.peak, buckets) : contribution.peak,
          offPeak: period === 'offPeak' ? addBuckets(contribution.offPeak, buckets) : contribution.offPeak,
          calls: contribution.calls + 1,
        },
      }
      turns[index] = { turn, calls: calls + 1, retries: entry.retries, byRoute }
      return { turns, last: { turn, step, key: route.key, period, buckets }, lastRoute: state.lastRoute }
    },
    wire: {
      viewSchema: z.object({
        turns: z.array(z.object({
          turn: z.number().int().nonnegative(),
          calls: z.number().int().nonnegative(),
          retries: z.number().int().nonnegative(),
          routes: z.array(z.object({
            provider: z.string(),
            model: z.string(),
            peak: bucketsSchema,
            offPeak: bucketsSchema,
            calls: z.number().int().nonnegative(),
          })),
        })),
      }),
      view: (state) => ({
        turns: state.turns.map((entry) => ({
          turn: entry.turn,
          calls: entry.calls,
          retries: entry.retries,
          routes: Object.keys(entry.byRoute).map((key) => {
            const contribution = entry.byRoute[key]
            const { provider, model } = splitRouteKey(key)
            return {
              provider, model, peak: contribution.peak, offPeak: contribution.offPeak, calls: contribution.calls,
            }
          }),
        })),
      }),
      summary: false,
    },
  }
}

export { DEFAULT_CONFIG, normalizeConfig } from './fold.js'
