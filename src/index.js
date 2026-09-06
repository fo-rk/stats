import { Hono } from 'hono';
import { customAlphabet } from 'nanoid';
import { renderDashboard, renderJourney } from './dashboard.js';

const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 22);

const app = new Hono();

// ---------- helpers ----------

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const str = (v, max = 256) => (typeof v === 'string' && v.length > 0 && v.length <= max) ? v : null;

function normalizeHost(value) {
    if (!value) return null;
    try {
        const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
        return HOSTNAME.test(host) ? host : null;
    } catch {
        const host = String(value).toLowerCase().replace(/^www\./, '');
        return HOSTNAME.test(host) ? host : null;
    }
}

async function sha256hex(input) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Resend email events (existing) ----------

app.post("/resend", async (c) => {
    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.text('Bad JSON', 400);
    }

    const { type, data, created_at } = body || {};
    if (!data || typeof data !== 'object') {
        return c.text('Bad payload', 400);
    }

    const { email_id, tags } = data;

    if (!tags) {
        return c.text("OK");
    }

    const {
        documentId,
        participantId,
        projectName
    } = tags;

    await c.env.STATS.send({
        id: nanoid(),
        event: type.replace('email.', ''),
        source: 'resend',
        website: projectName,
        timestamp: created_at,
        data: JSON.stringify({
            participantId: participantId,
            documentId: documentId,
            eventId: email_id
        })
    });

    return c.text("OK");
});

// ---------- Web pageview ingest ----------

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type'
};

app.options('/api/event', (c) => c.body(null, 204, CORS));

app.post('/api/event', async (c) => {
    // Volume gate: abuse of the ingest is what runs up a bill
    // (token bucket: capacity ~= limit, refill limit/period per second, per IP)
    const ip = c.req.header('CF-Connecting-IP') || '';
    const { success } = await c.env.EVENT_LIMITER.limit({ key: ip });
    if (!success) {
        return c.text('Too many requests', 429, CORS);
    }

    // Browsers always send Origin on cross-origin POSTs; naive floods don't
    if (!c.req.header('Origin') && !c.req.header('User-Agent')) {
        return c.text('Forbidden', 403, CORS);
    }

    let body;
    try {
        const text = await c.req.text();
        if (text.length > 2048) {
            return c.text('Payload too large', 413, CORS);
        }
        body = JSON.parse(text);
    } catch {
        return c.text('Bad JSON', 400, CORS);
    }

    const website = str(body?.website, 64);
    if (!website || !SLUG.test(website)) {
        return c.text('Bad website', 400, CORS);
    }

    // Optional allowlist: set ALLOWED_SITES=slug1,slug2 as a secret to lock ingest down
    if (c.env.ALLOWED_SITES) {
        const allowed = String(c.env.ALLOWED_SITES).split(',').map(s => s.trim());
        if (!allowed.includes(website)) {
            return c.text('Unknown site', 403, CORS);
        }
    }

    let path = str(body?.url, 512);
    if (path && !path.startsWith('/')) {
        path = null;
    }
    if (path) {
        path = path.split('?')[0].split('#')[0] || '/';
    }

    let referrer = null;
    const rawReferrer = str(body?.referrer, 512);
    if (rawReferrer) {
        try { referrer = new URL(rawReferrer).hostname.toLowerCase(); } catch {}
    }

    const journey = str(body?.journey, 64);
    const hasJourney = journey && SLUG.test(journey);
    if (journey && !hasJourney) {
        return c.text('Bad journey', 400);
    }
    let step = str(body?.step, 128);
    if (step) {
        step = step.trim().slice(0, 128);
    }
    const kind = ['page', 'click', 'custom'].includes(body?.kind)
        ? body.kind
        : (path && !step ? 'page' : 'custom');
    if (!path && !hasJourney) {
        return c.text('Nothing to record', 400);
    }
    if (hasJourney && !step) {
        step = kind === 'page' && path ? path : null;
    }
    if (hasJourney && !step) {
        return c.text('Bad step', 400);
    }

    const country = (typeof c.req.raw.cf?.country === 'string' && /^[A-Z]{2}$/.test(c.req.raw.cf.country))
        ? c.req.raw.cf.country
        : null;

    // Browsers send Origin on cross-origin POSTs — the authoritative host of the hit
    const host = normalizeHost(c.req.header('Origin')) || normalizeHost(body?.host);

    // Optional page status (e.g. 404), only meaningful error codes accepted
    const status = (Number.isInteger(body?.status) && body.status >= 400 && body.status <= 599)
        ? body.status
        : null;

    const ua = c.req.header('User-Agent') || '';
    const day = new Date().toISOString().slice(0, 10);

    // Daily-rotating anonymous visitor id: no cookies, no PII,
    // same visitor resolves to a different id each day
    const visitor_hash = (await sha256hex(`${ip}|${ua}|${website}|${day}|${c.env.STATS_SALT || ''}`)).slice(0, 16);
    const timestamp = new Date().toISOString();

    if (path && kind === 'page') {
        await c.env.STATS.send({
            table: 'pageviews',
            id: nanoid(),
            website,
            path,
            host,
            referrer,
            country,
            status,
            visitor_hash,
            timestamp
        });
    }

    if (hasJourney) {
        await c.env.STATS.send({
            table: 'journey_events',
            id: nanoid(),
            website,
            journey,
            step,
            kind,
            host,
            visitor_hash,
            timestamp
        });
    }

    return c.json({ ok: true }, 200, CORS);
});

