// Louvain 커뮤니티 탐지 — 서로 촘촘히 연결된 클래스끼리 묶는다 (무방향, 가중치)
// 노드 순서를 정렬해서 쓰므로 같은 입력이면 항상 같은 결과가 나온다.

export interface WEdge {
  s: string;
  t: string;
  w: number;
}

/** 노드 id → 커뮤니티 번호 */
export function louvain(nodeIds: string[], edges: WEdge[], maxLevels = 4): Map<string, number> {
  const ids = [...nodeIds].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  let n = ids.length;
  // 인접 리스트 (자기 자신으로의 간선 포함 가능)
  let adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const e of edges) {
    const a = index.get(e.s);
    const b = index.get(e.t);
    if (a === undefined || b === undefined || a === b || e.w <= 0) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + e.w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + e.w);
  }
  // 원래 노드 → 현재 단계 노드
  let membership = ids.map((_, i) => i);

  for (let level = 0; level < maxLevels; level++) {
    const comm = Array.from({ length: n }, (_, i) => i);
    const k = adj.map((m, i) => {
      let s = 0;
      for (const [j, w] of m) s += j === i ? 2 * w : w;
      return s;
    });
    const m2 = k.reduce((a, b) => a + b, 0); // = 2m
    if (m2 === 0) break;
    const tot = [...k];

    let moved = true;
    let anyMove = false;
    for (let pass = 0; moved && pass < 20; pass++) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        // i 를 자기 커뮤니티에서 빼고, 이웃 커뮤니티별 연결 가중치 계산
        tot[ci] -= k[i];
        const wTo = new Map<number, number>();
        for (const [j, w] of adj[i]) {
          if (j === i) continue;
          wTo.set(comm[j], (wTo.get(comm[j]) ?? 0) + w);
        }
        let best = ci;
        let bestGain = (wTo.get(ci) ?? 0) - (tot[ci] * k[i]) / m2;
        for (const [c, w] of wTo) {
          const gain = w - (tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        tot[best] += k[i];
        if (best !== ci) {
          comm[i] = best;
          moved = true;
          anyMove = true;
        }
      }
    }
    if (!anyMove) break;

    // 커뮤니티 번호를 0.. 으로 다시 매기고 그래프를 압축
    const renum = new Map<number, number>();
    for (const c of comm) if (!renum.has(c)) renum.set(c, renum.size);
    const next: Map<number, number>[] = Array.from({ length: renum.size }, () => new Map());
    for (let i = 0; i < n; i++) {
      const a = renum.get(comm[i])!;
      for (const [j, w] of adj[i]) {
        const b = renum.get(comm[j])!;
        // 커뮤니티 안의 간선은 양쪽(i→j, j→i)에 저장되어 있으므로 절반씩 더해 원래 가중치를 유지.
        // 이전 단계에서 생긴 자기 루프(j === i)는 한 번만 저장되어 있으므로 그대로 더한다
        next[a].set(b, (next[a].get(b) ?? 0) + (a === b && j !== i ? w / 2 : w));
      }
    }
    membership = membership.map((c) => renum.get(comm[c])!);
    adj = next;
    n = renum.size;
  }

  return new Map(ids.map((id, i) => [id, membership[i]]));
}
