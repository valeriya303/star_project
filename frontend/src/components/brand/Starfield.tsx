import { useEffect, useRef } from "react";
import "./Starfield.css";

interface Dot {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  phase: number;
  tint: string;
}

/**
 * Фонове зоряне небо для всього застосунку: туманності, мерехтливі зорі
 * й зрідка — метеор. Поважає налаштування «зменшити рух».
 */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

    function build() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 5200);
      const tints = ["255,255,255", "255,237,123", "198,166,215", "169,196,255", "255,210,170"];
      dots = Array.from({ length: count }, () => {
        const big = Math.random() < 0.05;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: big ? 1.1 + Math.random() * 0.9 : 0.35 + Math.random() * 0.75,
          a: big ? 0.75 : 0.25 + Math.random() * 0.45,
          speed: 0.4 + Math.random() * 1.6,
          phase: Math.random() * Math.PI * 2,
          tint: Math.random() < 0.82 ? tints[0] : tints[1 + Math.floor(Math.random() * 4)],
        };
      });
    }

    function frame(t: number) {
      raf = requestAnimationFrame(frame);
      if (t - last < 66) return; // ≈ 15 кадрів/с достатньо для мерехтіння
      last = t;
      ctx!.clearRect(0, 0, w, h);
      const time = t / 1000;
      for (const d of dots) {
        const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(time * d.speed + d.phase);
        ctx!.fillStyle = `rgba(${d.tint},${d.a * tw})`;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx!.fill();
        if (d.r > 1.1) {
          ctx!.fillStyle = `rgba(${d.tint},${0.08 * tw})`;
          ctx!.beginPath();
          ctx!.arc(d.x, d.y, d.r * 4, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
      if (!reduce) {
        if (!meteor && Math.random() < 0.004) {
          meteor = { x: Math.random() * w * 0.8 + w * 0.1, y: Math.random() * h * 0.4, vx: 9 + Math.random() * 5, vy: 4 + Math.random() * 3, life: 1 };
        }
        if (meteor) {
          const m = meteor;
          const g = ctx!.createLinearGradient(m.x, m.y, m.x - m.vx * 9, m.y - m.vy * 9);
          g.addColorStop(0, `rgba(255,245,200,${0.85 * m.life})`);
          g.addColorStop(1, "rgba(255,245,200,0)");
          ctx!.strokeStyle = g;
          ctx!.lineWidth = 1.4;
          ctx!.beginPath();
          ctx!.moveTo(m.x, m.y);
          ctx!.lineTo(m.x - m.vx * 9, m.y - m.vy * 9);
          ctx!.stroke();
          m.x += m.vx;
          m.y += m.vy;
          m.life -= 0.045;
          if (m.life <= 0) meteor = null;
        }
      }
    }

    build();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", build);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", build);
    };
  }, []);

  return (
    <div className="starfield" aria-hidden="true">
      <div className="starfield__nebula" />
      <canvas ref={ref} className="starfield__canvas" />
    </div>
  );
}
