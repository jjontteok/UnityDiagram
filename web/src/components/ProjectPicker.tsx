import { useEffect, useState } from "react";
import { api, subscribeAnalyze, type RecentProject } from "../api/client";
import { useStore, writeLocal } from "../state/store";
import { HelpPanel } from "./HelpPanel";

interface Progress {
  label: string;
  done: number;
  total: number;
  phase: string;
}

const PHASES = ["clone", "scan", "parse", "unity"];

export function ProjectPicker() {
  const loadGraph = useStore((s) => s.loadGraph);
  const [path, setPath] = useState(() => {
    try {
      return localStorage.getItem("lastPath") ?? "";
    } catch {
      return "";
    }
  });
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [excludes, setExcludes] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [autoPlugins, setAutoPlugins] = useState(() => readPluginPref());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const busy = !!progress;

  useEffect(() => {
    api.recent().then(setRecent).catch(() => {});
    api.defaultExcludes().then((d) => {
      let saved: string[] | null = null;
      try {
        saved = JSON.parse(localStorage.getItem("excludes") ?? "null");
      } catch {
        /* 무시 */
      }
      setExcludes((saved ?? d.defaultExcludes).join("\n"));
    });
  }, []);

  const analyze = async (p: string) => {
    const target = p.trim();
    if (!target) return;
    setError(null);
    setProgress({ label: "분석 준비 중…", done: 0, total: 1, phase: "scan" });
    const globs = excludes.split("\n").map((x) => x.trim()).filter(Boolean);
    writeLocal("excludes", globs);
    writeLocal("autoExcludePlugins", autoPlugins);
    try {
      localStorage.setItem("lastPath", target);
    } catch {
      /* 무시 */
    }
    try {
      const { jobId } = await api.startAnalyze(target, globs, autoPlugins);
      subscribeAnalyze(jobId, async (event, data) => {
        if (event === "progress") setProgress(data);
        else if (event === "done") {
          try {
            loadGraph(await api.graph(data.graphId));
          } catch (e) {
            setError((e as Error).message);
            setProgress(null);
          }
        } else if (event === "error") {
          setError(data.message);
          setProgress(null);
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  const openRecent = async (r: RecentProject) => {
    setError(null);
    try {
      loadGraph(await api.graph(r.graphId));
    } catch {
      // 캐시가 없으면 다시 분석
      setPath(r.path);
      analyze(r.path);
    }
  };

  const pct = progress ? (PHASES.indexOf(progress.phase) + (progress.total ? progress.done / progress.total : 0)) / PHASES.length : 0;

  return (
    <div className="picker">
      <div className="picker-card">
        <div className="picker-tools">
          <button className="btn small" onClick={() => setHelpOpen(true)}>❓ 사용법</button>
        </div>
        <h1>Unity 클래스 다이어그램</h1>
        <p className="muted">Unity 프로젝트 폴더를 지정하면 C# 스크립트·프리팹·씬을 분석해 클래스 구조를 그리고, 구조와 상호작용을 단계별로 설명합니다.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            analyze(path);
          }}
        >
          <label className="field-label" htmlFor="path">Unity 프로젝트 경로 또는 GitHub 주소</label>
          <div className="row">
            <input
              id="path"
              className="input grow"
              placeholder="예: C:\Users\me\Documents\MyGame  또는  https://github.com/owner/repo"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <button className="btn primary" type="submit" disabled={busy || !path.trim()}>
              분석 시작
            </button>
          </div>
        </form>

        <p className="muted small hint">
          GitHub 주소를 넣으면 코드·프리팹·씬 파일만 내려받아 분석합니다. 특정 브랜치나 하위 폴더는 <code>…/tree/브랜치/폴더</code> 형식으로 지정하세요.
          비공개 저장소는 이 PC 의 git 에 GitHub 로그인이 되어 있어야 합니다.
        </p>
        <label className="plugin-check small">
          <input type="checkbox" checked={autoPlugins} onChange={(e) => setAutoPlugins(e.target.checked)} disabled={busy} />
          플러그인 폴더 자동 제외 (권장) — Plugins · ThirdParty · DOTween 처럼 설치한 에셋과 LICENSE·package.json 이 있는 폴더는 빼고, 직접 만든 스크립트만 보여줍니다
        </label>
        <button className="link" onClick={() => setShowSettings(!showSettings)}>
          {showSettings ? "▾" : "▸"} 직접 제외할 경로 (glob)
        </button>
        {showSettings && (
          <textarea className="input mono" rows={6} value={excludes} onChange={(e) => setExcludes(e.target.value)} disabled={busy} />
        )}

        {progress && (
          <div className="progress">
            <div className="progress-bar">
              <div style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <div className="muted small">
              {progress.label} {progress.total > 1 ? `${progress.done} / ${progress.total}` : ""}
            </div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}

        {recent.length > 0 && (
          <div className="recent">
            <div className="field-label">최근 프로젝트</div>
            {recent.map((r) => (
              <button key={r.path} className="recent-item" onClick={() => openRecent(r)} disabled={busy}>
                <b>{/github\.com/.test(r.path) ? "🐙 " : ""}{r.projectName}</b>
                <span className="muted small mono">{r.path}</span>
                <span className="muted small">{new Date(r.analyzedAt).toLocaleString()}</span>
                <span
                  className="link small"
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPath(r.path);
                    analyze(r.path);
                  }}
                >
                  다시 분석
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="modal help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="사용법">
            <div className="modal-head">
              <b>사용법</b>
              <div className="spacer" />
              <button className="btn small" onClick={() => setHelpOpen(false)}>닫기</button>
            </div>
            <div className="help-modal-body">
              <HelpPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function readPluginPref() {
  try {
    return JSON.parse(localStorage.getItem("autoExcludePlugins") ?? "true") !== false;
  } catch {
    return true;
  }
}
