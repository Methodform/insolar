// Позиция солнца и времена (алгоритм Meeus/SunCalc). Всё в UTC.
export const RAD=Math.PI/180, DAY=86400000, J1970=2440588, J2000=2451545, E=RAD*23.4397;
const toDays=ms=>(ms/DAY-0.5+J1970)-J2000;
const ra=(l,b)=>Math.atan2(Math.sin(l)*Math.cos(E)-Math.tan(b)*Math.sin(E),Math.cos(l));
const dec=(l,b)=>Math.asin(Math.sin(b)*Math.cos(E)+Math.cos(b)*Math.sin(E)*Math.sin(l));
const sidereal=(d,lw)=>RAD*(280.16+360.9856235*d)-lw;
const sma=d=>RAD*(357.5291+0.98560028*d);
const ecl=M=>M+RAD*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M))+RAD*102.9372+Math.PI;
function sunCoords(d){const M=sma(d),L=ecl(M);return{dec:dec(L,0),ra:ra(L,0)};}
export function sunPosition(ms,lat,lon){
  const lw=RAD*(-lon),phi=RAD*lat,d=toDays(ms),c=sunCoords(d),H=sidereal(d,lw)-c.ra;
  return{ azimuth:Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(c.dec)*Math.cos(phi)),
          altitude:Math.asin(Math.sin(phi)*Math.sin(c.dec)+Math.cos(phi)*Math.cos(c.dec)*Math.cos(H)) };
}
export const compassAz=a=>{let x=a*180/Math.PI+180;x%=360;if(x<0)x+=360;return x;};
const J0=0.0009, fromJulian=j=>(j+0.5-J1970)*DAY;
const julianCycle=(d,lw)=>Math.round(d-J0-lw/(2*Math.PI));
const approxTransit=(Ht,lw,n)=>J0+(Ht+lw)/(2*Math.PI)+n;
const solarTransitJ=(ds,M,L)=>J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);
function hourAngle(h,phi,d){const x=(Math.sin(h)-Math.sin(phi)*Math.sin(d))/(Math.cos(phi)*Math.cos(d));if(x<=-1)return Math.PI;if(x>=1)return 0;return Math.acos(x);}
export function getTimes(dayMs,lat,lon){
  const lw=RAD*(-lon),phi=RAD*lat,d=toDays(dayMs),n=julianCycle(d,lw),ds=approxTransit(0,lw,n),
    M=sma(ds),L=ecl(M),dc=dec(L,0),Jn=solarTransitJ(ds,M,L),
    w=hourAngle(-0.833*RAD,phi,dc),a=approxTransit(w,lw,n),Js=solarTransitJ(a,M,L);
  return{ rise:fromJulian(Jn-(Js-Jn)), set:fromJulian(Js), noon:fromJulian(Jn),
          polarDay:w>=Math.PI-1e-6, polarNight:w<=1e-6 };
}
// местные компоненты + пояс → UTC ms
export const localToUTC=(y,mo,da,hh,mi,tz)=>Date.UTC(y,mo,da,hh,mi,0)-tz*3600000;
export function fmtLocal(ms,tz){ if(!isFinite(ms))return'—';
  const d=new Date(ms+tz*3600000);
  return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0'); }
export function fmtHours(h){ if(!isFinite(h))return'—'; const H=Math.floor(h),M=Math.round((h-H)*60); return H+' ч '+String(M).padStart(2,'0')+' мин'; }
// контур из строк "широта долгота" → локальные метры [east,north] от центроида
export function parsePoly(txt){
  const rows=(txt||'').split(/\n+/).map(s=>s.trim()).filter(Boolean), pts=[];
  for(const r of rows){ const n=r.replace(/,/g,' ').split(/\s+/).map(parseFloat).filter(x=>!isNaN(x)); if(n.length>=2)pts.push([n[0],n[1]]); }
  if(pts.length<3) return null;
  const lat0=pts.reduce((s,p)=>s+p[0],0)/pts.length, lon0=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  const mLat=110540, mLon=111320*Math.cos(lat0*RAD);
  return { local:pts.map(p=>[(p[1]-lon0)*mLon,(p[0]-lat0)*mLat]), lat0, lon0 };
}

// --- инсоляция и тени (чистый JS, метод теневого полигона) ---
export function pointInPoly(x,y,poly){ let ins=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
function hull(pts){ pts=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); const lo=[];
  for(const p of pts){ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop(); lo.push(p); }
  const up=[]; for(let i=pts.length-1;i>=0;i--){ const p=pts[i]; while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop(); up.push(p); }
  return lo.slice(0,-1).concat(up.slice(0,-1)); }
// затенена ли точка pt зданиями при данном азимуте(рад, от севера)/высоте(рад) солнца
export function shadedByBuildings(pt, azRad, altRad, buildings, eyeH=1.5){
  if(altRad<=0) return true;
  const se=-Math.sin(azRad), sn=-Math.cos(azRad);           // анти-солнечное горизонтальное
  for(const b of (buildings||[])){ if(!b.pts||b.pts.length<3) continue;
    const Heff=Math.max(0,(b.height+(b.roofH||0))-eyeH); if(Heff<=0) continue;
    const L=Heff/Math.tan(altRad);
    const proj=b.pts.map(c=>[c[0]+se*L,c[1]+sn*L]);
    if(pointInPoly(pt[0],pt[1],hull(b.pts.concat(proj)))) return true; }
  return false;
}
// инсоляция точки за день: {sun, cont} в часах
export function insolationAt(pt, buildings, dayMs, lat, lon){
  const t=getTimes(dayMs,lat,lon); if(!isFinite(t.rise)||!isFinite(t.set)) return {sun:0,cont:0};
  const step=5*60000; let sunMin=0,run=0,mx=0;
  for(let ms=t.rise; ms<=t.set; ms+=step){ const p=sunPosition(ms,lat,lon);
    const lit = p.altitude>0 && !shadedByBuildings(pt, compassAz(p.azimuth)*RAD, p.altitude, buildings);
    if(lit){ sunMin+=5; run+=5; if(run>mx)mx=run; } else run=0; }
  return {sun:sunMin/60, cont:mx/60};
}
// окна = середины фасадов зданий, нормаль наружу
export function facadeWindows(buildings){ const out=[];
  (buildings||[]).forEach((b,bi)=>{ const pts=b.pts; if(!pts||pts.length<3) return;
    let cx=0,cy=0; pts.forEach(p=>{cx+=p[0];cy+=p[1];}); cx/=pts.length; cy/=pts.length;
    for(let i=0;i<pts.length;i++){ const a=pts[i],c=pts[(i+1)%pts.length];
      const mx=(a[0]+c[0])/2,my=(a[1]+c[1])/2; let ex=c[0]-a[0],ey=c[1]-a[1]; const L=Math.hypot(ex,ey)||1; ex/=L; ey/=L;
      let nx=ey,ny=-ex; if(nx*(mx-cx)+ny*(my-cy)<0){ nx=-nx; ny=-ny; }
      out.push({ bi, name:b.name||('Здание '+(bi+1)), e:mx+nx*0.15, n:my+ny*0.15, nx, ny }); } });
  return out; }
// инсоляция одного окна за день (учёт стороны фасада)
export function windowInsolation(win, buildings, dayMs, lat, lon){
  const t=getTimes(dayMs,lat,lon); if(!isFinite(t.rise)||!isFinite(t.set)) return {sun:0,cont:0};
  const step=5*60000; let sunMin=0,run=0,mx=0;
  for(let ms=t.rise; ms<=t.set; ms+=step){ const p=sunPosition(ms,lat,lon); let lit=false;
    if(p.altitude>0){ const azc=compassAz(p.azimuth), se=Math.sin(azc*RAD), sn=Math.cos(azc*RAD);
      if(se*win.nx+sn*win.ny>0) lit=!shadedByBuildings([win.e,win.n],azc*RAD,p.altitude,buildings,1.5); }
    if(lit){ sunMin+=5; run+=5; if(run>mx)mx=run; } else run=0; }
  return {sun:sunMin/60, cont:mx/60}; }
// отчёт по всем окнам на нормативную дату
export function windowsReport(buildings, lat, lon, tz, year){
  const z=normativeZone(lat), dayMs=localToUTC(year,z.mo,z.da,12,0,tz), wins=facadeWindows(buildings);
  return { z, rows: wins.map(w=>{ const r=windowInsolation(w,buildings,dayMs,lat,lon);
    const dir=azToCardinal((Math.atan2(w.nx,w.ny)*180/Math.PI+360)%360);
    return { name:w.name, dir, cont:r.cont, sun:r.sun, ok:r.cont>=z.hours, e:w.e, n:w.n }; }) }; }
// климатическая зона → требуемая непрерывная инсоляция
export function normHours(lat){ const a=Math.abs(lat); return a>=58?2.5:a>=48?2.0:1.5; }
export const shadowLen=(h,altDeg)=> altDeg<=0.2 ? Infinity : h/Math.tan(altDeg*RAD);
export function azToCardinal(a){ return ['С','ССВ','СВ','ВСВ','В','ВЮВ','ЮВ','ЮЮВ','Ю','ЮЮЗ','ЮЗ','ЗЮЗ','З','ЗСЗ','СЗ','ССЗ'][Math.round(a/22.5)%16]; }

export function polyAreaSigned(p){ let a=0; for(let i=0,j=p.length-1;i<p.length;j=i++) a+=p[j][0]*p[i][1]-p[i][0]*p[j][1]; return a/2; }
export function polyArea(p){ return Math.abs(polyAreaSigned(p)); }
export function nearestOnSeg(p,a,b){ const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy; let t=l2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2:0; t=Math.max(0,Math.min(1,t)); return [a[0]+t*dx,a[1]+t*dy]; }
export function clampToPoly(p,poly){ if(pointInPoly(p[0],p[1],poly)) return p; let best=p,bd=1e9;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const q=nearestOnSeg(p,poly[j],poly[i]); const d=Math.hypot(q[0]-p[0],q[1]-p[1]); if(d<bd){bd=d;best=q;} } return best; }
export function offsetInward(poly,d){ const n=poly.length; if(n<3) return null;
  const ccw=polyAreaSigned(poly)>0, lines=[];
  for(let i=0;i<n;i++){ const a=poly[i],b=poly[(i+1)%n]; let ux=b[0]-a[0],uy=b[1]-a[1]; const L=Math.hypot(ux,uy)||1; ux/=L; uy/=L;
    const nx=ccw?-uy:uy, ny=ccw?ux:-ux; lines.push({px:a[0]+nx*d,py:a[1]+ny*d,ux,uy}); }
  const res=[]; for(let i=0;i<n;i++){ const l1=lines[(i-1+n)%n],l2=lines[i]; const cr=l1.ux*l2.uy-l1.uy*l2.ux;
    if(Math.abs(cr)<1e-9){ res.push([l2.px,l2.py]); continue; }
    const t=((l2.px-l1.px)*l2.uy-(l2.py-l1.py)*l2.ux)/cr; res.push([l1.px+l1.ux*t,l1.py+l1.uy*t]); }
  if(Math.sign(polyAreaSigned(res))!==Math.sign(polyAreaSigned(poly))||polyArea(res)<0.5) return null; return res; }
