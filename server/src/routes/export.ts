// GET /api/export/mermaid
import type { FastifyInstance } from "fastify";
import { loadGraph } from "../cache.js";
import { toMermaid } from "../export/mermaid.js";

export function registerExportRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { graphId?: string; moduleId?: string } }>("/api/export/mermaid", async (req, reply) => {
    const g = await loadGraph(req.query.graphId ?? "");
    if (!g) return reply.code(404).send({ error: "그래프를 찾을 수 없습니다" });
    reply.type("text/plain; charset=utf-8");
    return toMermaid(g, req.query.moduleId || undefined);
  });
}
