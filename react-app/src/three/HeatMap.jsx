import React, { useEffect, useRef, useState } from 'react';
import { heatmapGrid } from '../engine/astronomy.js';

const TH = [[0,'#2b3a55'],[0.5,'#d29922'],[1,'#ffe6a0']];
function lerp(a,b,t){ const r=x=>parseInt(x,16), h=n=>Math.round(n).toString(16).padStart(2,'0');
  return '#'+h(r(a.slice(1,3))+(r(b.slice(1,3))-r(a.slice(1,3)))*t)+h(r(a.slice(3,5))+(r(b.slice(3,5))-r(a.slice(3,5)))*t)+h(r(a.slice(5,7))+(r(b.slice(5,7))-r(a.slice(5,7)))*t); }
function heatColor(t){ t=Math.max(0,Math.min(1,t)); return t<0.5?lerp(TH[0][1],TH[1][1],t/0.5):lerp(TH[1][1],TH[2][1],(t-0.5)/0.5); }

export default function HeatMap({ poly, buildings, lat, lon, tz, year }) {
  const ref = useRef(null);
  const [info, setInfo] = useState('Считаю…');
  useEffect(() => {
    const t = setTimeout(() => {
      const { cells, cell, maxV, base } = heatmapGrid(poly, buildings, year, lat, lon, tz);
      const cv = ref.current; if (!cv) return; const W = cv.width, H = cv.height, g = cv.getContext('2d');
      g.clearRect(0, 0, W, H); g.fillStyle = '#12161c'; g.fillRect(0, 0, W, H);
      let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9; base.forEach(p=>{mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mny=Math.min(mny,p[1]);mxy=Math.max(mxy,p[1]);});
      const ext = Math.max(mxx-mnx, mxy-mny, 8)/2 + 3, sc = Math.min(W, H)*0.82/(2*ext), cx = W/2, cy = H/2;
      const w2s = (e,n) => [cx + e*sc, cy - n*sc];
      cells.forEach(c => { const [sx,sy]=w2s(c.x,c.y); g.fillStyle=heatColor(c.val/maxV); g.fillRect(sx-cell*sc/2-0.5, sy-cell*sc/2-0.5, cell*sc+1, cell*sc+1); });
      g.strokeStyle='#f5a623'; g.lineWidth=2; g.beginPath(); base.forEach((p,i)=>{const[x,y]=w2s(p[0],p[1]);i?g.lineTo(x,y):g.moveTo(x,y);}); g.closePath(); g.stroke();
      g.fillStyle='rgba(20,25,30,.6)'; g.strokeStyle='#c9d4df'; g.lineWidth=1;
      (buildings||[]).forEach(b=>{ g.beginPath(); b.pts.forEach((p,i)=>{const[x,y]=w2s(p[0],p[1]);i?g.lineTo(x,y):g.moveTo(x,y);}); g.closePath(); g.fill(); g.stroke(); });
      const lx=16, ly=H-30, lw=200; for(let i=0;i<lw;i++){ g.fillStyle=heatColor(i/lw); g.fillRect(lx+i,ly,1,12); }
      g.fillStyle='#e6edf3'; g.font='12px sans-serif'; g.textAlign='left'; g.fillText('0',lx,ly-5);
      g.textAlign='right'; g.fillText(maxV.toFixed(1)+' ч/сут', lx+lw, ly-5); g.textAlign='left';
      g.fillStyle='#f85149'; g.font='bold 13px sans-serif'; g.fillText('С ↑', W-46, 22);
      setInfo(`Среднесуточная инсоляция за год · макс ${maxV.toFixed(1)} ч · ячейка ${cell.toFixed(1)} м`);
    }, 30);
    return () => clearTimeout(t);
  }, [poly, buildings, lat, lon, tz, year]);
  return <div><canvas ref={ref} width={720} height={460} style={{ width: '100%', borderRadius: 10, display: 'block' }} /><div style={{ fontSize: 12, color: 'var(--gray-11)', marginTop: 8 }}>{info}</div></div>;
}
