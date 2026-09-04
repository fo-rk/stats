/* fork stats — privacy-respecting pageview + journey tracking
 * Usage: <script defer data-website="your-slug" src="https://analytics.fork.studio/beacon.js"></script>
 *
 * Journeys:
 *   <body data-journey="join">                                              — every pageview is a journey step
 *   <button data-journey="join" data-journey-step="donate-clicked">Donate</button>  — click steps
 *   <script>fork('join', 'form-submitted')</script>                          — programmatic steps
 *
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

    var lastSent = {};

    function isLocal() {
        return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(location.hostname);
    }

    function dedupe(key) {
        var now = Date.now();
        if (lastSent[key] && now - lastSent[key] < 3000) return false;
        lastSent[key] = now;
        return true;
    }

    function send(payload) {
        try {
            fetch(endpoint, {
                method: 'POST',
                keepalive: true,
                // text/plain keeps this a CORS "simple request" — no preflight
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify(payload)
            }).catch(function () {});
        } catch (e) {}
    }

    function pageJourney() {
        return document.body && document.body.dataset.journey
            || document.documentElement.dataset.journey;
    }

    function sendPage() {
        if (isLocal()) return;
        var path = location.pathname;
        if (!dedupe('page:' + path)) return;
        send({
            website: website,
            url: path,
            referrer: document.referrer || null,
            journey: pageJourney() || undefined
        });
    }

    function stepName(el) {
        var step = el.getAttribute('data-journey-step');
        if (step) return step;
        if (el.id) return el.id;
        var text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text) return text.slice(0, 64);
        return el.tagName.toLowerCase();
    }

    function onJourneyClick(event) {
        var el;
        try { el = event.target && event.target.closest('[data-journey]'); } catch (e) { return; }
        // body/html data-journey marks whole pages, not individual clicks
        if (!el || el === document.body || el === document.documentElement) return;
        if (isLocal()) return;
        var journey = el.getAttribute('data-journey');
        var step = stepName(el);
        if (!dedupe('click:' + journey + ':' + step)) return;
        send({
            website: website,
            journey: journey,
            step: step,
            kind: 'click',
            url: location.pathname
        });
    }

    // Programmatic steps for inline scripts (module users get @fork/stats instead)
    window.fork = function (journey, step) {
        if (!journey || !step || isLocal()) return;
        if (!dedupe('fork:' + journey + ':' + step)) return;
        send({ website: website, journey: journey, step: step, kind: 'custom' });
    };

    document.addEventListener('click', onJourneyClick, true);

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
            whenVisible(sendPage);
            return result;
        };
    }
    hook('pushState');
    hook('replaceState');
    window.addEventListener('popstate', function () { whenVisible(sendPage); });

    whenVisible(sendPage);
})();
