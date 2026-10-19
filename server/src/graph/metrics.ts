// fan-in/fan-out, 순환 참조(Tarjan SCC), 허브 클래스 (SPEC 4.6)
import type { Edge, EdgeKind, ProjectGraph, TypeNode } from "../types.js";

const NON_DEPENDENCY: EdgeKind[] = ["nestedIn", "coLocated"];

export function computeMetrics(nodes: TypeNode[], edges: Edge[]): ProjectGraph["metrics"] {
  const fanIn: Record<string, number> = {};
  const fanOut: Record<string, number> = {};
  const outSet = new Map<string, Set<string>>();
  const inSet = new Map<string, Set<string>>();
  for (const n of nodes) {
    outSet.set(n.id, new Set());
    inSet.set(n.id, new Set());
  }
  for (const e of edges) {
    if (NON_DEPENDENCY.includes(e.kind)) continue;
    outSet.get(e.source)?.add(e.target);
    inSet.get(e.target)?.add(e.source);
  }
  for (const n of nodes) {
    fanIn[n.id] = inSet.get(n.id)!.size;
    fanOut[n.id] = outSet.get(n.id)!.size;
  }

  const internal = new Set(nodes.filter((n) => n.unityRole !== "External").map((n) => n.id));
  const cycles = tarjan([...internal], (id) => [...(outSet.get(id) ?? [])].filter((t) => internal.has(t)))
    .filter((c) => c.length > 1)
    .sort((a, b) => b.length - a.length);

  const hubs = [...internal]
    .filter((id) => fanIn[id] > 0)
    .sort((a, b) => fanIn[b] - fanIn[a] || fanOut[b] - fanOut[a])
    .slice(0, 10);

  return { fanIn, fanOut, cycles, hubs };
}

function tarjan(ids: string[], next: (id: string) => string[]): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  // 반복형 DFS (깊은 의존 체인에서 콜스택 초과 방지)
  for (const start of ids) {
    if (idx.has(start)) continue;
    const work: { id: string; it: number; succ: string[] }[] = [];
    const push = (id: string) => {
      idx.set(id, index);
      low.set(id, index);
      index++;
      stack.push(id);
      onStack.add(id);
      work.push({ id, it: 0, succ: next(id) });
    };
    push(start);
    while (work.length) {
      const top = work[work.length - 1];
      if (top.it < top.succ.length) {
        const w = top.succ[top.it++];
        if (!idx.has(w)) push(w);
        else if (onStack.has(w)) low.set(top.id, Math.min(low.get(top.id)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1];
        low.set(parent.id, Math.min(low.get(parent.id)!, low.get(top.id)!));
      }
      if (low.get(top.id) === idx.get(top.id)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.id);
        out.push(comp);
      }
    }
  }
  return out;
}
