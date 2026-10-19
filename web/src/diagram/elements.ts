// 그래프 + 뷰 상태 → Cytoscape 요소. 접힌 모듈은 하나의 노드로, 그 사이 엣지는 집계 엣지로 만든다 (SPEC 7.2)
import type { ElementDefinition } from "cytoscape";
import type { Edge, EdgeKind, Module, ProjectGraph, TypeNode, UnityRole } from "../types";
import type { ViewMode } from "../state/store";
import { louvain, type WEdge } from "./community";

export interface BuildInput {
  graph: ProjectGraph;
  modules: Module[];
  mode: ViewMode;
  expanded: Set<string>;
  roleFilter: Record<UnityRole, boolean>;
  edgeFilter: Record<EdgeKind, boolean>;
  neighborRoot: string | null;
  hops: number;
}

export interface BuildResult {
  elements: ElementDefinition[];
  /** 노드 id → 화면에 실제로 보이는 요소 id (자신, 또는 접힌 모듈) */
  repOf: Map<string, string>;
  /** 원본 엣지 id → 화면 엣지 id */
  edgeRepOf: Map<string, string>;
  visibleNodeCount: number;
}

const STEREO: Record<UnityRole, string> = {
  MonoBehaviour: "MonoBehaviour",
  NetworkBehaviour: "NetworkBehaviour",
  ScriptableObject: "ScriptableObject",
  EditorScript: "Editor",
  Interface: "interface",
  Data: "class",
  Enum: "enum",
  External: "library",
};

