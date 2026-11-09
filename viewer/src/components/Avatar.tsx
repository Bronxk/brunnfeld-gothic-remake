import { useEffect, useRef } from "react";
import { c, radius } from "../theme";

const BASE = "/assets/units/Pawn/";

/** Idle pawn sheet by skill (carried tool matches the trade). Sheets are N square frames side by side. */
function sheetFor(agent: string, skill: string | undefined): string {
  if (agent === "reinhart") return "Pawn_Idle Gold.png";
  switch (skill) {
    case "knappe": return "Pawn_Idle Pickaxe.png";
    case "holzfaeller": return "Pawn_Idle Axe.png";
    case "schmied":
    case "zimmermann": return "Pawn_Idle Hammer.png";
    case "baecker":
    case "wirt":
    case "hirte": return "Pawn_Idle Meat.png";
    case "mueller": return "Pawn_Idle Wood.png";
    case "bauer":
    case "bader":
    case "naeherin": return "Pawn_Idle Knife.png";
    default: return "Pawn_Idle.png";
  }
}

const imgCache = new Map<string, HTMLImageElement>();

/** Small animated pawn portrait (canvas). Static first frame when the user prefers reduced motion. */
export default function Avatar({ agent, skill, size = 68 }: { agent: string; skill?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const url = BASE + sheetFor(agent, skill);
    let img = imgCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      imgCache.set(url, img);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const draw = () => {
      if (!img || !img.complete || img.naturalHeight === 0) return;
      const fh = img.naturalHeight;
      const frames = Math.max(1, Math.floor(img.naturalWidth / fh));
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (frame % frames) * fh, 0, fh, fh, 0, 0, canvas.width, canvas.height);
      frame += 1;
    };
    const start = () => {
      draw();
      if (!reduced) timer = setInterval(draw, 170);
    };
    if (img.complete) start();
    else img.addEventListener("load", start, { once: true });
    return () => {
      if (timer) clearInterval(timer);
      img?.removeEventListener("load", start);
    };
  }, [agent, skill]);

  return (
    <canvas
      ref={ref}
      className="kol-avatar"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size, borderRadius: radius.lg, background: c.panel3 }}
      aria-hidden="true"
    />
  );
}
