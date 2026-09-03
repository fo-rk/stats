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

export function renderDashboard({ slug, days, totals, series, pages, referrers, countries }) {
    const hasData = totals && Number(totals.pageviews) > 0;
    const range = [['7', 7], ['30', 30], ['90', 90]].map(([label, d]) =>
        `<a class="range${d === days ? ' active' : ''}" href="/${esc(slug)}?days=${d}">${label}d</a>`).join('');

    if (!hasData) {
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(slug)} · fork stats</title><style>${CSS}</style></head><body>
<main><p class="brand"><a href="/">fork stats</a></p><h1>${esc(slug)}</h1>
<p>No pageviews in the last ${days} days. Drop this line in the <code>&lt;head&gt;</code> of the site:</p>
<pre>&lt;script defer data-website="${esc(slug)}" src="https://stats.fork.studio/stat.js"&gt;&lt;/script&gt;</pre>
<p class="dim">No cookies, no personal data — unique visitors are a daily-rotating hash of IP + browser, country only.</p>
</main></body></html>`;
    }

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(slug)} · fork stats</title><style>${CSS}</style></head><body>
<main><p class="brand"><a href="/">fork stats</a> <span class="rangebox">${range}</span></p>
<h1>${esc(slug)}</h1>
<div class="stats"><div class="card stat"><span class="n">${totals.visitors}</span><span class="l">Unique visitors</span></div>
<div class="card stat"><span class="n">${totals.pageviews}</span><span class="l">Pageviews</span></div></div>
<div class="card">${chartSVG(series, days)}</div>
<div class="cols">
${table('Top pages', pages, r => esc(r.path))}
${table('Referrers', referrers, r => esc(r.referrer))}
${table('Locations', countries, r => `${flag(r.country)} ${esc(r.country)}`)}
</div>
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
pre{background:#111;color:#e5e7eb;padding:14px 16px;border-radius:10px;overflow-x:auto;font-size:13px}
.dim{color:#9ca3af;font-size:13px}
svg rect:hover{fill:#4338ca}
`;
