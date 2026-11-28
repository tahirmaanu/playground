/* Body chart: front + back anatomy drawing with editable points (cupping / hijama sites).
 *
 * Points are stored as {x, y, label} where x / y are 0..1 fractions of the drawing, so they
 * stay put regardless of screen size.
 *
 *   BodyChart.renderStatic(points)           -> SVG markup for read-only previews
 *   BodyChart.openEditor(points, onSave)     -> full-screen editor (tap = add, drag = move,
 *                                                pinch / buttons = zoom, selected dot = label / delete)
 */
(function () {
  'use strict';

  const VB_W = 360, VB_H = 370;
  const FILL = '#f7e6e3', EDGE = '#c9908a', LINE = '#b9736c';
  const FIGURES = [{ side: 'front', cx: 95 }, { side: 'back', cx: 265 }];
  const TOP = 12;

  // ---- drawing --------------------------------------------------------------------------
  // Limbs are thick round-capped strokes; the outline is made by drawing every shape twice
  // (wide edge-coloured stroke underneath, narrower fill-coloured stroke on top).
  const limbs = [
    // [x1, y1, x2, y2, width]  (right-hand side; mirrored for the left)
    [41, 68, 51, 128, 17], [51, 128, 58, 176, 12],        // arm
    [15, 184, 19, 252, 24], [19, 252, 21, 322, 16]        // leg
  ];
  const torso = 'M-34,60 C-22,54 -10,52 0,52 C10,52 22,54 34,60 C37,78 33,98 28,118 C26,128 26,138 29,152 C32,162 33,172 30,184 L-30,184 C-33,172 -32,162 -29,152 C-26,138 -26,128 -28,118 C-33,98 -37,78 -34,60 Z';

  function silhouette() {
    let edge = '', fill = '';
    const add = (tag, attrs, w) => {
      edge += `<${tag} ${attrs} stroke="${EDGE}" stroke-width="${w + 3}"/>`;
      fill += `<${tag} ${attrs} stroke="${FILL}" stroke-width="${w}"/>`;
    };
    add('path', `d="${torso}" fill="${FILL}" stroke-linejoin="round"`, 0.5);
    add('line', 'x1="0" y1="40" x2="0" y2="56" stroke-linecap="round"', 14);
    for (const sx of [1, -1]) {
      for (const [x1, y1, x2, y2, w] of limbs) {
        add('line', `x1="${x1 * sx}" y1="${y1}" x2="${x2 * sx}" y2="${y2}" stroke-linecap="round"`, w);
      }
      add('ellipse', `cx="${60 * sx}" cy="190" rx="6" ry="10" fill="${FILL}"`, 0.5);
      add('ellipse', `cx="${23 * sx}" cy="332" rx="11" ry="5" fill="${FILL}"`, 0.5);
    }
    add('ellipse', `cx="0" cy="22" rx="15" ry="19" fill="${FILL}"`, 0.5);
    return edge + fill;
  }

  function details(side) {
    const st = `fill="none" stroke="${LINE}" stroke-width="1" stroke-linecap="round" opacity=".55"`;
    let d = '';
    if (side === 'front') {
      d += `<path ${st} d="M0,58 Q-16,56 -32,64 M0,58 Q16,56 32,64"/>`;                 // collar bones
      d += `<path ${st} d="M-30,78 Q-16,94 -2,86 M30,78 Q16,94 2,86"/>`;                 // chest
      d += `<path ${st} d="M0,58 L0,122"/>`;                                              // sternum / midline
      d += `<path ${st} d="M-10,106 L10,106 M-10,118 L10,118 M-10,130 L10,130 M-9,142 L9,142"/>`; // abdomen
      d += `<circle cx="0" cy="136" r="1.6" fill="${LINE}" opacity=".6"/>`;              // navel
      d += `<path ${st} d="M-30,100 Q-24,112 -27,124 M30,100 Q24,112 27,124"/>`;         // ribs
      d += `<circle ${st} cx="16" cy="252" r="5.5"/><circle ${st} cx="-16" cy="252" r="5.5"/>`; // knees
      d += `<path ${st} d="M-6,40 L-6,52 M6,40 L6,52"/>`;
      d += `<path ${st} d="M-4,30 Q0,34 4,30"/>`;                                         // chin
    } else {
      d += `<path ${st} stroke-dasharray="2 3" d="M0,44 L0,184"/>`;                       // spine
      d += `<path ${st} d="M-27,68 Q-10,72 -7,94 Q-22,102 -31,88 Z M27,68 Q10,72 7,94 Q22,102 31,88 Z"/>`; // shoulder blades
      d += `<path ${st} d="M-9,160 L9,160 L0,182 Z"/>`;                                   // sacrum
      d += `<path ${st} d="M-30,150 Q-18,160 -8,160 M30,150 Q18,160 8,160"/>`;            // waist / hips
      d += `<path ${st} d="M-31,184 Q-15,196 0,184 Q15,196 31,184"/>`;                    // glutes
      d += `<path ${st} d="M12,250 Q17,256 22,250 M-12,250 Q-17,256 -22,250"/>`;          // back of knees
      d += `<path ${st} d="M-14,18 Q0,30 14,18"/>`;                                       // hair line
    }
    return d;
  }

  let baseMarkup = null;
  function base() {
    if (baseMarkup) return baseMarkup;
    const sil = silhouette();
    baseMarkup = FIGURES.map(f =>
      `<g transform="translate(${f.cx},${TOP})">${sil}${details(f.side)}</g>`
    ).join('') +
      `<text x="95" y="366" text-anchor="middle" font-size="12" fill="${LINE}">سامنے (Front)</text>` +
      `<text x="265" y="366" text-anchor="middle" font-size="12" fill="${LINE}">پیچھے (Back)</text>`;
    return baseMarkup;
  }

  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function sanitize(points) {
    if (!Array.isArray(points)) return [];
    return points
      .map(p => ({ x: clamp(Number(p && p.x), 0, 1), y: clamp(Number(p && p.y), 0, 1), label: String((p && p.label) || '').slice(0, 12) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function dotsMarkup(points, u, selected) {
    return points.map((p, i) => {
      const cx = p.x * VB_W, cy = p.y * VB_H;
      let out = '';
      if (i === selected) out += `<circle cx="${cx}" cy="${cy}" r="${13 * u}" fill="#a878c433" stroke="#a878c4" stroke-width="${1.6 * u}"/>`;
      out += `<circle cx="${cx}" cy="${cy}" r="${5.5 * u}" fill="#111" stroke="#fff" stroke-width="${1.2 * u}"/>`;
      if (p.label) out += `<text x="${cx + 8 * u}" y="${cy - 7 * u}" font-size="${12 * u}" font-weight="700" fill="#6d4784" stroke="#fff" stroke-width="${3 * u}" paint-order="stroke" font-family="Arial,sans-serif">${esc(p.label)}</text>`;
      return out;
    }).join('');
  }

  function renderStatic(points, cls) {
    const pts = sanitize(points);
    // 1 screen px ≈ 0.6 drawing units on a typical preview; keep the dots readable.
    return `<svg class="${cls || 'bc-mini'}" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="جسمانی نقشہ">${base()}${dotsMarkup(pts, 0.85, -1)}</svg>`;
  }

  // ---- editor ---------------------------------------------------------------------------
  let els = null, st = null;

  function build() {
    if (els) return els;
    const root = document.createElement('div');
    root.id = 'bcModal';
    root.className = 'bc-modal hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="bc-dialog">
        <header class="bc-head"><button type="button" class="bc-x" data-bc="cancel">✕ منسوخ</button><h2>جسمانی نقشہ</h2><span class="bc-count" id="bcCount"></span></header>
        <div class="bc-tools">
          <button type="button" data-bc="zoomOut" aria-label="زوم آؤٹ">−</button>
          <button type="button" data-bc="zoomIn" aria-label="زوم ان">+</button>
          <button type="button" data-bc="reset">پورا نقشہ</button>
          <button type="button" data-bc="undo" id="bcUndo">↶ واپس</button>
          <button type="button" data-bc="clear" class="bc-warn">سب صاف</button>
        </div>
        <div class="bc-stage" id="bcStage"><svg id="bcSvg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet"><g id="bcWorld"><g id="bcBase"></g><g id="bcDots"></g></g></svg></div>
        <div class="bc-select dim" id="bcSelect">
          <input id="bcLabel" maxlength="12" placeholder="منتخب نقطے کا نمبر/نام، مثلاً 18" autocomplete="off" disabled>
          <button type="button" data-bc="deselect" class="bc-sec" disabled>ٹھیک ہے</button>
          <button type="button" data-bc="delete" class="bc-del" disabled>🗑 حذف</button>
        </div>
        <p class="bc-hint" id="bcHint">خالی جگہ پر ٹیپ کریں → نقطہ لگے گا · نقطے کو پکڑ کر گھسیٹیں → جگہ بدلے گی · دو انگلیوں سے زوم کریں</p>
        <footer class="bc-foot"><button type="button" class="bc-save" data-bc="save">محفوظ کریں</button></footer>
      </div>`;
    document.body.appendChild(root);
    els = {
      root,
      stage: root.querySelector('#bcStage'), svg: root.querySelector('#bcSvg'), world: root.querySelector('#bcWorld'),
      base: root.querySelector('#bcBase'), dots: root.querySelector('#bcDots'),
      count: root.querySelector('#bcCount'), select: root.querySelector('#bcSelect'), label: root.querySelector('#bcLabel'),
      undo: root.querySelector('#bcUndo')
    };
    els.base.innerHTML = base();
    root.addEventListener('click', onButton);
    els.label.addEventListener('input', () => { if (st && st.sel >= 0) { st.pts[st.sel].label = els.label.value.slice(0, 12); st.changed = true; drawDots(); } });
    wireGestures();
    return els;
  }

  function svgScale() { const m = els.svg.getScreenCTM(); return m ? m.a : 1; }   // px per drawing unit at zoom 1
  function unit() { return 1 / (svgScale() * st.s); }                              // drawing units per screen px (at current zoom)
  function toWorld(clientX, clientY) {
    const m = els.svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const pt = els.svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: (p.x - st.tx) / st.s, y: (p.y - st.ty) / st.s };
  }
  function applyView() {
    st.s = clamp(st.s, 1, 8);
    st.tx = clamp(st.tx, VB_W - VB_W * st.s, 0);
    st.ty = clamp(st.ty, VB_H - VB_H * st.s, 0);
    els.world.setAttribute('transform', `translate(${st.tx} ${st.ty}) scale(${st.s})`);
    drawDots();
  }
  function drawDots() {
    els.dots.innerHTML = dotsMarkup(st.pts, unit(), st.sel);
    els.count.textContent = st.pts.length ? `${st.pts.length} نقطے` : '';
    els.undo.disabled = !st.undo.length;
    const has = st.sel >= 0;
    els.select.classList.toggle('dim', !has);
    els.select.querySelectorAll('input,button').forEach(n => { n.disabled = !has; });
  }
  function snapshot() { st.undo.push(JSON.stringify(st.pts)); if (st.undo.length > 60) st.undo.shift(); }
  function select(i) {
    st.sel = i;
    els.label.value = i >= 0 ? (st.pts[i].label || '') : '';
    drawDots();
  }
  function zoomAt(factor, cx, cy) {   // cx, cy in drawing units (screen-space of the svg viewBox)
    const ns = clamp(st.s * factor, 1, 8), k = ns / st.s;
    st.tx = cx - (cx - st.tx) * k; st.ty = cy - (cy - st.ty) * k; st.s = ns; applyView();
  }
  function hit(clientX, clientY) {
    const w = toWorld(clientX, clientY), r = 18 * unit();
    let best = -1, bd = r * r;
    st.pts.forEach((p, i) => { const dx = p.x * VB_W - w.x, dy = p.y * VB_H - w.y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  function wireGestures() {
    const stage = els.stage, ptrs = new Map();
    let mode = null, dragIdx = -1, startX = 0, startY = 0, startT = 0, moved = false, pinch = null, pan = null, dragSnap = null;
    const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const mid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const svgPt = (x, y) => { const m = els.svg.getScreenCTM(), pt = els.svg.createSVGPoint(); pt.x = x; pt.y = y; return pt.matrixTransform(m.inverse()); };

    stage.addEventListener('pointerdown', e => {
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {                                   // second finger -> pinch zoom
        if (dragSnap && mode === 'drag') { st.pts = JSON.parse(dragSnap); }
        mode = 'pinch'; const m = svgPt(mid().x, mid().y);
        pinch = { d0: dist(), s0: st.s, tx0: st.tx, ty0: st.ty, cx: m.x, cy: m.y };
        drawDots(); return;
      }
      if (ptrs.size > 2) return;
      startX = e.clientX; startY = e.clientY; startT = Date.now(); moved = false;
      const i = hit(e.clientX, e.clientY);
      if (i >= 0) { mode = 'drag'; dragIdx = i; dragSnap = JSON.stringify(st.pts); select(i); }
      else { mode = 'pending'; pan = { tx: st.tx, ty: st.ty }; }
      e.preventDefault();
    });

    stage.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pinch' && ptrs.size >= 2 && pinch) {
        const ns = clamp(pinch.s0 * dist() / pinch.d0, 1, 8), k = ns / pinch.s0, m = svgPt(mid().x, mid().y);
        st.s = ns; st.tx = pinch.cx - (pinch.cx - pinch.tx0) * k + (m.x - pinch.cx); st.ty = pinch.cy - (pinch.cy - pinch.ty0) * k + (m.y - pinch.cy);
        applyView(); return;
      }
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (mode === 'pending' && Math.hypot(dx, dy) > 7) mode = 'pan';
      if (mode === 'pan') {
        const sc = svgScale(); moved = true;
        st.tx = pan.tx + dx / sc; st.ty = pan.ty + dy / sc; applyView();
      } else if (mode === 'drag') {
        if (Math.hypot(dx, dy) > 3) moved = true;
        if (moved) { const w = toWorld(e.clientX, e.clientY); st.pts[dragIdx].x = clamp(w.x / VB_W, 0, 1); st.pts[dragIdx].y = clamp(w.y / VB_H, 0, 1); drawDots(); }
      }
      e.preventDefault();
    });

    const end = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (mode === 'pinch') { if (ptrs.size < 2) { mode = ptrs.size ? 'pan-after-pinch' : null; pinch = null; } return; }
      if (mode === 'pending' && e.type === 'pointerup' && Date.now() - startT < 600) {
        const w = toWorld(e.clientX, e.clientY);
        if (w.x >= 0 && w.x <= VB_W && w.y >= 0 && w.y <= VB_H) {   // tap on empty space -> new point
          snapshot();
          st.pts.push({ x: clamp(w.x / VB_W, 0, 1), y: clamp(w.y / VB_H, 0, 1), label: '' });
          st.changed = true; select(st.pts.length - 1);
        }
      } else if (mode === 'drag' && moved) {
        st.undo.push(dragSnap); st.changed = true; drawDots();
      }
      mode = null; dragIdx = -1; dragSnap = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', e => { e.preventDefault(); const m = svgPt(e.clientX, e.clientY); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, m.x, m.y); }, { passive: false });
  }

  function onButton(e) {
    const b = e.target.closest('[data-bc]'); if (!b || !st) return;
    const act = b.dataset.bc;
    if (act === 'zoomIn') zoomAt(1.5, VB_W / 2, VB_H / 2);
    else if (act === 'zoomOut') zoomAt(1 / 1.5, VB_W / 2, VB_H / 2);
    else if (act === 'reset') { st.s = 1; st.tx = 0; st.ty = 0; applyView(); }
    else if (act === 'undo') { const last = st.undo.pop(); if (last) { st.pts = JSON.parse(last); st.changed = true; st.sel = -1; els.label.value = ''; drawDots(); } }
    else if (act === 'clear') { if (st.pts.length && confirm('تمام نقطے ہٹا دیں؟')) { snapshot(); st.pts = []; st.changed = true; select(-1); } }
    else if (act === 'deselect') select(-1);
    else if (act === 'delete') { if (st.sel >= 0) { snapshot(); st.pts.splice(st.sel, 1); st.changed = true; select(-1); } }
    else if (act === 'save') finish(true);
    else if (act === 'cancel') requestCancel();
  }

  function requestCancel() {
    if (st.changed && !confirm('تبدیلیاں محفوظ کیے بغیر بند کریں؟')) return;
    finish(false);
  }

  // Back gesture / button: returns false if the user chose to keep editing (so the app keeps the editor's history entry).
  function backPressed() {
    if (!st) return true;
    if (st.changed && !confirm('تبدیلیاں محفوظ کیے بغیر بند کریں؟')) return false;
    finish(false, true);
    return true;
  }

  function finish(save, viaBack) {
    if (!st) return;
    const s = st, cb = s.onSave;
    st = null;
    els.root.classList.add('hidden');
    document.body.classList.remove('bc-open');
    if (!viaBack && s.closeFromUi) s.closeFromUi();
    if (save && cb) cb(sanitize(s.pts));
  }

  function openEditor(points, onSave, hooks) {
    build();
    st = { pts: sanitize(points), onSave, s: 1, tx: 0, ty: 0, sel: -1, undo: [], changed: false, closeFromUi: hooks && hooks.onClose };
    els.root.classList.remove('hidden');
    document.body.classList.add('bc-open');
    els.label.value = '';
    applyView();
  }
  function isOpen() { return Boolean(st); }

  window.BodyChart = { renderStatic, openEditor, isOpen, backPressed, sanitize };
})();
