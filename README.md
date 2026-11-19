# AI Usage Monitor

A DeepSeek Harness (DSH) plugin that adds a live usage monitor to the left
sidebar: token consumption, context headroom, and estimated USD cost, attributed
to the provider and model that actually served each call.

**Author: Alejavi Rivera**
- YouTube channel: <https://www.youtube.com/@alejavirivera>
- Video with the prompt that started this plugin: <https://www.youtube.com/watch?v=_fgcYcSA7oo&t=5s>

The plugin interface is available in **English and Spanish**, with an EN/ES
toggle at the top of the panel.

---

## What it shows

| Figure | Source |
| --- | --- |
| Provider and model of the latest call | `request/context` events and `assistant/message.source` |
| Input, output, cache-read, cache-write tokens | Harness `tokenUsage` projection |
| Reasoning tokens (shown separately) | This plugin's `aiUsageRoutes` projection |
| Tokens per task, session, and all listed sessions | `aiUsageTurns`, `tokenUsage`, and Session-list summary values |
| Context bar and headroom for the next request | Harness `contextPressure` (`projectedTokens`, `contextWindow`) |
| Generation speed and cache-hit ratio | Harness `sessionStats` plus the prompt token buckets |
| Cost per task, session, and history | Published per-million-token rates applied to the projections above |
| History by model | `aiUsageRoutes` summary value of every listed Session |
| Account balance (optional) | `ctx.remote.account.getBalance`, only after you enable it |

The bar and the "left for the next request" figure are labelled *approximate*:
they are anchored to the last prompt size the provider reported, plus a
heuristic repricing of everything the surface gained or lost since.

## Where to find it

1. Open the **Plugins** panel in the sidebar and install/enable **AI Usage
   Monitor** (this bundle).
2. Click the monitor icon in the sidebar's panel list. Its id is
   `ai-usage-monitor`, so it also addresses the matching main panel.
3. The panel header carries the **EN/ES** language toggle and a **Minimize**
   button. Minimizing returns to the Conversation and keeps the same headline
   figures in a small floating card. **Open panel** brings the full view back;
   the card hides itself while the full panel is open.

## Language

The plugin ships complete English and Spanish dictionaries. The **EN / ES**
toggle at the top of the panel switches the whole interface immediately and is
remembered per browser. On first run the panel starts in the language of the
Harness UI (Spanish Harness → Spanish panel), and the toggle then overrides it.

## Accounting rules

- **No model requests.** Every figure is folded from durable Session events the
  Harness already logs, and updates arrive through the projection change feed.
  There is no polling and no prompt. The optional account-balance read is the
  only additional request, and it is off by default.
- **Per-call routing, not per-session.** A settled message names its own
  `provider`/`model`; a streamed attempt is attributed to the newest
  `request/context` envelope. Switching models mid-session adds a second route
  in the same panel instead of rewriting the session's history.
- **Attempts settle one slot.** A `(turn, step)` slot is replaced, not
  accumulated, when it is re-settled. `llm/retry-started` closes the slot so a
  genuinely separate billed attempt adds its own usage. Replayed frames are
  idempotent, and a route that billed no tokens is treated as costing nothing.
- **Reasoning is never added twice.** Providers report reasoning as a subset of
  completion tokens, so it is displayed beside output and never summed into it.
- **Unknown is not invented.** A model without a verified rate renders as
  *unavailable*, and a cost that misses any rate is labelled *incomplete
  estimate*. Account quota reads *unavailable* when the provider exposes no
  balance API, and it is never confused with the remaining context window.

## Prices

Defaults are DeepSeek's published list prices in USD per 1M tokens
(`deepseek-flash`, its legacy ids, and `deepseek-v4-pro`), with the published
off-peak rate at half of peak. Peak hours are 01:00–04:00 and 06:00–10:00 UTC,
Monday through Friday, from
<https://api-docs.deepseek.com/quick_start/pricing>.

The **Prices** section opens the editable rate table for the models that appear
in the data: cache-hit, cache-miss, output, and an optional cache-write rate for
both peak and off-peak, plus the date the rates were verified and the rate basis
used for the estimate (*auto* applies each call's own peak/off-peak split).

Only rates that differ from the published list are stored, so an untouched model
keeps following the defaults and blanking a field restores that default.
Overrides live in `localStorage` (`aiUsageMonitor.prices.v1`);
**Reset to published** clears them.

DeepSeek publishes no separate cache-write rate, so a cache-write count is priced
at the cache-miss rate. Chinese public holidays are excluded from peak by the
published rules but are not modelled here, so a holiday weekday is charged at the
peak rate and the estimate leans high.

## Configuration

The bundle row accepts two keys in `cordis.patch.yml`:

```yaml
- id: ai-usage-monitor
  name: dsh-ai-usage-monitor
  config:
    trackAttempts: true   # count a settled attempt as soon as its usage lands
    maxTurns: 200         # per-task rows retained per Session
```

## Limitations

- Per-model history starts when this plugin is first enabled: older Sessions have
  no `aiUsageRoutes` checkpoint row yet, so they contribute tokens (from the
  official `tokenUsage` projection) but not a per-model cost. The history row
  states how many Sessions the cost covers.
- Watching a Session other than the open one retains its projection baseline — a
  durable read, not a model request — so the panel can show live values.
- Context pressure and per-task rows need the Session to be open in the browser;
  a Session known only from the list shows its summary totals.
- Token counts are provider-reported; cost is an estimate for reference, not a
  billing statement.

## Development

```sh
npm install
npm test
```

- `src/fold.js` — pure accounting helpers (buckets, pricing periods, retry and
  replacement rules).
- `src/units.js` — the two Session projection definitions built on those helpers.
- `index.js` — Host half: registers `aiUsageRoutes` and `aiUsageTurns`.
- `client.js` — browser half: sidebar entry, panel, floating card, price editor.

Automated coverage: 20 tests (`node --test`), including a render smoke test with
a minimal hook runtime (registration, empty and populated panels, the floating
card, the EN/ES toggle, unpriced and zero-token routes) and the fold rules over
synthetic event streams.

## License

MIT — see [LICENSE](LICENSE).
