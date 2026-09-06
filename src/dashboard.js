// Server-rendered dashboard HTML — no client JS, no external deps

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const flag = (cc) => {
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0)));
};

function chartSVG(series, days) {
    if (!series.length) return '';
    const byDay = Object.fromEntries(series.map(r => [r.day, r.visitors]));
    const out = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
        out.push({ day: d, visitors: byDay[d] || 0 });
    }
    const max = Math.max(1, ...out.map(o => o.visitors));
    const W = 900, H = 160, gap = 3;
    const bw = (W - gap * (out.length - 1)) / out.length;
    const bars = out.map((o, i) => {
        const h = Math.round((o.visitors / max) * (H - 24));
        const x = i * (bw + gap);
        const y = H - h;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="2"><title>${o.day}: ${o.visitors} visitor${o.visitors === 1 ? '' : 's'}</title></rect>`;
    }).join('');
    const labels = [0, Math.floor(out.length / 2), out.length - 1]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map(i => `<text x="${(i * (bw + gap) + bw / 2).toFixed(1)}" y="${H - 4}" font-size="10" fill="#9ca3af" text-anchor="middle">${out[i].day.slice(5)}</text>`)
        .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:160px" xmlns="http://www.w3.org/2000/svg"><g fill="#6366f1">${bars}</g>${labels}</svg>`;
}

function table(title, rows, keyFn) {
    if (!rows.length) return '';
    return `<div class="card"><h2>${title}</h2><table>
        <thead><tr><th>${rows.length === 10 ? 'Top 10' : ''}</th><th>Visitors</th><th>Pageviews</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td class="k">${keyFn(r)}</td><td>${r.visitors}</td><td>${r.pageviews}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

function hostPill(host) {
    const label = host.split('.').length >= 3 ? host.split('.')[0] : 'www';
    const hue = [...host].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7) % 360;
    return `<span class="hpill" style="background:hsl(${hue},60%,45%)" title="${esc(host)}">${esc(label)}</span>`;
}

export function renderDashboard({ slug, days, totals, series, pages, referrers, countries, journeys, hosts, notFound }) {
    const hasData = totals && Number(totals.pageviews) > 0;
    const range = [['7', 7], ['30', 30], ['90', 90]].map(([label, d]) =>
        `<a class="range${d === days ? ' active' : ''}" href="/${esc(slug)}?days=${d}">${label}d</a>`).join('');

    if (!hasData) {
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(slug)} · fork stats</title><style>${CSS}</style></head><body>
<main><p class="brand"><a href="/">fork stats</a></p><h1>${esc(slug)}</h1>
<p>No pageviews in the last ${days} days. Drop this line in the <code>&lt;head&gt;</code> of the site:</p>
<pre>&lt;script defer data-website="${esc(slug)}" src="https://analytics.fork.studio/beacon.js"&gt;&lt;/script&gt;</pre>
<p class="dim">No cookies, no personal data — unique visitors are a daily-rotating hash of IP + browser, country only.</p>
</main></body></html>`;
    }

    const multiHost = new Set((pages || []).filter(p => p.host).map(p => p.host)).size > 1;
    const pageLabel = (r) => {
        if (r.host) {
            return `<a href="https://${esc(r.host)}${esc(r.path)}">${esc(r.path)}</a>${multiHost ? hostPill(r.host) : ''}`;
        }
        return esc(r.path);
    };

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(slug)} · fork stats</title><style>${CSS}</style></head><body>
<main><p class="brand"><a href="/">fork stats</a> <span class="rangebox">${range}</span></p>
<h1>${esc(slug)}</h1>
<div class="stats"><div class="card stat"><span class="n">${totals.visitors}</span><span class="l">Unique visitors</span></div>
<div class="card stat"><span class="n">${totals.pageviews}</span><span class="l">Pageviews</span></div></div>
<div class="card">${chartSVG(series, days)}</div>
<div class="cols">
${table('Top pages', pages, pageLabel)}
${table('Referrers', referrers, r => esc(r.referrer))}
${table('Locations', countries, r => `${flag(r.country)} ${esc(r.country)}`)}
</div>
${(hosts || []).length ? `<div class="card"><h2>Hosts</h2><table>
<thead><tr><th></th><th>Visitors</th><th>Pageviews</th></tr></thead>
<tbody>${hosts.map(h => `<tr><td class="k">${esc(h.host)}</td><td>${h.visitors}</td><td>${h.pageviews}</td></tr>`).join('')}</tbody>
</table></div>` : ''}
${(notFound || []).length ? `<div class="card"><h2>Not found (${notFound.reduce((a, r) => a + r.hits, 0)} hits)</h2><table>
<thead><tr><th>404 path</th><th>Visitors</th><th>Hits</th></tr></thead>
<tbody>${notFound.map(r => `<tr><td class="k">${esc(r.path)}</td><td>${r.visitors}</td><td>${r.hits}</td></tr>`).join('')}</tbody>
</table></div>` : ''}
${(journeys || []).length ? `<div class="card"><h2>Journeys</h2><table>
<tbody>${journeys.map(j => `<tr><td class="k"><a href="/${esc(slug)}/${esc(j.journey)}">${esc(j.journey)}</a></td><td>${j.visitors} visitors</td><td></td></tr>`).join('')}</tbody>
</table></div>` : ''}
<p class="dim">Last ${days} days · no cookies, no personal data · unique visitors = daily-rotating anonymous hash</p>
</main></body></html>`;
}

const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#111}
main{max-width:900px;margin:0 auto;padding:32px 20px}
.brand{font-weight:600}.brand a{color:inherit;text-decoration:none}
.rangebox{float:right;display:flex;gap:4px}
.range{padding:2px 10px;border-radius:99px;border:1px solid #e5e7eb;text-decoration:none;color:#374151;font-size:13px}
.range.active{background:#111;color:#fff;border-color:#111}
h1{margin:8px 0 20px;font-size:26px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;margin-bottom:14px}
.stats{display:flex;gap:14px;margin-bottom:14px}
.stat{flex:1;display:flex;flex-direction:column}
.stat .n{font-size:30px;font-weight:700}.stat .l{color:#6b7280;font-size:13px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;color:#9ca3af;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px 6px 0}
th:nth-child(n+2),td:nth-child(n+2){text-align:right}
td{padding:6px 8px 6px 0;border-top:1px solid #f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
td.k{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
td.k a{color:#4338ca}
.hpill{display:inline-block;color:#fff;font-size:10px;font-weight:600;line-height:1;padding:3px 7px;border-radius:99px;margin-left:8px;vertical-align:middle}
pre{background:#111;color:#e5e7eb;padding:14px 16px;border-radius:10px;overflow-x:auto;font-size:13px}
.dim{color:#9ca3af;font-size:13px}
svg rect:hover{fill:#4338ca}
`;

