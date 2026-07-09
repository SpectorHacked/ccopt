/** Lightweight SVG chart primitives — no chart library (CSP-clean, tiny). */
import type { ReactNode } from 'react';

export function Sparkline({ points, color, w = 118, h = 40 }: { points: number[]; color: string; w?: number; h?: number }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const step = (w - pad * 2) / (points.length - 1);
  const xy = points.map((p, i) => [pad + i * step, h - pad - ((p - min) / span) * (h - pad * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${h} L${xy[0][0].toFixed(1)} ${h} Z`;
  const gid = `sg-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface Seg { value: number; color: string; }

export function Donut({
  segments, size = 118, thickness = 12, children,
}: { segments: Seg[]; size?: number; thickness?: number; children?: ReactNode }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--inset)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={thickness} strokeLinecap="round"
              strokeDasharray={`${Math.max(len - 2, 0)} ${c}`} strokeDashoffset={-acc} />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}
