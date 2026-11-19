/**
 * Smoke tests for the browser half.
 *
 * The panel cannot be rendered in a real browser from this environment, so
 * these tests execute the module with a minimal hook runtime: they catch
 * reference errors, slot-registration mistakes, and a crash on missing data.
 * They do not replace looking at the panel in the running app.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/* ------------------------------------------------------------------ */
/* Minimal React runtime                                               */
/* ------------------------------------------------------------------ */

let hookIndex = 0
let pendingEffects = []

const ReactStub = {
  createElement(type, props, ...children) {
    const flat = children.length === 1 ? children[0] : children
    return { type, props: { ...(props ?? {}), children: flat } }
  },
  useState(initial) {
    hookIndex += 1
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useMemo(factory) {
    hookIndex += 1
    return factory()
  },
  useCallback(callback) {
    hookIndex += 1
    return callback
  },
  useEffect(callback) {
    hookIndex += 1
    pendingEffects.push(callback)
  },
  useRef(value) {
    hookIndex += 1
    return { current: value }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    hookIndex += 1
    return getSnapshot()
  },
}

const storage = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      globalThis.window.__loaded = definition
    },
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, value) },
  },
}

const modulePath = new URL('../client.js', import.meta.url)
await import(modulePath)

const definition = globalThis.window.__loaded
assert.equal(definition.id, 'dsh-ai-usage-monitor', 'the module id must be the package name')
const module = definition.factory((name) => {
  assert.equal(name, 'react', 'the browser half may only require React')
  return ReactStub
})

/** Render one function component, resetting the hook cursor. */
function render(component, props) {
  hookIndex = 0
  pendingEffects = []
  return component(props)
}

