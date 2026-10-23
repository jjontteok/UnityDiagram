import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { activeSession, useStore } from "../state/store";
import { diagram } from "./DiagramCanvas";
import type { NarrationStep } from "../types";

const TYPE_LABEL: Record<NarrationStep["type"], string> = {
  overview: "개요",
  layer: "레이어",
  module: "모듈",
  flow: "흐름",
  pattern: "패턴",
  risk: "주의점",
  summary: "정리",
};

/** 마크다운 안의 `클래스명` 을 다이어그램 링크로 */
function useCodeRenderer() {
  const graph = useStore((s) => s.graph)!;
  const byName = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of graph.nodes) m.set(n.name, [...(m.get(n.name) ?? []), n.id]);
    return m;
  }, [graph]);
  return function Code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const text = String(children ?? "");
    const key = text.replace(/\(\)$/, "").replace(/<.*>$/, "");
    const id = byName.get(key)?.length === 1 ? byName.get(key)![0] : graph.nodes.some((n) => n.id === key) ? key : undefined;
    if (!className && id) {
      return (
        <button
          className="code-link"
          onClick={() => {
            // 해설은 그대로 두고, 지금 그림에 있으면 그 클래스로 이동
            useStore.getState().select({ kind: "node", id }, { keepTab: true });
            diagram.center(id);
          }}
        >
          {text}
        </button>
      );
    }
    return <code className={className}>{children}</code>;
  };
}

