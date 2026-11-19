import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  billedTokens,
  bucketsFrom,
  emptyBuckets,
  normalizeConfig,
  ratePeriod,
  splitRouteKey,
} from '../src/fold.js'
import { createRoutesUnit, createTurnsUnit } from '../src/units.js'

/** A peak instant: Monday 02:00 UTC. */
const PEAK_TIME = Date.UTC(2026, 10, 16, 2, 0, 0)
/** An off-peak instant: the same Monday at 12:00 UTC. */
const OFF_PEAK_TIME = Date.UTC(2026, 10, 16, 12, 0, 0)

/** @returns a request envelope event. */
function contextEvent(time, provider, model, contextWindow) {
  return { type: 'request/context', time, data: { provider, model, contextWindow } }
}

/** @returns a settled attempt event carrying usage in its stream. */
function attemptEvent(time, turn, step, usage) {
  return {
    type: 'assistant/attempt',
    time,
    data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
  }
}

/** @returns a settled assistant message event. */
function messageEvent(time, turn, step, provider, model, usage) {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, message: { source: { provider, model } }, usage, stream: [] },
  }
}

/** @returns a retry-started event. */
function retryEvent(time, turn, step) {
  return { type: 'llm/retry-started', time, data: { turn, step } }
}

/** Drive one unit over a list of events. */
function drive(unit, events) {
  let state = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return state
}

test('usage buckets keep reasoning beside output and reject untrustworthy counts', () => {
  const buckets = bucketsFrom({
    inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 20, reasoningTokens: 30,
  })
  assert.deepEqual(buckets, {
    uncachedInputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 900,
    cacheWriteTokens: 20,
    reasoningTokens: 30,
  })
  assert.equal(billedTokens(buckets), 1060, 'reasoning is part of output, not an extra bucket')

  assert.equal(bucketsFrom({ inputTokens: 10, outputTokens: 5, reasoningTokens: 6 }).reasoningTokens, 0)
  assert.equal(bucketsFrom({ inputTokens: 10, outputTokens: 5, cacheReadTokens: -1 }), undefined)
  assert.equal(bucketsFrom({ inputTokens: 1.5, outputTokens: 5 }), undefined)
  assert.equal(bucketsFrom(null), undefined)
})

test('pricing periods follow the published UTC windows', () => {
  assert.equal(ratePeriod(PEAK_TIME), 'peak')
  assert.equal(ratePeriod(OFF_PEAK_TIME), 'offPeak')
  // Saturday 02:00 UTC is off-peak even inside the hour window.
  assert.equal(ratePeriod(Date.UTC(2026, 10, 21, 2, 0, 0)), 'offPeak')
  // Monday 05:00 UTC sits between the two windows.
  assert.equal(ratePeriod(Date.UTC(2026, 10, 16, 5, 0, 0)), 'offPeak')
})

test('a settled message replaces the attempt it supersedes', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 1_000_000),
    attemptEvent(PEAK_TIME, 0, 0, { inputTokens: 100, outputTokens: 10 }),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 120, outputTokens: 25 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.totals.uncachedInputTokens, 120, 'the superseded attempt must not add on top')
  assert.equal(view.totals.outputTokens, 25)
  assert.equal(view.totals.calls, 1)
  assert.equal(view.routes.length, 1)
  assert.deepEqual(view.routes[0].peak, {
    uncachedInputTokens: 120,
    outputTokens: 25,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  })
  assert.equal(unit.wire.viewSchema.safeParse(view).success, true)
})

test('a replay of the same settlement is idempotent', () => {
  const unit = createRoutesUnit()
  const event = messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 50, outputTokens: 5 })
  const once = drive(unit, [contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000), event])
  const twice = unit.apply(once, event)
  assert.equal(twice, once, 'an unchanged sample must return the same state reference')
})

test('a retry counts a genuinely separate attempt once', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    attemptEvent(PEAK_TIME, 0, 0, { inputTokens: 100, outputTokens: 0 }),
    retryEvent(PEAK_TIME, 0, 0),
    attemptEvent(PEAK_TIME, 0, 0, { inputTokens: 100, outputTokens: 30 }),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 100, outputTokens: 30 }),
  ])
  const view = unit.wire.view(state)
  // The first attempt was interrupted but billed; the retry and its message
  // settle one slot, so 100 + 100 input is right and output is counted once.
  assert.equal(view.totals.uncachedInputTokens, 200)
  assert.equal(view.totals.outputTokens, 30)
  assert.equal(view.totals.calls, 2)
  assert.equal(view.totals.retries, 1)
})

