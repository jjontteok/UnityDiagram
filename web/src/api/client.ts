// fetch + SSE 래퍼. 해설 요청은 POST 라 EventSource 대신 fetch 스트림을 직접 파싱한다.
import type { ProjectGraph } from "../types";

export interface RecentProject {
  path: string;
  projectName: string;
  graphId: string;
  analyzedAt: string;
}

export interface SourceFile {
  filePath: string;
  from: number;
  to: number;
  totalLines: number;
  lines: string[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  defaultExcludes: () => fetch("/api/config/excludes").then((r) => json<{ defaultExcludes: string[] }>(r)),
  recent: () => fetch("/api/recent").then((r) => json<RecentProject[]>(r)),
  graph: (graphId: string) => fetch(`/api/graph/${graphId}`).then((r) => json<ProjectGraph>(r)),
  source: (graphId: string, filePath: string) =>
    fetch(`/api/source?graphId=${graphId}&filePath=${encodeURIComponent(filePath)}`).then((r) => json<SourceFile>(r)),
  mermaid: (graphId: string, moduleId?: string) =>
    fetch(`/api/export/mermaid?graphId=${graphId}${moduleId ? `&moduleId=${encodeURIComponent(moduleId)}` : ""}`).then((r) => r.text()),
  startAnalyze: (projectPath: string, excludeGlobs: string[], autoExcludePlugins = true) =>
    fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath, excludeGlobs, autoExcludePlugins }),
    }).then((r) => json<{ jobId: string }>(r)),
};

export type SseHandler = (event: string, data: any) => void;

/** GET SSE (분석 진행률) */
export function subscribeAnalyze(jobId: string, onEvent: SseHandler): () => void {
  const es = new EventSource(`/api/analyze/${jobId}/events`);
  for (const ev of ["progress", "done", "error"]) {
    es.addEventListener(ev, (e) => {
      onEvent(ev, JSON.parse((e as MessageEvent).data));
      if (ev !== "progress") es.close();
    });
  }
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    onEvent("error", { message: "서버와의 연결이 끊어졌습니다" });
  };
  return () => es.close();
}

/** POST SSE (구조 해설) */
export async function streamPost(url: string, body: unknown, onEvent: SseHandler, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  }
}