/** Render and run the mounted effects, as React does after a commit. */
function mount(component, props) {
  const tree = render(component, props)
  const cleanups = []
  for (const effect of pendingEffects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  pendingEffects = []
  return {
    tree,
    unmount: () => {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

/** Collect every string in a rendered tree. */
function textOf(tree) {
  if (tree === null || tree === undefined || tree === false) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join(' ')
  if (typeof tree === 'object' && tree.props !== undefined) return textOf(tree.props.children)
  return ''
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const buckets = (input, output, cacheRead = 0, reasoning = 0) => ({
  uncachedInputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: 0,
  reasoningTokens: reasoning,
})

const flashRoute = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  peak: buckets(1200, 300, 5000, 120),
  offPeak: buckets(800, 200, 2000, 40),
  calls: 2,
  retries: 1,
}

const proRoute = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  peak: buckets(400, 100),
  offPeak: buckets(100, 20),
  calls: 1,
  retries: 0,
}

const routesView = {
  totals: { ...buckets(2500, 620, 7000, 160), calls: 3, retries: 1 },
  routes: [flashRoute, proRoute],
  lastRoute: { provider: 'deepseek', model: 'deepseek-v4-pro' },
  contextWindow: 131072,
}

const turnsView = {
  turns: [
    {
      turn: 0,
      calls: 1,
      retries: 0,
      routes: [{ provider: 'deepseek', model: 'deepseek-flash', peak: buckets(600, 120, 100), offPeak: buckets(0, 0), calls: 1 }],
    },
    {
      turn: 1,
      calls: 2,
      retries: 1,
      routes: [
        { provider: 'deepseek', model: 'deepseek-flash', peak: buckets(600, 180, 900), offPeak: buckets(800, 200, 2000), calls: 2 },
        { provider: 'deepseek', model: 'deepseek-v4-pro', peak: buckets(400, 100), offPeak: buckets(100, 20), calls: 1 },
      ],
    },
  ],
}

const listSnapshot = {
  phase: 'ready',
  ids: ['s1', 's2'],
  byId: {
    s1: {
      id: 's1',
      displayTitle: 'Session A',
      updatedAt: 200,
      running: true,
      projectionValues: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    },
    s2: {
      id: 's2',
      displayTitle: 'Session B',
      updatedAt: 100,
      running: false,
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 2000, outputTokens: 500, cacheReadTokens: 7000, cacheWriteTokens: 0 },
        aiUsageRoutes: routesView,
      },
    },
  },
  projectionsBySession: {},
}

const face = (value) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/** A retained-session reference stub: the panel releases it on unmount. */
const retainSession = (sessionId) => ({
  sessionId,
  binding: { sessionId },
  ready: Promise.resolve({ sessionId }),
  release: () => {},
})

/** A minimal observable store with the shared setter both surfaces call. */
const createStore = (initial) => {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

const prefsStore = createStore({
  floating: false, lang: 'en', basis: 'auto', showSpeed: true, showCacheHit: true, accountEnabled: false,
})
const pricesStore = createStore({})

/** Props every surface receives from the slot registration. */
const injected = {
  readAccountBalance: () => undefined,
  retainSession,
  prefsStore,
  pricesStore,
  showPanel: () => true,
  accountAvailable: () => true,
}

const projectionFace = (sessionId, key) => {
  if (sessionId !== 's1') return undefined
  if (key === 'tokenUsage') return face({ uncachedInputTokens: 2000, outputTokens: 500, cacheReadTokens: 7000, cacheWriteTokens: 0 })
  if (key === 'contextPressure') return face({ pressureTokens: 6200, projectedTokens: 6500, contextWindow: 131072 })
  if (key === 'sessionStats') return face({ decodeMs: 2000, decodeTokens: 400 })
  if (key === 'aiUsageRoutes') return face(routesView)
  if (key === 'aiUsageTurns') return face(turnsView)
  return undefined
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('the module registers the sidebar entry and the panel under one id', () => {
  const injections = []
  const registrations = []
  const ctx = {
    effect: (callback) => callback(),
    get: () => undefined,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active: 'en' }),
    },
    sessions: { binding: () => undefined, retain: retainSession },
    slots: {
      inject(key, callback) {
        injections.push(key)
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  module.apply(ctx)

  assert.deepEqual(injections.sort(), ['main', 'shell.overlay', 'sidebar.panellist'])
  const panel = registrations.find(entry => entry.options.name === 'main')
  const overlay = registrations.find(entry => entry.options.name === 'shell.overlay')
  const entry = registrations.find(entry => entry.options.name === 'sidebar.panellist')
  assert.equal(panel.options.key, 'ai-usage-monitor')
  assert.equal(overlay.options.id, 'ai-usage-monitor-mini')
  assert.equal(entry.options.id, 'ai-usage-monitor')
  assert.equal(entry.options.order, 20)
  assert.equal(typeof entry.options.label, 'function')
  assert.equal(entry.component({ size: 18, active: true }).type, 'svg')
})

test('the panel renders with no data at all', () => {
  const tree = render(findComponent(module), {
    t: (key) => key,
    useSessions: (selector) => selector({ phase: 'ready', ids: [], byId: {}, projectionsBySession: {} }),
    projectionFace: () => undefined,
    ...injected,
  })
  const text = textOf(tree)
  assert.match(text, /AI usage monitor/)
  assert.match(text, /No model call recorded yet/)
  assert.match(text, /Unavailable/)
})

test('the panel renders a populated session', () => {
  const component = findComponent(module)
  const tree = render(component, {
    t: (key) => key,
    useSessions: (selector) => selector(listSnapshot),
    projectionFace,
    ...injected,
  })
  const text = textOf(tree)
  assert.match(text, /deepseek · deepseek-v4-pro/)
  assert.match(text, /History by model/)
  assert.match(text, /Tokens per task/)
  assert.match(text, /Prices \(USD per 1M tokens\)/)
  assert.match(text, /Account quota/)
  assert.match(text, /deepseek-v4-pro/)
  assert.match(text, /131,072|131.072|131072/, 'the context window is shown')
  assert.doesNotMatch(text, /Incomplete estimate/, 'every observed route has a rate')
})

test('the language toggle switches the whole panel copy', () => {
  const component = findComponent(module)
  const props = {
    useSessions: selector => selector(listSnapshot),
    projectionFace,
    ...injected,
  }
  prefsStore.set({ ...prefsStore.getSnapshot(), lang: 'es' })
  const spanish = textOf(render(component, props))
  assert.match(spanish, /Monitor de uso de IA/)
  assert.match(spanish, /Ventana de contexto/)
  assert.match(spanish, /Histórico por modelo/)

  prefsStore.set({ ...prefsStore.getSnapshot(), lang: 'en' })
  const english = textOf(render(component, props))
  assert.match(english, /AI usage monitor/)
  assert.match(english, /Context window/)
  assert.match(english, /History by model/)
})

test('an unknown model is reported instead of priced', () => {  const component = findComponent(module)
  const unknownRoutes = {
    totals: { ...buckets(10, 2), calls: 1, retries: 0 },
    routes: [{ provider: 'freellmapi', model: 'auto', peak: buckets(10, 2), offPeak: buckets(0, 0), calls: 1 }],
    lastRoute: { provider: 'freellmapi', model: 'auto' },
    contextWindow: null,
  }
  const tree = render(component, {
    t: (key) => key,
    useSessions: (selector) => selector({
      phase: 'ready',
      ids: ['s9'],
      byId: { s9: { id: 's9', displayTitle: 'Other', updatedAt: 1, running: false, projectionValues: { aiUsageRoutes: unknownRoutes } } },
      projectionsBySession: {},
    }),
    projectionFace: () => undefined,
    ...injected,
  })
  const text = textOf(tree)
  assert.match(text, /freellmapi · auto/)
  assert.match(text, /Incomplete estimate/)
})

test('a route that billed no tokens does not make the estimate incomplete', () => {
  const component = findComponent(module)
  const mixed = {
    totals: { ...buckets(1200, 300), calls: 12, retries: 9 },
    routes: [
      { provider: 'deepseek', model: 'deepseek-flash', peak: buckets(1200, 300), offPeak: buckets(0, 0), calls: 1 },
      // A provider that failed before reporting tokens: calls, no usage.
      { provider: 'freellmapi', model: 'auto', peak: buckets(0, 0), offPeak: buckets(0, 0), calls: 11 },
    ],
    lastRoute: { provider: 'deepseek', model: 'deepseek-flash' },
    contextWindow: 1_310_720,
  }
  const tree = render(component, {
    t: (key) => key,
    useSessions: (selector) => selector({
      phase: 'ready',
      ids: ['s7'],
      byId: { s7: { id: 's7', displayTitle: 'Mixed', updatedAt: 1, running: false, projectionValues: { aiUsageRoutes: mixed } } },
      projectionsBySession: {},
    }),
    projectionFace: () => undefined,
    ...injected,
  })
  const text = textOf(tree)
  assert.match(text, /auto/)
  assert.doesNotMatch(text, /Incomplete estimate/)
})

test('the floating card renders only while minimized and off the panel', () => {
  const mini = registered(module)['shell.overlay']
  basePrefs(false)

  const props = (extra) => ({
    t: (key) => key,
    useSessions: selector => selector(listSnapshot),
    projectionFace,
    ...injected,
    ...extra,
  })

  assert.equal(render(mini, props({})), null, 'nothing floats until the user minimizes')

  basePrefs(true)
  const text = textOf(render(mini, props({})))
  assert.match(text, /AI usage/)
  assert.match(text, /deepseek · deepseek-v4-pro/)
  assert.match(text, /Open panel/)

  const activePanel = () => ({ activePanelId: 'ai-usage-monitor' })
  assert.equal(render(mini, props({ usePanelInfo: activePanel })), null, 'the open panel replaces the card')
  basePrefs(false)
})

/** Set the shared floating preference for one test. */
function basePrefs(floating) {
  prefsStore.set({ ...prefsStore.getSnapshot(), floating })
}

/**
 * The factory only publishes `inject` and `apply`; these tests reach the
 * components through the slot registrations `apply` performs.
 * @param module - the browser module namespace.
 * @returns the registered components by slot name.
 */
function registered(module) {
  const components = {}
  module.apply({
    effect: (callback) => callback(),
    get: () => undefined,
    locale: { register: () => () => {}, bind: () => (key) => key, getSnapshot: () => ({ active: 'en' }) },
    sessions: { binding: () => undefined, retain: retainSession },
    slots: {
      inject(_key, callback) { callback() },
      register(options, component) {
        components[options.name] = component
        return () => {}
      },
    },
  })
  return components
}

/**
 * @param module - the browser module namespace.
 * @returns the registered panel component.
 */
function findComponent(module) {
  return registered(module).main
}
