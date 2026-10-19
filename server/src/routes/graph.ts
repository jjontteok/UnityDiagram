// GET /api/graph/:graphId, GET /api/source
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { loadGraph } from "../cache.js";

export function registerGraphRoutes(app: FastifyInstance) {
  app.get<{ Params: { graphId: string } }>("/api/graph/:graphId", async (req, reply) => {
    const g = await loadGraph(req.params.graphId);
    if (!g) return reply.code(404).send({ error: "그래프를 찾을 수 없습니다. 다시 분석하세요." });
    return g;
  });

  app.get<{ Querystring: { graphId?: string; filePath?: string; from?: string; to?: string } }>("/api/source", async (req, reply) => {
    const { graphId = "", filePath = "" } = req.query;
    const g = await loadGraph(graphId);
    if (!g) return reply.code(404).send({ error: "그래프를 찾을 수 없습니다" });
    // path traversal 방지: 프로젝트의 Assets 폴더 안 파일만 허용 (SPEC 6 MUST)
    const assetsRoot = path.join(g.projectRoot, "Assets");
    const abs = path.resolve(g.projectRoot, filePath);
    const rel = path.relative(assetsRoot, abs);
    if (!filePath || rel.startsWith("..") || path.isAbsolute(rel)) return reply.code(403).send({ error: "프로젝트 밖 경로는 읽을 수 없습니다" });
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      return reply.code(404).send({ error: "파일이 없습니다" });
    }
    const realRel = path.relative(await fs.realpath(assetsRoot), real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return reply.code(403).send({ error: "프로젝트 밖 경로는 읽을 수 없습니다" });
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return reply.code(413).send({ error: "파일이 너무 큽니다" });
    const lines = (await fs.readFile(real, "utf8")).split(/\r?\n/);
    const from = Math.max(1, Number(req.query.from) || 1);
    const to = Math.min(lines.length, Number(req.query.to) || lines.length);
    return { filePath, from, to, totalLines: lines.length, lines: lines.slice(from - 1, to) };
  });
}
