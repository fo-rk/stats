import { Hono } from 'hono';
import { customAlphabet } from 'nanoid';
import { renderDashboard } from './dashboard.js';

const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 22);

const app = new Hono();

// ---------- helpers ----------

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const str = (v, max = 256) => (typeof v === 'string' && v.length > 0 && v.length <= max) ? v : null;

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
    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.text('Bad JSON', 400);
    }

    const website = str(body?.website, 64);
    if (!website || !SLUG.test(website)) {
        return c.text('Bad website', 400);
    }

    let path = str(body?.url, 512);
    if (!path || !path.startsWith('/')) {
        return c.text('Bad url', 400);
    }
    path = path.split('?')[0].split('#')[0] || '/';

    let referrer = null;
    const rawReferrer = str(body?.referrer, 512);
    if (rawReferrer) {
        try { referrer = new URL(rawReferrer).hostname.toLowerCase(); } catch {}
    }

    const country = (typeof c.req.raw.cf?.country === 'string' && /^[A-Z]{2}$/.test(c.req.raw.cf.country))
        ? c.req.raw.cf.country
        : null;

    const ip = c.req.header('CF-Connecting-IP') || '';
    const ua = c.req.header('User-Agent') || '';
    const day = new Date().toISOString().slice(0, 10);

    // Daily-rotating anonymous visitor id: no cookies, no PII,
    // same visitor resolves to a different id each day
    const visitor_hash = (await sha256hex(`${ip}|${ua}|${website}|${day}|${c.env.STATS_SALT || ''}`)).slice(0, 16);

    await c.env.STATS.send({
        table: 'pageviews',
        id: nanoid(),
        website,
        path,
        referrer,
        country,
        visitor_hash,
        timestamp: new Date().toISOString()
    });

    return c.json({ ok: true }, 200, CORS);
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

    const [totals, series, pages, referrers, countries] = await db.batch([
        db.prepare(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2`).bind(slug, cutoff),
        db.prepare(`SELECT substr(timestamp, 1, 10) AS day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 GROUP BY day ORDER BY day`).bind(slug, cutoff),
        db.prepare(`SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 GROUP BY path ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT referrer, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND referrer IS NOT NULL
                    GROUP BY referrer ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff),
        db.prepare(`SELECT country, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors
                    FROM pageviews WHERE website = ?1 AND timestamp >= ?2 AND country IS NOT NULL
                    GROUP BY country ORDER BY pageviews DESC LIMIT 10`).bind(slug, cutoff)
    ]);

    return c.html(
        renderDashboard({
            slug,
            days,
            totals: totals.results[0],
            series: series.results,
            pages: pages.results,
            referrers: referrers.results,
            countries: countries.results
        }),
        200,
        { 'Cache-Control': 'no-store' }
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
                if (body?.table === 'pageviews') {
                    const website = str(body.website, 64);
                    const path = str(body.path, 512);
                    const visitorHash = str(body.visitor_hash, 32);
                    const timestamp = str(body.timestamp, 32);
                    const id = str(body.id, 64);
                    const referrer = body.referrer === null ? null : str(body.referrer, 256);
                    const country = body.country === null ? null : str(body.country, 2);

                    if (!id || !website || !SLUG.test(website) || !path || !path.startsWith('/')
                        || !visitorHash || !/^[a-f0-9]{16}$/.test(visitorHash) || !timestamp) {
                        console.log('Invalid pageview message, discarding', JSON.stringify(body));
                        message.ack();
                        continue;
                    }

                    stmts.push(env.DB.prepare(`
                        INSERT OR IGNORE INTO pageviews (id, website, path, referrer, country, visitor_hash, timestamp)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    `).bind(id, website, path, referrer, country, visitorHash, timestamp));
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
