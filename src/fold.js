/**
 * Pure, dependency-free helpers shared by the AI Usage Monitor's Session
 * projections.
 *
 * The Harness already publishes `tokenUsage` (whole-log provider usage) and
 * `contextPressure` (request pressure and route capacity). Neither carries the
 * provider/model of the call that produced a sample, and `tokenUsage` has no
 * per-task breakdown, so this bundle adds exactly those two facts. The pieces
 * that need a schema live in `units.js`; everything here is a pure function so
 * it can be reasoned about and tested on its own.
 *
 * @module dsh-ai-usage-monitor/fold
 */

/** Peak pricing windows in UTC hours, `[start, end)`, from DeepSeek's price page. */
export const PEAK_WINDOWS = Object.freeze([{ start: 1, end: 4 }, { start: 6, end: 10 }])
/** UTC weekdays charged at the peak rate: Monday through Friday. */
export const PEAK_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5])
/** Route key of a usage sample seen before any `request/context` record. */
export const UNKNOWN_ROUTE = 'unknown\u0000unknown'
/** Period keys used by the wire views. */
export const PERIODS = Object.freeze(['peak', 'offPeak'])

/** @returns empty token buckets; every field is a disjoint token count. */
export function emptyBuckets() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

/** @returns true for a non-negative safe integer count. */
export function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Map one provider usage record onto disjoint buckets.
 *
 * `inputTokens` is uncached prompt input; cache reads and writes are reported
 * separately by the provider (or absent, which means zero). Reasoning is kept
 * beside output and a nonsensical reasoning count above output is dropped
 * rather than trusted — providers report reasoning as a subset of completion
 * tokens, so it is never added to output.
 * @param usage - provider usage record from an attempt or message.
 * @returns the buckets, or undefined when the record cannot be trusted.
 */
export function bucketsFrom(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } = usage
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    reasoningTokens: isCount(reasoningTokens) && reasoningTokens <= outputTokens ? reasoningTokens : 0,
  }
}

/** @returns the sum of two bucket records. */
export function addBuckets(left, right) {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  }
}

/** @returns `left - right`, floored at zero so a stale replacement cannot go negative. */
export function subtractBuckets(left, right) {
  return {
    uncachedInputTokens: Math.max(0, left.uncachedInputTokens - right.uncachedInputTokens),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
    cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
    cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
    reasoningTokens: Math.max(0, left.reasoningTokens - right.reasoningTokens),
  }
}

/** @returns true when two bucket records hold the same counts. */
export function bucketsEqual(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
    && left.reasoningTokens === right.reasoningTokens
}

/** @returns the prompt-side total of a bucket record; reasoning stays out of it. */
export function promptTokens(buckets) {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** @returns the billed total of a bucket record: prompt plus output. */
export function billedTokens(buckets) {
  return promptTokens(buckets) + buckets.outputTokens
}

/**
 * Classify one call time into the pricing period DeepSeek publishes.
 *
 * Peak hours are 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday. Chinese
 * public holidays are excluded from peak by the published rules; this fold
 * cannot see the holiday calendar, so a holiday weekday is charged at the peak
 * rate and the estimate leans high.
 * @param time - event time in milliseconds since the epoch.
 * @returns `'peak'` or `'offPeak'`.
 */
export function ratePeriod(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return 'offPeak'
  const at = new Date(time)
  if (!PEAK_WEEKDAYS.includes(at.getUTCDay())) return 'offPeak'
  const hour = at.getUTCHours()
  return PEAK_WINDOWS.some(window => hour >= window.start && hour < window.end) ? 'peak' : 'offPeak'
}

/** @returns the last `usage` chunk of a streamed attempt, when it reported one. */
export function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record !== null && typeof record === 'object' && record.type === 'chunk') {
      const chunk = record.chunk
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== undefined) {
        return chunk.usage
      }
    }
  }
  return undefined
}

/**
 * Read the provider usage one durable settlement reports.
 *
 * `assistant/message` carries the settled record (and a fallback chunk);
 * `assistant/attempt` only carries the stream, which is where an interrupted
 * attempt's billed usage lives.
 * @param event - durable Session event.
 * @returns the usage record, or undefined when the event is not a settlement.
 */
export function usageOf(event) {
  if (event.type === 'assistant/message') {
    const data = event.data ?? {}
    return data.usage ?? streamUsage(data.stream)
  }
  if (event.type === 'assistant/attempt') return streamUsage((event.data ?? {}).stream)
  return undefined
}

/** @returns the wire route key for a provider/model pair. */
export function routeKey(provider, model) {
  return `${provider}\u0000${model}`
}

/** @returns the provider/model pair behind a wire route key. */
export function splitRouteKey(key) {
  const [provider = '', model = ''] = key.split('\u0000')
  return { provider, model }
}

/** @returns true when an event settles a usage sample this bundle may count. */
export function isSettlement(event, trackAttempts) {
  if (event.type === 'assistant/message') return true
  return trackAttempts === true && event.type === 'assistant/attempt'
}

/** Default configuration of the bundle row. */
export const DEFAULT_CONFIG = Object.freeze({ trackAttempts: true, maxTurns: 200 })

/**
 * Read the row's configuration defensively: an omitted or malformed key falls
 * back to its default instead of failing activation.
 * @param raw - configuration passed by the Loader.
 * @returns the resolved configuration.
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const trackAttempts = typeof input.trackAttempts === 'boolean' ? input.trackAttempts : DEFAULT_CONFIG.trackAttempts
  const maxTurns = isCount(input.maxTurns) && input.maxTurns > 0 ? input.maxTurns : DEFAULT_CONFIG.maxTurns
  return { trackAttempts, maxTurns }
}
