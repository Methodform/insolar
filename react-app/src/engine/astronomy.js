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