/** 키보드: ← → 단계 이동, ESC 해설 종료. 다른 탭(상세 등)을 보고 있을 때도 동작하도록 앱 전체에 건다 */
export function useNarrationKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const st = useStore.getState();
      if (!activeSession(st) || st.code) return; // 코드 보기 창이 열려 있으면 그 창이 먼저
      if (e.key === "ArrowRight") st.setStep(st.stepIndex + 1);
      else if (e.key === "ArrowLeft") st.setStep(st.stepIndex - 1);
      else if (e.key === "Escape" && st.narrationActive) st.endNarration();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function NarrationPanel() {
  const session = useStore(activeSession);
  const sessions = useStore((s) => s.sessions);
  const stepIndex = useStore((s) => s.stepIndex);
  const setStep = useStore((s) => s.setStep);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const narrationActive = useStore((s) => s.narrationActive);
  const endNarration = useStore((s) => s.endNarration);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const stopGuide = useStore((s) => s.stopGuide);
  const nodeById = useStore((s) => s.nodeById);
  const Code = useCodeRenderer();
  const [hop, setHop] = useState(-1);

  const step = session?.steps[stepIndex];

  // 자동재생: 스텝당 (글자수 × 40ms, 최소 4초)
  useEffect(() => {
    if (!playing || !session || !step) return;
    const ms = Math.max(4000, step.markdown.length * 40) + (step.type === "flow" ? step.sequence.length * 1100 : 0);
    const t = window.setTimeout(() => {
      if (stepIndex < session.steps.length - 1) setStep(stepIndex + 1);
      else if (session.status !== "streaming") setPlaying(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [playing, stepIndex, step, session, setStep, setPlaying]);

  useEffect(() => {
    const onHop = (e: Event) => setHop((e as CustomEvent<number>).detail);
    window.addEventListener("flow-hop", onHop);
    return () => window.removeEventListener("flow-hop", onHop);
  }, []);
  useEffect(() => setHop(-1), [step]);

  if (!session) {
    return (
      <div className="narration empty">
        <p>아직 해설이 없습니다.</p>
        <p className="muted small">상단의 <b>🧭 클래스 다이어그램 보기</b> 를 누르면 프로젝트 구조와 상호작용을 단계별로 설명하고, 설명하는 부분을 다이어그램에서 강조합니다. 클래스 상세의 <b>📖 이 클래스 설명</b> 으로 클래스 하나만 볼 수도 있습니다.</p>
      </div>
    );
  }

  const short = (id: string) => nodeById.get(id)?.name ?? id;
  const streaming = session.status === "streaming";

  return (
    <div className="narration">
      <div className="narration-head">
        <select className="input select grow" value={session.id} onChange={(e) => setActiveSession(e.target.value)}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.status === "streaming" ? "⏳ " : s.status === "error" ? "⚠ " : ""}
              {s.title}
            </option>
          ))}
        </select>
        {streaming && (
          <button className="btn small" onClick={stopGuide}>중지</button>
        )}
      </div>
      <div className="muted small meta">
        {session.steps.length > 0 && <span>{session.steps.length}단계</span>}
      </div>

      <ol className="step-list">
        {session.steps.map((s, i) => (
          <li key={i}>
            <button className={i === stepIndex && narrationActive ? "active" : ""} onClick={() => setStep(i)}>
              <span className={`step-type t-${s.type}`}>{TYPE_LABEL[s.type]}</span> {s.title}
            </button>
          </li>
        ))}
        {streaming && (
          <li className="skeleton">
            <span className="spinner" /> {session.progress || "구조를 정리하는 중…"}
          </li>
        )}
      </ol>

      <div className="step-body">
        {step ? (
          <>
            <div className="step-title">
              <span className={`step-type t-${step.type}`}>{TYPE_LABEL[step.type]}</span>
              <h3>
                {stepIndex + 1}. {step.title}
              </h3>
            </div>
            <div className="md">
              <ReactMarkdown components={{ code: Code as any }}>{step.markdown}</ReactMarkdown>
            </div>
            {step.sequence.length > 0 && (
              <ol className="sequence">
                {step.sequence.map((s, i) => (
                  <li key={i} className={i === hop ? "active" : ""}>
                    <b>{short(s.from)}</b> → <b>{short(s.to)}</b>
                    {s.label && <div className="muted small">{s.label}</div>}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : streaming && session.draft?.markdown ? (
          <div className="draft">
            <div className="step-title">
              <h3>{session.draft.title || "작성 중…"}</h3>
            </div>
            <div className="md">
              <ReactMarkdown components={{ code: Code as any }}>{session.draft.markdown}</ReactMarkdown>
              <span className="caret-blink">▍</span>
            </div>
          </div>
        ) : streaming ? (
          <div className="muted thinking">
            <span className="spinner" /> {session.progress ?? "구조를 정리하는 중…"}
          </div>
        ) : null}
        {streaming && step && stepIndex === session.steps.length - 1 && session.draft?.markdown && (
          <div className="draft-next muted small">다음 단계 작성 중: {session.draft.title}</div>
        )}
        {session.status === "error" && (
          <div className="error-box">
            {session.error}
          </div>
        )}
        {session.status === "done" && session.finish && stepIndex === session.steps.length - 1 && (
          <div className="finish">
            {session.finish.oneLineSummary && <p className="summary">💡 {session.finish.oneLineSummary}</p>}
          </div>
        )}
      </div>

      <div className="controls">
        <button className="btn" onClick={() => setStep(stepIndex - 1)} disabled={!session.steps.length || stepIndex === 0}>
          ◀ 이전
        </button>
        <button className="btn" onClick={() => setPlaying(!playing)} disabled={!session.steps.length}>
          {playing ? "⏸ 일시정지" : "▶ 자동재생"}
        </button>
        <button className="btn" onClick={() => setStep(stepIndex + 1)} disabled={stepIndex >= session.steps.length - 1}>
          다음 ▶
        </button>
        <span className="muted small">
          {session.steps.length ? `${stepIndex + 1} / ${session.steps.length}${streaming ? "+" : ""}` : ""}
        </span>
        <div className="spacer" />
        {narrationActive ? (
          <button className="btn small" onClick={endNarration} title="ESC">
            해설 종료
          </button>
        ) : (
          session.steps.length > 0 && (
            <button className="btn small" onClick={() => setStep(stepIndex)}>
              강조 다시 보기
            </button>
          )
        )}
      </div>
    </div>
  );
}
