// SPEC 10.2 픽스처의 기대 엣지/역할 검증
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeProject } from "../src/graph/builder.js";
import { DEFAULT_EXCLUDES } from "../src/scan/fileScanner.js";
import { parseTypeString } from "../src/parse/csharpParser.js";
import type { ProjectGraph } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "SampleUnityProject");

let g: ProjectGraph;
beforeAll(async () => {
  g = await analyzeProject(fixture, DEFAULT_EXCLUDES, () => {});
});

const edge = (kind: string, s: string, t: string) => g.edges.find((e) => e.id === `${kind}:${s}->${t}`);
const node = (id: string) => g.nodes.find((n) => n.id === id)!;

describe("기대 엣지", () => {
  it.each([
    ["inherits", "Enemy", "EntityBase"],
    ["implements", "EntityBase", "IDamageable"],
    ["references", "EntityBase", "EntityData"],
    ["usesSingleton", "Enemy", "GameManager"],
    ["references", "Player", "Weapon"],
    ["requiresComponent", "Player", "PlayerInput"],
    ["subscribes", "ScoreUI", "GameManager"],
    ["usesSingleton", "ScoreUI", "GameManager"],
    ["coLocated", "Enemy", "PlayerInput"],
    ["wiredInInspector", "Enemy", "EntityData"],
  ])("%s: %s → %s", (kind, s, t) => {
    const e = edge(kind, s, t);
    expect(e).toBeDefined();
    expect(e!.evidence.length).toBeGreaterThan(0);
  });

  it("직렬화/다중성 표시", () => {
    expect(edge("references", "EntityBase", "EntityData")!.serialized).toBe(true);
    const w = edge("references", "Player", "Weapon")!;
    expect(w.serialized).toBe(true);
    expect(w.multiplicity).toBe("many");
  });

  it("호출된 멤버 기록", () => {
    expect(edge("usesSingleton", "Enemy", "GameManager")!.calls).toContain("Instance");
    expect(edge("references", "Enemy", "GameManager")!.calls).toContain("AddScore()");
  });

  it("외부 타입(Rigidbody2D)은 노드/엣지가 없다", () => {
    expect(g.nodes.find((n) => n.name === "Rigidbody2D")).toBeUndefined();
    expect(g.edges.find((e) => e.target.includes("Rigidbody2D"))).toBeUndefined();
  });
});

describe("기대 역할", () => {
  it("Unity 역할", () => {
    expect(node("Enemy").unityRole).toBe("MonoBehaviour");
    expect(node("Player").unityRole).toBe("NetworkBehaviour");
    expect(node("Player").methods.filter((m) => m.isRpc)).toHaveLength(1);
    expect(node("EntityData").unityRole).toBe("ScriptableObject");
    expect(node("GameManager").unityRole).toBe("MonoBehaviour");
    expect(node("GameManager").tags).toContain("singleton");
    expect(node("ScoreUI").unityRole).toBe("MonoBehaviour");
    expect(node("ScoreUI").tags).toContain("ui");
    expect(node("Weapon").unityRole).toBe("Data");
    expect(node("IDamageable").unityRole).toBe("Interface");
  });

  it("에셋 사용처", () => {
    expect(node("Enemy").usedIn).toEqual(["Prefabs/Enemy.prefab"]);
    expect(node("EntityData").assetInstances).toBe(1);
    expect(node("GameManager").summary).toContain("점수");
  });

  it("메타데이터", () => {
    expect(g.unityVersion).toBe("6000.0.30f1");
    expect(g.packages).toEqual(["com.unity.netcode.gameobjects"]);
    expect(g.metrics.hubs.slice(0, 2)).toContain("GameManager");
  });
});

describe("parseTypeString", () => {
  it("제네릭/배열", () => {
    expect(parseTypeString("Dictionary<int, List<Item>>")).toEqual({
      name: "Dictionary",
      array: false,
      args: [
        { name: "int", args: [], array: false },
        { name: "List", args: [{ name: "Item", args: [], array: false }], array: false },
      ],
    });
    expect(parseTypeString("Enemy[]").array).toBe(true);
  });
});
