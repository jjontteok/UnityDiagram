// Server-Sent Events 헬퍼. 클라이언트가 연결을 끊으면 signal 이 abort 된다.
import type { FastifyReply, FastifyRequest } from "fastify";

export interface SseChannel {
  send(event: string, data: unknown): void;
  close(): void;
  signal: AbortSignal;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const ctrl = new AbortController();
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    ctrl.abort();
  };
  req.raw.on("close", cleanup);
  res.on("close", cleanup);
  return {
    signal: ctrl.signal,
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (!closed) res.end();
      cleanup();
    },
  };
}