// ---------- Journey funnel ----------

function computeFunnel(rows) {
    // rows: { step, host, visitor_hash, t (first touch per visitor per host-step) }
    const globalFirst = {};
    for (const r of rows) {
        const key = r.host + '|' + r.step;
        if (!globalFirst[key] || r.t < globalFirst[key]) globalFirst[key] = r.t;
    }
    const steps = Object.keys(globalFirst).sort((a, b) => globalFirst[a] < globalFirst[b] ? -1 : 1);

    const byVisitor = new Map();
    for (const r of rows) {
        if (!byVisitor.has(r.visitor_hash)) byVisitor.set(r.visitor_hash, []);
        byVisitor.get(r.visitor_hash).push(r);
    }

    const lastStepKey = steps[steps.length - 1];
    const visitors = [];
    for (const [hash, events] of byVisitor) {
        // one entry per visitor per step (earliest touch), ordered in time
        const seen = new Map();
        for (const r of events) {
            const key = r.host + '|' + r.step;
            if (!seen.has(key) || r.t < seen.get(key).t) seen.set(key, r);
        }
        const sequence = [...seen.values()].sort((a, b) => a.t < b.t ? -1 : 1);
        visitors.push({
            hash,
            steps: sequence.map(r => ({ step: r.step, host: r.host, t: r.t })),
            firstT: sequence[0]?.t,
            lastT: sequence[sequence.length - 1]?.t,
            completed: seen.has(lastStepKey)
        });
    }
    visitors.sort((a, b) => (a.lastT < b.lastT ? 1 : -1));

    // Ordered funnel: a visitor "reaches" step N only if they touched
    // every earlier step at an earlier (or equal) time, in sequence
    const reached = new Array(steps.length).fill(0);
    for (const v of visitors) {
        const touched = new Map(v.steps.map(s => [s.host + '|' + s.step, s.t]));
        let cursor = '';
        for (let i = 0; i < steps.length; i++) {
            const t = touched.get(steps[i]);
            if (t && t >= cursor) {
                reached[i]++;
                cursor = t;
            } else {
                break;
            }
        }
    }

    const funnel = steps.map((key, i) => ({
        host: key.split('|')[0],
        step: key.split('|')[1],
        visitors: reached[i],
        pctOfStart: reached[0] ? Math.round((reached[i] / reached[0]) * 100) : 0,
        pctFromPrev: i === 0 ? 100 : (reached[i - 1] ? Math.round((reached[i] / reached[i - 1]) * 100) : 0)
    }));

    return { funnel, visitors };
}

