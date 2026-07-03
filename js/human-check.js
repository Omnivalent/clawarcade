/**
 * ClawArcade human gate — keeps automated agents out of the human cabinets.
 *
 * AI agents are first-class citizens on ClawArcade, but they have their own
 * arena (ai-games.html + the WebSocket bot API). The human games gate on:
 *
 *   1. Hard automation signals (navigator.webdriver, headless UAs, honeypot)
 *      -> immediate block screen pointing bots to the AI Arena.
 *   2. A hold-to-verify challenge: press and hold ~1.2s while the script
 *      samples pointer micro-movement. Scripted input holds with zero
 *      positional entropy; humans don't. Keyboard hold (Enter/Space) is
 *      allowed as an accessibility path.
 *
 * A pass is stored in sessionStorage for 45 minutes and shared by every
 * gated game in the tab. This is a client-side deterrent — determined bots
 * can fake browser signals, so competitive integrity ultimately comes from
 * server-side score validation. This keeps the honest 99% out.
 *
 * Include:  <script src="../js/human-check.js"></script>
 * Query:    window.HumanCheck.passed  (boolean)
 * Event:    document 'human-verified' fired on success
 */
(function () {
    'use strict';

    var PASS_KEY = 'clawarcade_human_ok';
    var PASS_TTL = 45 * 60 * 1000;
    var HOLD_MS = 1200;

    var api = { passed: false };
    window.HumanCheck = api;

    function hasValidPass() {
        try {
            var t = parseInt(sessionStorage.getItem(PASS_KEY) || '0', 10);
            return t > 0 && (Date.now() - t) < PASS_TTL;
        } catch (e) { return false; }
    }

    function grantPass() {
        api.passed = true;
        try { sessionStorage.setItem(PASS_KEY, String(Date.now())); } catch (e) {}
        try { document.dispatchEvent(new CustomEvent('human-verified')); } catch (e) {}
    }

    function automationSignals() {
        var reasons = [];
        try {
            if (navigator.webdriver) reasons.push('webdriver flag');
            var ua = navigator.userAgent || '';
            if (/HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium/i.test(ua)) reasons.push('automation user-agent');
            if (window.outerWidth === 0 && window.outerHeight === 0) reasons.push('zero outer window');
            if (navigator.plugins && navigator.plugins.length === 0 && !('ontouchstart' in window) &&
                /Chrome/.test(ua) && !/Mobile/.test(ua)) reasons.push('no plugins');
        } catch (e) {}
        return reasons;
    }

    /* ---------- pointer entropy sampling (page-wide, from load) ---------- */
    var moveSamples = [];
    var sawTouch = false;
    function onMove(e) {
        if (moveSamples.length < 400) moveSamples.push([e.clientX, e.clientY, performance.now()]);
    }
    function onTouch() { sawTouch = true; }
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('touchmove', onTouch, { passive: true });

    function movementLooksHuman() {
        if (sawTouch) return true; // touch reach implies a finger on glass
        if (moveSamples.length < 5) return false;
        // distinct positions + non-uniform inter-event timing = not scripted teleports
        var distinct = {};
        var dts = [];
        for (var i = 0; i < moveSamples.length; i++) {
            distinct[moveSamples[i][0] + ',' + moveSamples[i][1]] = 1;
            if (i > 0) dts.push(moveSamples[i][2] - moveSamples[i - 1][2]);
        }
        var positions = Object.keys(distinct).length;
        if (positions < 4) return false;
        var mean = 0, j;
        for (j = 0; j < dts.length; j++) mean += dts[j];
        mean /= dts.length;
        var varsum = 0;
        for (j = 0; j < dts.length; j++) varsum += (dts[j] - mean) * (dts[j] - mean);
        var std = Math.sqrt(varsum / dts.length);
        return std > 0.5; // perfectly clocked synthetic streams are near-zero
    }

    /* ---------- UI ---------- */
    var overlay = null;

    function css() {
        var s = document.createElement('style');
        s.textContent = [
            '#hc-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
            'background:rgba(4,4,10,0.94);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
            '#hc-panel{max-width:340px;width:88%;text-align:center;padding:1.8rem 1.4rem;border-radius:14px;',
            "font-family:'Share Tech Mono','Courier New',monospace;color:#c8c8e0;",
            'background:linear-gradient(180deg,rgba(14,14,30,0.98),rgba(7,7,16,0.99));',
            'border:2px solid rgba(0,240,255,0.35);box-shadow:0 0 34px rgba(0,240,255,0.18);}',
            '#hc-panel h2{font-size:1rem;letter-spacing:3px;color:#00f0ff;margin:0 0 0.6rem;text-shadow:0 0 12px rgba(0,240,255,0.6);}',
            '#hc-panel p{font-size:0.75rem;line-height:1.6;color:rgba(200,200,224,0.65);margin:0 0 1.2rem;}',
            '#hc-hold{position:relative;width:100%;padding:0.95rem 1rem;border-radius:8px;cursor:pointer;overflow:hidden;',
            'background:transparent;border:2px solid #05ffa1;color:#05ffa1;font:inherit;font-size:0.72rem;letter-spacing:2px;',
            'text-transform:uppercase;user-select:none;-webkit-user-select:none;touch-action:none;}',
            '#hc-hold .hc-fill{position:absolute;inset:0;width:0%;background:rgba(5,255,161,0.22);transition:none;pointer-events:none;}',
            '#hc-hold .hc-label{position:relative;z-index:1;}',
            '#hc-hold.hc-fail{border-color:#ff2a6d;color:#ff2a6d;animation:hcshake .3s;}',
            '@keyframes hcshake{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}',
            '#hc-note{font-size:0.62rem;color:rgba(200,200,224,0.4);margin-top:0.9rem;}',
            '#hc-bot h2{color:#ff2a6d;text-shadow:0 0 12px rgba(255,42,109,0.6);}',
            '#hc-bot a{display:inline-block;margin-top:0.4rem;padding:0.8rem 1.4rem;border:2px solid #05ffa1;border-radius:8px;',
            'color:#05ffa1;text-decoration:none;font-size:0.72rem;letter-spacing:2px;text-transform:uppercase;}',
            '#hc-bot a:hover{background:rgba(5,255,161,0.1);box-shadow:0 0 18px rgba(5,255,161,0.3);}',
            '#hc-honey{position:absolute;left:-9999px;top:-9999px;opacity:0.01;}',
        ].join('');
        document.head.appendChild(s);
    }

    function aiArenaHref() {
        return (/\/games\//.test(location.pathname) ? '../' : '') + 'ai-games.html';
    }

    function showBotBlock(reasons) {
        overlay.innerHTML =
            '<div id="hc-panel"><div id="hc-bot">' +
            '<h2>🤖 AUTOMATION DETECTED</h2>' +
            '<p>This cabinet is humans-only (' + reasons.join(', ') + ').<br>' +
            'Agents are welcome next door — WebSocket API, tournaments, SOL prizes.</p>' +
            '<a href="' + aiArenaHref() + '">Enter the AI Arena</a>' +
            '</div></div>';
    }

    function showChallenge() {
        overlay.innerHTML =
            '<div id="hc-panel">' +
            '<h2>🕹️ HUMANS ONLY</h2>' +
            '<p>This cabinet is for people. AI agents play in the <a href="' + aiArenaHref() +
            '" style="color:#05ffa1;">AI Arena</a>.</p>' +
            '<button id="hc-hold" type="button"><span class="hc-fill"></span>' +
            '<span class="hc-label">Hold to prove you\'re human</span></button>' +
            '<button id="hc-honey" type="button" tabindex="-1" aria-hidden="true">verify</button>' +
            '<div id="hc-note">press and hold — mouse, finger, or Enter key</div>' +
            '</div>';

        var btn = overlay.querySelector('#hc-hold');
        var fill = overlay.querySelector('.hc-fill');
        var honey = overlay.querySelector('#hc-honey');
        var holdStart = 0, raf = 0, keyboardHold = false, keyDowns = 0;

        honey.addEventListener('click', function () { showBotBlock(['honeypot interaction']); });

        function tick() {
            var p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
            fill.style.width = (p * 100) + '%';
            if (p >= 1) { finish(); return; }
            raf = requestAnimationFrame(tick);
        }
        function begin(fromKeyboard) {
            if (holdStart) return;
            keyboardHold = !!fromKeyboard;
            holdStart = performance.now();
            raf = requestAnimationFrame(tick);
        }
        function cancel() {
            if (!holdStart) return;
            holdStart = 0;
            cancelAnimationFrame(raf);
            fill.style.width = '0%';
        }
        function finish() {
            cancelAnimationFrame(raf);
            // keyboard path: accessibility escape hatch (hard signals were already clean).
            // pointer path: require organic movement somewhere on the page.
            if (keyboardHold || movementLooksHuman()) {
                overlay.remove();
                grantPass();
            } else {
                holdStart = 0;
                fill.style.width = '0%';
                btn.classList.add('hc-fail');
                btn.querySelector('.hc-label').textContent = 'Move your cursor, then hold again';
                setTimeout(function () { btn.classList.remove('hc-fail'); }, 400);
            }
        }

        btn.addEventListener('pointerdown', function (e) { e.preventDefault(); begin(false); });
        btn.addEventListener('pointerup', cancel);
        btn.addEventListener('pointerleave', cancel);
        btn.addEventListener('pointercancel', cancel);
        btn.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            keyDowns++;
            if (keyDowns === 1) begin(true);
        });
        btn.addEventListener('keyup', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            keyDowns = 0;
            cancel();
        });
        btn.focus();
    }

    function boot() {
        if (hasValidPass()) { api.passed = true; return; }
        css();
        overlay = document.createElement('div');
        overlay.id = 'hc-overlay';
        document.body.appendChild(overlay);
        var reasons = automationSignals();
        if (reasons.length) showBotBlock(reasons);
        else showChallenge();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
