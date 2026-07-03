/**
 * ClawArcade virtual analog stick — v2 (floating thumb stick)
 *
 * Mobile-usability upgrades over v1:
 *  - FLOATING: the stick spawns wherever the thumb lands in the lower-left
 *    capture zone, so players never have to look down to find it. A faint
 *    resting "ghost" shows where it lives when idle.
 *  - Bigger (148px), smaller deadzone (0.18), so light thumb strokes register.
 *  - Direction HYSTERESIS: once a direction is active it takes a clearly
 *    different angle to switch, killing jitter at sector boundaries.
 *  - FLICK gestures (tap-mode): a quick swipe anywhere in the zone fires the
 *    direction once — swipe-to-turn for grid games like Snake / 2048-likes.
 *
 * API is unchanged from v1:
 *   ArcadeStick.create({ mode:'tap'|'hold', repeat, repeatDirs, axes:4|8,
 *                        lockY, keys, buttons:[{label,key,hold,color,onDown,onUp}],
 *                        onVector, force, size })
 * Synthetic KeyboardEvents carry key/code/keyCode/which and are dispatched on
 * document and window, driving games' existing e.key handlers.
 */
(function () {
    'use strict';

    var KEYCODES = {
        ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
        ' ': 32, w: 87, a: 65, s: 83, d: 68, Enter: 13, c: 67,
    };

    function fire(type, key) {
        var code = key === ' ' ? 'Space' : (key.length === 1 ? 'Key' + key.toUpperCase() : key);
        var ev = new KeyboardEvent(type, { key: key, code: code, bubbles: true, cancelable: true });
        var kc = KEYCODES[key] || 0;
        try {
            Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } });
            Object.defineProperty(ev, 'which', { get: function () { return kc; } });
        } catch (e) { /* e.key still works */ }
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);
    }

    function isCoarse() {
        return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    }

    function create(opts) {
        opts = opts || {};
        if (!opts.force && !isCoarse()) return null;

        var SIZE = opts.size || 148;
        var KNOB = Math.round(SIZE * 0.42);
        var RADIUS = (SIZE - KNOB) / 2;
        var DEAD = 0.18;                        // enter threshold (fraction of radius)
        var RELEASE = 0.13;                     // exit threshold (hysteresis on magnitude)
        var AXES = opts.axes === 8 ? 8 : 4;
        var MODE = opts.mode === 'hold' ? 'hold' : 'tap';
        var REPEAT = typeof opts.repeat === 'number' ? opts.repeat : 0;
        var KEYS = opts.keys || { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
        var FLICK_MS = 240, FLICK_PX = 22;

        /* ---------- styles (once) ---------- */
        if (!document.getElementById('astick-css')) {
            var st = document.createElement('style');
            st.id = 'astick-css';
            st.textContent = [
                '#astick-zone{position:fixed;left:0;bottom:0;width:62vw;height:44vh;max-width:520px;z-index:8998;',
                'touch-action:none;-webkit-user-select:none;user-select:none;}',
                '.astick-base{position:fixed;z-index:9000;border-radius:50%;pointer-events:none;',
                'background:radial-gradient(circle at 50% 42%,rgba(20,24,40,0.78),rgba(8,10,18,0.85));',
                'border:2px solid rgba(0,229,246,0.4);box-shadow:0 0 26px rgba(0,229,246,0.2),inset 0 0 28px rgba(0,0,0,0.6);',
                'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
                'opacity:0;transform:scale(0.9);transition:opacity .18s ease,transform .18s ease;}',
                '.astick-base.ghost{opacity:0.28;transform:scale(0.82);}',
                '.astick-base.live{opacity:1;transform:scale(1);transition:none;}',
                '.astick-base::before{content:"";position:absolute;inset:13%;border-radius:50%;',
                'border:1px dashed rgba(0,229,246,0.2);pointer-events:none;}',
                '.astick-knob{position:absolute;border-radius:50%;pointer-events:none;',
                'background:radial-gradient(circle at 36% 30%,#3be9f8,#0a99ad 55%,#065e6b 100%);',
                'box-shadow:0 4px 14px rgba(0,0,0,0.55),0 0 20px rgba(0,229,246,0.6),inset 0 -4px 8px rgba(0,0,0,0.35);}',
                '.astick-btns{position:fixed;right:24px;bottom:calc(38px + env(safe-area-inset-bottom,0px));z-index:9000;',
                'display:flex;flex-direction:column;gap:16px;}',
                '.astick-btn{width:82px;height:82px;border-radius:50%;border:2px solid rgba(255,42,109,0.55);cursor:pointer;',
                'background:radial-gradient(circle at 38% 32%,rgba(255,92,143,0.35),rgba(120,10,45,0.5));',
                'color:#ff5c8f;font:700 0.7rem/1 Orbitron,sans-serif;letter-spacing:0.12em;text-transform:uppercase;',
                'box-shadow:0 0 18px rgba(255,42,109,0.3),inset 0 -4px 10px rgba(0,0,0,0.4);',
                'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
                '.astick-btn:active{transform:scale(0.92);box-shadow:0 0 30px rgba(255,42,109,0.6),inset 0 -2px 6px rgba(0,0,0,0.4);}',
            ].join('');
            document.head.appendChild(st);
        }

        /* ---------- DOM ---------- */
        var zone = document.getElementById('astick-zone');
        if (!zone) {
            zone = document.createElement('div');
            zone.id = 'astick-zone';
            document.body.appendChild(zone);
        }
        var base = document.createElement('div');
        base.className = 'astick-base ghost';
        base.style.width = SIZE + 'px';
        base.style.height = SIZE + 'px';
        var knob = document.createElement('div');
        knob.className = 'astick-knob';
        knob.style.width = KNOB + 'px';
        knob.style.height = KNOB + 'px';
        knob.style.left = (SIZE - KNOB) / 2 + 'px';
        knob.style.top = (SIZE - KNOB) / 2 + 'px';
        base.appendChild(knob);
        document.body.appendChild(base);

        var HOME = { x: 24, y: 30 }; // ghost resting offset from bottom-left
        function placeBase(cx, cy) {
            var half = SIZE / 2;
            cx = Math.max(half + 6, Math.min(innerWidth - half - 6, cx));
            cy = Math.max(half + 6, Math.min(innerHeight - half - 6, cy));
            base.style.left = (cx - half) + 'px';
            base.style.top = (cy - half) + 'px';
            return { x: cx, y: cy };
        }
        function restGhost() {
            base.classList.remove('live');
            base.classList.add('ghost');
            placeBase(HOME.x + SIZE / 2, innerHeight - HOME.y - SIZE / 2);
            knob.style.transform = '';
        }
        restGhost();
        addEventListener('resize', function () { if (!pid) restGhost(); });

        /* ---------- action buttons ---------- */
        var btnWrap = null;
        if (opts.buttons && opts.buttons.length) {
            btnWrap = document.createElement('div');
            btnWrap.className = 'astick-btns';
            opts.buttons.forEach(function (b) {
                var el = document.createElement('button');
                el.type = 'button';
                el.className = 'astick-btn';
                el.textContent = b.label;
                if (b.color) { el.style.borderColor = b.color; el.style.color = b.color; el.style.boxShadow = '0 0 18px ' + b.color + '55, inset 0 -4px 10px rgba(0,0,0,0.4)'; }
                function down(e) { e.preventDefault(); if (b.onDown) b.onDown(); else fire('keydown', b.key); }
                function up(e) { e.preventDefault(); if (b.onUp) b.onUp(); else if (b.hold) fire('keyup', b.key); }
                el.addEventListener('pointerdown', down);
                el.addEventListener('pointerup', up);
                el.addEventListener('pointercancel', up);
                el.addEventListener('pointerleave', up);
                btnWrap.appendChild(el);
            });
            document.body.appendChild(btnWrap);
        }

        /* ---------- input logic ---------- */
        var pid = null, center = null;
        var active = [], lastDirs = '', repeatTimer = null;
        var downT = 0, downX = 0, downY = 0, maxTravel = 0, lastVX = 0, lastVY = 0;

        function sectorDirs(nx, ny, mag) {
            // magnitude hysteresis: harder to enter than to stay
            var thresh = active.length ? RELEASE : DEAD;
            if (mag < thresh) return [];
            var dirs = [];
            if (AXES === 8) {
                var t = active.length ? 0.30 : 0.42;  // angular hysteresis
                if (nx > t) dirs.push('right');
                if (nx < -t) dirs.push('left');
                if (ny > t) dirs.push('down');
                if (ny < -t) dirs.push('up');
            } else {
                var ang = Math.atan2(ny, nx);
                var cur = active[0] || null;
                var centers = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
                // stay in the current sector unless we're clearly (>57°) outside it
                if (cur && centers[cur] !== undefined) {
                    var d = Math.abs(Math.atan2(Math.sin(ang - centers[cur]), Math.cos(ang - centers[cur])));
                    if (d < 1.0) return [cur];
                }
                var oct = Math.round(ang / (Math.PI / 2));
                dirs.push(oct === 0 ? 'right' : oct === 1 ? 'down' : oct === -1 ? 'up' : 'left');
            }
            if (opts.lockY) dirs = dirs.filter(function (d) { return d === 'left' || d === 'right'; });
            return dirs;
        }

        function applyDirs(dirs) {
            var key = dirs.join(',');
            if (key === lastDirs) return;
            if (MODE === 'hold') {
                active.forEach(function (d) { if (dirs.indexOf(d) < 0 && KEYS[d]) fire('keyup', KEYS[d]); });
                dirs.forEach(function (d) { if (active.indexOf(d) < 0 && KEYS[d]) fire('keydown', KEYS[d]); });
            } else {
                dirs.forEach(function (d) { if (active.indexOf(d) < 0 && KEYS[d]) fire('keydown', KEYS[d]); });
                clearInterval(repeatTimer);
                var rd = opts.repeatDirs || ['up', 'down', 'left', 'right'];
                var repeatable = dirs.filter(function (d) { return rd.indexOf(d) >= 0; });
                if (REPEAT > 0 && repeatable.length) {
                    repeatTimer = setInterval(function () {
                        repeatable.forEach(function (d) { if (KEYS[d]) fire('keydown', KEYS[d]); });
                    }, REPEAT);
                }
            }
            active = dirs.slice();
            lastDirs = key;
        }

        function release(e) {
            // flick: fast short gesture in tap mode fires its direction once
            if (MODE === 'tap' && e && (performance.now() - downT) < FLICK_MS && maxTravel > FLICK_PX && !lastDirs) {
                var fd = sectorDirs(lastVX, lastVY, 1);
                fd.forEach(function (d) { if (KEYS[d]) fire('keydown', KEYS[d]); });
            }
            if (MODE === 'hold') active.forEach(function (d) { if (KEYS[d]) fire('keyup', KEYS[d]); });
            clearInterval(repeatTimer);
            active = []; lastDirs = '';
            if (opts.onVector) opts.onVector(0, 0);
            restGhost();
        }

        function track(e) {
            var dx = e.clientX - center.x, dy = e.clientY - center.y;
            var mag = Math.sqrt(dx * dx + dy * dy);
            maxTravel = Math.max(maxTravel, mag);
            var lim = Math.min(mag, RADIUS);
            var nx = mag ? dx / mag : 0, ny = mag ? dy / mag : 0;
            lastVX = nx; lastVY = ny;
            knob.style.transform = 'translate(' + (nx * lim) + 'px,' + (ny * lim) + 'px)';
            var vx = (lim / RADIUS) * nx, vy = (lim / RADIUS) * ny;
            if (opts.onVector) opts.onVector(vx, vy);
            applyDirs(sectorDirs(nx, ny, mag / RADIUS));
        }

        zone.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            pid = e.pointerId;
            zone.setPointerCapture(pid);
            center = placeBase(e.clientX, e.clientY);
            base.classList.remove('ghost');
            base.classList.add('live');
            downT = performance.now(); downX = e.clientX; downY = e.clientY; maxTravel = 0;
            track(e);
        });
        zone.addEventListener('pointermove', function (e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            track(e);
        });
        function end(e) {
            if (e.pointerId !== pid) return;
            pid = null;
            release(e);
        }
        zone.addEventListener('pointerup', end);
        zone.addEventListener('pointercancel', end);

        return {
            destroy: function () { release(); base.remove(); if (btnWrap) btnWrap.remove(); },
            el: base,
        };
    }

    window.ArcadeStick = { create: create, isCoarse: isCoarse };
})();
