'use client';
/** A small line of recent values, drawn inline (no library). */
export function Spark({ values, max, color = 'var(--honey)', height = 36 }: { values: number[]; max?: number; color?: string; height?: number }) {
  const w = 160, m = max ?? Math.max(1, ...values);
  if (values.length < 2) return <svg className="spark" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden />;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(height - 2 - (Math.min(v, m) / m) * (height - 4)).toFixed(1)}`);
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={color} opacity=".14" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
