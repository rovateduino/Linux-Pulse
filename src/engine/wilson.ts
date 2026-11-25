export const WILSON_Z = 1.96

export function wilson(proportion: number, n: number, z = WILSON_Z): [number, number] {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(proportion)) {
    return [0, 0]
  }

  const p = Math.min(1, Math.max(0, proportion))
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator

  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