function hhmm(iso) {
    return String(iso || '').slice(11, 16);
}

function dayLabel(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}

function dot(hash) {
    const hue = parseInt(hash.slice(0, 4), 16) % 360;
    return `<span class="dot" style="background:hsl(${hue},60%,45%)"></span>`;
}

function visitorTable(visitors, funnel) {
    if (!visitors || !visitors.length) return '';
    const multiHost = new Set(funnel.filter(f => f.host).map(f => f.host)).size > 1;
    const label = (s) => (multiHost && s.host ? `${esc(s.host)}${s.step.startsWith('/') ? '' : ' · '}${esc(s.step)}` : esc(s.step));

    const rows = visitors.slice(0, 20).map(v => {
        const seq = v.steps.map(s => `<span class="vstep"><span class="vt">${hhmm(s.t)}</span> ${label(s)}</span>`).join('<span class="varrow">→</span>');
        const status = v.completed
            ? `<span class="ok">completed</span>`
            : `<span class="stall">stalled at ${label(v.steps[v.steps.length - 1])} · ${ago(v.lastT)}</span>`;
        return `<tr>
            <td class="vid">${dot(v.hash)}${esc(v.hash.slice(0, 8))}</td>
            <td class="vseq">${seq}</td>
            <td class="vstat">${status}<br><span class="dim">${dayLabel(v.firstT)}</span></td>
        </tr>`;
    }).join('');

    return `<div class="card"><h2>Visitors (${visitors.length}${visitors.length > 20 ? ', showing 20 recent' : ''})</h2><table class="vtable">
<thead><tr><th>Visitor</th><th>Steps (in order, first touch)</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;
}

export function renderJourney({ slug, journey, days, funnel, visitors, steps }) {
    const range = [['7', 7], ['30', 30], ['90', 90]].map(([label, d]) =>
        `<a class="range${d === days ? ' active' : ''}" href="/${esc(slug)}/${esc(journey)}?days=${d}">${label}d</a>`).join('');

    if (!funnel.length) {
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(journey)} · ${esc(slug)} · fork stats</title><style>${CSS}</style></head><body>
<main><p class="brand"><a href="/">fork stats</a> / <a href="/${esc(slug)}">${esc(slug)}</a></p><h1>${esc(journey)}</h1>
<p>No journey events in the last ${days} days. Track a journey with any of these:</p>
<pre>&lt;body data-journey="${esc(journey)}"&gt;   &lt;!-- every pageview becomes a step --&gt;</pre>
<pre>&lt;button data-journey="${esc(journey)}" data-journey-step="clicked"&gt;Go&lt;/button&gt;</pre>
<pre>import { journey } from '@fork/stats'; journey('${esc(journey)}', 'form-submitted')</pre>
<p class="dim">Journeys are same-day per visitor (daily-rotating anonymous hash) · steps are ordered by first seen</p>
</main></body></html>`;
    }

    const starters = funnel[0].visitors;
    const multiHost = new Set(funnel.filter(f => f.host).map(f => f.host)).size > 1;
    const stepLabel = (f) => (multiHost && f.host ? `${esc(f.host)}${f.step.startsWith('/') ? '' : ' · '}${esc(f.step)}` : esc(f.step));
    const rows = funnel.map((f, i) => `
        <tr>
            <td class="k">${i + 1}. ${stepLabel(f)}</td>
            <td><div class="fbar"><div class="ffill" style="width:${Math.max(2, f.pctOfStart)}%"></div></div></td>
            <td>${f.visitors}</td>
            <td>${f.pctOfStart}%</td>
            <td>${i === 0 ? '—' : f.pctFromPrev + '%'}</td>
        </tr>`).join('');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(journey)} · ${esc(slug)} · fork stats</title><style>${CSS}
