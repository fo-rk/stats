# fork stats

Privacy-respecting web analytics on Cloudflare Workers + D1. One-line setup per site, per-client dashboards, named visitor journeys.

No cookies, no personal data: unique visitors are a daily-rotating anonymous hash of IP + browser (computed server-side), location is country-level only, referrers are stored as hostnames.

## Quick start (script tag)

Add to the `<head>` of any site:

```html
<script defer data-website="your-slug" src="https://analytics.fork.studio/beacon.js"></script>
```

Dashboard: `https://stats.fork.studio/your-slug` (supports `?days=7|30|90`). Hits appear within ~30 seconds.

- Localhost traffic is ignored
- Client-side routed sites (pushState/replaceState/popstate) are tracked automatically
- Prerendered/prefetched pages only count when they become visible

## Module (Nuxt, SvelteKit, React, …)

```sh
bun add github:fo-rk/stats
```

```js
import { init, page, journey } from '@fork/stats'

init({ website: 'your-slug' })        // once, in your app entry

journey('join', 'form-submitted')     // anywhere, any component, any time
page()                                // from router hooks, or use init({ auto: true })
```

- Safe to call before `init()` — events buffer until it runs
- SSR-safe — everything no-ops on the server
- Never throws, never blocks the host app

## Journeys

Track a named flow through pages and clicks:

```html
<body data-journey="join">                                              <!-- page steps -->
<button data-journey="join" data-journey-step="donate-clicked">Donate</button>  <!-- click steps -->
<script>fork('join', 'form-submitted')</script>                          <!-- programmatic (beacon global) -->
```

Dashboard: `stats.fork.studio/your-slug/join` — ordered funnel with visitors, % of starters and step-to-step conversion. Steps are ordered by first seen; a visitor only counts as reaching a step after touching every earlier step in order.

Journeys are same-day per visitor (daily-rotating hash) — a returning visitor tomorrow counts as a new visitor. That's the privacy model.

## Ingest API

`POST /api/event` (text/plain JSON, no preflight):

```json
{ "website": "slug", "url": "/path", "referrer": "https://host/page", "journey": "join", "step": "clicked", "kind": "page|click|custom" }
```

Events are queued (Cloudflare Queues) and batch-inserted into D1 idempotently.

## Also collected

Resend email events (sent/delivered/clicked/bounced) POST to `/resend` — same store, `website` taken from the `projectName` tag.

## Deploy

```sh
npm run deploy
```

Bindings: D1 `DB` (database `stats`), Queue `STATS` (`stats-queue`), secret `STATS_SALT` (any random string; rotates the visitor hash space). Migrations in `migrations/`.

## Dashboard routes

- `/:website` — pageviews, uniques, pages, referrers, countries, journeys list
- `/:website/:journey` — ordered funnel
- Unlisted but unauthenticated — put Cloudflare Access in front if that matters
