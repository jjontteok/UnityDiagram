import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import csharp from "highlight.js/lib/languages/csharp";
import { api, type SourceFile } from "../api/client";
import { useStore } from "../state/store";

hljs.registerLanguage("csharp", csharp);

/** 읽기 전용 코드 뷰어 (SPEC 7.4) */
export function CodeViewer() {
  const code = useStore((s) => s.code);
  const close = useStore((s) => s.closeCode);
  const graph = useStore((s) => s.graph);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!code || !graph) return;
    setFile(null);
    setError(null);
    api.source(graph.graphId, code.filePath).then(setFile).catch((e: Error) => setError(e.message));
  }, [code?.filePath, graph]);

  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "center" });
  }, [file, code?.line]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 닫혀 있을 때는 ESC 를 가로채지 않음 (해설 종료 등 다른 ESC 가 동작하도록)
      if (e.key === "Escape" && useStore.getState().code) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // 줄 단위 하이라이트 (여러 줄 주석 등은 줄마다 다시 토큰화되므로 완벽하진 않음)
  const html = useMemo(() => {
    if (!file) return [];
    const full = hljs.highlight(file.lines.join("\n"), { language: "csharp" }).value;
    return splitHighlightedLines(full);
  }, [file]);

  if (!code) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal code-viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="코드 보기">
        <div className="modal-head">
          <span className="mono small">{code.filePath}:{code.line}</span>
          <div className="spacer" />
          {graph?.source?.kind === "github" && (
            <a
              className="btn small"
              target="_blank"
              rel="noreferrer"
              href={`${graph.source.url}/blob/${graph.source.commit}/${[graph.source.subPath, code.filePath]
                .filter(Boolean)
                .map((p) => p.split("/").map(encodeURIComponent).join("/"))
                .join("/")}#L${code.line}`}
            >
              GitHub 에서 보기
            </a>
          )}
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(`${code.filePath}:${code.line}`)}>
            경로 복사
          </button>
          <button className="btn small" onClick={close}>
            닫기 (ESC)
          </button>
        </div>
        <div className="code-body">
          {error && <div className="error-box">{error}</div>}
          {!file && !error && <div className="muted">불러오는 중…</div>}
          {html.map((h, i) => {
            const ln = i + 1;
            const hit = ln === code.line;
            return (
              <div key={i} ref={hit ? lineRef : undefined} className={`code-line ${hit ? "hit" : ""}`}>
                <span className="ln">{ln}</span>
                <span className="src" dangerouslySetInnerHTML={{ __html: h || " " }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** highlight.js 결과를 줄 단위로 자르되, 줄을 넘는 <span> 은 닫고 다음 줄에서 다시 연다 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      open.push(m[1]);
      cur += m[1];
    } else if (m[2]) {
      open.pop();
      cur += m[2];
    } else if (m[3]) {
      cur += "</span>".repeat(open.length);
      lines.push(cur);
      cur = open.join("");
    } else cur += m[4];
  }
  lines.push(cur);
  return lines;
}
