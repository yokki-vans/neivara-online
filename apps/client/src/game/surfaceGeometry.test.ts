import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { describe, expect, it } from "vitest";
import { appendTopFacingQuad } from "./surfaceGeometry";

describe("appendTopFacingQuad", () => {
  it("produces upward-facing normals for a flat world surface", () => {
    const indices: number[] = [];
    appendTopFacingQuad(indices, 0, 1, 2, 3);

    const normals: number[] = [];
    VertexData.ComputeNormals(
      [
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
        1, 0, 1,
      ],
      indices,
      normals,
    );

    expect(indices).toEqual([0, 1, 2, 1, 3, 2]);
    for (let index = 1; index < normals.length; index += 3) {
      expect(normals[index]).toBeGreaterThan(0.99);
    }
  });
});
