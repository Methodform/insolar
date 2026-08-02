// Подбор места для копии объекта: без пересечения габаритов с другими объектами,
// в максимально пустой области участка. Все координаты — локальные метры.

function bbox(pts) {
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  (pts || []).forEach(p => { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]); });
  return { mnx, mny, mxx, mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny };
}
function overlaps(a, b, gap) {
  return !(a.mxx + gap <= b.mnx || a.mnx - gap >= b.mxx || a.mxy + gap <= b.mny || a.mny - gap >= b.mxy);
}
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

// srcPts — контур копируемого объекта; others — массив контуров остальных объектов; poly — контур участка.
export function placeCopyPts(srcPts, others, poly, gap = 1.2) {
  const src = bbox(srcPts);
  const obs = (others || []).map(bbox);
  const hasPoly = poly && poly.length >= 3;
  const P = hasPoly ? bbox(poly) : { mnx: src.mnx - 40, mny: src.mny - 40, mxx: src.mxx + 40, mxy: src.mxy + 40 };
  const step = Math.max(0.75, Math.min(src.w, src.h) / 2, 1);
  const hw = src.w / 2, hh = src.h / 2;
  let best = null, bestScore = -1e9;
  for (let ty = P.mny + hh; ty <= P.mxy - hh + 1e-6; ty += step) {
    for (let tx = P.mnx + hw; tx <= P.mxx - hw + 1e-6; tx += step) {
      const dx = tx - src.cx, dy = ty - src.cy;
      const cand = { mnx: src.mnx + dx, mny: src.mny + dy, mxx: src.mxx + dx, mxy: src.mxy + dy, cx: tx, cy: ty };
      if (hasPoly) {
        const cs = [[cand.mnx, cand.mny], [cand.mxx, cand.mny], [cand.mxx, cand.mxy], [cand.mnx, cand.mxy], [tx, ty]];
        if (!cs.every(c => inPoly(c, poly))) continue;      // копия должна лежать внутри участка
      }
      if (obs.some(o => overlaps(cand, o, gap))) continue;   // без пересечения габаритов
      // счёт: чем дальше до ближайшего объекта — тем «пустее» область
      let score;
      if (obs.length) { let d = 1e9; obs.forEach(o => { d = Math.min(d, Math.hypot(o.cx - tx, o.cy - ty)); }); score = d; }
      else score = -Math.hypot(dx, dy);                      // объектов нет → ближе к оригиналу
      if (score > bestScore) { bestScore = score; best = { dx, dy }; }
    }
  }
  if (!best) { const off = src.w + gap; best = { dx: off, dy: 0 }; }   // не нашли — сдвиг вбок
  return srcPts.map(p => [p[0] + best.dx, p[1] + best.dy]);
}
