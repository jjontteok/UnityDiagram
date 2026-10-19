import { useMemo, useState } from "react";
import { EDGE_KINDS, EDGE_LABEL, modulesOf, ROLES, useStore } from "../state/store";
import { diagram } from "./DiagramCanvas";
import { displayName } from "../diagram/elements";
import type { Module, ModuleRule } from "../types";

const RULE_LABEL: Record<ModuleRule, string> = { asmdef: "asmdef", namespace: "네임스페이스", folder: "폴더" };

export function ExplorerTree() {
  const graph = useStore((s) => s.graph)!;
  const moduleRule = useStore((s) => s.moduleRule);
  const setModuleRule = useStore((s) => s.setModuleRule);
  const roleFilter = useStore((s) => s.roleFilter);
  const toggleRole = useStore((s) => s.toggleRole);
  const edgeFilter = useStore((s) => s.edgeFilter);
  const toggleEdgeKind = useStore((s) => s.toggleEdgeKind);
  const selection = useStore((s) => s.selection);
  const nodeById = useStore((s) => s.nodeById);
  const [openMods, setOpenMods] = useState<Set<string>>(new Set());

  const modules = modulesOf(graph, moduleRule);
  const { tops, childrenOf, directOf } = useMemo(() => {
    const tops = modules.filter((m) => !m.parent);
    const childrenOf = new Map<string, Module[]>();
    for (const m of modules) if (m.parent) childrenOf.set(m.parent, [...(childrenOf.get(m.parent) ?? []), m]);
    // 하위 모듈에 속하지 않고 상위에 바로 있는 노드
    const directOf = new Map<string, string[]>();
    for (const t of tops) {
      const inChild = new Set((childrenOf.get(t.id) ?? []).flatMap((c) => c.nodeIds));
      directOf.set(t.id, t.nodeIds.filter((id) => !inChild.has(id)));
    }
    return { tops, childrenOf, directOf };
  }, [modules]);

  const roleCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) c[n.unityRole] = (c[n.unityRole] ?? 0) + 1;
    return c;
  }, [graph]);
  const edgeCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of graph.edges) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [graph]);

  const toggle = (id: string) => {
    const s = new Set(openMods);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setOpenMods(s);
  };

  const pickNode = (id: string) => {
    const st = useStore.getState();
    st.ensureVisible([id]);
    st.select({ kind: "node", id });
    setTimeout(() => diagram.center(id), 700);
  };

  const nodeItem = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return null;
    return (
      <button key={id} className={`tree-node ${selection?.id === id ? "active" : ""}`} onClick={() => pickNode(id)} title={n.id}>
        <span className={`dot role-${n.unityRole} ${n.tags.includes("ui") ? "tag-ui" : ""}`} />
        {displayName(n)}
        {n.tags.includes("singleton") && <span className="star">⭐</span>}
      </button>
    );
  };

  const sortIds = (ids: string[]) => [...ids].sort((a, b) => (nodeById.get(a)?.name ?? a).localeCompare(nodeById.get(b)?.name ?? b));

  return (
    <aside className="explorer">
      <div className="explorer-section">
        <div className="section-head">
          <span>탐색</span>
          <select className="input select small" value={moduleRule} onChange={(e) => setModuleRule(e.target.value as ModuleRule)}>
            {(Object.keys(graph.modulesByRule) as ModuleRule[]).map((r) => (
              <option key={r} value={r}>
                {RULE_LABEL[r]} 기준
              </option>
            ))}
          </select>
        </div>
        <div className="tree">
          {tops.map((t) => (
            <div key={t.id}>
              <div className="tree-mod">
                <button className="caret" onClick={() => toggle(t.id)}>
                  {openMods.has(t.id) ? "▾" : "▸"}
                </button>
                <button className={`mod-label ${selection?.id === t.id ? "active" : ""}`} onClick={() => useStore.getState().select({ kind: "module", id: t.id })} onDoubleClick={() => useStore.getState().toggleExpanded(t.id)}>
                  {t.label} <span className="muted small">{t.nodeIds.length}</span>
                </button>
              </div>
              {openMods.has(t.id) && (
                <div className="tree-children">
                  {(childrenOf.get(t.id) ?? []).map((c) => (
                    <div key={c.id}>
                      <div className="tree-mod">
                        <button className="caret" onClick={() => toggle(c.id)}>
                          {openMods.has(c.id) ? "▾" : "▸"}
                        </button>
                        <button className={`mod-label ${selection?.id === c.id ? "active" : ""}`} onClick={() => useStore.getState().select({ kind: "module", id: c.id })}>
                          {c.label} <span className="muted small">{c.nodeIds.length}</span>
                        </button>
                      </div>
                      {openMods.has(c.id) && <div className="tree-children">{sortIds(c.nodeIds).map(nodeItem)}</div>}
                    </div>
                  ))}
                  {sortIds(directOf.get(t.id) ?? []).map(nodeItem)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="explorer-section">
        <div className="section-head">역할 필터</div>
        {ROLES.filter((r) => roleCount[r]).map((r) => (
          <label key={r} className="check">
            <input type="checkbox" checked={roleFilter[r]} onChange={() => toggleRole(r)} />
            <span className={`dot role-${r}`} />
            {r === "External" ? "외부 라이브러리" : r === "Data" ? "데이터 클래스" : r}
            <span className="muted small">{roleCount[r]}</span>
          </label>
        ))}
      </div>

      <div className="explorer-section">
        <div className="section-head">엣지 종류</div>
        {EDGE_KINDS.filter((k) => edgeCount[k]).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={edgeFilter[k]} onChange={() => toggleEdgeKind(k)} />
            {EDGE_LABEL[k]}
            <span className="muted small">{edgeCount[k]}</span>
          </label>
        ))}
      </div>

      <div className="explorer-section muted small stats">
        스크립트 {graph.stats.scripts} · 타입 {graph.nodes.length} · 엣지 {graph.edges.length}
        <br />
        프리팹 {graph.stats.prefabs} · 씬 {graph.stats.scenes} · 분석 {(graph.stats.durationMs / 1000).toFixed(1)}s
        {graph.unityVersion && <><br />Unity {graph.unityVersion}</>}
        {graph.warnings.length > 0 && (
          <details>
            <summary>경고 {graph.warnings.length}</summary>
            {graph.warnings.map((w) => <div key={w}>{w}</div>)}
          </details>
        )}
        {graph.unresolved.length > 0 && (
          <details>
            <summary>미해결 타입 {graph.unresolved.length}</summary>
            {graph.unresolved.slice(0, 50).map((u) => <div key={u.from + u.typeName}>{u.typeName} ← {u.from.split(".").pop()}</div>)}
          </details>
        )}
      </div>
    </aside>
  );
}
