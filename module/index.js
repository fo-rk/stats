/* @fork/stats — client module for fork stats analytics
 *
 *   import { init, page, journey } from '@fork/stats'
 *   init({ website: 'client-slug' })
 *   journey('join', 'form-submitted')
 *
 * - Safe to call any export before init(): events buffer until init runs
 * - Safe on the server (SSR): all functions no-op without a browser
 * - Never throws, never blocks the host app
 * - No cookies, no personal data — unique visitors are a daily-rotating hash computed server-side
 *
 * @typedef {{ website: string, endpoint?: string, auto?: boolean }} InitOptions
 */

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** @type {InitOptions | null} */
let config = null;
/** @type {Array<Record<string, string>>} */
let buffer = [];
const lastSent = {};

function isLocal() {
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(window.location.hostname);
}

function dedupe(key) {
    const now = Date.now();
    if (lastSent[key] && now - lastSent[key] < 3000) return false;
    lastSent[key] = now;
    return true;
}

function send(event) {
    try {
        fetch(config.endpoint, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify({ website: config.website, ...event })
        }).catch(() => {});
    } catch (e) { /* never break the host app */ }
}

function emit(event) {
    if (!isBrowser || isLocal()) return;
    if (config) {
        send(event);
    } else {
        buffer.push(event);
    }
}

/**
 * Initialise the module. Buffered events created before init are flushed.
 * @param {InitOptions} options
 */
export function init(options) {
    if (!isBrowser || !options || !options.website) return;
    config = {
        website: options.website,
        endpoint: options.endpoint || 'https://analytics.fork.studio/api/event',
        auto: !!options.auto
    };

    if (config.auto) {
        const track = () => page();
        const hook = (name) => {
            const original = history[name];
            if (typeof original !== 'function') return;
            history[name] = function () {
                const result = original.apply(this, arguments);
                track();
                return result;
            };
        };
        hook('pushState');
        hook('replaceState');
        window.addEventListener('popstate', track);
        track();
    }

    for (const event of buffer) send(event);
    buffer = [];
}

/**
 * Record a pageview. Call from router hooks, or use init({ auto: true }).
 * @param {string} [path] — defaults to the current pathname
 * @param {string} [journey] — optional journey this page belongs to
 */
export function page(path, journey) {
    if (!isBrowser) return;
    const p = (path || window.location.pathname).split('?')[0].split('#')[0] || '/';
    if (!dedupe('page:' + p)) return;
    emit({
        url: p,
        referrer: document.referrer || undefined,
        journey,
        kind: 'page'
    });
}

/**
 * Record a journey step (button clicks, form submissions, virtual steps).
 * @param {string} journey — journey name, e.g. 'join'
 * @param {string} step — step name, e.g. 'form-submitted'
 */
export function journey(journey, step) {
    if (!isBrowser || !journey || !step) return;
    if (!dedupe('step:' + journey + ':' + step)) return;
    emit({ journey, step: String(step).slice(0, 128), kind: 'custom' });
}
