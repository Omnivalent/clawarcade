/**
 * ClawArcade virtual analog stick
 *
 * One circle, drag like a controller thumbstick — replaces per-direction
 * touch buttons. Shows only on coarse-pointer (touch) devices unless
 * opts.force is set.
 *
 * Integration is one call:
 *
 *   ArcadeStick.create({
 *     mode: 'tap' | 'hold',        // tap: one keydown per direction change
 *                                  // hold: keydown on enter, keyup on leave
 *     repeat: 140,                 // (tap mode) re-fire while held, ms; 0 = off
 *     axes: 4 | 8,                 // direction resolution (default 4)
 *     lockY: false,                // ignore vertical (paddle games)
 *     keys: { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' },
 *     buttons: [{ label:'FIRE', key:' ', hold:true }],   // action buttons
 *     onVector: (x, y) => {},      // optional raw analog callback (-1..1)
 *     side: 'left',                // stick side; buttons dock opposite
 *   });
 *
 * Synthetic KeyboardEvents carry key/code/keyCode/which so both modern
 * (e.key) and legacy (e.keyCode) handlers respond. Events are dispatched
 * on document and window.
 */
(function () {
    'use strict';

    var KEYCODES = {
        ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
        ' ': 32, w: 87, a: 65, s: 83, d: 68, Enter: 13,
    };

    function fire(type, key) {
        var code = key === ' ' ? 'Space' : (key.length === 1 ? 'Key' + key.toUpperCase() : key);
        var ev = new KeyboardEvent(type, { key: key, code: code, bubbles: true, cancelable: true });
        var kc = KEYCODES[key] || 0;
        try {
            Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } });
            Object.defineProperty(ev, 'which', { get: function () { return kc; } });
        } catch (e) { /* readonly on some engines — e.key still works */ }
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);
    }

    function isCoarse() {
        return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    }

    function create(opts) {
        opts = opts || {};
        if (!opts.force && !isCoarse()) return null;

        var SIZE = opts.size || 124;
        var KNOB = Math.round(SIZE * 0.44);
        var RADIUS = (SIZE - KNOB) / 2;
        var DEAD = 0.28;                       // deadzone fraction of radius
        var AXES = opts.axes === 8 ? 8 : 4;
        var MODE = opts.mode === 'hold' ? 'hold' : 'tap';
        var REPEAT = typeof opts.repeat === 'number' ? opts.repeat : 0;
        var KEYS = opts.keys || { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
        var side = opts.side === 'right' ? 'right' : 'left';

        /* ---------- styles (once) ---------- */
        if (!document.getElementById('astick-css')) {
            var st = document.createElement('style');
            st.id = 'astick-css';
            st.textContent = [
                '.astick-base{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:9000;',
                'border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none;',
                'background:radial-gradient(circle at 50% 42%,rgba(20,24,40,0.85),rgba(8,10,18,0.9));',
                'border:2px solid rgba(0,229,246,0.35);box-shadow:0 0 24px rgba(0,229,246,0.18),inset 0 0 26px rgba(0,0,0,0.6);',
                'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}',
                '.astick-base::before{content:"";position:absolute;inset:14%;border-radius:50%;',
                'border:1px dashed rgba(0,229,246,0.18);pointer-events:none;}',
                '.astick-knob{position:absolute;border-radius:50%;pointer-events:none;',
                'background:radial-gradient(circle at 36% 30%,#3be9f8,#0a99ad 55%,#065e6b 100%);',
                'box-shadow:0 4px 14px rgba(0,0,0,0.55),0 0 18px rgba(0,229,246,0.55),inset 0 -4px 8px rgba(0,0,0,0.35);',
                'transition:transform .09s ease-out;}',
                '.astick-base.active .astick-knob{transition:none;box-shadow:0 4px 14px rgba(0,0,0,0.55),0 0 30px rgba(0,229,246,0.85),inset 0 -4px 8px rgba(0,0,0,0.35);}',
                '.astick-btns{position:fixed;bottom:calc(34px + env(safe-area-inset-bottom,0px));z-index:9000;display:flex;flex-direction:column;gap:14px;}',
                '.astick-btn{width:74px;height:74px;border-radius:50%;border:2px solid rgba(255,42,109,0.55);cursor:pointer;',
                'background:radial-gradient(circle at 38% 32%,rgba(255,92,143,0.35),rgba(120,10,45,0.5));',
                'color:#ff5c8f;font:700 0.68rem/1 Orbitron,sans-serif;letter-spacing:0.12em;text-transform:uppercase;',
                'box-shadow:0 0 18px rgba(255,42,109,0.3),inset 0 -4px 10px rgba(0,0,0,0.4);',
                'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;}',
                '.astick-btn:active{transform:scale(0.92);box-shadow:0 0 30px rgba(255,42,109,0.6),inset 0 -2px 6px rgba(0,0,0,0.4);}',
            ].join('');
            document.head.appendChild(st);
        }

        /* ---------- stick DOM ---------- */
        var base = document.createElement('div');
        base.className = 'astick-base';
        base.style.width = SIZE + 'px';
        base.style.height = SIZE + 'px';
        base.style[side] = '22px';
        var knob = document.createElement('div');
        knob.className = 'astick-knob';
        knob.style.width = KNOB + 'px';
        knob.style.height = KNOB + 'px';
        knob.style.left = (SIZE - KNOB) / 2 + 'px';
        knob.style.top = (SIZE - KNOB) / 2 + 'px';
        base.appendChild(knob);
        document.body.appendChild(base);

        /* ---------- action buttons ---------- */
        var btnWrap = null;
        if (opts.buttons && opts.buttons.length) {
            btnWrap = document.createElement('div');
            btnWrap.className = 'astick-btns';
            btnWrap.style[side === 'left' ? 'right' : 'left'] = '26px';
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
        var pid = null, active = [];          // active directions (for hold mode)
        var repeatTimer = null, lastDirs = '';

        function vecToDirs(nx, ny) {
            var mag = Math.sqrt(nx * nx + ny * ny);
            if (mag < DEAD) return [];
            var ang = Math.atan2(ny, nx);      // screen coords: +y down
            var dirs = [];
            if (AXES === 8) {
                // 8-way: emit up to two directions (diagonals)
                if (Math.cos(ang) > 0.38) dirs.push('right');
                if (Math.cos(ang) < -0.38) dirs.push('left');
                if (Math.sin(ang) > 0.38) dirs.push('down');
                if (Math.sin(ang) < -0.38) dirs.push('up');
            } else {
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

        function release() {
            if (MODE === 'hold') active.forEach(function (d) { if (KEYS[d]) fire('keyup', KEYS[d]); });
            clearInterval(repeatTimer);
            active = []; lastDirs = '';
            knob.style.transform = '';
            base.classList.remove('active');
            if (opts.onVector) opts.onVector(0, 0);
        }

        function track(e) {
            var r = base.getBoundingClientRect();
            var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            var dx = e.clientX - cx, dy = e.clientY - cy;
            var mag = Math.sqrt(dx * dx + dy * dy);
            var lim = Math.min(mag, RADIUS);
            var nx = mag ? dx / mag : 0, ny = mag ? dy / mag : 0;
            knob.style.transform = 'translate(' + (nx * lim) + 'px,' + (ny * lim) + 'px)';
            var vx = (lim / RADIUS) * nx, vy = (lim / RADIUS) * ny;
            if (opts.onVector) opts.onVector(vx, vy);
            applyDirs(vecToDirs(vx, vy));
        }

        base.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            pid = e.pointerId;
            base.setPointerCapture(pid);
            base.classList.add('active');
            track(e);
        });
        base.addEventListener('pointermove', function (e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            track(e);
        });
        function end(e) {
            if (e.pointerId !== pid) return;
            pid = null;
            release();
        }
        base.addEventListener('pointerup', end);
        base.addEventListener('pointercancel', end);

        return {
            destroy: function () { release(); base.remove(); if (btnWrap) btnWrap.remove(); },
            el: base,
        };
    }

    window.ArcadeStick = { create: create, isCoarse: isCoarse };
})();
