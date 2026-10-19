// 로컬 서버 진입점 — 127.0.0.1 에만 바인딩 (SPEC 3, 10.1)
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { TOOL_ROOT } from "./cache.js";
import { registerAnalyzeRoutes } from "./routes/analyze.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerGuideRoutes } from "./routes/guide.js";
import { getParser } from "./parse/csharpParser.js";

dotenv.config({ path: path.join(TOOL_ROOT, ".env"), quiet: true });

const dev = process.argv.includes("--dev");
const noOpen = process.argv.includes("--no-open") || process.env.NO_OPEN === "1";
const HOST = "127.0.0.1";
const port = Number(dev ? process.env.DEV_API_PORT || 5174 : process.env.PORT || 5173);

const app = Fastify({ logger: { level: dev ? "info" : "warn" }, bodyLimit: 1024 * 1024 });

// 다른 사이트가 브라우저를 통해 로컬 API 를 호출하지 못하도록 Origin 검사
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return reply.code(403).send({ error: "허용되지 않은 출처입니다" });
  }
});

registerAnalyzeRoutes(app);
registerGraphRoutes(app);
registerExportRoutes(app);
registerGuideRoutes(app);

const webDist = path.join(TOOL_ROOT, "web", "dist");
if (!dev && fs.existsSync(webDist)) {
  // wildcard 모드: 시작 이후에 다시 빌드된 파일도 바로 제공
  await app.register(fastifyStatic, { root: webDist, wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

await getParser(); // WASM 미리 로드
await app.listen({ host: HOST, port });

const url = `http://localhost:${port}`;
console.log(`\n  Unity 클래스 다이어그램 서버: ${dev ? `${url} (API 전용 — 웹은 http://localhost:5173)` : url}`);
if (!dev && !fs.existsSync(webDist)) console.log("  ⚠ web/dist 가 없습니다. `npm run build` 를 먼저 실행하세요.\n");
if (!dev && !noOpen) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
