// GPU-расчёт «часов солнца» по участку (как ShadeMap): heightfield сцены-окклюдеров +
// марш по азимуту солнца на N шагов дня, накопление доли освещённого времени на каждую точку земли.
// Работает в отдельном оффскрин-контексте (не мешает рендеру карты). Возвращает CPU-массив долей.
import * as THREE from 'three';
import { sunPosition, compassAz, localToUTC } from './astronomy.js';

const MAXSTEPS = 96;   // максимум временных шагов за день (24ч / 15мин)
const MARCH = 160;     // шагов марша луча к солнцу

let R = null;          // кэш ресурсов оффскрин-рендерера, пересоздаётся при смене res

function ensure(res) {
  if (R && R.res === res) return R;
  if (R) { try { R.renderer.dispose(); } catch (e) {} }
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
  renderer.setSize(res, res, false); renderer.autoClear = true;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.NoColorSpace;   // без гамма-конверсии: R хранит долю линейно
  const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true };
  const heightRT = new THREE.WebGLRenderTarget(res, res, rtOpts);
  const fracRT = new THREE.WebGLRenderTarget(res, res, { ...rtOpts, depthBuffer: false });

  const heightMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { uMaxH: { value: 10 } },
    vertexShader: `varying float vY; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vY = wp.y; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `precision highp float; varying float vY; uniform float uMaxH; void main(){ gl_FragColor = vec4(clamp(vY/uMaxH,0.0,1.0),0.0,0.0,1.0); }`,
  });

  const accMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      uHeight: { value: heightRT.texture }, uVP: { value: new THREE.Matrix4() }, uVPinv: { value: new THREE.Matrix4() },
      uMaxH: { value: 10 }, uStepLen: { value: 1 }, uBias: { value: 0.15 }, uCount: { value: 0 },
      uSunDir: { value: Array.from({ length: MAXSTEPS }, () => new THREE.Vector2()) },
      uSunTan: { value: new Float32Array(MAXSTEPS) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv;
      uniform sampler2D uHeight; uniform mat4 uVP, uVPinv; uniform float uMaxH, uStepLen, uBias; uniform int uCount;
      uniform vec2 uSunDir[${MAXSTEPS}]; uniform float uSunTan[${MAXSTEPS}];
      void main(){
        vec4 wp = uVPinv * vec4(vUv*2.0-1.0, 0.0, 1.0); vec2 base = wp.xz / wp.w;
        float lit = 0.0, cnt = 0.0;
        for (int i=0;i<${MAXSTEPS};i++){
          if (i>=uCount) break;
          vec2 dir = uSunDir[i]; float tanA = uSunTan[i]; bool sh = false;
          for (int k=1;k<=${MARCH};k++){
            float dist = float(k)*uStepLen; vec2 p = base + dir*dist;
            vec4 c = uVP * vec4(p.x, 0.0, p.y, 1.0); vec2 uv = (c.xy/c.w)*0.5+0.5;
            if (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) break;
            float h = texture2D(uHeight, uv).r * uMaxH;
            if (h > dist*tanA + uBias){ sh = true; break; }
          }
          if (!sh) lit += 1.0; cnt += 1.0;
        }
        gl_FragColor = vec4(cnt>0.0 ? lit/cnt : 0.0, 0.0, 0.0, 1.0);
      }`,
  });
  const quadScene = new THREE.Scene(); quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accMat));
  const quadCam = new THREE.Camera();
  const pixels = new Uint8Array(res * res * 4);
  R = { res, renderer, heightRT, fracRT, heightMat, accMat, quadScene, quadCam, pixels };
  return R;
}

