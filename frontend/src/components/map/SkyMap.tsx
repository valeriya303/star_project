import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import * as THREE from "three";

import type { Constellation, Star } from "@/types/star";
import { altAz, lstDeg } from "@/utils/astro";
import type { Place } from "@/utils/astro";
import { rgbToCss } from "@/utils/starColor";
import {
  ALL_TILES, D2R, baseScale, clampView, horizonRadius, pan, project, projectHorizon, startView, tilesInView, zoomAt,
} from "./projection";
import type { EqView, Projection, Pt } from "./projection";
import { MOTION_YEARS, coreRadius } from "./skyConstants";
import "./SkyMap.css";

export type SkyMode = "equatorial" | "local";

interface Props {
  stars: Star[];
  /** Усі завантажені зорі — для ліній сузір'їв незалежно від фільтрів */
  lineStars: Map<number, Star>;
  constellations: Constellation[];
  mode: SkyMode;
  projection: Projection;
  date: Date;
  place: Place;
  selectedHip: number | null;
  selectedConstId: string | null;
  onSelect: (s: Star) => void;
  onSelectConstellation: (c: Constellation) => void;
  showNames: boolean;
  showGrid: boolean;
  showMotion: boolean;
  showConstellations: boolean;
  focus: { ra: number; dec: number; nonce: number } | null;
  onViewTiles?: (ids: string[]) => void;
  overlayMessage?: string | null;
}


const VERT = /* glsl */ `
attribute vec2 radec;
attribute float psize;
attribute vec3 scolor;
uniform float mode;
uniform vec2 center;
uniform float scale;
uniform vec2 viewport;
uniform float lst;
uniform float lat;
uniform float R;
uniform float pixelRatio;
uniform float sizeK;
varying vec3 vColor;
const float PI = 3.141592653589793;
void main() {
  float ra = radec.x;
  float dec = radec.y;
  vec2 p;
  bool vis = true;
  if (mode < 0.5) {
    float dra = mod(ra - center.x + PI, 2.0 * PI) - PI;
    p = vec2(viewport.x * 0.5 - dra * scale, viewport.y * 0.5 - (dec - center.y) * scale);
  } else if (mode < 1.5) {
    float dra = ra - center.x;
    float cosc = sin(center.y) * sin(dec) + cos(center.y) * cos(dec) * cos(dra);
    if (cosc < -0.2) vis = false;
    float k = 2.0 / (1.0 + cosc);
    float X = k * cos(dec) * sin(dra);
    float Y = k * (cos(center.y) * sin(dec) - sin(center.y) * cos(dec) * cos(dra));
    p = vec2(viewport.x * 0.5 - X * scale, viewport.y * 0.5 - Y * scale);
  } else {
    float h = lst - ra;
    float sinAlt = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(h);
    float alt = asin(clamp(sinAlt, -1.0, 1.0));
    if (alt <= 0.0) vis = false;
    float az = atan(-sin(h) * cos(dec), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(h));
    float r = (PI * 0.5 - alt) / (PI * 0.5) * R;
    p = vec2(viewport.x * 0.5 - r * sin(az), viewport.y * 0.5 - r * cos(az));
  }
  vColor = scolor;
  if (!vis) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = vec4(p.x / viewport.x * 2.0 - 1.0, 1.0 - p.y / viewport.y * 2.0, 0.0, 1.0);
  gl_PointSize = psize * sizeK * pixelRatio;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.16, 0.3, d);
  float glow = exp(-d * d * 7.0) * 0.5;
  float a = max(core, glow);
  gl_FragColor = vec4(vColor * a, a);
}`;


