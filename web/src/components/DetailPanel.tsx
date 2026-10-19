import { useMemo } from "react";
import { EDGE_LABEL, modulesOf, useStore } from "../state/store";
import { displayName } from "../diagram/elements";
import { diagram } from "./DiagramCanvas";
import type { Edge, Member, MethodInfo, TypeNode } from "../types";

export function DetailPanel() {
  const selection = useStore((s) => s.selection);
  const graph = useStore((s) => s.graph)!;
  if (!selection) {
    return (
      <div className="detail empty">
        <p className="muted">다이어그램에서 클래스, 모듈 또는 연결선을 클릭하면 상세 정보가 여기에 표시됩니다.</p>
        <p className="muted small">상단의 <b>🧭 클래스 다이어그램 보기</b> 를 누르면 전체 구조를 단계별로 설명합니다.</p>
        <HubList />
      </div>
    );
  }
  if (selection.kind === "node") return <NodeDetail id={selection.id} />;
  if (selection.kind === "module") return <ModuleDetail id={selection.id} />;
  const edge = graph.edges.find((e) => e.id === selection.id);
  if (edge) return <EdgeDetail edge={edge} />;
  return <AggEdgeDetail id={selection.id} />;
}

function NodeLink({ id }: { id: string }) {
  const n = useStore((s) => s.nodeById.get(id));
  const go = () => {
    const st = useStore.getState();
    st.ensureVisible([id]);
    st.select({ kind: "node", id });
    setTimeout(() => diagram.center(id), 600);
  };
  return (
    <button className="node-link" onClick={go} title={id}>
      <span className={`dot role-${n?.unityRole ?? "External"}`} />
      {n ? displayName(n) : id}
    </button>
  );
}

function HubList() {
  const graph = useStore((s) => s.graph)!;
  return (
    <div className="hubs">
      <div className="section-head">허브 클래스 (많이 참조됨)</div>
      {graph.metrics.hubs.map((id) => (
        <div key={id} className="hub-row">
          <NodeLink id={id} />
          <span className="muted small">← {graph.metrics.fanIn[id]}</span>
        </div>
      ))}
    </div>
  );
}

function MemberList({ title, items }: { title: string; items: (Member | MethodInfo)[] }) {
  const node = useStore((s) => (s.selection?.kind === "node" ? s.nodeById.get(s.selection.id) : undefined));
  const openCode = useStore((s) => s.openCode);
  if (!items.length) return null;
  return (
    <details className="members" open={items.length <= 12}>
      <summary>
        {title} <span className="muted small">{items.length}</span>
      </summary>
      {items.map((m, i) => {
        const isMethod = "params" in m;
        return (
          <button key={`${m.name}-${i}`} className="member" onClick={() => openCode(m.filePath ?? node!.filePath, m.line)}>
            <span className="muted mono small">{m.access === "public" ? "+" : m.access === "protected" ? "#" : "-"}</span>
            <span className="mono">
              {isMethod ? (
                <>
                  {(m as MethodInfo).isStatic && <i>static </i>}
                  {m.name}({(m as MethodInfo).params.map((p) => p.type).join(", ")})
                  {(m as MethodInfo).returnType && (m as MethodInfo).returnType !== "void" && <span className="muted">: {(m as MethodInfo).returnType}</span>}
                </>
              ) : (
                <>
                  {m.isStatic && <i>static </i>}
                  {m.name}: <span className="muted">{(m as Member).type}</span>
                </>
              )}
            </span>
            {isMethod && (m as MethodInfo).isUnityMessage && <span className="chip">Unity</span>}
            {isMethod && (m as MethodInfo).isRpc && <span className="chip net">{(m as MethodInfo).rpcKind}</span>}
            {isMethod && (m as MethodInfo).isAsync && <span className="chip">async</span>}
            {!isMethod && (m as Member).serialized && <span className="chip">Serialized</span>}
          </button>
        );
      })}
    </details>
  );
}

