/**
 * Browser half: the left-sidebar entry and the usage panel it opens.
 *
 * Data comes exclusively from Host projections:
 * - `tokenUsage` and `contextPressure` are the Harness's own units;
 * - `sessionStats` supplies the generation-speed figures;
 * - `aiUsageRoutes` and `aiUsageTurns` are this bundle's units in `src/fold.js`.
 *
 * Nothing here calls a model, and the only network read is the optional,
 * explicitly enabled DeepSeek account balance (requirement: a provider balance
 * API gated on user authorization). Neither figure is confused with the
 * remaining context window.
 *
 * @module dsh-ai-usage-monitor/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-ai-usage-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React

    const NS = 'aiUsageMonitor'
    const PANEL_ID = 'ai-usage-monitor'
    const PREFS_KEY = 'aiUsageMonitor.prefs.v1'
    const PRICES_KEY = 'aiUsageMonitor.prices.v1'
    const PRICE_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing'
    const PRICE_EFFECTIVE = '2026-11-18'

    /**
     * Published DeepSeek list prices, USD per 1M tokens.
     *
     * DeepSeek bills prompt tokens as cache hits or cache misses and publishes no
     * separate cache-write rate, so a cache-write count is priced at the miss
     * rate. Off-peak is half of peak; peak is 01:00-04:00 and 06:00-10:00 UTC,
     * Monday through Friday. Reasoning tokens are part of the output count and
     * are never priced twice.
     */
    const FLASH_PRICES = {
      peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      effectiveFrom: PRICE_EFFECTIVE,
      source: PRICE_SOURCE,
    }
    const PRO_PRICES = {
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      effectiveFrom: PRICE_EFFECTIVE,
      source: PRICE_SOURCE,
    }
    const DEFAULT_PRICES = {
      'deepseek-flash': FLASH_PRICES,
      // Legacy ids the price page still accepts and bills at the Flash rate.
      'deepseek-v4-flash': FLASH_PRICES,
      'deepseek-v4-flash-vision-exp': FLASH_PRICES,
      'deepseek-v4-pro': PRO_PRICES,
    }

    const EN = {
      title: 'AI usage monitor',
      subtitle: 'Live tokens, context headroom and estimated cost. Minimize to float over the conversation.',
      activeRoute: 'Active route',
      noRoute: 'No model call recorded yet',
      calls: 'calls',
      call: 'call',
      retries: 'retries',
      retry: 'retry',
      contextWindow: 'Context window',
      contextLeft: 'Left for the next request',
      approximate: 'approximate',
      contextUnavailable: 'Open this session to read context pressure',
      unavailable: 'Unavailable',
      incomplete: 'Incomplete estimate',
      input: 'Input',
      output: 'Output',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      reasoning: 'Reasoning',
      reasoningNote: 'already inside output',
      task: 'Task',
      session: 'Session',
      sessions: 'Sessions',
      history: 'History',
      tokens: 'tokens',
      totalBilled: 'Total',
      cost: 'Cost',
      speed: 'Generation speed',
      cacheHit: 'Cache hit',
      showSpeed: 'Show speed',
      showCacheHit: 'Show cache hit',
      turnsTitle: 'Tokens per task',
      turnsEmpty: 'No task recorded in this session yet',
      turnLabel: 'Task',
      historyTitle: 'History by model',
      historyEmpty: 'No model usage recorded yet',
      historyScope: 'All listed sessions',
      historyCostScope: 'cost covers',
      pricesTitle: 'Prices (USD per 1M tokens)',
      pricesHint: 'Defaults follow the published DeepSeek list. Edit a rate to override it for this browser; an empty field falls back to the default.',
      pricesEffective: 'Effective from',
      cacheHitRate: 'Cache hit $/1M',
      cacheMissRate: 'Cache miss $/1M',
      outputRate: 'Output $/1M',
      cacheWriteRate: 'Cache write $/1M',
      peakRates: 'Peak',
      offPeakRates: 'Off-peak',
      priceEdit: 'Edit rates',
      savePrices: 'Save rates',
      resetPrices: 'Reset to published',
      saved: 'Saved',
      rateBasis: 'Rate basis',
      basisAuto: 'Auto (peak and off-peak)',
      basisPeak: 'Peak',
      basisOffPeak: 'Off-peak',
      accountTitle: 'Account quota',
      accountEnable: 'Query account balance',
      accountHint: 'Separate request to the signed-in DeepSeek account when enabled. It is not a model call, and it is not the context window.',
      accountUnavailable: 'Account quota: unavailable',
      accountLoading: 'Reading account balance…',
      accountRefresh: 'Refresh',
      accountWallet: 'Top-up balance',
      accountBonus: 'Granted balance',
      tokensShort: 'tok',
      tokensPerSecond: 'tok/s',
      minimize: 'Minimize',
      sessionPicker: 'Session',
      autoSession: 'Auto (running or newest)',
      minimizeHint: 'Minimize into a floating card over the conversation',
      floatingTitle: 'AI usage',
      openPanel: 'Open panel',
      hideCard: 'Hide card',
      contextPending: 'No prompt reported yet',
      nextRequest: 'Next request ≈',
      allSessions: 'All sessions',
      language: 'Language',
      turnsCap: 'Last 12 tasks',
      accountIdle: 'Not queried. Enable it to read the balance.',
      accountNoApi: 'This provider exposes no account-balance API, so account quota is unavailable.',
      ratesVerified: 'Rates verified on',
      rateMissShort: 'miss',
      rateOutShort: 'out',
      tooltipCalls: 'Settled calls observed in this session',
      tooltipRetries: 'Retries that reopened an attempt slot',
    }

    const ES = {
      title: 'Monitor de uso de IA',
      subtitle: 'Tokens, espacio de contexto y coste estimado en vivo. Minimiza para flotar sobre la conversación.',
      activeRoute: 'Ruta activa',
      noRoute: 'Aún no hay llamadas al modelo',
      calls: 'llamadas',
      call: 'llamada',
      retries: 'reintentos',
      retry: 'reintento',
      contextWindow: 'Ventana de contexto',
      contextLeft: 'Espacio para la próxima petición',
      approximate: 'aproximado',
      contextUnavailable: 'Abre esta sesión para leer la presión de contexto',
      unavailable: 'No disponible',
      incomplete: 'Estimación incompleta',
      input: 'Entrada',
      output: 'Salida',
      cacheRead: 'Caché leída',
      cacheWrite: 'Caché escrita',
      reasoning: 'Razonamiento',
      reasoningNote: 'ya incluido en salida',
      task: 'Tarea',
      session: 'Sesión',
      sessions: 'Sesiones',
      history: 'Histórico',
      tokens: 'tokens',
      totalBilled: 'Total',
      cost: 'Coste',
      speed: 'Velocidad de generación',
      cacheHit: 'Acierto de caché',
      showSpeed: 'Mostrar velocidad',
      showCacheHit: 'Mostrar acierto',
      turnsTitle: 'Tokens por tarea',
      turnsEmpty: 'Aún no hay tareas en esta sesión',
      turnLabel: 'Tarea',
      historyTitle: 'Histórico por modelo',
      historyEmpty: 'Aún no hay consumo por modelo',
      historyScope: 'Todas las sesiones listadas',
      historyCostScope: 'el coste cubre',
      pricesTitle: 'Precios (USD por 1M de tokens)',
      pricesHint: 'Los valores por defecto siguen la lista oficial de DeepSeek. Edita una tarifa para sustituirla en este navegador; un campo vacío vuelve al valor por defecto.',
      pricesEffective: 'Vigente desde',
      cacheHitRate: 'Caché leída $/1M',
      cacheMissRate: 'Caché fallida $/1M',
      outputRate: 'Salida $/1M',
      cacheWriteRate: 'Caché escrita $/1M',
      peakRates: 'Punta',
      offPeakRates: 'Valle',
      priceEdit: 'Editar tarifas',
      savePrices: 'Guardar tarifas',
      resetPrices: 'Restablecer oficiales',
      saved: 'Guardado',
      rateBasis: 'Base tarifaria',
      basisAuto: 'Auto (punta y valle)',
      basisPeak: 'Punta',
      basisOffPeak: 'Valle',
      accountTitle: 'Cuota de cuenta',
      accountEnable: 'Consultar saldo de la cuenta',
      accountHint: 'Petición aparte a la cuenta de DeepSeek con sesión iniciada cuando se activa. No es una llamada al modelo ni es la ventana de contexto.',
      accountUnavailable: 'Cuota de cuenta: no disponible',
      accountLoading: 'Leyendo saldo de la cuenta…',
      accountRefresh: 'Actualizar',
      accountWallet: 'Saldo recargado',
      accountBonus: 'Saldo concedido',
      tokensShort: 'tok',
      tokensPerSecond: 'tok/s',
      minimize: 'Minimizar',
      sessionPicker: 'Sesión',
      autoSession: 'Auto (en curso o más reciente)',
      minimizeHint: 'Minimiza en una tarjeta flotante sobre la conversación',
      floatingTitle: 'Uso de IA',
      openPanel: 'Abrir panel',
      hideCard: 'Ocultar tarjeta',
      contextPending: 'Aún no hay petición registrada',
      nextRequest: 'Próxima petición ≈',
      allSessions: 'Todas las sesiones',
      language: 'Idioma',
      turnsCap: 'Últimas 12 tareas',
      accountIdle: 'Sin consultar. Actívalo para leer el saldo.',
      accountNoApi: 'Este proveedor no expone una API de saldo, así que la cuota de cuenta no está disponible.',
      ratesVerified: 'Tarifas verificadas el',
      rateMissShort: 'fallo',
      rateOutShort: 'salida',
      tooltipCalls: 'Llamadas liquidadas observadas en esta sesión',
      tooltipRetries: 'Reintentos que reabrieron un intento',
    }

    const TOKEN_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
    const USD_FORMAT = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
    })
    const RATE_FORMAT = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
    })

    /* ------------------------------------------------------------------ */
    /* Pure helpers (presentation only: the Host owns every accounting)    */
    /* ------------------------------------------------------------------ */

    /** @returns a bucket record with zero counts. */
    function emptyBuckets() {
      return {
        uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
      }
    }

    /** @returns the sum of two bucket records. */
    function addBuckets(left, right) {
      return {
        uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
        outputTokens: left.outputTokens + right.outputTokens,
        cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
        cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
        reasoningTokens: left.reasoningTokens + right.reasoningTokens,
      }
    }

    /** @returns the prompt-side total of a bucket record. */
    function promptTokens(buckets) {
      return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
    }

    /** @returns the billed total of a bucket record; reasoning is already inside output. */
    function billedTokens(buckets) {
      return promptTokens(buckets) + buckets.outputTokens
    }

    /** @returns the periods a rate basis reads. */
    function periodsOf(basis) {
      if (basis === 'peak') return ['peak']
      if (basis === 'offPeak') return ['offPeak']
      return ['peak', 'offPeak']
    }

    /**
     * Price one route's buckets.
     * @param route - wire route row with `peak` and `offPeak` buckets.
     * @param price - merged price entry, or undefined when no rate is known.
     * @param basis - which periods to charge.
     * @returns the USD amount and whether every needed rate was present.
     */
    function routeCost(route, price, basis) {
      if (price === undefined) return { usd: 0, priced: false }
      let usd = 0
      let priced = true
      for (const period of periodsOf(basis)) {
        const buckets = route[period]
        const rates = price[period]
        if (buckets === undefined) continue
        if (rates === undefined) { priced = false; continue }
        const cacheWrite = typeof rates.cacheWrite === 'number' ? rates.cacheWrite : rates.cacheMiss
        const amount = buckets.uncachedInputTokens * rates.cacheMiss
          + buckets.cacheWriteTokens * cacheWrite
          + buckets.cacheReadTokens * rates.cacheHit
          + buckets.outputTokens * rates.output
        if (![rates.cacheHit, rates.cacheMiss, rates.output, cacheWrite].every(value => typeof value === 'number' && Number.isFinite(value))) {
          priced = false
          continue
        }
        usd += amount / 1e6
      }
      return { usd, priced }
    }

    /**
     * Price one route, treating a route that billed no tokens as fully priced.
     *
     * A route can record calls without tokens: a request envelope that failed
     * before the provider reported usage settles attempts with zero counts.
     * Those cost nothing, so they must not turn a complete estimate into an
     * incomplete one.
     * @param route - wire route row with `peak` and `offPeak` buckets.
     * @param priceTable - merged rate table.
     * @param basis - which periods to charge.
     * @returns the billed tokens, USD amount, and whether every needed rate existed.
     */
    function costOf(route, priceTable, basis) {
      const tokens = billedTokens(addBuckets(route.peak ?? emptyBuckets(), route.offPeak ?? emptyBuckets()))
      if (tokens === 0) return { tokens: 0, usd: 0, priced: true }
      const price = Object.hasOwn(priceTable, route.model) ? priceTable[route.model] : undefined
      const cost = routeCost(route, price, basis)
      return { tokens, usd: cost.usd, priced: cost.priced }
    }

    /** @returns the chart rows for one route table, priced. */
    function pricedRoutes(routes, priceTable, basis) {
      if (!Array.isArray(routes)) return { rows: [], usd: 0, complete: true }
      let usd = 0
      let complete = true
      const rows = routes.map((route) => {
        const cost = costOf(route, priceTable, basis)
        if (!cost.priced) complete = false
        usd += cost.usd
        return {
          provider: route.provider,
          model: route.model,
          tokens: cost.tokens,
          calls: route.calls,
          usd: cost.usd,
          priced: cost.priced,
        }
      })
      return { rows, usd, complete }
    }

    /** @returns a compact token count. */
    function formatTokens(value) {
      return typeof value === 'number' && Number.isFinite(value) ? TOKEN_FORMAT.format(Math.round(value)) : '—'
    }

    /** @returns a USD amount, keeping sub-cent values readable. */
    function formatUsd(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.0001) return `<${USD_FORMAT.format(0.0001)}`
      return USD_FORMAT.format(value)
    }

    /** @returns a USD rate per million tokens. */
    function formatRate(value) {
      return typeof value === 'number' && Number.isFinite(value) ? RATE_FORMAT.format(value) : '—'
    }

    /** @returns a one-decimal percentage in the active UI language. */
    function formatPercent(value, localeTag) {
      try {
        return new Intl.NumberFormat(localeTag, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100)
      } catch (_error) {
        return `${value.toFixed(1)}%`
      }
    }

    /** @returns a numeric input value without trailing noise, or an empty string. */
    function inputRate(value) {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    }

    /** @returns the parsed rate, or undefined when the field is blank or invalid. */
    function parseRate(text) {
      if (typeof text !== 'string' || text.trim() === '') return undefined
      const value = Number(text)
      return Number.isFinite(value) && value >= 0 ? value : undefined
    }

    /** @returns a stored JSON value, or the fallback. */
    function readStored(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback
      } catch (_error) {
        return fallback
      }
    }

    /** Persist one JSON value; a storage failure leaves the in-memory value intact. */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (_error) {
        /* A blocked storage backend only costs persistence across reloads. */
      }
    }

    /** Preferences shared by the full panel and the floating card. */
    const DEFAULT_PREFS = Object.freeze({
      /** Whether the compact card floats over the conversation. */
      floating: false,
      /** Interface language: `en` or `es`, chosen with the panel's toggle. */
      lang: 'en',
      basis: 'auto',
      showSpeed: true,
      showCacheHit: true,
      accountEnabled: false,
    })

    /**
     * One observable JSON value behind both surfaces.
     *
     * The panel and the floating card are separate slot registrations that can be
     * mounted at the same time; a shared store keeps them in step without either
     * one reading the other's DOM.
     * @param key - localStorage key.
     * @param fallback - value used when nothing is stored.
     * @returns the observable store with its write method.
     */
    function createJsonStore(key, fallback) {
      let value = readStored(key, fallback)
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          value = next
          writeStored(key, value)
          for (const listener of listeners) listener()
        },
      }
    }

    /**
     * Merge manual rate overrides over the published list, one period at a time.
     *
     * An override may carry only the fields the user changed, so editing one rate
     * never blanks the rest of that model's table.
     * @param overrides - stored per-model patches.
     * @returns the effective rate table.
     */
    function mergePrices(overrides) {
      const table = { ...DEFAULT_PRICES }
      for (const model of Object.keys(overrides)) {
        const patch = overrides[model]
        if (patch === null || typeof patch !== 'object') continue
        const base = Object.hasOwn(table, model) ? table[model] : {}
        table[model] = {
          ...base,
          ...patch,
          peak: { ...(base.peak ?? {}), ...(patch.peak ?? {}) },
          offPeak: { ...(base.offPeak ?? {}), ...(patch.offPeak ?? {}) },
          effectiveFrom: patch.effectiveFrom ?? base.effectiveFrom,
        }
      }
      return table
    }

    /**
     * Subscribe one React tree to a framework projection face.
     * @param face - `ObservableSnapshot` of a projection key, or undefined.
     * @returns the current projection value.
     */
    function useFace(face) {
      const subscribe = useCallback(
        (listener) => (face === undefined ? () => {} : face.subscribe(listener)),
        [face],
      )
      const getSnapshot = useCallback(
        () => (face === undefined ? undefined : face.getSnapshot()),
        [face],
      )
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /** @returns the named projection value a summary row retained, when it retained one. */
    function summaryValue(list, sessionId, key) {
      const row = list === undefined || list.byId === undefined ? undefined : list.byId[sessionId]
      const values = row === undefined ? undefined : row.projectionValues
      return values === undefined ? undefined : values[key]
    }

    /**
     * Normalize a projection's token fields into shared buckets.
     *
     * `tokenUsage` and this bundle's route totals share the bucket field names,
     * so either can answer when the other is absent (a Session known only from
     * the list may carry one but not both).
     * @param value - projection value, or undefined.
     * @returns the buckets, or undefined without a source.
     */
    function bucketsOf(value) {
      if (value === undefined || value === null || typeof value !== 'object') return undefined
      return {
        uncachedInputTokens: value.uncachedInputTokens ?? 0,
        outputTokens: value.outputTokens ?? 0,
        cacheReadTokens: value.cacheReadTokens ?? 0,
        cacheWriteTokens: value.cacheWriteTokens ?? 0,
        reasoningTokens: value.reasoningTokens ?? 0,
      }
    }

    /**
     * Resolve the Session the panel watches: an explicit choice while it still
     * exists, otherwise the running Session, otherwise the newest one.
     * @param list - Session-list snapshot.
     * @param selected - explicit Session id, or null for automatic.
     * @returns the Session id, or undefined with no Sessions.
     */
    function resolveSession(list, selected) {
      if (list === undefined) return undefined
      const ids = Array.isArray(list.ids) ? list.ids : []
      const rows = ids.map(id => (list.byId === undefined ? undefined : list.byId[id])).filter(row => row !== undefined)
      if (selected !== null && rows.some(row => row.id === selected)) return selected
      const running = rows.find(row => row.running === true)
      if (running !== undefined) return running.id
      let best
      for (const row of rows) {
        if (best === undefined || (row.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = row
      }
      return best === undefined ? undefined : best.id
    }

    /** @returns the visual tone of a context bar. */
    function barTone(percent) {
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-brand-primary)'
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = `
.aum-root { box-sizing: border-box; height: 100%; overflow: auto; padding: 0; }
.aum-card { box-sizing: border-box; width: calc(100% - 40px); max-width: 620px; margin: 24px auto 32px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.45; }
.aum-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 14px 14px 0 0; }
.aum-title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
.aum-subtitle { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.aum-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.aum-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 4px 8px; font-size: 11px; font-family: inherit; cursor: pointer; }
.aum-btn:hover { border-color: var(--dsw-alias-border-l2); }
.aum-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.aum-btn[disabled] { opacity: 0.5; cursor: default; }
.aum-lang { display: flex; gap: 2px; }
.aum-btnOn { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.aum-select { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 4px 6px; font-size: 11px; font-family: inherit; max-width: 190px; }
.aum-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.aum-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
.aum-route { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aum-routeLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aum-routeValue { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.aum-chip { border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 1px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.aum-chipTruncate { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.aum-sectionTitle { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary); }
.aum-barTrack { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.aum-barFill { height: 100%; border-radius: 999px; transition: width 160ms ease; }
.aum-barMeta { display: flex; justify-content: space-between; gap: 8px; margin-top: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aum-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.aum-gridTwo { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.aum-metric { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 7px 9px; background: var(--dsw-alias-bg-base); min-width: 0; }
.aum-metricLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aum-metricValue { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 1px; }
.aum-metricNote { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aum-scopes { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; }
.aum-scopeRow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 6px 10px; background: var(--dsw-alias-bg-base); }
.aum-scopeRow + .aum-scopeRow { border-top: 1px solid var(--dsw-alias-border-l1); }
.aum-scopeLabel { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.aum-scopeValue { font-size: 12.5px; font-variant-numeric: tabular-nums; text-align: right; }
.aum-warn { color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 68%, var(--dsw-alias-label-primary)); }
.aum-muted { color: var(--dsw-alias-label-secondary); }
.aum-chart { display: flex; flex-direction: column; gap: 5px; }
.aum-chartRow { display: grid; grid-template-columns: minmax(90px, 1.1fr) minmax(60px, 2fr) auto; align-items: center; gap: 8px; font-size: 11.5px; }
.aum-chartLabel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aum-chartTrack { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.aum-chartFill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); }
.aum-chartValue { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.aum-turns { display: flex; flex-direction: column; gap: 4px; max-height: 168px; overflow: auto; }
.aum-turnRow { display: grid; grid-template-columns: 62px 1fr auto; align-items: baseline; gap: 8px; padding: 4px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); font-size: 11.5px; }
.aum-turnRow:last-child { border-bottom: 0; }
.aum-turnGoal { font-variant-numeric: tabular-nums; }
.aum-turnMeta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aum-details { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 8px 10px; background: var(--dsw-alias-bg-base); }
.aum-details > summary { cursor: pointer; font-size: 11.5px; font-weight: 600; outline: none; }
.aum-details > summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.aum-detailsBody { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.aum-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aum-priceGrid { display: grid; grid-template-columns: minmax(0, 1fr) repeat(4, minmax(46px, 74px)); gap: 6px; align-items: center; font-size: 11px; }
.aum-priceHead { font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: right; }
.aum-priceModel { font-size: 11px; overflow-wrap: anywhere; }
.aum-input { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 3px 5px; font-size: 11px; font-family: inherit; font-variant-numeric: tabular-nums; text-align: right; }
.aum-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.aum-subhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.aum-empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.aum-rowActions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.aum-float { position: fixed; right: 16px; bottom: 16px; z-index: 40; width: min(290px, calc(100vw - 32px)); box-sizing: border-box; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 10px 12px 12px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.4; }
.aum-floatHead { display: flex; align-items: center; gap: 6px; }
.aum-floatTitle { font-weight: 600; font-size: 12px; flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aum-floatRoute { margin-top: 4px; font-size: 11.5px; overflow-wrap: anywhere; }
@media (max-width: 460px) {
  .aum-card { width: calc(100% - 16px); margin: 12px auto 20px; }
  .aum-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .aum-priceGrid { grid-template-columns: minmax(0, 1fr) repeat(4, minmax(38px, 58px)); }
}
`

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    /**
     * The usage panel: compact, collapsible, theme-token styled.
     * @param props - slot props, the locale `t`, and the injected readers.
     * @returns the panel element.
     */
    function UsagePanel(props) {
      const {
        t, useSessions, projectionFace, readAccountBalance, retainSession,
        prefsStore, pricesStore, showPanel, accountAvailable,
      } = props

      const list = useSessions(state => state)
      const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getSnapshot)
      const lang = prefs.lang === 'es' ? 'es' : 'en'
      const overrides = useSyncExternalStore(pricesStore.subscribe, pricesStore.getSnapshot, pricesStore.getSnapshot)
      const [selected, setSelected] = useState(null)
      const [draft, setDraft] = useState(null)
      const [savedAt, setSavedAt] = useState(0)
      const [balance, setBalance] = useState({ state: 'idle' })

      const tr = useCallback((key) => {
        const dict = lang === 'es' ? ES : EN
        const value = dict[key] ?? EN[key]
        return typeof value === 'string' && value !== '' ? value : key
      }, [lang])

      /** @returns a formatted count with the right singular/plural label. */
      const label = useCallback(
        (value, singular, plural) => `${formatTokens(value)} ${tr(value === 1 ? singular : plural)}`,
        [tr],
      )

      // Asked lazily: reading an uninjected Remote namespace throws, and that
      // only means this provider exposes no balance API.
      const accountSupported = useMemo(() => {
        try {
          return typeof accountAvailable === 'function' ? accountAvailable() === true : accountAvailable === true
        } catch (_error) {
          return false
        }
      }, [accountAvailable])

      const activeId = useMemo(() => resolveSession(list, selected), [list, selected])

      // Selecting this panel unmounts the Conversation, which releases the
      // Session it was retaining: without our own reference no live projection
      // would exist and only the Session-list summary would remain. Retain the
      // watched Session while the panel is mounted (reference-counted with the
      // Conversation, and no model request), and re-read the faces once its
      // binding is ready.
      const [bindingRevision, setBindingRevision] = useState(0)
      useEffect(() => {
        if (activeId === undefined || typeof retainSession !== 'function') return undefined
        const reference = retainSession(activeId)
        let cancelled = false
        if (reference !== undefined && reference !== null && typeof reference.ready?.then === 'function') {
          reference.ready.then(() => {
            if (!cancelled) setBindingRevision(value => value + 1)
          }).catch(() => {})
        }
        return () => {
          cancelled = true
          try {
            reference?.release?.()
          } catch (_error) {
            /* A reference already released elsewhere is not an error here. */
          }
        }
      }, [activeId, retainSession])

      const usageFace = useMemo(() => projectionFace(activeId, 'tokenUsage'), [projectionFace, activeId, bindingRevision])
      const pressureFace = useMemo(() => projectionFace(activeId, 'contextPressure'), [projectionFace, activeId, bindingRevision])
      const statsFace = useMemo(() => projectionFace(activeId, 'sessionStats'), [projectionFace, activeId, bindingRevision])
      const routesFace = useMemo(() => projectionFace(activeId, 'aiUsageRoutes'), [projectionFace, activeId, bindingRevision])
      const turnsFace = useMemo(() => projectionFace(activeId, 'aiUsageTurns'), [projectionFace, activeId, bindingRevision])

      const liveUsage = useFace(usageFace)
      const pressure = useFace(pressureFace)
      const stats = useFace(statsFace)
      const liveRoutes = useFace(routesFace)
      const turns = useFace(turnsFace)

      // A Session that is not open has no live binding; its Session-list row
      // still carries the summary projections, which is what history reads.
      const usage = liveUsage ?? summaryValue(list, activeId, 'tokenUsage')
      const routes = liveRoutes ?? summaryValue(list, activeId, 'aiUsageRoutes')

      const priceTable = useMemo(() => mergePrices(overrides), [overrides])
      const basis = prefs.basis

      const sessionBuckets = useMemo(
        () => bucketsOf(usage) ?? bucketsOf(routes === undefined ? undefined : routes.totals),
        [usage, routes],
      )

      const sessionCost = useMemo(
        () => pricedRoutes(routes === undefined ? undefined : routes.routes, priceTable, basis),
        [routes, priceTable, basis],
      )

      // The official `tokenUsage` view has no reasoning bucket (reasoning is a
      // subset of output); this bundle's route view carries it beside output.
      const sessionReasoning = routes === undefined || routes.totals === undefined
        ? undefined
        : routes.totals.reasoningTokens

      const lastTurn = useMemo(() => {
        if (turns === undefined || !Array.isArray(turns.turns) || turns.turns.length === 0) return undefined
        return turns.turns[turns.turns.length - 1]
      }, [turns])

      const taskCost = useMemo(() => {
        if (lastTurn === undefined) return { rows: [], usd: 0, complete: true }
        return pricedRoutes(lastTurn.routes, priceTable, basis)
      }, [lastTurn, priceTable, basis])

      const taskBuckets = useMemo(() => {
        if (lastTurn === undefined) return undefined
        let total = emptyBuckets()
        for (const route of lastTurn.routes) total = addBuckets(total, addBuckets(route.peak, route.offPeak))
        return total
      }, [lastTurn])

      const history = useMemo(() => {
        if (list === undefined || !Array.isArray(list.ids)) return []
        const rows = []
        for (const id of list.ids) {
          const row = list.byId === undefined ? undefined : list.byId[id]
          if (row === undefined) continue
          const rowUsage = id === activeId && liveUsage !== undefined ? liveUsage : summaryValue(list, id, 'tokenUsage')
          const rowRoutes = id === activeId && liveRoutes !== undefined ? liveRoutes : summaryValue(list, id, 'aiUsageRoutes')
          if (rowUsage === undefined && rowRoutes === undefined) continue
          rows.push({ id, title: row.displayTitle ?? id, updatedAt: row.updatedAt ?? 0, usage: rowUsage, routes: rowRoutes })
        }
        return rows
      }, [list, activeId, liveUsage, liveRoutes])

      const historyTotals = useMemo(() => {
        let buckets = emptyBuckets()
        let usd = 0
        let complete = true
        let covered = 0
        for (const row of history) {
          const rowBuckets = bucketsOf(row.usage) ?? bucketsOf(row.routes === undefined ? undefined : row.routes.totals)
          if (rowBuckets !== undefined) buckets = addBuckets(buckets, rowBuckets)
          if (row.routes === undefined) continue
          covered += 1
          const priced = pricedRoutes(row.routes.routes, priceTable, basis)
          usd += priced.usd
          if (!priced.complete) complete = false
        }
        // Token totals cover every listed Session (the official projection is
        // checkpointed); the cost covers only the Sessions this bundle has
        // folded, which starts when it is enabled.
        return { buckets, usd, complete, covered, total: history.length }
      }, [history, priceTable, basis])

      const models = useMemo(() => {
        const byModel = new Map()
        for (const row of history) {
          if (row.routes === undefined || !Array.isArray(row.routes.routes)) continue
          for (const route of row.routes.routes) {
            const key = `${route.provider}\u0000${route.model}`
            const entry = byModel.get(key) ?? {
              provider: route.provider, model: route.model, peak: emptyBuckets(), offPeak: emptyBuckets(), calls: 0,
            }
            entry.peak = addBuckets(entry.peak, route.peak)
            entry.offPeak = addBuckets(entry.offPeak, route.offPeak)
            entry.calls += route.calls
            byModel.set(key, entry)
          }
        }
        const rows = [...byModel.values()].map((entry) => {
          const cost = costOf(entry, priceTable, basis)
          return {
            provider: entry.provider,
            model: entry.model,
            tokens: cost.tokens,
            calls: entry.calls,
            usd: cost.usd,
            priced: cost.priced,
          }
        })
        rows.sort((left, right) => right.tokens - left.tokens)
        return rows
      }, [history, priceTable, basis])

      // A route that billed no tokens needs no rate and would only add a 0-width
      // bar, so the chart keeps the routes that actually consumed tokens.
      const chartModels = useMemo(() => models.filter(row => row.tokens > 0), [models])

      const modelsMax = chartModels.reduce((max, row) => Math.max(max, row.tokens), 0)
      // The same model id can be served through more than one provider; only
      // then does the chart label need the provider to stay unambiguous.
      const sharedModels = new Set(chartModels
        .filter(row => chartModels.some(other => other !== row && other.model === row.model))
        .map(row => row.model))

      const contextLimit = pressure?.contextWindow ?? routes?.contextWindow ?? undefined
      const used = pressure?.projectedTokens ?? pressure?.pressureTokens ?? undefined
      const percent = typeof contextLimit === 'number' && contextLimit > 0 && typeof used === 'number'
        ? Math.min(100, Math.max(0, (used / contextLimit) * 100))
        : null
      const remaining = typeof contextLimit === 'number' && typeof used === 'number' ? Math.max(0, contextLimit - used) : undefined

      const speed = stats !== undefined && stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1000) : undefined
      const cacheHit = sessionBuckets === undefined
        ? undefined
        : (() => {
          const prompt = promptTokens(sessionBuckets)
          return prompt > 0 ? Math.min(1, sessionBuckets.cacheReadTokens / prompt) : undefined
        })()

      const editableModels = useMemo(() => {
        const names = new Set([...Object.keys(DEFAULT_PRICES), ...Object.keys(overrides)])
        for (const row of models) names.add(row.model)
        return [...names].sort()
      }, [models, overrides])

      const updatePrefs = useCallback(
        (patch) => { prefsStore.set({ ...prefsStore.getSnapshot(), ...patch }) },
        [prefsStore],
      )

      const startDraft = useCallback(() => {
        const next = {}
        for (const model of editableModels) {
          const source = Object.hasOwn(priceTable, model) ? priceTable[model] : undefined
          next[model] = {
            peak: {
              cacheHit: inputRate(source?.peak?.cacheHit),
              cacheMiss: inputRate(source?.peak?.cacheMiss),
              output: inputRate(source?.peak?.output),
              cacheWrite: inputRate(source?.peak?.cacheWrite),
            },
            offPeak: {
              cacheHit: inputRate(source?.offPeak?.cacheHit),
              cacheMiss: inputRate(source?.offPeak?.cacheMiss),
              output: inputRate(source?.offPeak?.output),
              cacheWrite: inputRate(source?.offPeak?.cacheWrite),
            },
            effectiveFrom: source?.effectiveFrom ?? PRICE_EFFECTIVE,
          }
        }
        setDraft(next)
      }, [editableModels, priceTable])

      const commitDraft = useCallback(() => {
        if (draft === null) return
        const next = {}
        for (const [model, entry] of Object.entries(draft)) {
          const base = Object.hasOwn(DEFAULT_PRICES, model) ? DEFAULT_PRICES[model] : {}
          const patch = { peak: {}, offPeak: {}, effectiveFrom: entry.effectiveFrom }
          let changed = false
          for (const period of ['peak', 'offPeak']) {
            for (const field of ['cacheHit', 'cacheMiss', 'output', 'cacheWrite']) {
              const parsed = parseRate(entry[period][field])
              // A blank field keeps the published value; only a real difference
              // is stored, so untouched models keep following the list.
              if (parsed === undefined) continue
              if (parsed === (base[period] === undefined ? undefined : base[period][field])) continue
              patch[period][field] = parsed
              changed = true
            }
          }
          const effectiveFrom = entry.effectiveFrom ?? base.effectiveFrom ?? PRICE_EFFECTIVE
          if (!changed && effectiveFrom === (base.effectiveFrom ?? PRICE_EFFECTIVE)) continue
          next[model] = { ...patch, effectiveFrom }
        }
        pricesStore.set(next)
        setDraft(null)
        setSavedAt(Date.now())
      }, [draft, pricesStore])

      const resetPrices = useCallback(() => {
        pricesStore.set({})
        setDraft(null)
        setSavedAt(Date.now())
      }, [pricesStore])

      const loadBalance = useCallback(async () => {
        if (typeof readAccountBalance !== 'function') {
          setBalance({ state: 'unavailable' })
          return
        }
        setBalance({ state: 'loading' })
        try {
          const result = await readAccountBalance()
          if (result === null || result === undefined || result.ok !== true) {
            setBalance({ state: 'unavailable' })
            return
          }
          const value = result.value
          if (value === null || value === undefined || value.status !== 'ready') {
            setBalance({ state: 'unavailable' })
            return
          }
          setBalance({ state: 'ready', wallets: value.value ?? [], bonus: value.bonusWallets ?? [] })
        } catch (_error) {
          setBalance({ state: 'unavailable' })
        }
      }, [readAccountBalance])

      useEffect(() => {
        if (savedAt === 0) return undefined
        const timer = setTimeout(() => setSavedAt(0), 2500)
        return () => { clearTimeout(timer) }
      }, [savedAt])

      useEffect(() => {
        if (!prefs.accountEnabled) return
        void loadBalance()
      }, [prefs.accountEnabled, loadBalance])

      useEffect(() => {
        // Hiding the balance section must not leave its last wallets behind.
        if (!prefs.accountEnabled && balance.state !== 'idle') setBalance({ state: 'idle' })
      }, [prefs.accountEnabled, balance.state])

      const options = useMemo(() => {
        if (list === undefined || !Array.isArray(list.ids)) return []
        return list.ids
          .map(id => list.byId?.[id])
          .filter(row => row !== undefined)
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
          .slice(0, 40)
      }, [list])

      const routeLabel = routes?.lastRoute
      const incompleteCost = !sessionCost.complete || !taskCost.complete

      const langButton = (code) => h('button', {
        type: 'button',
        className: lang === code ? 'aum-btn aum-btnOn' : 'aum-btn',
        'aria-pressed': lang === code,
        onClick: () => updatePrefs({ lang: code }),
      }, code.toUpperCase())

      const header = h('div', { className: 'aum-head' },
        h('div', null,
          h('h2', { className: 'aum-title' }, tr('title')),
          h('div', { className: 'aum-subtitle' }, tr('subtitle')),
        ),
        h('div', { className: 'aum-actions' },
          h('div', { className: 'aum-lang', role: 'group', 'aria-label': tr('language') },
            langButton('en'),
            langButton('es'),
          ),
          h('button', {
            type: 'button',
            className: 'aum-btn',
            title: tr('minimizeHint'),
            onClick: () => {
              // Only float once navigation back to the Conversation succeeded;
              // otherwise the card would be hidden behind the panel it came from.
              updatePrefs({ floating: showPanel(null) })
            },
          }, tr('minimize')),
        ),
      )

      const routeLine = h('div', { className: 'aum-route' },
        h('span', { className: 'aum-routeLabel' }, tr('activeRoute')),
        routeLabel === null || routeLabel === undefined
          ? h('span', { className: 'aum-routeValue aum-muted' }, tr('noRoute'))
          : h('span', { className: 'aum-routeValue' }, `${routeLabel.provider} · ${routeLabel.model}`),
        routes === undefined
          ? null
          : h('span', { className: 'aum-chip', title: tr('tooltipCalls') }, label(routes.totals?.calls ?? 0, 'call', 'calls')),
        routes === undefined || (routes.totals?.retries ?? 0) === 0
          ? null
          : h('span', { className: 'aum-chip', title: tr('tooltipRetries') }, label(routes.totals.retries, 'retry', 'retries')),
        activeId === undefined
          ? null
          : h('span', { className: 'aum-chip aum-chipTruncate', title: `${tr('session')}: ${list?.byId?.[activeId]?.displayTitle ?? activeId}` },
            `${tr('session')}: ${list?.byId?.[activeId]?.displayTitle ?? activeId}`),
      )

      const contextSection = h('section', null,
        h('div', { className: 'aum-subhead' },
          h('h3', { className: 'aum-sectionTitle' }, tr('contextWindow')),
          percent === null ? null : h('span', { className: 'aum-chip' }, `${formatPercent(percent, lang)} · ${tr('approximate')}`),
        ),
        percent === null
          ? h('div', { className: 'aum-empty' },
            // No face means the Session is not open here; a face without fields
            // means the Session is open but no prompt has been reported yet.
            pressureFace === undefined
              ? tr('contextUnavailable')
              : pressure === undefined ? tr('contextPending') : tr('unavailable'))
          : h('div', null,
            h('div', {
              className: 'aum-barTrack',
              role: 'progressbar',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': Number(percent.toFixed(1)),
              'aria-valuetext': `${formatPercent(percent, lang)} · ${tr('approximate')}`,
              'aria-label': tr('contextWindow'),
            }, h('div', { className: 'aum-barFill', style: { width: `${percent}%`, background: barTone(percent) } })),
            h('div', { className: 'aum-barMeta' },
              h('span', null, `${tr('nextRequest')}: ${formatTokens(used)} / ${formatTokens(contextLimit)}`),
              h('span', null, `${tr('contextLeft')}: ${formatTokens(remaining)}`),
            ),
          ),
      )

      const metric = (label, value, note) => h('div', { className: 'aum-metric' },
        h('div', { className: 'aum-metricLabel' }, label),
        h('div', { className: 'aum-metricValue' }, value),
        note === undefined ? null : h('div', { className: 'aum-metricNote' }, note),
      )

      const tokenGrid = h('div', { className: 'aum-grid' },
        metric(tr('input'), sessionBuckets === undefined ? '—' : formatTokens(sessionBuckets.uncachedInputTokens)),
        metric(tr('output'), sessionBuckets === undefined ? '—' : formatTokens(sessionBuckets.outputTokens)),
        metric(tr('cacheRead'), sessionBuckets === undefined ? '—' : formatTokens(sessionBuckets.cacheReadTokens)),
        metric(tr('cacheWrite'), sessionBuckets === undefined ? '—' : formatTokens(sessionBuckets.cacheWriteTokens)),
        metric(tr('reasoning'), formatTokens(sessionReasoning), tr('reasoningNote')),
        metric(tr('totalBilled'), sessionBuckets === undefined ? '—' : formatTokens(billedTokens(sessionBuckets)), tr('tokens')),
      )

      const scopeRow = (label, value, note) => h('div', { className: 'aum-scopeRow' },
        h('span', { className: 'aum-scopeLabel' }, label),
        h('span', { className: 'aum-scopeValue' },
          value,
          note === undefined ? null : h('span', { className: 'aum-muted' }, ` · ${note}`),
        ),
      )

      const costSection = h('section', null,
        h('div', { className: 'aum-subhead' },
          h('h3', { className: 'aum-sectionTitle' }, tr('cost')),
          incompleteCost ? h('span', { className: 'aum-chip aum-warn' }, tr('incomplete')) : null,
        ),
        h('div', { className: 'aum-scopes' },
          scopeRow(
            tr('task'),
            lastTurn === undefined
              ? tr('unavailable')
              : `${taskCost.complete || taskCost.usd > 0 ? formatUsd(taskCost.usd) : tr('unavailable')} · ${formatTokens(billedTokens(taskBuckets))} ${tr('tokens')}`,
            lastTurn !== undefined && !taskCost.complete ? tr('incomplete') : undefined,
          ),
          scopeRow(
            tr('session'),
            sessionBuckets === undefined
              ? tr('unavailable')
              : `${routes === undefined || (sessionCost.usd === 0 && !sessionCost.complete) ? tr('unavailable') : formatUsd(sessionCost.usd)} · ${formatTokens(billedTokens(sessionBuckets))} ${tr('tokens')}`,
            routes !== undefined && !sessionCost.complete ? tr('incomplete') : undefined,
          ),
          scopeRow(
            tr('allSessions'),
            history.length === 0
              ? tr('unavailable')
              : `${historyTotals.covered === 0 || (historyTotals.usd === 0 && historyTotals.complete === false) ? tr('unavailable') : formatUsd(historyTotals.usd)} · ${formatTokens(billedTokens(historyTotals.buckets))} ${tr('tokens')}`,
            historyTotals.complete === false
              ? tr('incomplete')
              : `${tr('historyCostScope')} ${historyTotals.covered}/${historyTotals.total} ${tr('sessions').toLowerCase()}`,
          ),
        ),
      )

      const indicatorToggle = (key, label, checked) => h('label', {
        className: 'aum-hint',
        style: { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' },
      },
        h('input', {
          type: 'checkbox',
          checked,
          onChange: (event) => updatePrefs({ [key]: event.target.checked }),
        }),
        label,
      )

      const indicators = (prefs.showSpeed || prefs.showCacheHit) ? h('div', { className: 'aum-grid aum-gridTwo' },
        prefs.showSpeed
          ? metric(tr('speed'), speed === undefined ? tr('unavailable') : `${speed.toFixed(1)} ${tr('tokensPerSecond')}`)
          : null,
        prefs.showCacheHit
          ? metric(tr('cacheHit'), cacheHit === undefined ? tr('unavailable') : formatPercent(cacheHit * 100, lang))
          : null,
      ) : null

      const indicatorsSection = h('section', null,
        h('div', { className: 'aum-rowActions' },
          indicatorToggle('showSpeed', tr('showSpeed'), prefs.showSpeed),
          indicatorToggle('showCacheHit', tr('showCacheHit'), prefs.showCacheHit),
        ),
        indicators,
      )

      const turnsSection = h('section', null,
        h('div', { className: 'aum-subhead' },
          h('h3', { className: 'aum-sectionTitle' }, tr('turnsTitle')),
          h('span', { className: 'aum-chip' }, tr('turnsCap')),
        ),
        turns === undefined || !Array.isArray(turns.turns) || turns.turns.length === 0
          ? h('div', { className: 'aum-empty' }, tr('turnsEmpty'))
          : h('div', { className: 'aum-turns' },
            turns.turns.slice().reverse().slice(0, 12).map((turn) => {
              let buckets = emptyBuckets()
              let usd = 0
              let complete = true
              for (const route of turn.routes) {
                buckets = addBuckets(buckets, addBuckets(route.peak, route.offPeak))
                const price = Object.hasOwn(priceTable, route.model) ? priceTable[route.model] : undefined
                const cost = routeCost(route, price, basis)
                usd += cost.usd
                if (!cost.priced) complete = false
              }
              const names = [...new Set(turn.routes.map(route => route.model))].join(', ')
              return h('div', { className: 'aum-turnRow', key: `turn-${turn.turn}` },
                h('span', { className: 'aum-turnGoal' }, `${tr('turnLabel')} ${turn.turn + 1}`),
                h('span', { className: 'aum-turnMeta' },
                  `${formatTokens(billedTokens(buckets))} ${tr('tokensShort')}`,
                  turn.calls > 1 ? ` · ${label(turn.calls, 'call', 'calls')}` : '',
                  turn.retries > 0 ? ` · ${label(turn.retries, 'retry', 'retries')}` : '',
                  names === '' ? '' : ` · ${names}`,
                ),
                h('span', { className: complete ? 'aum-turnMeta' : 'aum-turnMeta aum-warn' },
                  complete || usd > 0 ? formatUsd(usd) : tr('unavailable'),
                ),
              )
            }),
          ),
      )

      const historySection = h('section', null,
        h('div', { className: 'aum-subhead' },
          h('h3', { className: 'aum-sectionTitle' }, tr('historyTitle')),
          models.some(row => !row.priced && row.tokens > 0)
            ? h('span', { className: 'aum-chip aum-warn' }, tr('incomplete'))
            : h('span', { className: 'aum-chip' }, tr('historyScope')),
        ),
        chartModels.length === 0
          ? h('div', { className: 'aum-empty' }, tr('historyEmpty'))
          : h('div', { className: 'aum-chart' }, chartModels.map((row) => h('div', { className: 'aum-chartRow', key: `${row.provider}/${row.model}` },
            h('span', { className: 'aum-chartLabel', title: `${row.provider} · ${row.model}` },
              sharedModels.has(row.model) ? `${row.model} · ${row.provider}` : row.model),
            h('div', { className: 'aum-chartTrack' },
              h('div', { className: 'aum-chartFill', style: { width: `${row.tokens === 0 || modelsMax === 0 ? 0 : Math.max(2, (row.tokens / modelsMax) * 100)}%` } }),
            ),
            h('span', { className: row.priced ? 'aum-chartValue' : 'aum-chartValue aum-warn' },
              `${formatTokens(row.tokens)} · ${row.priced ? formatUsd(row.usd) : tr('unavailable')}`,
            ),
          ))),
        h('div', { className: 'aum-hint' },
          `${tr('historyCostScope')} ${historyTotals.covered}/${historyTotals.total} ${tr('sessions').toLowerCase()}`),
      )

      const priceRow = (model) => {
        const entry = draft === null ? undefined : draft[model]
        const field = (period, name, label) => h('input', {
          className: 'aum-input',
          type: 'text',
          inputMode: 'decimal',
          'aria-label': `${model} · ${period === 'peak' ? tr('peakRates') : tr('offPeakRates')} · ${label}`,
          value: entry === undefined ? '' : entry[period][name],
          onChange: (event) => {
            const value = event.target.value
            setDraft((current) => {
              if (current === null) return current
              return { ...current, [model]: { ...current[model], [period]: { ...current[model][period], [name]: value } } }
            })
          },
        })
        if (entry === undefined) return null
        return h('div', { className: 'aum-priceGrid', key: `price-${model}` },
          h('span', { className: 'aum-priceModel' }, model),
          field('peak', 'cacheHit', tr('cacheHitRate')),
          field('peak', 'cacheMiss', tr('cacheMissRate')),
          field('peak', 'output', tr('outputRate')),
          field('peak', 'cacheWrite', tr('cacheWriteRate')),
          h('span', { className: 'aum-priceHead aum-priceModel' }, tr('offPeakRates')),
          field('offPeak', 'cacheHit', tr('cacheHitRate')),
          field('offPeak', 'cacheMiss', tr('cacheMissRate')),
          field('offPeak', 'output', tr('outputRate')),
          field('offPeak', 'cacheWrite', tr('cacheWriteRate')),
        )
      }

      const pricesSection = h('details', { className: 'aum-details' },
        h('summary', null, tr('pricesTitle')),
        h('div', { className: 'aum-detailsBody' },
          h('div', { className: 'aum-hint' }, tr('pricesHint')),
          h('div', { className: 'aum-rowActions' },
            h('label', { className: 'aum-hint', style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              tr('rateBasis'),
              h('select', {
                className: 'aum-select',
                value: prefs.basis,
                'aria-label': tr('rateBasis'),
                onChange: (event) => updatePrefs({ basis: event.target.value }),
              },
                h('option', { value: 'auto' }, tr('basisAuto')),
                h('option', { value: 'peak' }, tr('basisPeak')),
                h('option', { value: 'offPeak' }, tr('basisOffPeak')),
              ),
            ),
            h('button', { type: 'button', className: 'aum-btn', onClick: startDraft }, tr('priceEdit')),
            draft === null ? null : h('button', { type: 'button', className: 'aum-btn', onClick: commitDraft }, tr('savePrices')),
            h('button', { type: 'button', className: 'aum-btn', onClick: resetPrices }, tr('resetPrices')),
            savedAt === 0 ? null : h('span', { className: 'aum-hint' }, tr('saved')),
          ),
          draft === null
            ? h('div', { className: 'aum-chart' }, editableModels.map((model) => {
              const price = Object.hasOwn(priceTable, model) ? priceTable[model] : undefined
              return h('div', { className: 'aum-chartRow', key: `rate-${model}` },
                h('span', { className: 'aum-chartLabel' }, model),
                h('span', { className: 'aum-chartValue' },
                  price === undefined
                    ? tr('unavailable')
                    : `${tr('rateMissShort')} ${formatRate(price.peak?.cacheMiss)} / ${tr('rateOutShort')} ${formatRate(price.peak?.output)}`,
                ),
                h('span', { className: 'aum-chartValue' }, price?.effectiveFrom ?? '—'),
              )
            }))
            : h('div', { className: 'aum-detailsBody' },
              h('div', { className: 'aum-priceGrid' },
                h('span', { className: 'aum-priceHead aum-priceModel' }, tr('peakRates')),
                h('span', { className: 'aum-priceHead' }, tr('cacheHitRate')),
                h('span', { className: 'aum-priceHead' }, tr('cacheMissRate')),
                h('span', { className: 'aum-priceHead' }, tr('outputRate')),
                h('span', { className: 'aum-priceHead aum-priceOptional' }, tr('cacheWriteRate')),
              ),
              editableModels.map(priceRow),
              h('div', { className: 'aum-rowActions' },
                h('span', { className: 'aum-hint' }, tr('ratesVerified')),
                h('input', {
                  className: 'aum-input',
                  style: { width: '140px', textAlign: 'left' },
                  type: 'date',
                  'aria-label': tr('ratesVerified'),
                  value: draft[editableModels[0]]?.effectiveFrom ?? PRICE_EFFECTIVE,
                  onChange: (event) => {
                    const value = event.target.value
                    setDraft((current) => {
                      if (current === null) return current
                      const next = {}
                      for (const [model, entry] of Object.entries(current)) next[model] = { ...entry, effectiveFrom: value }
                      return next
                    })
                  },
                }),
              ),
            ),
        ),
      )

      const accountStatus = accountSupported === false
        ? tr('unavailable')
        : balance.state === 'unavailable' ? tr('unavailable')
          : balance.state === 'loading' ? tr('accountLoading') : null

      const accountSection = h('details', { className: 'aum-details' },
        h('summary', null, `${tr('accountTitle')}${accountStatus === null ? '' : `: ${accountStatus}`}`),
        h('div', { className: 'aum-detailsBody' },
          accountSupported === false
            ? h('div', { className: 'aum-empty' }, tr('accountNoApi'))
            : h('div', null,
              h('label', { className: 'aum-hint', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                h('input', {
                  type: 'checkbox',
                  checked: prefs.accountEnabled,
                  onChange: (event) => updatePrefs({ accountEnabled: event.target.checked }),
                }),
                tr('accountEnable'),
              ),
              h('div', { className: 'aum-hint' }, tr('accountHint')),
              balance.state === 'ready'
                ? h('div', { className: 'aum-scopes' },
                  ...(balance.wallets ?? []).map((wallet, index) => h('div', { className: 'aum-scopeRow', key: `wallet-${index}` },
                    h('span', { className: 'aum-scopeLabel' }, `${tr('accountWallet')} (${wallet.currency})`),
                    h('span', { className: 'aum-scopeValue' }, wallet.balance),
                  )),
                  ...(balance.bonus ?? []).map((wallet, index) => h('div', { className: 'aum-scopeRow', key: `bonus-${index}` },
                    h('span', { className: 'aum-scopeLabel' }, `${tr('accountBonus')} (${wallet.currency})`),
                    h('span', { className: 'aum-scopeValue' }, wallet.balance),
                  )),
                  (balance.wallets ?? []).length + (balance.bonus ?? []).length === 0
                    ? h('div', { className: 'aum-scopeRow' }, h('span', { className: 'aum-scopeLabel' }, tr('accountUnavailable')))
                    : null,
                )
                : h('div', { className: 'aum-empty' },
                  !prefs.accountEnabled
                    ? tr('accountIdle')
                    : balance.state === 'loading' ? tr('accountLoading')
                      : balance.state === 'unavailable' ? tr('accountUnavailable')
                        : tr('accountIdle'),
                ),
              prefs.accountEnabled
                ? h('div', { className: 'aum-rowActions' },
                  h('button', { type: 'button', className: 'aum-btn', onClick: () => void loadBalance() }, tr('accountRefresh')),
                )
                : null,
            ),
        ),
      )

      const sessionRow = h('div', { className: 'aum-route' },
        h('span', { className: 'aum-routeLabel' }, tr('sessionPicker')),
        h('select', {
          className: 'aum-select',
          value: selected ?? '',
          'aria-label': tr('sessionPicker'),
          onChange: (event) => setSelected(event.target.value === '' ? null : event.target.value),
        },
          h('option', { value: '' }, tr('autoSession')),
          options.map(row => h('option', { key: row.id, value: row.id }, row.displayTitle ?? row.id)),
        ),
      )

      const body = h('div', { className: 'aum-body' },
        sessionRow,
        routeLine,
        contextSection,
        tokenGrid,
        costSection,
        indicatorsSection,
        turnsSection,
        historySection,
        pricesSection,
        accountSection,
      )

      return h('div', { className: 'aum-root' },
        h('style', null, CSS),
        h('div', { className: 'aum-card', role: 'region', 'aria-label': tr('title') },
          header,
          body,
        ),
      )
    }

    /**
     * The floating card: the same headline figures in one small block.
     *
     * It lives in `shell.overlay`, so minimizing the panel returns the user to
     * the conversation while the monitor stays on screen. It hides itself while
     * the full panel is the selected main panel, so the two never duplicate.
     * @param props - slot props and the injected readers.
     * @returns the floating card, or null when it should not be drawn.
     */
    function UsageMini(props) {
      const {
        useSessions, usePanelInfo, projectionFace, retainSession, prefsStore, pricesStore,
        showPanel,
      } = props

      const list = useSessions(state => state)
      const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getSnapshot)
      const lang = prefs.lang === 'es' ? 'es' : 'en'
      const tr = useCallback((key) => {
        const dict = lang === 'es' ? ES : EN
        const value = dict[key] ?? EN[key]
        return typeof value === 'string' && value !== '' ? value : key
      }, [lang])

      const overrides = useSyncExternalStore(pricesStore.subscribe, pricesStore.getSnapshot, pricesStore.getSnapshot)
      const activeId = useMemo(() => resolveSession(list, null), [list])

      const [bindingRevision, setBindingRevision] = useState(0)
      useEffect(() => {
        if (activeId === undefined || typeof retainSession !== 'function') return undefined
        const reference = retainSession(activeId)
        let cancelled = false
        if (reference !== undefined && reference !== null && typeof reference.ready?.then === 'function') {
          reference.ready.then(() => {
            if (!cancelled) setBindingRevision(value => value + 1)
          }).catch(() => {})
        }
        return () => {
          cancelled = true
          try {
            reference?.release?.()
          } catch (_error) {
            /* A reference already released elsewhere is not an error here. */
          }
        }
      }, [activeId, retainSession])

      const routesFace = useMemo(() => projectionFace(activeId, 'aiUsageRoutes'), [projectionFace, activeId, bindingRevision])
      const pressureFace = useMemo(() => projectionFace(activeId, 'contextPressure'), [projectionFace, activeId, bindingRevision])
      const liveRoutes = useFace(routesFace)
      const pressure = useFace(pressureFace)
      const routes = liveRoutes ?? summaryValue(list, activeId, 'aiUsageRoutes')
      // The owner's own hook: the same panel selection the sidebar drives.
      const panelState = typeof usePanelInfo === 'function' ? usePanelInfo(value => value) : undefined

      const priceTable = useMemo(() => mergePrices(overrides), [overrides])
      const sessionCost = useMemo(
        () => pricedRoutes(routes === undefined ? undefined : routes.routes, priceTable, prefs.basis),
        [routes, priceTable, prefs.basis],
      )

      const contextLimit = pressure?.contextWindow ?? routes?.contextWindow ?? undefined
      const used = pressure?.projectedTokens ?? pressure?.pressureTokens ?? undefined
      const percent = typeof contextLimit === 'number' && contextLimit > 0 && typeof used === 'number'
        ? Math.min(100, Math.max(0, (used / contextLimit) * 100))
        : null

      const panelId = panelState === undefined || panelState === null ? null : panelState.activePanelId ?? null
      if (prefs.floating !== true || panelId === PANEL_ID) return null

      const route = routes?.lastRoute
      const costLabel = routes === undefined || (sessionCost.usd === 0 && !sessionCost.complete)
        ? tr('unavailable')
        : formatUsd(sessionCost.usd)

      return h('div', { className: 'aum-float', role: 'region', 'aria-label': tr('floatingTitle') },
        h('style', null, CSS),
        h('div', { className: 'aum-floatHead' },
          h('span', { className: 'aum-floatTitle' }, tr('floatingTitle')),
          h('button', {
            type: 'button',
            className: 'aum-btn',
            onClick: () => {
              prefsStore.set({ ...prefs, floating: false })
              showPanel(PANEL_ID)
            },
          }, tr('openPanel')),
          h('button', {
            type: 'button',
            className: 'aum-btn',
            'aria-label': tr('hideCard'),
            title: tr('hideCard'),
            onClick: () => prefsStore.set({ ...prefs, floating: false }),
          }, '×'),
        ),
        h('div', { className: 'aum-floatRoute' },
          route === null || route === undefined ? tr('noRoute') : `${route.provider} · ${route.model}`),
        h('div', {
          className: 'aum-barTrack',
          style: { marginTop: '6px' },
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': percent === null ? 0 : Number(percent.toFixed(1)),
          'aria-label': tr('contextWindow'),
        }, h('div', {
          className: 'aum-barFill',
          style: {
            width: `${percent === null ? 0 : percent}%`,
            background: percent === null ? 'var(--dsw-alias-state-idle-primary)' : barTone(percent),
          },
        })),
        h('div', { className: 'aum-barMeta' },
          h('span', null, percent === null ? tr('contextUnavailable') : `${formatPercent(percent, lang)} · ${tr('approximate')}`),
          h('span', null, `${tr('cost')}: ${costLabel}`),
        ),
      )
    }

    /**
     * The sidebar entry glyph: three ascending bars under a capacity arc.
     * @param props - owner props (`size`, `active`).
     * @returns the icon element.
     */
    function MonitorIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      const active = props.active === true
      const stroke = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': true,
        focusable: false,
      },
        h('path', {
          d: 'M6 22a12 12 0 0 1 24 0',
          stroke,
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          opacity: 0.55,
        }),
        h('rect', { x: 9, y: 20, width: 4.4, height: 8, rx: 1.4, fill: stroke, opacity: 0.55 }),
        h('rect', { x: 15.8, y: 16, width: 4.4, height: 12, rx: 1.4, fill: stroke, opacity: 0.78 }),
        h('rect', { x: 22.6, y: 11.5, width: 4.4, height: 16.5, rx: 1.4, fill: stroke }),
      )
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'layout', 'remote'],

      /**
       * Register the dictionaries, the sidebar entry, and the panel.
       * @param ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'ai-usage-monitor: english dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'es', ES), 'ai-usage-monitor: spanish dictionary')
        const t = ctx.locale.bind(NS)

        const projectionFace = (sessionId, key) => {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          const binding = ctx.sessions.binding(sessionId)
          if (binding === undefined || binding === null) return undefined
          const projections = binding.session?.projections
          return projections === undefined || typeof projections.faceOf !== 'function'
            ? undefined
            : projections.faceOf(key)
        }

        const readAccountBalance = async () => {
          try {
            const account = ctx.remote === undefined || ctx.remote === null ? undefined : ctx.remote.account
            if (account === undefined || typeof account.getBalance !== 'function') return null
            const active = ctx.locale.getSnapshot().active
            const metadata = {
              version: globalThis.process?.env?.DSH_CLIENT_VERSION ?? '0.0.0',
              locale: typeof active === 'string' ? active : 'en',
              timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
            }
            return await account.getBalance(metadata)
          } catch (_error) {
            // Without the account namespace this provider simply has no balance API.
            return null
          }
        }

        const retainSession = (sessionId) => {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          if (ctx.sessions === undefined || typeof ctx.sessions.retain !== 'function') return undefined
          try {
            return ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
          } catch (_error) {
            return undefined
          }
        }

        // The plugin ships English and Spanish; the panel's toggle is the
        // authority, and the first run starts in the user's DSH language.
        const activeLocale = String(ctx.locale.getSnapshot().active ?? 'en').toLowerCase()
        const defaultLang = activeLocale.startsWith('es') ? 'es' : 'en'
        const prefsStore = createJsonStore(PREFS_KEY, { ...DEFAULT_PREFS, lang: defaultLang })
        const pricesStore = createJsonStore(PRICES_KEY, {})
        const layout = ctx.layout
        const hasAccountBalance = () => {
          try {
            const account = ctx.remote === undefined || ctx.remote === null ? undefined : ctx.remote.account
            return account !== undefined && account !== null && typeof account.getBalance === 'function'
          } catch (_error) {
            // Reading an uninjected Remote namespace throws; that is a provider
            // without a documented balance API from this plugin's point of view.
            return false
          }
        }
        const showPanel = (panelId) => {
          if (layout === undefined || layout === null || typeof layout.selectPanel !== 'function') return false
          try {
            layout.selectPanel(panelId)
            return true
          } catch (_error) {
            /* A panel id that is not registered yet leaves navigation unchanged. */
            return false
          }
        }

        const props = () => ({
          projectionFace,
          readAccountBalance,
          retainSession,
          prefsStore,
          pricesStore,
          showPanel,
          accountAvailable: hasAccountBalance,
        })

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: props,
        }, UsagePanel))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ai-usage-monitor-mini',
          order: 40,
          locale: NS,
          inject: props,
        }, UsageMini))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t('title'),
        }, MonitorIcon))
      },
    }
  },
})
