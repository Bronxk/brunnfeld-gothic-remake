import { useId } from "react";
import { c } from "../theme";

/** Tiny inline price trend. `color` is a CSS colour / var() (default: accent). */
export function Sparkline({ data, width = 64, height = 20, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <span className="muted" aria-hidden="true">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={color ? { ["--chart" as string]: color } : undefined} aria-hidden="true">
      <polygon points={`0,${height} ${line} ${width},${height}`} />
      <polyline points={line} />
      <circle cx={last[0]} cy={last[1]} r={2} />
    </svg>
  );
}

/** Line + area chart with a light grid, used on the Wirtschaft tab. Scales to the container width. */
export function LineChart({ data, height = 84, color = c.accent, label }: { data: number[]; height?: number; color?: string; label: string }) {
  const gid = useId();
  const W = 300;
  const padL = 4, padR = 4, padT = 6, padB = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / range) * (height - padT - padB);
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={label} style={{ display: "block", height: "auto" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={padT + f * (height - padT - padB)} y2={padT + f * (height - padT - padB)} stroke={c.line} strokeDasharray="2 4" />
      ))}
      <polygon points={`${x(0)},${height - padB} ${line} ${x(data.length - 1)},${height - padB}`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1]!)} r="3" fill={color} />
    </svg>
  );
}
