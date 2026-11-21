// Controller + keyboard navigation (works with Xbox/XInput pads and the Steam Controller via Steam Input).
// Any element with class "nav" can be focused. Movement picks the nearest element in that direction.
(function () {
  const handlers = {};

  function navEls() {
    const overlay = document.querySelector('.overlay');
    const root = overlay || document;
    return [...root.querySelectorAll('.nav')].filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function focusEl(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function move(dir) {
    document.body.classList.add('kbd');
    const els = navEls();
    if (!els.length) return;
    const cur = document.activeElement;
    if (!els.includes(cur)) {
      focusEl(els.find((e) => e.closest('.main') || e.closest('.overlay')) || els[0]);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let primary;
      let secondary;
      if (dir === 'left' || dir === 'right') {
        primary = dir === 'left' ? ax - bx : bx - ax;
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        secondary = overlap > 0 ? 0 : Math.abs(by - ay);
      } else {
        primary = dir === 'up' ? ay - by : by - ay;
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        secondary = overlap > 0 ? Math.abs(bx - ax) * 0.3 : Math.abs(bx - ax);
      }
      if (primary <= 1) continue;
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }

  // Show focus rings only while driving the UI with a controller/keyboard.
  function padMode(on) { document.body.classList.toggle('kbd', on); }
  document.addEventListener('mousedown', () => padMode(false));
  document.addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 4) padMode(false); });

  function fire(name) {
    padMode(true);
    const el = document.activeElement;
    switch (name) {
      case 'a':
        if (el && el.classList.contains('nav')) el.click();
        else move('down');
        break;
      case 'b': handlers.back && handlers.back(); break;
      case 'x': handlers.resume && handlers.resume(el); break;
      case 'y': handlers.search && handlers.search(); break;
      case 'lb': handlers.cycle && handlers.cycle(-1); break;
      case 'rb': handlers.cycle && handlers.cycle(1); break;
      case 'start': handlers.settings && handlers.settings(); break;
      case 'select': handlers.exit && handlers.exit(); break;
      default: break;
    }
  }

  // --- Gamepad polling ---------------------------------------------------
  const prev = {};
  const repeatAt = {};
  let lastConnected = null;
  const BUTTONS = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, select: 8, start: 9 };

  function poll(t) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const connected = pads.length > 0;
    if (connected !== lastConnected) {
      lastConnected = connected;
      handlers.status && handlers.status(connected, pads[0] && pads[0].id);
    }
    if (connected && document.hasFocus()) {
      const pressed = (i) => pads.some((p) => p.buttons[i] && p.buttons[i].pressed);
      const axis = (i) => pads.reduce((acc, p) => (Math.abs(p.axes[i] || 0) > Math.abs(acc) ? p.axes[i] : acc), 0);
      const dirs = {
        up: pressed(12) || axis(1) < -0.55,
        down: pressed(13) || axis(1) > 0.55,
        left: pressed(14) || axis(0) < -0.55,
        right: pressed(15) || axis(0) > 0.55,
      };
      for (const d of Object.keys(dirs)) {
        if (dirs[d]) {
          if (!prev[d]) { move(d); repeatAt[d] = t + 380; }
          else if (t >= repeatAt[d]) { move(d); repeatAt[d] = t + 110; }
        }
        prev[d] = dirs[d];
      }
      for (const [name, idx] of Object.entries(BUTTONS)) {
        const v = pressed(idx);
        if (v && !prev[name]) fire(name);
        prev[name] = v;
      }
    }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);

  // --- Keyboard ------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (e.key === 'Tab' || e.key === 'Enter') padMode(true);
    if (map[e.key]) {
      if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      e.preventDefault();
      move(map[e.key]);
    } else if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
      e.preventDefault();
      if (typing) e.target.blur();
      fire('b');
    }
  });

  window.Nav = {
    move,
    focus: focusEl,
    on(name, fn) { handlers[name] = fn; },
  };
})();
