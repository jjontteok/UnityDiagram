import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import elk from "cytoscape-elk";
import fcose from "cytoscape-fcose";
import svg from "cytoscape-svg";
import { buildElements, type BuildResult } from "../diagram/elements";
import { buildStyles, PALETTES } from "../diagram/styles";
import { layoutFor, removeOverlaps } from "../diagram/layouts";
import { playFlow } from "../diagram/flowAnimation";
import { currentStep, EDGE_LABEL, modulesOf, useStore, writeLocal } from "../state/store";
import type { Edge } from "../types";

cytoscape.use(elk);
cytoscape.use(fcose);
cytoscape.use(svg);

/** 다른 컴포넌트에서 다이어그램을 조작하기 위한 핸들 */
export const diagram = {
  cy: null as Core | null,
  center(id: string) {
    const cy = diagram.cy;
    if (!cy) return;
    const el = cy.getElementById(id);
    if (el.empty()) return;
    cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 1) }, { duration: 400 });
    el.flashClass("search-hit", 1500);
  },
  /** 화면 가운데를 기준으로 factor 배 확대/축소 */
  zoomBy(factor: number) {
    const cy = diagram.cy;
    if (!cy) return;
    const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.stop(true, false);
    cy.animate({ zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 200 });
  },
  fit() {
    diagram.cy?.animate({ fit: { eles: diagram.cy.elements(), padding: 40 } }, { duration: 400 });
  },
  png(bg: string) {
    return diagram.cy?.png({ full: true, scale: 2, bg, output: "blob" }) as Blob | undefined;
  },
  svg(bg: string) {
    return (diagram.cy as unknown as { svg(o: object): string } | null)?.svg({ full: true, scale: 1, bg });
  },
};