function EdgeGroup({ title, edges, side }: { title: string; edges: Edge[]; side: "source" | "target" }) {
  const select = useStore((s) => s.select);
  if (!edges.length) return null;
  return (
    <details className="members" open={edges.length <= 15}>
      <summary>
        {title} <span className="muted small">{edges.length}</span>
      </summary>
      {edges.map((e) => (
        <div key={e.id} className="edge-row">
          <button className="chip kind" onClick={() => select({ kind: "edge", id: e.id })}>
            {EDGE_LABEL[e.kind]}
          </button>
          <NodeLink id={side === "target" ? e.target : e.source} />
          {e.calls?.length ? <span className="muted small mono">{e.calls.slice(0, 3).join(", ")}</span> : null}
        </div>
      ))}
    </details>
  );
}

function NodeDetail({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)!;
  const n = useStore((s) => s.nodeById.get(id)) as TypeNode | undefined;
  const openCode = useStore((s) => s.openCode);
  const startGuide = useStore((s) => s.startGuide);
  const { out, inc } = useMemo(() => {
    const out = graph.edges.filter((e) => e.source === id && e.kind !== "coLocated");
    const inc = graph.edges.filter((e) => e.target === id && e.kind !== "coLocated");
    const co = graph.edges.filter((e) => e.kind === "coLocated" && (e.source === id || e.target === id));
    return { out: [...out, ...co.filter((e) => e.source === id)], inc: [...inc, ...co.filter((e) => e.target === id)] };
  }, [graph, id]);
  if (!n) return null;

  return (
    <div className="detail">
      <div className="detail-head">
        <span className={`stereo role-${n.unityRole}`}>«{n.unityRole}»</span>
        <h2>{displayName(n)}</h2>
        <div className="muted small mono">{n.namespace ?? "(global)"}</div>
        <div className="chips">
          {n.modifiers.map((m) => <span key={m} className="chip">{m}</span>)}
          {n.tags.includes("singleton") && <span className="chip warn">⭐ 싱글톤/매니저</span>}
          {n.tags.includes("ui") && <span className="chip ui">UI</span>}
          {graph.metrics.cycles.some((c) => c.includes(n.id)) && <span className="chip warn">🔁 순환 참조</span>}
          <span className="chip">fan-in {graph.metrics.fanIn[n.id] ?? 0}</span>
          <span className="chip">fan-out {graph.metrics.fanOut[n.id] ?? 0}</span>
        </div>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={() => startGuide("explain-node", { nodeId: n.id })} disabled={n.unityRole === "External"}>
          📖 이 클래스 설명
        </button>
        <button
          className="btn"
          onClick={() => {
            useStore.getState().setNeighborRoot(n.id);
            useStore.getState().setViewMode("neighbor");
          }}
        >
          주변 보기
        </button>
      </div>

      {n.filePath && (
        <button className="file-link mono small" onClick={() => openCode(n.filePath, n.lineStart)}>
          📄 {n.filePath}:{n.lineStart}
        </button>
      )}
      {n.summary && <p className="summary">{n.summary}</p>}
      {n.baseTypes.length > 0 && <div className="small"><span className="muted">상속/구현:</span> <span className="mono">{n.baseTypes.join(", ")}</span></div>}
      {n.attributes.length > 0 && <div className="small mono muted">[{n.attributes.join("] [")}]</div>}

      {(n.usedIn.length > 0 || n.assetInstances > 0) && (
        <div className="usedin small">
          {n.usedIn.length > 0 && (
            <details>
              <summary>📦 사용처 (프리팹/씬) {n.usedIn.length}</summary>
              {n.usedIn.map((p) => <div key={p} className="mono">{p}</div>)}
            </details>
          )}
          {n.assetInstances > 0 && <div>🗂 ScriptableObject 인스턴스 {n.assetInstances}개</div>}
        </div>
      )}

      <MemberList title="직렬화 필드 / 필드" items={n.fields} />
      <MemberList title="NetworkVariable" items={n.networkVars} />
      <MemberList title="이벤트" items={n.events} />
      <MemberList title="프로퍼티" items={n.properties} />
      <MemberList title="메서드" items={n.methods} />
      <EdgeGroup title="이 클래스가 사용하는 것 →" edges={out} side="target" />
      <EdgeGroup title="← 이 클래스를 사용하는 것" edges={inc} side="source" />
    </div>
  );
}