app.get('/:slug/:journey', async (c) => {
    const slug = c.req.param('slug');
    const journey = c.req.param('journey');
    if (slug === 'resend' || slug === 'api' || !SLUG.test(slug) || !SLUG.test(journey)) {
        return c.text('Not found', 404);
    }

    const days = Math.min(Math.max(parseInt(c.req.query('days')) || 30, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const viewLimit = await c.env.VIEW_LIMITER.limit({ key: c.req.header('CF-Connecting-IP') || '' });
    if (!viewLimit.success) {
        return c.text('Too many requests', 429);
    }

    const { results } = await c.env.DB.prepare(`
        SELECT step, COALESCE(host, '') AS host, visitor_hash, MIN(timestamp) AS t
        FROM journey_events
        WHERE website = ?1 AND journey = ?2 AND timestamp >= ?3
        GROUP BY step, host, visitor_hash
    `).bind(slug, journey, cutoff).all();

    const { funnel, visitors } = computeFunnel(results || []);

    return c.html(
        renderJourney({
            slug,
            journey,
            days,
            funnel,
            visitors,
            steps: [...new Set((results || []).map(r => r.host + '|' + r.step))]
        }),
        200,
        { 'Cache-Control': 'public, max-age=30' }
    );
});

// ---------- Client dashboards ----------

app.get('/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (slug === 'resend' || slug === 'api' || slug === 'index.html' || !SLUG.test(slug)) {
        return c.text('Not found', 404);
    }

    const days = Math.min(Math.max(parseInt(c.req.query('days')) || 30, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const db = c.env.DB;

    // Gate before the query batch: dashboard reads are the expensive D1 cost
    const viewLimit = await c.env.VIEW_LIMITER.limit({ key: c.req.header('CF-Connecting-IP') || '' });
    if (!viewLimit.success) {
        return c.text('Too many requests', 429);
    }

    const [totals, series, pages, referrers, countries, journeys, hosts, notFound] = await db.batch([
        db.prepare(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND (status IS NULL OR status < 400)`).bind(slug, cutoff),
        db.prepare(`SELECT substr(timestamp, 1, 10) AS day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND (status IS NULL OR status < 400)
                    GROUP BY day ORDER BY day`).bind(slug, cutoff),
        db.prepare(`SELECT COALESCE(host, '') AS host, path, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND (status IS NULL OR status < 400)
                    GROUP BY host, path ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT referrer, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND referrer IS NOT NULL AND (status IS NULL OR status < 400)
                    GROUP BY referrer ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT country, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND country IS NOT NULL AND (status IS NULL OR status < 400)
                    GROUP BY country ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT journey, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM journey_events WHERE website = ?1 AND timestamp >= ?2
                    GROUP BY journey ORDER BY visitors DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT COALESCE(host, '(unknown)') AS host, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND host IS NOT NULL AND (status IS NULL OR status < 400)
                    GROUP BY host ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT path, COUNT(*) AS hits, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND status >= 400
                    GROUP BY path ORDER BY hits DESC LIMIT 10`).bind(slug, cutoff)
    ]);

    return c.html(
        renderDashboard({
            slug,
            days,
            totals: totals.results[0],
            series: series.results,
            pages: pages.results,
            referrers: referrers.results,
            countries: countries.results,
            journeys: journeys.results,
            hosts: hosts.results,
            notFound: notFound.results
        }),
        200,
        { 'Cache-Control': 'public, max-age=30' }
    );
});

export default {
    fetch: app.fetch,
    async queue(batch, env) {
        if (batch.queue !== 'stats-queue') return;

        const stmts = [];

        for (const message of batch.messages) {
            const body = message.body;

            try {
                if (body?.table === 'journey_events') {
                    const id = str(body.id, 64);
                    const website = str(body.website, 64);
                    const journey = str(body.journey, 64);
                    const step = str(body.step, 128);
                    const kind = str(body.kind, 16);
                    const visitorHash = str(body.visitor_hash, 32);
                    const timestamp = str(body.timestamp, 32);
                    const host = body.host === null ? null : normalizeHost(body.host);

                    if (!id || !website || !SLUG.test(website) || !journey || !SLUG.test(journey)
                        || !step || !kind || !visitorHash || !/^[a-f0-9]{16}$/.test(visitorHash) || !timestamp) {
                        console.log('Invalid journey message, discarding', JSON.stringify(body));
                        message.ack();
                        continue;
                    }

                    stmts.push(env.DB.prepare(`
                        INSERT OR IGNORE INTO journey_events (id, website, journey, step, kind, host, visitor_hash, timestamp)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                    `).bind(id, website, journey, step, kind, host, visitorHash, timestamp));
                } else if (body?.table === 'pageviews') {
                    const website = str(body.website, 64);
                    const path = str(body.path, 512);
                    const visitorHash = str(body.visitor_hash, 32);
                    const timestamp = str(body.timestamp, 32);
                    const id = str(body.id, 64);
                    const referrer = body.referrer === null ? null : str(body.referrer, 256);
                    const country = body.country === null ? null : str(body.country, 2);
                    const host = body.host === null ? null : normalizeHost(body.host);
                    const status = (Number.isInteger(body.status) && body.status >= 400 && body.status <= 599)
                        ? body.status
                        : null;

                    if (!id || !website || !SLUG.test(website) || !path || !path.startsWith('/')
                        || !visitorHash || !/^[a-f0-9]{16}$/.test(visitorHash) || !timestamp) {
                        console.log('Invalid pageview message, discarding', JSON.stringify(body));
                        message.ack();
                        continue;
                    }

                    stmts.push(env.DB.prepare(`
                        INSERT OR IGNORE INTO pageviews (id, website, path, host, referrer, country, status, visitor_hash, timestamp)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                    `).bind(id, website, path, host, referrer, country, status, visitorHash, timestamp));
                } else {
                    // Legacy shape: Resend email events -> stats table
                    const id = str(body?.id, 64);
                    const event = str(body?.event, 64);
                    const source = str(body?.source, 32);
                    const timestamp = str(body?.timestamp, 64);

                    if (!id || !event || !source || !timestamp) {
                        console.log('Invalid stats message, discarding', JSON.stringify(body));
                        message.ack();
                        continue;
                    }

                    stmts.push(env.DB.prepare(`
                        INSERT OR IGNORE INTO stats (id, event, source, website, timestamp, data)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    `).bind(id, event, source, str(body.website, 64), timestamp, typeof body.data === 'string' ? body.data : JSON.stringify(body.data ?? null)));
                }
            } catch (err) {
                console.log('Error preparing message, discarding', err);
                message.ack();
            }
        }

        if (stmts.length) {
            const result = await env.DB.batch(stmts);
            console.log('Batch submitted to D1', result.length, 'statements');
        }
    }
}