export function DiagramCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const buildRef = useRef<BuildResult | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  const graph = useStore((s) => s.graph)!;
  const moduleRule = useStore((s) => s.moduleRule);
  const viewMode = useStore((s) => s.viewMode);
  const expanded = useStore((s) => s.expanded);
  const roleFilter = useStore((s) => s.roleFilter);
  const edgeFilter = useStore((s) => s.edgeFilter);
  const neighborRoot = useStore((s) => s.neighborRoot);
  const hops = useStore((s) => s.hops);
  const theme = useStore((s) => s.theme);
  const selection = useStore((s) => s.selection);
  const step = useStore(currentStep);
  const narrationActive = useStore((s) => s.narrationActive);
  const detailAlways = useStore((s) => s.detailAlways);
  const toggleDetailAlways = useStore((s) => s.toggleDetailAlways);
  // 지금 상세(멤버 목록) 라벨이 적용되어 있는지
  const detailOnRef = useRef(false);

  const modules = useMemo(() => modulesOf(graph, moduleRule), [graph, moduleRule]);
  const edgeById = useMemo(() => new Map<string, Edge>(graph.edges.map((e) => [e.id, e])), [graph]);
  const nodeById = useStore((s) => s.nodeById);

  const viewKey = useMemo(
    () =>
      [
        viewMode,
        moduleRule,
        [...expanded].sort().join("|"),
        viewMode === "neighbor" ? `${neighborRoot}:${hops}` : "",
        Object.entries(roleFilter).filter(([, v]) => !v).map(([k]) => k).join(","),
        detailAlways ? "detail" : "",
      ].join("#"),
    [viewMode, moduleRule, expanded, neighborRoot, hops, roleFilter, detailAlways],
  );
  // 배치 방식이 바뀌면 예전에 저장한 위치를 쓰지 않도록 버전 표시
  const posKey = `pos2:${graph.projectRoot}:${viewKey}`;

  // ───── 초기화 ─────
  useEffect(() => {
    const cy = cytoscape({
      container: ref.current!,
      style: buildStyles(useStore.getState().theme),
      minZoom: 0.05,
      maxZoom: 4,
      boxSelectionEnabled: false,
      // 화면 이동은 왼쪽 드래그 대신 가운데(휠) 버튼 드래그로 (아래 직접 처리).
      // Cytoscape 는 이동을 끄면 휠 확대도 꺼지므로 휠 확대도 직접 처리한다
      userPanningEnabled: false,
      userZoomingEnabled: false,
    });
    cyRef.current = cy;
    diagram.cy = cy;
    (window as unknown as { __cy: Core }).__cy = cy; // 디버깅/E2E 점검용

    const st = () => useStore.getState();
    cy.on("tap", "node.cls", (e) => st().select({ kind: "node", id: e.target.id() }));
    cy.on("tap", "node.module", (e) => st().select({ kind: "module", id: e.target.id() }));
    cy.on("dbltap", "node.module", (e) => {
      e.stopPropagation();
      st().toggleExpanded(e.target.id());
    });
    cy.on("dbltap", "node.cls", (e) => {
      st().setNeighborRoot(e.target.id());
      st().setViewMode("neighbor");
    });
    cy.on("tap", "edge", (e) => st().select({ kind: "edge", id: e.target.id() }));
    cy.on("tap", (e) => {
      if (e.target === cy) st().select(null);
    });
    // 가운데 버튼 드래그로 화면 이동
    const el = ref.current!;
    let last: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault(); // Windows 자동 스크롤 아이콘 방지
      last = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      if (!last) return;
      cy.panBy({ x: e.clientX - last.x, y: e.clientY - last.y });
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 1 || !last) return;
      last = null;
      el.style.cursor = "";
    };
    const noAutoScroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    // 휠 확대/축소: 마우스 위치 기준, 한 칸(100px)에 약 1.25배
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
      const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * Math.pow(1.25, -px / 100)));
      const rect = el.getBoundingClientRect();
      cy.zoom({ level, renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onDown);
    el.addEventListener("auxclick", noAutoScroll);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("auxclick", noAutoScroll);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cy.destroy();
      cyRef.current = null;
      diagram.cy = null;
    };
  }, []);

  // ───── 테마 ─────
  useEffect(() => {
    cyRef.current?.style(buildStyles(theme));
  }, [theme]);

  // ───── 툴팁 (엣지 근거) ─────
  useEffect(() => {
    const cy = cyRef.current!;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const short = (id: string) => nodeById.get(id)?.name ?? id.replace(/^module:/, "");
    const over = (e: EventObject) => {
      const el = e.target;
      const pos = e.renderedPosition ?? { x: 0, y: 0 };
      if (el.hasClass("agg")) {
        const kinds = String(el.data("kinds")).split(",").map((k) => EDGE_LABEL[k as keyof typeof EDGE_LABEL] ?? k);
        setTooltip({ x: pos.x, y: pos.y, html: `<b>${esc(short(el.data("source")))} → ${esc(short(el.data("target")))}</b><br/>연결 ${el.data("weight")}개 · ${esc(kinds.join(", "))}` });
        return;
      }
      const edge = edgeById.get(el.id());
      if (!edge) return;
      const ev = edge.evidence.slice(0, 3).map((v) => `<div class="tt-ev"><span>${esc(v.filePath.split("/").pop()!)}:${v.line}</span> <code>${esc(v.snippet)}</code></div>`).join("");
      const calls = edge.calls?.length ? `<div class="tt-calls">호출: ${esc(edge.calls.slice(0, 6).join(", "))}</div>` : "";
      setTooltip({ x: pos.x, y: pos.y, html: `<b>${esc(short(edge.source))}</b> —${esc(EDGE_LABEL[edge.kind])}→ <b>${esc(short(edge.target))}</b>${calls}${ev}` });
    };
    const out = () => setTooltip(null);
    cy.on("mouseover", "edge", over);
    cy.on("mouseout", "edge", out);
    cy.on("pan zoom", out);
    return () => {
      cy.off("mouseover", "edge", over);
      cy.off("mouseout", "edge", out);
      cy.off("pan zoom", out);
    };
  }, [edgeById, nodeById]);

  // ───── 요소 재구성 + 레이아웃 ─────
  useEffect(() => {
    const cy = cyRef.current!;
    const build = buildElements({ graph, modules, mode: viewMode, expanded: new Set(expanded), roleFilter, edgeFilter, neighborRoot, hops });
    buildRef.current = build;
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(posKey) ?? "null") as Record<string, { x: number; y: number }> | null;
      } catch {
        return null;
      }
    })();
    cy.batch(() => {
      cy.elements().remove();
      cy.add(build.elements);
      // 상세 표시가 켜져 있으면 커진 상자 크기로 배치되도록 레이아웃 전에 적용
      // 상세(멤버 목록)는 ☰ 버튼을 켰을 때만 — 확대해도 자동으로 바뀌지 않음
      detailOnRef.current = detailAlways;
      if (detailOnRef.current) cy.nodes(".cls").addClass("detail");
    });
    const leaves = cy.nodes().filter((n) => n.isChildless());
    const usePreset = !!saved && leaves.length > 0 && leaves.toArray().every((n) => !!saved[n.id()]);
    const savePositions = () => {
      const pos: Record<string, { x: number; y: number }> = {};
      cy.nodes().filter((n) => n.isChildless() && !n.hasClass("token")).forEach((n) => {
        pos[n.id()] = n.position();
      });
      writeLocal(posKey, pos);
    };
    const layout = usePreset
      ? cy.layout({ name: "preset", positions: (n: any) => saved![n.id()], fit: true, padding: 40 } as any)
      : // 매니저·상수·enum 으로의 연결(layout-ignore)은 그대로 그리되 배치 계산에서는 뺀다
        cy.elements().not("edge.layout-ignore").layout(layoutFor(viewMode, build.visibleNodeCount, true, detailOnRef.current));
    const started = performance.now();
    layout.one("layoutstop", () => {
      if (!usePreset) {
        removeOverlaps(cy);
        savePositions();
      }
      setLayoutVersion((v) => v + 1);
      // 디버깅/E2E 점검용 레이아웃 시간
      const w = window as unknown as { __layoutMs: number; __layoutDone: number };
      w.__layoutMs = Math.round(performance.now() - started);
      w.__layoutDone = (w.__layoutDone ?? 0) + 1;
    });
    layout.run();
    cy.on("dragfree", "node", savePositions);
    return () => {
      layout.stop();
      cy.off("dragfree", "node", savePositions);
    };
  }, [graph, modules, viewMode, expanded, roleFilter, edgeFilter, neighborRoot, hops, posKey, detailAlways]);

  // ───── 선택 동기화 ─────
  useEffect(() => {
    const cy = cyRef.current!;
    cy.$(":selected").unselect();
    cy.edges(".sel-out, .sel-in, .sel-fade").removeClass("sel-out sel-in sel-fade");
    if (!selection) return;
    const b = buildRef.current;
    const id = selection.kind === "node" ? b?.repOf.get(selection.id) ?? selection.id : selection.kind === "edge" ? b?.edgeRepOf.get(selection.id) ?? selection.id : selection.id;
    const el = cy.getElementById(id);
    el.select();
    // 선택한 것과 연결된 화살표 색: 나가는 것(사용하는 것) / 들어오는 것(사용되는 것)
    if (el.isNode()) {
      const inner = el.union(el.descendants());
      // 펼친 모듈을 선택했으면 모듈 안끼리의 연결은 제외
      inner.outgoers().edges().filter((e) => !inner.contains(e.target())).addClass("sel-out");
      inner.incomers().edges().filter((e) => !inner.contains(e.source())).addClass("sel-in");
      // 나머지 화살표는 흐리게 해서 연결된 것이 잘 보이도록
      cy.edges().not(".sel-out, .sel-in").addClass("sel-fade");
    }
  }, [selection, layoutVersion]);

  // ───── 해설 단계 → 필요한 모듈 펼치기 ─────
  useEffect(() => {
    if (!step) return;
    const ids = [...new Set([...step.focus.nodeIds, ...step.sequence.flatMap((s) => [s.from, s.to])])];
    if (ids.length && ids.length <= 25) useStore.getState().ensureVisible(ids);
  }, [step]);

  // ───── 해설 하이라이트 + 카메라 + flow 애니메이션 ─────
  useEffect(() => {
    const cy = cyRef.current!;
    const b = buildRef.current;
    cy.stop(true, false); // 진행 중인 카메라 이동이 새 이동과 겹치지 않도록
    cy.$(".token").remove();
    cy.elements().removeClass("dim focus focus-module seq-active");
    if (!narrationActive || !step || !b) return;
    // 접힌 모듈을 펼치는 중이면(위 effect) 재배치가 끝난 뒤 다시 실행된다
    const wanted = [...new Set([...step.focus.nodeIds, ...step.sequence.flatMap((s) => [s.from, s.to])])];
    const { viewMode: vm, roleFilter: rf } = useStore.getState();
    if (
      (vm === "module" || vm === "all") &&
      wanted.length <= 25 &&
      wanted.some((id) => b.repOf.get(id) !== id && rf[nodeById.get(id)?.unityRole ?? "External"])
    ) {
      return;
    }
    const signal = { cancelled: false };

    const focusIds = new Set<string>();
    for (const id of step.focus.nodeIds) {
      const rep = b.repOf.get(id);
      if (rep) focusIds.add(rep);
    }
    for (const s of step.sequence) for (const id of [s.from, s.to]) {
      const rep = b.repOf.get(id);
      if (rep) focusIds.add(rep);
    }
    const focusModules = new Set<string>();
    for (const m of step.focus.moduleIds) {
      if (!cy.getElementById(m).empty()) focusModules.add(m);
      else for (const id of modules.find((x) => x.id === m)?.nodeIds ?? []) {
        const rep = b.repOf.get(id);
        if (rep) focusIds.add(rep);
      }
    }
    const edgeIds = new Set<string>();
    for (const id of [...step.focus.edgeIds, ...step.sequence.map((s) => s.edgeId).filter(Boolean)]) {
      const rep = b.edgeRepOf.get(id);
      if (rep) edgeIds.add(rep);
    }
    // 강조 노드끼리의 엣지도 강조
    cy.edges().forEach((e) => {
      if (focusIds.has(e.source().id()) && focusIds.has(e.target().id()) && focusIds.size <= 30) edgeIds.add(e.id());
    });

    let focus = cy.collection();
    focusIds.forEach((id) => (focus = focus.union(cy.getElementById(id))));
    edgeIds.forEach((id) => (focus = focus.union(cy.getElementById(id))));
    let mods = cy.collection();
    focusModules.forEach((id) => (mods = mods.union(cy.getElementById(id))));

    if (focus.empty() && mods.empty()) {
      cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 600 });
      return;
    }
    cy.batch(() => {
      cy.elements().addClass("dim");
      focus.removeClass("dim").addClass("focus");
      mods.removeClass("dim").addClass("focus-module");
      // 강조 노드가 들어 있는 모듈 상자는 흐리게 하지 않음
      focus.nodes().ancestors().removeClass("dim");
      mods.descendants().removeClass("dim");
    });
    const target = focus.union(mods);
    const pad = step.focus.camera === "zoomOut" ? 160 : 80;
    cy.animate(
      { fit: { eles: target, padding: pad } },
      {
        duration: 600,
        complete: () => {
          if (signal.cancelled) return;
          if (step.focus.camera === "zoomIn") cy.animate({ zoom: { level: Math.min(cy.zoom() * 1.3, 2.5), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 300 });
          focus.nodes().flashClass("pulse", 500);
          if (step.type === "flow" && step.sequence.length) {
            const hops = step.sequence.map((s) => ({ from: b.repOf.get(s.from) ?? s.from, to: b.repOf.get(s.to) ?? s.to, edgeId: s.edgeId ? b.edgeRepOf.get(s.edgeId) : undefined }));
            playFlow(cy, hops, (i) => window.dispatchEvent(new CustomEvent("flow-hop", { detail: i })), signal);
          }
        },
      },
    );
    return () => {
      signal.cancelled = true;
    };
  }, [step, narrationActive, layoutVersion, modules, nodeById]);

  const palette = PALETTES[theme];
  return (
    <div className="diagram-wrap" style={{ background: palette.bg }}>
      <div ref={ref} className="diagram" />
      {tooltip && <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }} dangerouslySetInnerHTML={{ __html: tooltip.html }} />}
      <Legend />
      <div className="zoom-controls">
        <button className="btn icon" onClick={() => diagram.zoomBy(1.6)} title="확대">＋</button>
        <button className="btn icon" onClick={() => diagram.zoomBy(1 / 1.6)} title="축소">−</button>
        <button className="btn icon" onClick={() => diagram.fit()} title="전체 보기">⤢</button>
        <button
          className={`btn icon ${detailAlways ? "on" : ""}`}
          onClick={toggleDetailAlways}
          title={detailAlways ? "상세 표시 끄기 (클래스 이름만 표시)" : "상세 표시 켜기 (필드·메서드 표시)"}
          aria-pressed={detailAlways}
        >
          ☰
        </button>
      </div>
      <div className="diagram-hint">
        {viewMode === "module" ? "모듈을 더블클릭하면 펼쳐집니다 · 클래스를 더블클릭하면 주변 보기 · 휠 버튼 드래그로 화면 이동" : viewMode === "neighbor" ? "선택한 클래스 주변 N단계 · 휠 버튼 드래그로 화면 이동" : "휠 버튼 드래그로 화면 이동"}
      </div>
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`legend ${open ? "open" : ""}`}>
      <button className="legend-toggle" onClick={() => setOpen(!open)}>
        범례 {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-row"><span className="sw role-MonoBehaviour" />MonoBehaviour</div>
          <div className="legend-row"><span className="sw role-NetworkBehaviour" />NetworkBehaviour</div>
          <div className="legend-row"><span className="sw role-ScriptableObject" />ScriptableObject</div>
          <div className="legend-row"><span className="sw role-Data" />데이터 클래스</div>
          <div className="legend-row"><span className="sw tag-ui" />UI</div>
          <div className="legend-row"><span className="sw singleton" />싱글톤/매니저 (빨간 테두리)</div>
          <div className="legend-row"><span className="sw iface" />인터페이스 (점선)</div>
          <div className="legend-row"><span className="sw role-Enum" />enum</div>
          <hr />
          <div className="legend-row"><span className="ln inherits" />상속 (빈 삼각형)</div>
          <div className="legend-row"><span className="ln implements" />구현 (점선 + 삼각형)</div>
          <div className="legend-row"><span className="ln serialized" />[SerializeField] (마름모)</div>
          <div className="legend-row"><span className="ln singleton" />.Instance (빨간 파선)</div>
          <div className="legend-row"><span className="ln subscribes" />event 구독 (보라 점선)</div>
          <div className="legend-row"><span className="ln creates" />new / Instantiate (초록)</div>
          <div className="legend-row"><span className="ln colocated" />같은 GameObject (이중선)</div>
          <div className="legend-row"><span className="ln sel-out" />선택한 것이 사용하는 것 →</div>
          <div className="legend-row"><span className="ln sel-in" />← 선택한 것을 사용하는 곳</div>
          <div className="legend-row">🌐 네트워크 · ⭐ 싱글톤 · 📦 프리팹 사용 · 🔁 순환 참조</div>
        </div>
      )}
    </div>
  );
}