function ModuleDetail({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)!;
  const moduleRule = useStore((s) => s.moduleRule);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const expanded = useStore((s) => s.expanded);
  const m = modulesOf(graph, moduleRule).find((x) => x.id === id);
  if (!m) return null;
  return (
    <div className="detail">
      <div className="detail-head">
        <span className="stereo">«module · {m.rule}»</span>
        <h2>{m.label}</h2>
        <div className="muted small">타입 {m.nodeIds.length}개{m.parent ? ` · 상위 ${m.parent.replace("module:", "")}` : ""}</div>
      </div>
      <div className="actions">
        <button className="btn" onClick={() => toggleExpanded(m.id)}>{expanded.includes(m.id) ? "접기" : "펼치기"}</button>
      </div>
      <div className="node-list">
        {[...m.nodeIds]
          .sort((a, b) => (graph.metrics.fanIn[b] ?? 0) - (graph.metrics.fanIn[a] ?? 0))
          .map((nid) => (
            <div key={nid} className="hub-row">
              <NodeLink id={nid} />
              <span className="muted small">← {graph.metrics.fanIn[nid] ?? 0}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function EdgeDetail({ edge }: { edge: Edge }) {
  const openCode = useStore((s) => s.openCode);
  return (
    <div className="detail">
      <div className="detail-head">
        <span className="stereo">«{edge.kind}»</span>
        <h2>{EDGE_LABEL[edge.kind]}</h2>
        <div className="edge-ends">
          <NodeLink id={edge.source} /> → <NodeLink id={edge.target} />
        </div>
        <div className="chips">
          <span className="chip">근거 {edge.weight}건</span>
          {edge.serialized && <span className="chip">[SerializeField]</span>}
          {edge.multiplicity === "many" && <span className="chip">다수 (컬렉션)</span>}
        </div>
      </div>
      {edge.calls?.length ? (
        <div className="small">
          <span className="muted">사용한 멤버:</span> <span className="mono">{edge.calls.join(", ")}</span>
        </div>
      ) : null}
      <div className="section-head">근거 (클릭하면 코드로 이동)</div>
      {edge.evidence.map((ev, i) => (
        <button key={i} className="evidence" onClick={() => openCode(ev.filePath, ev.line)} disabled={!/\.cs$/.test(ev.filePath)}>
          <div className="muted small mono">{ev.filePath}:{ev.line}</div>
          <code>{ev.snippet}</code>
        </button>
      ))}
      {edge.weight > edge.evidence.length && <div className="muted small">외 {edge.weight - edge.evidence.length}건</div>}
    </div>
  );
}

function AggEdgeDetail({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)!;
  const cyEdge = diagram.cy?.getElementById(id);
  const members: string[] = cyEdge && !cyEdge.empty() ? cyEdge.data("members") ?? [] : [];
  const edges = graph.edges.filter((e) => members.includes(e.id));
  const m = /^agg:(.+)->(.+)$/.exec(id);
  return (
    <div className="detail">
      <div className="detail-head">
        <span className="stereo">«집계 연결»</span>
        <h2>{m ? `${m[1].replace("module:", "")} → ${m[2].replace("module:", "")}` : id}</h2>
        <div className="muted small">개별 연결 {edges.length}개 (모듈을 더블클릭해 펼치면 클래스 단위로 보입니다)</div>
      </div>
      <EdgeGroup title="연결 목록" edges={edges} side="target" />
    </div>
  );
}
