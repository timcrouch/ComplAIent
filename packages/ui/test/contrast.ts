// WCAG 2.2 relative-luminance contrast helper (test-only).
// Accepts #RRGGBB or rgba(r, g, b, a); translucent colours are composited
// over an opaque backdrop with `over()` before measuring.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba {
  const value = input.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    value,
  );
  if (rgba?.[1] && rgba[2] && rgba[3]) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

/** Composite `top` (possibly translucent) over an opaque `backdrop`. */
export function over(top: string, backdrop: string): string {
  const t = parseColor(top);
  const b = parseColor(backdrop);
  if (b.a !== 1) throw new Error(`Backdrop must be opaque: ${backdrop}`);
  const mix = (fg: number, bg: number) => Math.round(fg * t.a + bg * (1 - t.a));
  return `rgba(${String(mix(t.r, b.r))}, ${String(mix(t.g, b.g))}, ${String(mix(t.b, b.b))}, 1)`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: string): number {
  const { r, g, b, a } = parseColor(color);
  if (a !== 1) throw new Error(`Composite translucent colours first: ${color}`);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