// строим окклюдеры (здания+конёк, деревья/кусты, забор) в мировых координатах: x=восток, y=верх, z=-север
function buildOccluders(buildings, fenceH, plotLocal, heightMat) {
  const scene = new THREE.Scene(); const disposables = []; let maxH = 3;
  (buildings || []).forEach(b => {
    const pts = b.pts; if (!pts || pts.length < 3) return; const kind = b.kind || 'house';
    if (kind === 'bed') return;                                   // грядки не затеняют
    if (kind === 'tree' || kind === 'bush') {
      const H = b.height || (kind === 'tree' ? 6 : 1.2); maxH = Math.max(maxH, H);
      let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
      const r = kind === 'tree' ? 1.3 : 0.9;
      const g = new THREE.CylinderGeometry(r, r, H, 8); disposables.push(g);
      const m = new THREE.Mesh(g, heightMat); m.position.set(cx, H / 2, -cy); scene.add(m); return;
    }
    const H = (b.height || 3) + (b.roofH || 0) * 0.6; maxH = Math.max(maxH, H);   // конёк учитываем усреднённо
    const shape = new THREE.Shape(); shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }); disposables.push(g);
    const m = new THREE.Mesh(g, heightMat); m.rotation.x = -Math.PI / 2; scene.add(m);   // shape(px,py)→world(px,ze,-py)
  });
  if (fenceH > 0 && plotLocal && plotLocal.length >= 3) {
    maxH = Math.max(maxH, fenceH);
    for (let i = 0; i < plotLocal.length; i++) {
      const A = plotLocal[i], B = plotLocal[(i + 1) % plotLocal.length];
      const dx = B[0] - A[0], dyw = -(B[1] - A[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.3) continue;
      const g = new THREE.BoxGeometry(L, fenceH, 0.25); disposables.push(g);
      const m = new THREE.Mesh(g, heightMat);
      m.position.set((A[0] + B[0]) / 2, fenceH / 2, -(A[1] + B[1]) / 2);
      m.rotation.y = Math.atan2(-dyw, dx); scene.add(m);
    }
  }
  return { scene, disposables, maxH };
}

// главный расчёт. params: { buildings, fenceH, plotLocal, lat, lon, tz, y, mo, da, res=256, stepMin=15 }
// возврат: { frac:Float32Array(res*res), res, vp:number[16], daylightH } или null
export function computeSunHeatmap(p) {
  try {
    const res = p.res || 256, stepMin = p.stepMin || 15;
    const plot = p.plotLocal; if (!plot || plot.length < 3) return null;

    // солнечные шаги за день (только когда солнце над горизонтом)
    const dirs = [], tans = [];
    for (let mm = 0; mm < 1440 && dirs.length < MAXSTEPS; mm += stepMin) {
      const utc = localToUTC(p.y, p.mo - 1, p.da, Math.floor(mm / 60), mm % 60, p.tz);
      const pos = sunPosition(utc, p.lat, p.lon); if (pos.altitude <= 0.03) continue;
      const az = compassAz(pos.azimuth) * Math.PI / 180;
      dirs.push([Math.sin(az), -Math.cos(az)]); tans.push(Math.tan(pos.altitude));
    }
    if (!dirs.length) return { frac: new Float32Array(res * res), res, vp: null, daylightH: 0 };   // полярная ночь и т.п.

    const r = ensure(res);
    const { scene, disposables, maxH } = buildOccluders(p.buildings, p.fenceH || 0, plot, r.heightMat);

    // мировой bbox участка (world x=восток=px, z=-север=-py) + небольшой запас
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    plot.forEach(([px, py]) => { const x = px, z = -py; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); });
    const pad = 1.5; mnx -= pad; mxx += pad; mnz -= pad; mxz += pad;
    const cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2, hw = (mxx - mnx) / 2, hh = (mxz - mnz) / 2;

    const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, maxH + 60);
    cam.position.set(cx, maxH + 40, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const vpInv = new THREE.Matrix4().copy(vp).invert();

    r.heightMat.uniforms.uMaxH.value = maxH;
    // проход 1: heightfield
    r.renderer.setRenderTarget(r.heightRT); r.renderer.setClearColor(0x000000, 1); r.renderer.clear(); r.renderer.render(scene, cam);

    // проход 2: накопление доли освещённости
    const a = r.accMat.uniforms;
    a.uVP.value.copy(vp); a.uVPinv.value.copy(vpInv); a.uMaxH.value = maxH;
    a.uStepLen.value = Math.max(0.25, (2 * Math.max(hw, hh)) / MARCH); a.uCount.value = dirs.length;
    for (let i = 0; i < MAXSTEPS; i++) { if (i < dirs.length) a.uSunDir.value[i].set(dirs[i][0], dirs[i][1]); else a.uSunDir.value[i].set(0, 0); a.uSunTan.value[i] = i < tans.length ? tans[i] : 0; }
    r.renderer.setRenderTarget(r.fracRT); r.renderer.render(r.quadScene, r.quadCam);
    r.renderer.readRenderTargetPixels(r.fracRT, 0, 0, res, res, r.pixels);
    r.renderer.setRenderTarget(null);

    disposables.forEach(g => g.dispose());
    const frac = new Float32Array(res * res);
    for (let i = 0; i < frac.length; i++) frac[i] = r.pixels[i * 4] / 255;
    return { frac, res, vp: Array.from(vp.elements), daylightH: dirs.length * stepMin / 60 };
  } catch (e) { return null; }
}
