import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { diagram } from "./DiagramCanvas";
import { PALETTES } from "../diagram/styles";
import { activeSession, useStore, type ViewMode } from "../state/store";
import { displayName } from "../diagram/elements";

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: "module", label: "모듈" },
  { mode: "all", label: "전체" },
  { mode: "inherit", label: "상속" },
  { mode: "neighbor", label: "선택 주변" },
];

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function TopBar() {
  const graph = useStore((s) => s.graph)!;
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const hops = useStore((s) => s.hops);
  const setHops = useStore((s) => s.setHops);
  const startGuide = useStore((s) => s.startGuide);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const closeProject = useStore((s) => s.closeProject);
  const showToast = useStore((s) => s.showToast);
  const session = useStore(activeSession);
  const sessions = useStore((s) => s.sessions);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const streaming = session?.status === "streaming";

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return graph.nodes
      .filter((n) => n.name.toLowerCase().includes(t) || n.id.toLowerCase().includes(t))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.length - b.name.length)
      .slice(0, 12);
  }, [q, graph]);

  const pick = (id: string) => {
    const st = useStore.getState();
    st.ensureVisible([id]);
    st.select({ kind: "node", id });
    setQ("");
    setOpen(false);
    // 레이아웃이 끝난 뒤 이동
    setTimeout(() => diagram.center(id), 700);
  };

  const narrate = () => {
    // 이미 전체 해설이 있으면 다시 열고, 없으면 새로 요청
    const existing = sessions.find((s) => s.kind === "narrate" && s.status !== "error");
    if (existing && existing.status === "done") setActiveSession(existing.id);
    else startGuide("narrate", {});
  };

  const bg = PALETTES[theme].bg;
  const exportPng = () => {
    const b = diagram.png(bg);
    if (b) download(`${graph.projectName}-diagram.png`, b);
    setMenu(false);
  };
  const exportSvg = () => {
    const s = diagram.svg(bg);
    if (s) download(`${graph.projectName}-diagram.svg`, new Blob([s], { type: "image/svg+xml" }));
    setMenu(false);
  };
  const copyMermaid = async () => {
    const text = await api.mermaid(graph.graphId);
    try {
      await navigator.clipboard.writeText(text);
      showToast("Mermaid classDiagram 텍스트를 클립보드에 복사했습니다");
    } catch {
      download(`${graph.projectName}.mmd`, new Blob([text], { type: "text/plain" }));
    }
    setMenu(false);
  };
  const saveNarration = () => {
    const done = sessions.filter((s) => s.steps.length);
    if (!done.length) {
      showToast("저장할 해설이 없습니다", "warn");
      return;
    }
    const md = [`# ${graph.projectName} — 구조 해설`, "", `분석: ${new Date(graph.analyzedAt).toLocaleString()}`, ""];
    for (const s of [...done].reverse()) {
      md.push(`## ${s.title}`, "");
      for (const st of s.steps) md.push(`### ${st.stepIndex + 1}. ${st.title}`, "", st.markdown, "");
      if (s.finish?.oneLineSummary) md.push(`> ${s.finish.oneLineSummary}`, "");
    }
    download(`${graph.projectName}-구조-해설.md`, new Blob([md.join("\n")], { type: "text/markdown" }));
    setMenu(false);
  };

  return (
    <header className="topbar">
      <button className="project-name" onClick={closeProject} title="다른 프로젝트 열기">
        {graph.projectName} <span className="muted">▾</span>
      </button>
      {graph.source?.kind === "github" && (
        <a className="badge gh" href={`${graph.source.url}/tree/${graph.source.commit}`} target="_blank" rel="noreferrer" title={`${graph.source.url} @ ${graph.source.commit}`}>
          🐙 {graph.source.branch} · {graph.source.commit.slice(0, 7)}
        </a>
      )}

      <div className="search">
        <input
          ref={inputRef}
          className="input"
          placeholder="🔍 클래스 검색"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) pick(results[0].id);
            if (e.key === "Escape") inputRef.current?.blur();
          }}
        />
        {open && results.length > 0 && (
          <div className="search-results">
            {results.map((n) => (
              <button key={n.id} onMouseDown={() => pick(n.id)}>
                <span className={`dot role-${n.unityRole}`} /> {displayName(n)} <span className="muted small">{n.namespace ?? n.folder}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="segmented" role="tablist" aria-label="뷰">
        {VIEWS.map((v) => (
          <button key={v.mode} className={viewMode === v.mode ? "active" : ""} onClick={() => setViewMode(v.mode)}>
            {v.label}
          </button>
        ))}
      </div>
      {viewMode === "neighbor" && (
        <label className="hops">
          {hops}단계
          <input type="range" min={1} max={3} value={hops} onChange={(e) => setHops(Number(e.target.value))} />
        </label>
      )}

      <div className="spacer" />

      <button className="btn primary big" onClick={narrate} disabled={streaming}>
        🧭 클래스 다이어그램 보기
      </button>

      <div className="menu-wrap">
        <button className="btn icon" onClick={() => setMenu(!menu)} title="내보내기">
          ⤓
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={exportPng}>PNG 이미지로 저장</button>
            <button onClick={exportSvg}>SVG 로 저장</button>
            <button onClick={copyMermaid}>Mermaid 텍스트 복사</button>
            <button onClick={saveNarration}>구조 해설을 .md 로 저장</button>
          </div>
        )}
      </div>
      <button className="btn icon" onClick={() => useStore.getState().setPanelTab("help")} title="사용법">
        ❓
      </button>
      <button className="btn icon" onClick={toggleTheme} title="테마 전환">
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </header>
  );
}