const DISPLAY_ARITY = /`(\d+)$/;

export function displayName(n: TypeNode) {
  const m = DISPLAY_ARITY.exec(n.id);
  return m ? `${n.name}<${Array.from({ length: Number(m[1]) }, (_, i) => (i ? `T${i + 1}` : "T")).join(",")}>` : n.name;
}

function badges(g: ProjectGraph, n: TypeNode, inCycle: Set<string>) {
  const b: string[] = [];
  if (n.unityRole === "NetworkBehaviour") b.push("🌐");
  if (n.tags.includes("singleton")) b.push("⭐");
  if (n.usedIn.length) b.push(`📦${n.usedIn.length}`);
  if (n.assetInstances) b.push(`🗂${n.assetInstances}`);
  if (inCycle.has(n.id)) b.push("🔁");
  return b.join(" ");
}

const textWidth = (s: string) => {
  // 한글/이모지는 넓게
  let w = 0;
  for (const ch of s) w += /[ᄀ-￿]/.test(ch) ? 11 : 6.6;
  return w;
};

function classData(g: ProjectGraph, n: TypeNode, inCycle: Set<string>) {
  const title = displayName(n);
  const b = badges(g, n, inCycle);
  const shortLines = [`«${STEREO[n.unityRole]}»`, title, ...(b ? [b] : [])];
  const members: string[] = [];
  const fields = [...n.fields.filter((f) => f.serialized), ...n.events, ...n.networkVars].slice(0, 6);
  for (const f of fields) members.push(`${f.serialized ? "◆" : "+"} ${f.name}: ${f.type}`.slice(0, 48));
  const methods = n.methods.filter((m) => m.access === "public" || m.isUnityMessage || m.isRpc).slice(0, 8);
  if (members.length && methods.length) members.push("──────");
  for (const m of methods) members.push(`${m.isRpc ? "⇄" : m.isUnityMessage ? "◇" : "+"} ${m.name}()`.slice(0, 48));
  const fullLines = members.length ? [...shortLines, "──────", ...members] : shortLines;
  const w = (lines: string[]) => Math.max(90, Math.max(...lines.map(textWidth)) + 26);
  return {
    label: shortLines.join("\n"),
    labelFull: fullLines.join("\n"),
    w: w(shortLines),
    h: shortLines.length * 15 + 18,
    wFull: w(fullLines),
    hFull: fullLines.length * 14 + 18,
  };
}

export function buildElements(inp: BuildInput): BuildResult {
  const { graph: g, modules, mode, expanded, roleFilter, edgeFilter } = inp;
  const inCycle = new Set(g.metrics.cycles.flat());
  const visibleNode = (n: TypeNode) => roleFilter[n.unityRole] !== false;
  const edges = g.edges.filter((e) => edgeFilter[e.kind]);
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));

  let nodes = g.nodes.filter(visibleNode);
  const useModules = mode === "module" || mode === "all";

  if (mode === "inherit") {
    const inh = new Set(g.edges.filter((e) => e.kind === "inherits" || e.kind === "implements").flatMap((e) => [e.source, e.target]));
    nodes = nodes.filter((n) => inh.has(n.id));
  } else if (mode === "neighbor" && inp.neighborRoot) {
    const keep = new Set([inp.neighborRoot]);
    let frontier = [inp.neighborRoot];
    for (let h = 0; h < inp.hops; h++) {
      const next: string[] = [];
      for (const e of edges) {
        for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
          if (frontier.includes(a) && !keep.has(b)) {
            keep.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
    nodes = nodes.filter((n) => keep.has(n.id) || n.id === inp.neighborRoot);
  }
  const nodeSet = new Set(nodes.map((n) => n.id));

  // 노드 → 상위/하위 모듈
  const topOf = new Map<string, Module>();
  const childOf = new Map<string, Module>();
  for (const m of modules) for (const id of m.nodeIds) (m.parent ? childOf : topOf).set(id, m);

  const repOf = new Map<string, string>();
  const elements: ElementDefinition[] = [];
  const usedModules = new Map<string, { m: Module; collapsed: boolean; count: number }>();

  for (const n of nodes) {
    if (!useModules) {
      repOf.set(n.id, n.id);
      continue;
    }
    const top = topOf.get(n.id);
    const child = childOf.get(n.id);
    let rep = n.id;
    if (top && !expanded.has(top.id)) rep = top.id;
    else if (child && !expanded.has(child.id)) rep = child.id;
    repOf.set(n.id, rep);
    if (top) {
      const u = usedModules.get(top.id) ?? { m: top, collapsed: !expanded.has(top.id), count: 0 };
      u.count++;
      usedModules.set(top.id, u);
    }
    if (child && top && expanded.has(top.id)) {
      const u = usedModules.get(child.id) ?? { m: child, collapsed: !expanded.has(child.id), count: 0 };
      u.count++;
      usedModules.set(child.id, u);
    }
  }

  // 모듈 요소
  for (const { m, collapsed, count } of usedModules.values()) {
    const label = `${m.label}  (${count})`;
    elements.push({
      group: "nodes",
      data: {
        id: m.id,
        label,
        parent: m.parent && usedModules.has(m.parent) ? m.parent : undefined,
        kind: "module",
        count,
        w: Math.max(110, textWidth(label) + 30),
        h: 44,
      },
      classes: collapsed ? "module collapsed" : "module expanded",
    });
  }

  // 클래스 노드의 부모(모듈 상자)
  const parentOf = new Map<string, string | undefined>();
  for (const n of nodes) {
    if (repOf.get(n.id) !== n.id) continue;
    const p = useModules ? (childOf.get(n.id) && expanded.has(childOf.get(n.id)!.id) ? childOf.get(n.id)!.id : topOf.get(n.id)?.id) : undefined;
    parentOf.set(n.id, p && usedModules.has(p) ? p : undefined);
  }

  // 관련 묶음: 같은 상자 안에서 강하게 연결된 클래스끼리 그룹으로 (상속 뷰는 계층 배치라 제외)
  const groupOf = new Map<string, string>();
  if (mode !== "inherit") {
    const buckets = new Map<string, string[]>();
    for (const [id, p] of parentOf) buckets.set(p ?? "", [...(buckets.get(p ?? "") ?? []), id]);
    for (const [key, members] of buckets) {
      if (members.length < 6) continue;
      const inBucket = new Set(members);
      const wedges: WEdge[] = [];
      for (const e of edges) {
        if (!inBucket.has(e.source) || !inBucket.has(e.target)) continue;
        const w = layoutStrength(e, nodeById.get(e.target));
        if (w > 0) wedges.push({ s: e.source, t: e.target, w });
      }
      const comm = louvain(members, wedges);
      const byComm = new Map<number, string[]>();
      for (const [id, c] of comm) byComm.set(c, [...(byComm.get(c) ?? []), id]);
      const degree = new Map<string, number>();
      for (const e of wedges) for (const id of [e.s, e.t]) degree.set(id, (degree.get(id) ?? 0) + e.w);
      let gi = 0;
      for (const ids of byComm.values()) {
        // 너무 작거나 상자 전체와 같은 묶음은 의미가 없으므로 만들지 않음
        if (ids.length < 3 || ids.length === members.length) continue;
        const center = [...ids].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0];
        const gid = `grp:${key}:${gi++}`;
        elements.push({
          group: "nodes",
          data: { id: gid, parent: key || undefined, kind: "group", label: `${nodeById.get(center)?.name ?? ""} 관련` },
          classes: "group",
          selectable: false,
        });
        for (const id of ids) groupOf.set(id, gid);
      }
    }
  }

  // 클래스 노드
  for (const n of nodes) {
    if (repOf.get(n.id) !== n.id) continue;
    const classes = ["cls", `role-${n.unityRole}`, ...n.tags.map((t) => `tag-${t}`), n.kind === "interface" ? "iface" : "", inCycle.has(n.id) ? "cycle" : ""];
    elements.push({
      group: "nodes",
      data: { id: n.id, parent: groupOf.get(n.id) ?? parentOf.get(n.id), kind: "class", ...classData(g, n, inCycle) },
      classes: classes.filter(Boolean).join(" "),
    });
  }

  // 엣지
  const edgeRepOf = new Map<string, string>();
  const agg = new Map<string, { source: string; target: string; weight: number; kinds: Set<EdgeKind>; members: string[] }>();
  const isClassRep = (id: string) => nodeById.has(id);
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
    const rs = repOf.get(e.source)!;
    const rt = repOf.get(e.target)!;
    if (rs === rt) continue;
    if (isClassRep(rs) && isClassRep(rt)) {
      elements.push(edgeElement(e, layoutStrength(e, nodeById.get(e.target))));
      edgeRepOf.set(e.id, e.id);
      continue;
    }
    // coLocated 는 방향이 없으므로 정렬
    const [a, b] = e.kind === "coLocated" && rs > rt ? [rt, rs] : [rs, rt];
    const key = `agg:${a}->${b}`;
    const x = agg.get(key) ?? { source: a, target: b, weight: 0, kinds: new Set(), members: [] };
    x.weight += e.weight;
    x.kinds.add(e.kind);
    if (x.members.length < 200) x.members.push(e.id);
    agg.set(key, x);
    edgeRepOf.set(e.id, key);
  }
  for (const [id, x] of agg) {
    const onlyInherit = [...x.kinds].every((k) => k === "inherits" || k === "implements");
    elements.push({
      group: "edges",
      data: {
        id,
        source: x.source,
        target: x.target,
        weight: x.weight,
        kinds: [...x.kinds].join(","),
        members: x.members,
        label: String(x.weight),
        width: Math.min(9, 1 + Math.log2(1 + x.weight)),
        len: 140,
        elastic: Math.min(0.45, 0.1 + x.weight / 200),
      },
      classes: `agg${onlyInherit ? " agg-inherit" : ""}`,
    });
  }

  return { elements, repOf, edgeRepOf, visibleNodeCount: nodes.length };
}

const EDGE_TEXT: Partial<Record<EdgeKind, string>> = {
  getsComponent: "GetComponent",
  requiresComponent: "Require",
  usesSingleton: ".Instance",
  subscribes: "event",
  creates: "new",
  instantiates: "Instantiate",
  finds: "Find",
  callsStatic: "static",
  coLocated: "same GameObject",
  wiredInInspector: "inspector",
};

/**
 * 배치할 때 이 연결이 얼마나 "가깝다"는 신호인지 (0 이면 배치 계산에서 제외).
 * 매니저·상수·enum 처럼 거의 모두가 쓰는 대상으로의 연결은 모든 상자를 한가운데로 끌어당겨 엉키게 하므로 뺀다.
 */
export function layoutStrength(e: Edge, target: TypeNode | undefined): number {
  if (!target || target.unityRole === "External" || target.kind === "enum") return 0;
  if (e.kind === "usesSingleton" || e.kind === "callsStatic" || e.kind === "nestedIn") return 0;
  if (target.tags.includes("singleton") && e.kind === "references") return 0;
  const base: Partial<Record<EdgeKind, number>> = {
    inherits: 3,
    implements: 2,
    coLocated: 3,
    requiresComponent: 3,
    getsComponent: 2.5,
    wiredInInspector: 2,
    subscribes: 2,
    instantiates: 2,
    creates: 1.5,
    finds: 1,
    references: 1,
  };
  const b = base[e.kind] ?? 1;
  return e.kind === "references" ? b * Math.min(3, e.weight) * (e.serialized ? 1.5 : 1) : b;
}

function edgeElement(e: Edge, strength: number): ElementDefinition {
  let label = EDGE_TEXT[e.kind] ?? "";
  if (e.kind === "references" && e.serialized) label = "[SerializeField]";
  if (e.multiplicity === "many" && e.kind === "references") label = `${label ? `${label} ` : ""}*`;
  return {
    group: "edges",
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: e.weight,
      label,
      // 강한 관계일수록 짧고 단단하게
      len: strength >= 2.5 ? 45 : strength >= 1.5 ? 65 : 90,
      elastic: Math.min(0.8, 0.15 + strength * 0.15),
    },
    classes: `k-${e.kind}${e.serialized ? " serialized" : ""}${strength === 0 ? " layout-ignore" : ""}`,
  };
}
