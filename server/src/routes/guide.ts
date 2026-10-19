// POST /api/guide/narrate | explain-node → SSE. 분석 결과로 만든 해설을 한 단계씩 보낸다.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loadGraph } from "../cache.js";
import { buildNodeExplain, buildOverview } from "../guide/narrative.js";
import type { NarrationFinish, NarrationStep } from "../types.js";
import { openSse } from "./sse.js";

const STEP_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stream(req: FastifyRequest, reply: FastifyReply, result: { steps: NarrationStep[]; finish: NarrationFinish }) {
  const sse = openSse(req, reply);
  try {
    for (const s of result.steps) {
      if (sse.signal.aborted) return;
      sse.send("step", s);
      await sleep(STEP_DELAY_MS);
    }
    sse.send("finish", result.finish);
  } finally {
    sse.close();
  }
}

export function registerGuideRoutes(app: FastifyInstance) {
  app.post<{ Body: { graphId: string } }>("/api/guide/narrate", async (req, reply) => {
    const g = await loadGraph(req.body?.graphId ?? "");
    if (!g) return reply.code(404).send({ error: "그래프를 찾을 수 없습니다. 다시 분석하세요." });
    await stream(req, reply, buildOverview(g));
  });

  app.post<{ Body: { graphId: string; nodeId: string } }>("/api/guide/explain-node", async (req, reply) => {
    const g = await loadGraph(req.body?.graphId ?? "");
    if (!g) return reply.code(404).send({ error: "그래프를 찾을 수 없습니다. 다시 분석하세요." });
    if (!g.nodes.some((n) => n.id === req.body.nodeId)) return reply.code(404).send({ error: "클래스를 찾을 수 없습니다" });
    await stream(req, reply, buildNodeExplain(g, req.body.nodeId));
  });
}