interface Seg {
  c: Constellation;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function distToSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2));
  return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy));
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function SkyMap(props: Props) {
  const { mode, projection, focus, onViewTiles } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);

  const glState = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    points: THREE.Points;
    uniforms: Record<string, THREE.IUniform>;
  } | null>(null);
  const [webgl, setWebgl] = useState(true);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<EqView | null>(null);
  const segsRef = useRef<Seg[]>([]);
  const propsRef = useRef(props);
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const frame = useRef(0);
  const dragRef = useRef<{ x: number; y: number; start: EqView; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useLayoutEffect(() => {
    propsRef.current = props;
    viewRef.current = view;
    sizeRef.current = size;
  });

  // ---------------------------------------------------------------- розмір
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- початковий вигляд залежить від розміру
    setView((v) => (v ? clampView(v, size.w, size.h) : startView(size.w, size.h, projection)));
  }, [size, projection]);

  // AC2: зміна проєкції зберігає центр і масштаб (з обмеженням меж для рівнопроміжної)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація з вибраною проєкцією
    setView((v) => {
      if (!v) return v;
      const { w, h } = sizeRef.current;
      const next = { ...v, proj: projection };
      return w > 0 && h > 0 ? clampView(next, w, h) : next;
    });
  }, [projection]);


  // UC-03 крок 9: центрування на вибраній зорі
  useEffect(() => {
    if (!focus || mode !== "equatorial") return;
     
    setView((v) => {
      if (!v) return v;
      const { w, h } = sizeRef.current;
      return clampView({ ...v, ra0: focus.ra, dec0: focus.dec, scale: Math.max(v.scale, baseScale(w, h) * 4) }, w, h);
    });
  }, [focus, mode]);

  // ---------------------------------------------------------------- WebGL
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- запасний режим без WebGL
      setWebgl(false);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms: Record<string, THREE.IUniform> = {
      mode: { value: 0 },
      center: { value: new THREE.Vector2(Math.PI, 0) },
      scale: { value: 1 },
      viewport: { value: new THREE.Vector2(1, 1) },
      lst: { value: 0 },
      lat: { value: 0 },
      R: { value: 1 },
      pixelRatio: { value: 1 },
      sizeK: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    points.frustumCulled = false;
    scene.add(points);
    glState.current = { renderer, scene, camera, points, uniforms };
    return () => {
      points.geometry.dispose();
      material.dispose();
      renderer.dispose();
      glState.current = null;
    };
  }, []);

  // Буфер атрибутів перебудовується лише при зміні набору зір
  useEffect(() => {
    const st = glState.current;
    if (!st) return;
    const n = props.stars.length;
    const radec = new Float32Array(n * 2);
    const psize = new Float32Array(n);
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = props.stars[i];
      radec[i * 2] = s.ra * D2R;
      radec[i * 2 + 1] = s.dec * D2R;
      psize[i] = Math.max(3.2, (coreRadius(s.vmag) * 2) / 0.3);
      color[i * 3] = ((s.color >> 16) & 255) / 255;
      color[i * 3 + 1] = ((s.color >> 8) & 255) / 255;
      color[i * 3 + 2] = (s.color & 255) / 255;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("radec", new THREE.BufferAttribute(radec, 2));
    g.setAttribute("psize", new THREE.BufferAttribute(psize, 1));
    g.setAttribute("scolor", new THREE.BufferAttribute(color, 3));
    // Позиція не використовується шейдером, але потрібна three.js для кількості вершин
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    st.points.geometry.dispose();
    st.points.geometry = g;
  }, [props.stars]);

  // ---------------------------------------------------------------- малювання
  const draw = useCallback(() => {
    frame.current = 0;
    const p = propsRef.current;
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const under = underRef.current;
    const over = overRef.current;
    if (!v || !under || !over || w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const local = p.mode === "local";
    const R = horizonRadius(w, h);
    const lst = lstDeg(p.date, p.place.lon);
    const zoom = v.scale / baseScale(w, h);

    const proj = (ra: number, dec: number): Pt => {
      if (!local) return project(v, w, h, ra, dec);
      const { alt, az } = altAz(ra, dec, p.place.lat, lst);
      return projectHorizon(alt, az, w, h, R);
    };

    for (const c of [under, over]) {
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
    }
    const accent = cssVar("--color-accent", "#ffed7b");
    const teal = cssVar("--color-teal", "#7fe0c8");
    const text = cssVar("--color-text", "#f5f5f5");
    const muted = cssVar("--color-menu-text", "#c6a6d7");

    // ---- нижній шар: сітка, горизонт, лінії сузір'їв
    const u = under.getContext("2d")!;
    u.setTransform(dpr, 0, 0, dpr, 0, 0);
    u.clearRect(0, 0, w, h);
    u.font = "11px Montserrat, sans-serif";

    const polyline = (pts: Pt[], ctx: CanvasRenderingContext2D) => {
      let pen = false;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        const prev = pts[i - 1];
        if (!q.ok || (prev && Math.abs(q.x - prev.x) > w * 0.5)) {
          pen = false;
          if (!q.ok) continue;
        }
        if (!pen) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
        pen = true;
      }
      ctx.stroke();
    };

    if (local) {
      u.fillStyle = "rgba(0,0,0,0.18)";
      u.beginPath();
      u.arc(w / 2, h / 2, R, 0, Math.PI * 2);
      u.fill();
    }

    if (p.showGrid) {
      u.strokeStyle = "rgba(255,255,255,0.13)";
      u.fillStyle = "rgba(255,255,255,0.45)";
      u.lineWidth = 1;
      if (!local) {
        const raStep = zoom > 6 ? 15 : 30;
        const decStep = zoom > 6 ? 10 : 30;
        for (let ra = 0; ra < 360; ra += raStep) {
          const pts: Pt[] = [];
          for (let dec = -88; dec <= 88; dec += 2) pts.push(project(v, w, h, ra, dec));
          polyline(pts, u);
          const lab = project(v, w, h, ra, Math.max(-80, Math.min(80, v.dec0)));
          if (lab.ok) u.fillText(`${ra / 15}h`, lab.x + 3, lab.y - 3);
        }
        for (let dec = -90 + decStep; dec < 90; dec += decStep) {
          const pts: Pt[] = [];
          for (let ra = 0; ra <= 360; ra += 2) pts.push(project(v, w, h, ra, dec));
          u.strokeStyle = dec === 0 ? "rgba(127,224,200,0.35)" : "rgba(255,255,255,0.13)";
          polyline(pts, u);
          const lab = project(v, w, h, wrapRa(v.ra0 + 1), dec);
          if (lab.ok) u.fillText(`${dec > 0 ? "+" : dec < 0 ? "−" : ""}${Math.abs(dec)}°`, 6, lab.y - 3);
        }
      } else {
        for (const alt of [30, 60]) {
          u.beginPath();
          u.arc(w / 2, h / 2, ((90 - alt) / 90) * R, 0, Math.PI * 2);
          u.stroke();
          u.fillText(`${alt}°`, w / 2 + 4, h / 2 - ((90 - alt) / 90) * R - 4);
        }
        u.beginPath();
        u.moveTo(w / 2 - R, h / 2);
        u.lineTo(w / 2 + R, h / 2);
        u.moveTo(w / 2, h / 2 - R);
        u.lineTo(w / 2, h / 2 + R);
        u.stroke();
      }
    }
    if (local) {
      u.strokeStyle = "rgba(255,255,255,0.55)";
      u.lineWidth = 1.5;
      u.beginPath();
      u.arc(w / 2, h / 2, R, 0, Math.PI * 2);
      u.stroke();
      u.fillStyle = text;
      u.font = "600 13px Montserrat, sans-serif";
      u.textAlign = "center";
      u.fillText("Пн", w / 2, h / 2 - R - 10);
      u.fillText("Пд", w / 2, h / 2 + R + 20);
      u.fillText("Сх", w / 2 - R - 16, h / 2 + 4);
      u.fillText("Зх", w / 2 + R + 16, h / 2 + 4);
      u.textAlign = "left";
    }

    const segs: Seg[] = [];
    const consLabels: { c: Constellation; x: number; y: number }[] = [];
    if (p.showConstellations) {
      for (const c of p.constellations) {
        const selected = c.id === p.selectedConstId;
        u.strokeStyle = selected ? accent : "rgba(127,224,200,0.42)";
        u.lineWidth = selected ? 2.4 : 1;
        let sx = 0;
        let sy = 0;
        let n = 0;
        u.beginPath();
        for (const [a, b] of c.lines) {
          const sa = p.lineStars.get(a);
          const sb = p.lineStars.get(b);
          if (!sa || !sb) continue;
          const pa = proj(sa.ra, sa.dec);
          const pb = proj(sb.ra, sb.dec);
          if (!pa.ok || !pb.ok || Math.abs(pa.x - pb.x) > w * 0.5) continue;
          if ((pa.x < -50 && pb.x < -50) || (pa.x > w + 50 && pb.x > w + 50) || (pa.y < -50 && pb.y < -50) || (pa.y > h + 50 && pb.y > h + 50)) continue;
          u.moveTo(pa.x, pa.y);
          u.lineTo(pb.x, pb.y);
          segs.push({ c, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
          sx += pa.x + pb.x;
          sy += pa.y + pb.y;
          n += 2;
        }
        u.stroke();
        if (n > 0) consLabels.push({ c, x: sx / n, y: sy / n });
      }
    }
    segsRef.current = segs;

    // ---- зорі (WebGL)
    const st = glState.current;
    if (st && webgl) {
      st.renderer.setPixelRatio(dpr);
      st.renderer.setSize(w, h, false);
      const un = st.uniforms;
      un.mode.value = local ? 2 : v.proj === "stereo" ? 1 : 0;
      (un.center.value as THREE.Vector2).set(v.ra0 * D2R, v.dec0 * D2R);
      un.scale.value = v.scale / D2R;
      (un.viewport.value as THREE.Vector2).set(w, h);
      un.lst.value = lst * D2R;
      un.lat.value = p.place.lat * D2R;
      un.R.value = R;
      un.pixelRatio.value = dpr;
      un.sizeK.value = local ? 1 : Math.min(2, 1 + Math.log2(Math.max(1, zoom)) * 0.22);
      st.renderer.render(st.scene, st.camera);
    }

    // ---- верхній шар: рух, виділення, підписи
    const o = over.getContext("2d")!;
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.clearRect(0, 0, w, h);

    if (!webgl) {
      // Запасне відображення без WebGL: найяскравіші зорі на Canvas 2D
      const limit = Math.min(p.stars.length, 15000);
      for (let i = 0; i < limit; i++) {
        const s = p.stars[i];
        const q = proj(s.ra, s.dec);
        if (!q.ok || q.x < -5 || q.y < -5 || q.x > w + 5 || q.y > h + 5) continue;
        o.fillStyle = rgbToCss(s.color);
        o.beginPath();
        o.arc(q.x, q.y, coreRadius(s.vmag), 0, Math.PI * 2);
        o.fill();
      }
    }

    if (p.showMotion && !local) {
      o.strokeStyle = teal;
      o.lineWidth = 1.2;
      let drawn = 0;
      for (const s of p.stars) {
        if (drawn > 4000) break;
        if (s.pmRa == null || s.pmDec == null || Math.hypot(s.pmRa, s.pmDec) < 20) continue;
        const a = proj(s.ra, s.dec);
        if (!a.ok || a.x < 0 || a.y < 0 || a.x > w || a.y > h) continue;
        const ddec = (s.pmDec * MOTION_YEARS) / 3.6e6;
        const dra = (s.pmRa * MOTION_YEARS) / 3.6e6 / Math.max(0.05, Math.cos(s.dec * D2R));
        const b = proj(s.ra + dra, Math.max(-89.9, Math.min(89.9, s.dec + ddec)));
        if (!b.ok || Math.abs(b.x - a.x) > w * 0.5) continue;
        o.beginPath();
        o.moveTo(a.x, a.y);
        o.lineTo(b.x, b.y);
        o.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (Math.hypot(b.x - a.x, b.y - a.y) > 6) {
          o.beginPath();
          o.moveTo(b.x, b.y);
          o.lineTo(b.x - 4 * Math.cos(ang - 0.5), b.y - 4 * Math.sin(ang - 0.5));
          o.moveTo(b.x, b.y);
          o.lineTo(b.x - 4 * Math.cos(ang + 0.5), b.y - 4 * Math.sin(ang + 0.5));
          o.stroke();
        }
        drawn++;
      }
    }

    if (p.showConstellations) {
      o.textAlign = "center";
      for (const { c, x, y } of consLabels) {
        if (x < 0 || y < 0 || x > w || y > h) continue;
        const selected = c.id === p.selectedConstId;
        if (!selected && !local && zoom < 1.8) continue; // на загальному плані назви сузір'їв не перевантажують карту
        o.font = `italic 600 ${selected ? 14 : 12}px Montserrat, sans-serif`;
        o.fillStyle = selected ? accent : "rgba(127,224,200,0.8)";
        o.fillText(c.name, x, y - 14);
      }
      o.textAlign = "left";
    }

    if (p.showNames) {
      o.font = "12px Montserrat, sans-serif";
      o.fillStyle = text;
      const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const maxNames = local ? 60 : Math.round(40 * Math.min(8, zoom));
      // Підписи лише для зір, яскравіших за межу, що зростає з масштабом
      const magLimit = local ? 2.2 : 2.2 + 1.6 * Math.log2(Math.max(1, zoom));
      let count = 0;
      for (const s of p.stars) {
        if (count >= maxNames) break;
        if (!s.name || s.vmag > magLimit) continue;
        const q = proj(s.ra, s.dec);
        if (!q.ok || q.x < 0 || q.y < 0 || q.x > w || q.y > h) continue;
        const tw = o.measureText(s.name).width;
        const x = q.x + coreRadius(s.vmag) + 5;
        const y = q.y + 4;
        const box = { x1: x - 2, y1: y - 12, x2: x + tw + 2, y2: y + 4 };
        if (boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) continue;
        boxes.push(box);
        o.fillText(s.name, x, y);
        count++;
      }
    }

    if (p.selectedHip != null) {
      const s = p.lineStars.get(p.selectedHip) ?? p.stars.find((x) => x.hip === p.selectedHip);
      if (s) {
        const q = proj(s.ra, s.dec);
        if (q.ok) {
          o.strokeStyle = accent;
          o.lineWidth = 2;
          o.beginPath();
          o.arc(q.x, q.y, coreRadius(s.vmag) + 7, 0, Math.PI * 2);
          o.stroke();
        }
      }
    }
    o.fillStyle = muted;
  }, [webgl]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    schedule();
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  // Повідомляємо, які ділянки неба потрібні (UC-02 кроки 6–7)
  useEffect(() => {
    if (!onViewTiles || !view || size.w === 0) return;
    const t = window.setTimeout(() => {
      onViewTiles(mode === "local" ? ALL_TILES : tilesInView(view, size.w, size.h));
    }, 250);
    return () => window.clearTimeout(t);
  }, [view, size, mode, onViewTiles]);

  // колесо миші = масштаб (потрібен не-passive слухач)
  useEffect(() => {
    const canvas = overRef.current;
    if (!canvas || mode !== "equatorial") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const { w, h } = sizeRef.current;
      setView((v) => (v ? zoomAt(v, w, h, factor, e.clientX - rect.left, e.clientY - rect.top) : v));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [mode]);

  // ---------------------------------------------------------------- взаємодія
  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      dragRef.current = null;
    } else if (pointers.current.size === 1 && view) {
      dragRef.current = { x: e.clientX, y: e.clientY, start: view, moved: false };
    }
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode !== "equatorial") return;
    if (pointers.current.size === 2 && pinch.current !== null) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = e.currentTarget.getBoundingClientRect();
      const factor = dist / pinch.current;
      pinch.current = dist;
      setView((v) => (v ? zoomAt(v, size.w, size.h, factor, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top) : v));
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setView(clampView(pan(d.start, dx, dy), size.w, size.h));
  }

  function onPointerCancel(e: RPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    dragRef.current = null;
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = dragRef.current;
    dragRef.current = null;
    if (mode === "equatorial" && (!d || d.moved)) return;
    if (!view) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const slop = window.matchMedia("(pointer: coarse)").matches ? 16 : 8;
    const { w, h } = size;
    const R = horizonRadius(w, h);
    const lst = lstDeg(props.date, props.place.lon);

    // 1) зоря має пріоритет
    let best: Star | null = null;
    let bestScore = Infinity;
    for (const s of props.stars) {
      let q: Pt;
      if (mode === "local") {
        const { alt, az } = altAz(s.ra, s.dec, props.place.lat, lst);
        q = projectHorizon(alt, az, w, h, R);
      } else q = project(view, w, h, s.ra, s.dec);
      if (!q.ok) continue;
      const dist = Math.hypot(q.x - px, q.y - py);
      const r = coreRadius(s.vmag) + slop;
      if (dist <= r) {
        const score = dist + s.vmag * 0.8; // яскравіша зоря виграє при перекритті
        if (score < bestScore) {
          best = s;
          bestScore = score;
        }
      }
    }
    if (best) {
      props.onSelect(best);
      return;
    }
    // 2) лінія сузір'я
    let bestSeg: Seg | null = null;
    let bestSegDist = Infinity;
    for (const seg of segsRef.current) {
      const dist = distToSeg(px, py, seg);
      if (dist <= slop && dist < bestSegDist) {
        bestSeg = seg;
        bestSegDist = dist;
      }
    }
    if (bestSeg) props.onSelectConstellation(bestSeg.c);
  }

  const zoomBy = (f: number) => setView((v) => (v ? zoomAt(v, size.w, size.h, f, size.w / 2, size.h / 2) : v));

  return (
    <div ref={wrapRef} className="sky">
      <canvas ref={underRef} className="sky__layer" aria-hidden="true" />
      <canvas ref={glRef} className="sky__layer" aria-hidden="true" />
      <canvas
        ref={overRef}
        className={"sky__layer sky__canvas" + (mode === "equatorial" ? " sky__canvas--drag" : "")}
        role="img"
        aria-label={mode === "local" ? "Карта неба над місцем спостереження" : "Екваторіальна карта зір"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {mode === "equatorial" && (
        <div className="sky__zoom">
          <button type="button" aria-label="Збільшити" onClick={() => zoomBy(1.5)}>+</button>
          <button type="button" aria-label="Зменшити" onClick={() => zoomBy(1 / 1.5)}>−</button>
          <button type="button" aria-label="Скинути вигляд" onClick={() => setView(startView(size.w, size.h, projection))}>⟲</button>
        </div>
      )}

      {props.overlayMessage && <p className="sky__empty">{props.overlayMessage}</p>}
    </div>
  );
}

const wrapRa = (a: number) => ((a % 360) + 360) % 360;
