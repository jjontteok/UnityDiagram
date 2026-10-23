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

// 묶음 이름에서 빼는 흔한 단어 (역할만 나타내고 기능을 말해 주지 않음)
const STOP = new Set([
  "manager", "managers", "controller", "controllers", "base", "ui", "data", "state", "states", "system", "systems", "handler", "component",
  "components", "object", "objects", "view", "views", "panel", "info", "util", "utils", "utility", "helper", "helpers", "network", "net",
  "so", "script", "scripts", "behaviour", "behaviours", "type", "types", "abstract", "interface", "interfaces", "i", "the", "of", "on",
  "to", "and", "default", "common", "core", "main", "game", "event", "events", "config", "configs", "ex", "runtime", "editor",
  "entities", "entity", "src", "source", "assets", "prefabs", "global", "misc", "etc", "test", "tests",
]);
const words = (name: string) => name.replace(/`\d+$/, "").match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
/** "1_Scripts" → "Scripts" */
const cleanSeg = (seg: string) => seg.replace(/^[\d_.\-\s#]+/, "");

/**
 * 묶음에 붙일 이름 후보 (좋은 순).
 * 1) 멤버 대부분이 들어 있는 폴더 이름 (예: Controllers/Boss → "Boss")
 * 2) 클래스 이름에 여러 번 나오는 단어 (예: InventoryManager · InventorySlot → "Inventory")
 * 3) 가장 많이 연결된 클래스 이름
 */
export function clusterNames(items: { name: string; folder?: string }[], central: string, everywhere?: Map<string, number>): string[] {
  const score = new Map<string, { s: number; word: string }>();
  const add = (word: string, s: number) => {
    const k = word.toLowerCase();
    if (STOP.has(k) || k.length < 3 || /^\d+$/.test(k)) return;
    // 프로젝트 전체에 흔한 단어(프로젝트·회사 이름 폴더, DataBox 같은 접미사)는 이 묶음을 구별해 주지 못함
    const g = everywhere?.get(k) ?? 0;
    if (g >= 0.12) return;
    const c = score.get(k) ?? { s: 0, word: cap(word) };
    c.s += s * (1 - g * 4);
    score.set(k, c);
  };
  const n = Math.max(1, items.length);
  const folderCount = new Map<string, number>();
  for (const it of items) {
    const segs = (it.folder ?? "").split("/").map(cleanSeg).filter(Boolean);
    for (const seg of new Set(segs)) folderCount.set(seg, (folderCount.get(seg) ?? 0) + 1);
  }
  for (const [seg, c] of folderCount) if (c >= 2 && c / n >= 0.2 && /^[A-Za-z][\w ]*$/.test(seg)) add(seg.replace(/\s+/g, ""), (c / n) * 1.3);
  const wordCount = new Map<string, number>();
  for (const it of items) for (const w of new Set(words(it.name))) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  for (const [w, c] of wordCount) if (c >= 2 && c / n >= 0.2) add(w, c / n);
  // 중심 클래스(가장 많이 연결된 것)의 이름·폴더에 있는 단어를 우선
  const centralItem = items.find((it) => it.name === central);
  if (centralItem) {
    const toks = new Set([...(centralItem.folder ?? "").split("/").map(cleanSeg), ...words(centralItem.name)].map((x) => x.replace(/\s+/g, "").toLowerCase()));
    for (const [k, v] of score) if (toks.has(k)) v.s += 0.25;
  }
  // 매니저가 많이 모인 묶음은 "매니저·코어" 도 후보로
  const managers = items.filter((it) => /Manager/.test(it.name)).length;
  if (managers >= 3 && managers / n >= 0.3) score.set("__mgr", { s: managers / n, word: "매니저·코어" });
  const sorted = [...score.values()].sort((a, b) => b.s - a.s || a.word.localeCompare(b.word));
  const ranked = sorted.map((x) => x.word);
  // 두 이름이 비슷하게 강하면 섞인 묶음이므로 둘 다 보여준다 (예: "Placement·FoodTruck")
  const [w1, w2] = sorted.map((x) => x.word.toLowerCase());
  const overlap = !!w2 && (w1.includes(w2) || w2.includes(w1));
  if (sorted.length >= 2 && sorted[1].s >= sorted[0].s * 0.6 && !overlap && !w1.includes("·") && !w2.includes("·")) {
    ranked.unshift(`${sorted[0].word}·${sorted[1].word}`);
  }
  ranked.push(central.replace(/`\d+$/, "").replace(/(Controller|Manager|Base|Ex)+$/, "") || central);
  return [...new Set(ranked)];
}

/** 프로젝트 전체에서 각 단어(폴더 이름·클래스 이름 단어)가 나오는 클래스 비율 */
export function tokenShares(items: { name: string; folder?: string }[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const it of items) {
    const toks = new Set([...(it.folder ?? "").split("/").map(cleanSeg), ...words(it.name)].filter(Boolean).map((x) => x.replace(/\s+/g, "").toLowerCase()));
    for (const t of toks) c.set(t, (c.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, items.length);
  return new Map([...c].map(([k, v]) => [k, v / n]));
}
