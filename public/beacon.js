/* fork stats — privacy-respecting pageview tracking
 * Usage: <script defer data-website="your-slug" src="https://stats.fork.studio/stat.js"></script>
 * No cookies, no personal data. Unique visitors are a daily-rotating hash of IP + browser.
 */
(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) return;

    var website = script.getAttribute('data-website');
    if (!website) return;

    var endpoint;
    try {
        endpoint = new URL('/api/event', script.src).href;
    } catch (e) {
        return;
    }

    var lastPath = null;
    var lastAt = 0;

    function isLocal() {
        return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(location.hostname);
    }

    function send() {
        if (isLocal()) return;
        var path = location.pathname;
        var now = Date.now();
        if (path === lastPath && now - lastAt < 3000) return;
        lastPath = path;
        lastAt = now;
        try {
            fetch(endpoint, {
                method: 'POST',
                keepalive: true,
                // text/plain keeps this a CORS "simple request" — no preflight
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({
                    website: website,
                    url: path,
                    referrer: document.referrer || null
                })
            }).catch(function () {});
        } catch (e) {}
    }

    // Don't count prerendered/prefetched pages until they become visible
    function whenVisible(fn) {
        if (document.visibilityState !== 'prerender') {
            fn();
            return;
        }
        document.addEventListener('visibilitychange', function onVisible() {
            if (document.visibilityState !== 'prerender') {
                document.removeEventListener('visibilitychange', onVisible);
                fn();
            }
        });
    }

    // SPA navigation support
    function hook(name) {
        var original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function () {
            var result = original.apply(this, arguments);
            whenVisible(send);
            return result;
        };
    }
    hook('pushState');
    hook('replaceState');
    window.addEventListener('popstate', function () { whenVisible(send); });

    whenVisible(send);
})();
