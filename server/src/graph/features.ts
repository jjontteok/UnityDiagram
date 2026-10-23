// "기능 기준" 모듈: 폴더·네임스페이스와 상관없이 서로 강하게 연결된 클래스끼리 묶어 기능 단위로 보여준다.
// 처음 보는 사람이 "이 프로젝트에 어떤 기능들이 있는지"를 바로 볼 수 있게 하려는 것.
import type { Edge, EdgeKind, Module, TypeNode } from "../types.js";
import { clusterNames, louvain, tokenShares, type WEdge } from "./community.js";

/** 이 연결이 "같은 기능"이라는 신호로 얼마나 강한지. 매니저·enum·정적 접근은 모두가 쓰므로 0 (웹의 layoutStrength 와 같은 기준) */
function strength(e: Edge, target: TypeNode | undefined): number {
  if (!target || target.unityRole === "External" || target.kind === "enum") return 0;
  if (e.kind === "usesSingleton" || e.kind === "callsStatic" || e.kind === "nestedIn") return 0;
  if (target.tags.includes("singleton") && e.kind === "references") return 0;
  const base: Partial<Record<EdgeKind, number>> = {
    inherits: 3, implements: 2, coLocated: 3, requiresComponent: 3, getsComponent: 2.5, wiredInInspector: 2,
    subscribes: 2, instantiates: 2, creates: 1.5, finds: 1, references: 1,
  };
  const b = base[e.kind] ?? 1;
  return e.kind === "references" ? b * Math.min(3, e.weight) * (e.serialized ? 1.5 : 1) : b;
}

const COMMON = "공통·기타";
const MIN_FEATURE = 3;
const SPLIT_OVER = 30;

export function buildFeatureModules(nodes: TypeNode[], edges: Edge[]): Module[] {
  const own = nodes.filter((n) => n.unityRole !== "External");
  const byId = new Map(own.map((n) => [n.id, n]));
  // 중첩 타입은 바깥 타입을 따라간다
  const outerOf = new Map<string, string>();
  for (const e of edges) if (e.kind === "nestedIn" && byId.has(e.source) && byId.has(e.target)) outerOf.set(e.source, e.target);
  const top = (id: string) => {
    for (let i = 0; i < 10 && outerOf.has(id); i++) id = outerOf.get(id)!;
    return id;
  };
  const core = own.filter((n) => n.kind !== "enum" && !outerOf.has(n.id)).map((n) => n.id);
  const coreSet = new Set(core);

  const wedges: WEdge[] = [];
  const degree = new Map<string, number>();
  for (const e of edges) {
    const s = top(e.source);
    const t = top(e.target);
    if (s === t || !coreSet.has(s) || !coreSet.has(t)) continue;
    const w = strength(e, byId.get(t));
    if (w <= 0) continue;
    wedges.push({ s, t, w });
    for (const id of [s, t]) degree.set(id, (degree.get(id) ?? 0) + w);
  }

  // 1) 강한 연결로 묶음
  const comm = louvain(core, wedges);
  const members = new Map<number, string[]>();
  for (const [id, c] of comm) members.set(c, [...(members.get(c) ?? []), id]);
  const groupOf = new Map<string, string>();
  for (const [c, ids] of members) if (ids.length >= MIN_FEATURE) for (const id of ids) groupOf.set(id, `g${c}`);

  // 2) 작은 묶음·enum 은 가장 많이 함께 쓰이는 기능에 붙인다 (여러 기능이 고루 쓰면 공통)
  const attach = (id: string) => {
    const w = new Map<string, number>();
    for (const e of edges) {
      const s = top(e.source);
      const t = top(e.target);
      const other = s === id ? t : t === id ? s : null;
      if (!other || other === id) continue;
      const g = groupOf.get(other);
      if (!g || g === COMMON) continue;
      w.set(g, (w.get(g) ?? 0) + Math.max(0.3, strength(e, byId.get(t))) * e.weight);
    }
    if (!w.size) return null;
    const sorted = [...w.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, x]) => s + x, 0);
    return sorted.length >= 3 && sorted[0][1] / total < 0.5 ? COMMON : sorted[0][0];
  };
  const leftovers = [...core.filter((id) => !groupOf.has(id)), ...own.filter((n) => n.kind === "enum" && !outerOf.has(n.id)).map((n) => n.id)];
  for (let pass = 0; pass < 2; pass++) {
    for (const id of leftovers) {
      if (groupOf.has(id)) continue;
      const g = attach(id);
      if (g && (g !== COMMON || pass === 1)) groupOf.set(id, g);
    }
  }
  for (const id of leftovers) if (!groupOf.has(id)) groupOf.set(id, COMMON);
  for (const n of own) if (outerOf.has(n.id)) groupOf.set(n.id, groupOf.get(top(n.id)) ?? COMMON);

  // 3) 이름 붙이기
  const groups = new Map<string, string[]>();
  for (const [id, g] of groupOf) groups.set(g, [...(groups.get(g) ?? []), id]);
  const everywhere = tokenShares(own.map((n) => ({ name: n.name, folder: n.folder })));
  // 이름 후보 중 아직 안 쓴 것 (같은 이름이 겹치면 다음 후보, 다 쓰였으면 번호)
  const nameOf = (ids: string[], used: Set<string>, suffix = "") => {
    const main = ids.filter((id) => byId.get(id)!.kind !== "enum" && !outerOf.has(id));
    const central = [...(main.length ? main : ids)].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))[0];
    const cands = clusterNames(main.map((id) => ({ name: byId.get(id)!.name, folder: byId.get(id)!.folder })), byId.get(central)!.name, everywhere).map((c) => `${c}${suffix}`);
    let label = cands.find((c) => !used.has(c)) ?? cands[0];
    for (let i = 2; used.has(label); i++) label = `${cands[0]} ${i}`;
    used.add(label);
    return label;
  };
  const used = new Set<string>();
  const modules: Module[] = [];
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === COMMON ? 1 : b[0] === COMMON ? -1 : b[1].length - a[1].length));
  for (const [g, ids] of ordered) {
    const label = g === COMMON ? COMMON : nameOf(ids, used, " 기능");
    const id = `module:${label}`;
    modules.push({ id, label, rule: "feature", nodeIds: ids.sort() });

    // 큰 기능은 안에서 한 번 더 나눈다
    if (ids.length <= SPLIT_OVER || g === COMMON) continue;
    const inside = new Set(ids);
    const sub = louvain(ids.filter((x) => coreSet.has(x)), wedges.filter((e) => inside.has(e.s) && inside.has(e.t)));
    const subMembers = new Map<number, string[]>();
    for (const [x, c] of sub) subMembers.set(c, [...(subMembers.get(c) ?? []), x]);
    const parts = [...subMembers.values()].filter((p) => p.length >= 4);
    if (parts.length < 2) continue;
    const subUsed = new Set<string>();
    for (const p of parts.sort((a, b) => b.length - a.length)) {
      // 중첩 타입·enum 은 바깥 타입이 있는 쪽으로
      const all = ids.filter((x) => p.includes(top(x)));
      const sl = nameOf(p, subUsed);
      modules.push({ id: `${id}/${sl}`, label: sl, rule: "feature", parent: id, nodeIds: all.sort() });
    }
  }
  return modules;
}
