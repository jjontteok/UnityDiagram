import { useEffect, useState } from "react";
import { api } from "./api/client";
import { useStore } from "./state/store";
import { ProjectPicker } from "./components/ProjectPicker";
import { TopBar } from "./components/TopBar";
import { ExplorerTree } from "./components/ExplorerTree";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { NarrationPanel, useNarrationKeys } from "./components/NarrationPanel";
import { CodeViewer } from "./components/CodeViewer";
import { HelpPanel } from "./components/HelpPanel";

export function App() {
  const graph = useStore((s) => s.graph);
  const theme = useStore((s) => s.theme);
  const panelTab = useStore((s) => s.panelTab);
  const setPanelTab = useStore((s) => s.setPanelTab);
  const toast = useStore((s) => s.toast);
  const streaming = useStore((s) => s.sessions.some((x) => x.status === "streaming"));
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  useNarrationKeys();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        // 마지막으로 보던 프로젝트 복원
        let last: string | null = null;
        try {
          last = JSON.parse(localStorage.getItem("lastGraph") ?? "null");
        } catch {
          /* 무시 */
        }
        if (last) {
          const g = await api.graph(last).catch(() => null);
          if (g) useStore.getState().loadGraph(g);
        }
      } catch (e) {
        setBootError(`서버에 연결할 수 없습니다: ${(e as Error).message}`);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (booting) return <div className="boot muted">불러오는 중…</div>;
  if (bootError) return <div className="boot"><div className="error-box">{bootError}</div></div>;

  return (
    <>
      {!graph ? (
        <ProjectPicker />
      ) : (
        <div className="app">
          <TopBar />
          <div className="main">
            <ExplorerTree />
            <DiagramCanvas key={graph.graphId} />
            <aside className="side">
              <div className="tabs">
                <button className={panelTab === "detail" ? "active" : ""} onClick={() => setPanelTab("detail")}>
                  상세
                </button>
                <button className={panelTab === "ai" ? "active" : ""} onClick={() => setPanelTab("ai")}>
                  구조 해설 {streaming && <span className="spinner small" />}
                </button>
                <button className={panelTab === "help" ? "active" : ""} onClick={() => setPanelTab("help")}>
                  사용법
                </button>
              </div>
              <div className="side-body">{panelTab === "detail" ? <DetailPanel /> : panelTab === "ai" ? <NarrationPanel /> : <HelpPanel />}</div>
            </aside>
          </div>
        </div>
      )}
      <CodeViewer />
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