export function plotBasis(poly){ let best=-1,ux=1,uy=0;
  for(let i=0;i<poly.length;i++){ const a=poly[i],b=poly[(i+1)%poly.length]; const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy); if(L>best){best=L;ux=dx/L;uy=dy/L;} }
  return {ux,uy,vx:-uy,vy:ux}; }
// прямоугольник по двум точкам со сторонами вдоль участка
export function rectFromDrag(poly,s,e){ const B=plotBasis(poly);
  const pr=p=>[p[0]*B.ux+p[1]*B.uy, p[0]*B.vx+p[1]*B.vy], un=(U,V)=>[U*B.ux+V*B.vx, U*B.uy+V*B.vy];
  const a=pr(s),b=pr(e); const u0=Math.min(a[0],b[0]),u1=Math.max(a[0],b[0]),v0=Math.min(a[1],b[1]),v1=Math.max(a[1],b[1]);
  return { corners:[un(u0,v0),un(u1,v0),un(u1,v1),un(u0,v1)], w:u1-u0, h:v1-v0 }; }
// нормативная зона по широте (СанПиН 1.2.3685-21)
export function normativeZone(lat){ const a=Math.abs(lat);
  if(a>=58) return {zone:'северная (севернее 58° с.ш.)',hours:2.5,period:'22 апреля – 22 августа',mo:3,da:22};
  if(a>=48) return {zone:'центральная (48°–58° с.ш.)',hours:2.0,period:'22 марта – 22 сентября',mo:2,da:22};
  return {zone:'южная (южнее 48° с.ш.)',hours:1.5,period:'22 февраля – 22 октября',mo:1,da:22};
}
// данные нормативного отчёта: контрольные точки на нормативную дату
export function reportData(poly, buildings, lat, lon, tz, year){
  const z=normativeZone(lat), dayMs=localToUTC(year,z.mo,z.da,12,0,tz), t=getTimes(dayMs,lat,lon);
  const base=poly&&poly.length>=3?poly:[[-12,-12],[12,-12],[12,12],[-12,12]];
  let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9; base.forEach(p=>{mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mny=Math.min(mny,p[1]);mxy=Math.max(mxy,p[1]);});
  const N=5, rows=[]; let idx=1;
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){ const x=mnx+(mxx-mnx)*i/N, y=mny+(mxy-mny)*j/N; if(!pointInPoly(x,y,base))continue;
    const r=insolationAt([x,y],buildings,dayMs,lat,lon); rows.push({i:idx++, e:+x.toFixed(1), n:+y.toFixed(1), sun:r.sun, cont:r.cont, ok:r.cont>=z.hours}); }
  const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return { z, t, rows, area:polyArea(base), okc:rows.filter(r=>r.ok).length, n:rows.length,
    noonAlt:sunPosition(t.noon,lat,lon).altitude*180/Math.PI, dateStr:`${z.da} ${months[z.mo]} ${year}` };
}
// годовая тепловая карта: среднесуточная инсоляция по сетке участка (12 дат)
export function heatmapGrid(poly, buildings, year, lat, lon, tz){
  const base=(poly&&poly.length>=3)?poly:[[-12,-12],[12,-12],[12,12],[-12,12]];
  let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;
  base.forEach(p=>{mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mny=Math.min(mny,p[1]);mxy=Math.max(mxy,p[1]);});
  const span=Math.max(mxx-mnx,mxy-mny), cell=Math.max(1.5,Math.min(4,span/22));
  const days=[]; for(let m=0;m<12;m++) days.push(localToUTC(year,m,21,12,0,tz));
  const cells=[]; let maxV=0.001;
  for(let x=mnx+cell/2;x<mxx;x+=cell) for(let y=mny+cell/2;y<mxy;y+=cell){
    if(!pointInPoly(x,y,base)) continue;
    let s=0; for(const d of days) s+=insolationAt([x,y],buildings,d,lat,lon).sun;
    const val=s/days.length; if(val>maxV)maxV=val; cells.push({x,y,val});
  }
  return {cells, cell, maxV, base};
}