test('a mid-session model switch is attributed per call', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 100, outputTokens: 20 }),
    contextEvent(PEAK_TIME, 'freellmapi', 'auto', 1_310_720),
    messageEvent(PEAK_TIME, 1, 0, 'freellmapi', 'auto', { inputTokens: 300, outputTokens: 40 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.routes.length, 2)
  const flash = view.routes.find(route => route.model === 'deepseek-flash')
  const auto = view.routes.find(route => route.model === 'auto')
  assert.equal(flash.provider, 'deepseek')
  assert.equal(flash.peak.uncachedInputTokens, 100)
  assert.equal(auto.provider, 'freellmapi')
  assert.equal(auto.peak.uncachedInputTokens, 300)
  assert.deepEqual(view.lastRoute, { provider: 'freellmapi', model: 'auto' })
  assert.equal(view.contextWindow, 1_310_720)
})

test('a streamed attempt is attributed to the envelope it ran under', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    contextEvent(OFF_PEAK_TIME, 'deepseek', 'deepseek-v4-pro', 1_000_000),
    attemptEvent(OFF_PEAK_TIME, 3, 1, { inputTokens: 40, outputTokens: 8 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.routes[0].provider, 'deepseek')
  assert.equal(view.routes[0].model, 'deepseek-v4-pro')
  assert.equal(view.routes[0].offPeak.uncachedInputTokens, 40)
  assert.equal(view.routes[0].peak.uncachedInputTokens, 0)
})

test('usage with no known route is kept but marked unknown', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    attemptEvent(PEAK_TIME, 0, 0, { inputTokens: 10, outputTokens: 2 }),
  ])
  const view = unit.wire.view(state)
  assert.deepEqual(view.routes[0], {
    provider: 'unknown',
    model: 'unknown',
    peak: { ...emptyBuckets(), uncachedInputTokens: 10, outputTokens: 2 },
    offPeak: emptyBuckets(),
    calls: 1,
    retries: 0,
  })
  assert.equal(view.lastRoute, null)
})

test('per-task rows stay separate and are capped', () => {
  const unit = createTurnsUnit(normalizeConfig({ maxTurns: 1 }))
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 10, outputTokens: 1 }),
    messageEvent(PEAK_TIME, 1, 0, 'deepseek', 'deepseek-flash', { inputTokens: 20, outputTokens: 2 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.turns.length, 1, 'the oldest task is dropped past the cap')
  assert.equal(view.turns[0].turn, 1)
  assert.equal(view.turns[0].calls, 1)
  assert.equal(view.turns[0].routes[0].peak.uncachedInputTokens, 20)
  assert.equal(unit.wire.viewSchema.safeParse(view).success, true)
})

test('per-task rows keep one row per task across several calls', () => {
  const unit = createTurnsUnit(normalizeConfig({}))
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 10, outputTokens: 1 }),
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-v4-pro', 128_000),
    messageEvent(PEAK_TIME, 0, 1, 'deepseek', 'deepseek-v4-pro', { inputTokens: 30, outputTokens: 3 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.turns.length, 1)
  assert.equal(view.turns[0].calls, 2)
  const models = view.turns[0].routes.map(route => route.model).sort()
  assert.deepEqual(models, ['deepseek-flash', 'deepseek-v4-pro'])
  assert.deepEqual(unit.stateSchema.parse(JSON.parse(JSON.stringify(state))), state)
})

test('stored state round-trips through its own schema', () => {
  const unit = createRoutesUnit()
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', {
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, reasoningTokens: 1,
    }),
  ])
  const parsed = unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(parsed, state)
  assert.deepEqual(splitRouteKey('deepseek\u0000deepseek-flash'), { provider: 'deepseek', model: 'deepseek-flash' })
})

test('configuration falls back instead of failing activation', () => {
  assert.deepEqual(normalizeConfig(undefined), { trackAttempts: true, maxTurns: 200 })
  assert.deepEqual(normalizeConfig({ trackAttempts: false, maxTurns: 5 }), { trackAttempts: false, maxTurns: 5 })
  assert.deepEqual(normalizeConfig({ trackAttempts: 'yes', maxTurns: -1 }), { trackAttempts: true, maxTurns: 200 })
})

test('attempts are ignored when trackAttempts is off', () => {
  const unit = createTurnsUnit(normalizeConfig({ trackAttempts: false }))
  const state = drive(unit, [
    contextEvent(PEAK_TIME, 'deepseek', 'deepseek-flash', 128_000),
    attemptEvent(PEAK_TIME, 0, 0, { inputTokens: 99, outputTokens: 9 }),
    messageEvent(PEAK_TIME, 0, 0, 'deepseek', 'deepseek-flash', { inputTokens: 10, outputTokens: 1 }),
  ])
  const view = unit.wire.view(state)
  assert.equal(view.turns[0].routes[0].peak.uncachedInputTokens, 10)
})