.fbar{background:#f3f4f6;border-radius:4px;height:14px;min-width:120px}.ffill{background:#6366f1;height:14px;border-radius:4px}
th.r,td.r{text-align:right}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:baseline}
.vid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:nowrap}
.vseq{font-size:13px;line-height:1.9}
.vstep{white-space:nowrap}
.vt{color:#9ca3af;font-size:11px;margin-right:2px}
.varrow{color:#c4b5fd;margin:0 7px}
.ok{color:#059669;font-weight:600}
.stall{color:#b45309;font-weight:600}
.vtable td{vertical-align:top}
.vstat{white-space:nowrap}
</style></head><body>
<main><p class="brand"><a href="/">fork stats</a> / <a href="/${esc(slug)}">${esc(slug)}</a> <span class="rangebox">${range}</span></p>
<h1>${esc(journey)}</h1>
<div class="stats"><div class="card stat"><span class="n">${starters}</span><span class="l">Journey starters</span></div>
<div class="card stat"><span class="n">${funnel[funnel.length - 1].visitors}</span><span class="l">Completed (${funnel[funnel.length - 1].pctOfStart}%)</span></div></div>
<div class="card"><table>
<thead><tr><th>Step</th><th></th><th class="r">Visitors</th><th class="r">Of starters</th><th class="r">From prev</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
${visitorTable(visitors, funnel)}
<p class="dim">Last ${days} days · ${steps.length} step${steps.length === 1 ? '' : 's'} · a visitor reaches a step only after touching every earlier step in order · times UTC</p>
</main></body></html>`;
}
