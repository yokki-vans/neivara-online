/**
 * Appends a clockwise quad for Babylon's left-handed coordinate system when
 * a/b are the near edge and c/d are the far edge. This keeps the visible
 * surface and its generated normals facing upward.
 */
export function appendTopFacingQuad(
  indices: number[],
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  indices.push(a, b, c, b, d, c);
}
