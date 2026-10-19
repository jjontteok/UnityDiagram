// POST /api/analyze → jobId, GET /api/analyze/:jobId/events (SSE 진행률)
import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { analyzeProject } from "../graph/builder.js";
import { DEFAULT_EXCLUDES } from "../scan/fileScanner.js";
import { checkoutGithub, parseGithubUrl } from "../scan/github.js";
import { loadRecent, pushRecent, saveGraph } from "../cache.js";
import { openSse } from "./sse.js";

interface JobEvent {
  event: "progress" | "done" | "error";
  data: unknown;
}

interface Job {
  events: JobEvent[];
  listeners: Set<(e: JobEvent) => void>;
  finished: boolean;
}

const jobs = new Map<string, Job>();

const PHASE_LABEL: Record<string, string> = {
  scan: "파일 목록 수집 중…",
  parse: "C# 스크립트 파싱 중…",
  unity: "프리팹·씬·에셋 스캔 중…",
};

export function registerAnalyzeRoutes(app: FastifyInstance) {
  app.get("/api/config/excludes", async () => ({ defaultExcludes: DEFAULT_EXCLUDES }));

  app.get("/api/recent", async () => loadRecent());

  app.post<{ Body: { projectPath?: string; excludeGlobs?: string[] } }>("/api/analyze", async (req, reply) => {
    const projectPath = req.body?.projectPath?.trim().replace(/^"(.*)"$/, "$1");
    if (!projectPath) return reply.code(400).send({ error: "projectPath 가 필요합니다" });
    const excludes = Array.isArray(req.body.excludeGlobs) ? req.body.excludeGlobs.filter((x) => typeof x === "string" && x.trim()) : DEFAULT_EXCLUDES;
    const jobId = crypto.randomUUID();
    const job: Job = { events: [], listeners: new Set(), finished: false };
    jobs.set(jobId, job);
    const emit = (e: JobEvent) => {
      job.events.push(e);
      for (const l of job.listeners) l(e);
    };
    let lastProgress = 0;
    void (async () => {
      try {
        const gh = parseGithubUrl(projectPath);
        let root = path.resolve(projectPath);
        let checkout: Awaited<ReturnType<typeof checkoutGithub>> | null = null;
        if (gh) {
          checkout = await checkoutGithub(gh, (label) => emit({ event: "progress", data: { phase: "clone", label, done: 0, total: 1 } }));
          root = checkout.projectRoot;
        } else if (/^(https?:\/\/|git@)/i.test(projectPath)) {
          throw new Error("GitHub 주소만 지원합니다 (예: https://github.com/owner/repo)");
        }
        const g = await analyzeProject(root, excludes, (phase, done, total) => {
          const now = Date.now();
          if (now - lastProgress < 80 && done !== total) return;
          lastProgress = now;
          emit({ event: "progress", data: { phase, label: PHASE_LABEL[phase] ?? phase, done, total } });
        });
        if (checkout) {
          const sub = path.relative(checkout.dir, checkout.projectRoot).replace(/\\/g, "/");
          g.source = { kind: "github", url: checkout.ref.url, branch: checkout.branch, commit: checkout.commit, subPath: sub };
          g.projectName = sub ? `${checkout.ref.repo}/${sub.split("/").pop()}` : checkout.ref.repo;
          g.warnings.unshift(...checkout.warnings);
        }
        await saveGraph(g);
        await pushRecent({ path: gh ? projectPath.trim() : g.projectRoot, projectName: g.projectName, graphId: g.graphId, analyzedAt: g.analyzedAt });
        emit({ event: "done", data: { graphId: g.graphId, stats: g.stats, warnings: g.warnings.length } });
      } catch (e) {
        emit({ event: "error", data: { message: (e as Error).message } });
      } finally {
        job.finished = true;
        // 늦게 붙는 구독자를 위해 잠시 보관 후 정리
        setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000).unref();
      }
    })();
    return { jobId };
  });

  app.get<{ Params: { jobId: string } }>("/api/analyze/:jobId/events", async (req, reply) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "작업을 찾을 수 없습니다" });
    const sse = openSse(req, reply);
    for (const e of job.events) sse.send(e.event, e.data);
    if (job.finished) return sse.close();
    const listener = (e: JobEvent) => {
      sse.send(e.event, e.data);
      if (e.event !== "progress") sse.close();
    };
    job.listeners.add(listener);
    sse.signal.addEventListener("abort", () => job.listeners.delete(listener));
  });
}
