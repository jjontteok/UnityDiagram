// 분석 결과로 만든 해설이 그래프에 실제로 있는 요소만 가리키는지 검증
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeProject } from "../src/graph/builder.js";
import { DEFAULT_EXCLUDES } from "../src/scan/fileScanner.js";
import { buildNodeExplain, buildOverview } from "../src/guide/narrative.js";
import type { NarrationStep, ProjectGraph } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let g: ProjectGraph;

beforeAll(async () => {
  g = await analyzeProject(path.join(here, "fixtures", "SampleUnityProject"), DEFAULT_EXCLUDES, () => {});
});

function expectValidIds(steps: NarrationStep[]) {
  const nodes = new Set(g.nodes.map((n) => n.id));
  const edges = new Set(g.edges.map((e) => e.id));
  const modules = new Set(g.modules.map((m) => m.id));
  for (const s of steps) {
    expect(s.title).not.toBe("");
    expect(s.markdown).not.toBe("");
    for (const id of s.focus.nodeIds) expect(nodes.has(id)).toBe(true);
    for (const id of s.focus.edgeIds) expect(edges.has(id)).toBe(true);
    for (const id of s.focus.moduleIds) expect(modules.has(id)).toBe(true);
    for (const q of s.sequence) {
      expect(nodes.has(q.from) && nodes.has(q.to)).toBe(true);
      if (q.edgeId) expect(edges.has(q.edgeId)).toBe(true);
    }
  }
}

describe("구조 해설", () => {
  it("개요 → 계층 → 흐름 → 패턴 → 정리 순서로 만든다", () => {
    const { steps } = buildOverview(g);
    expect(steps[0].type).toBe("overview");
    expect(steps.at(-1)!.type).toBe("summary");
    expect(steps.some((s) => s.type === "layer")).toBe(true);
    expect(steps.some((s) => s.type === "flow" && s.sequence.length > 0)).toBe(true);
    expect(steps.some((s) => s.title.includes("싱글톤"))).toBe(true);
    expect(steps.some((s) => s.title.includes("이벤트") && s.focus.nodeIds.includes("ScoreUI"))).toBe(true);
    expect(steps.map((s) => s.stepIndex)).toEqual(steps.map((_, i) => i));
    expectValidIds(steps);
  });

  it("클래스 설명", () => {
    const { steps } = buildNodeExplain(g, "Enemy");
    expect(steps[0].markdown).toContain("MonoBehaviour");
    expect(steps.some((s) => s.markdown.includes("Awake"))).toBe(true);
    expect(steps.some((s) => s.markdown.includes("GameManager"))).toBe(true);
    expectValidIds(steps);
    expect(buildNodeExplain(g, "NoSuchClass").steps).toEqual([]);
  });
});
