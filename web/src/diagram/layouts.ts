// 뷰 모드별 레이아웃.
// - 상속 뷰: ELK layered (베이스 클래스가 위로 오는 계층 배치)
// - 모듈/전체/주변 뷰: fcose — 의존 그래프에 순환이 많아 layered 는 가로로 길게 퍼지므로, 모듈 상자(compound)를 지원하는 force 계열이 더 읽기 좋다
import type { Core, LayoutOptions } from "cytoscape";
import type { ViewMode } from "../state/store";

/**
 * 배치 후 겹친 클래스 상자를 조금씩 밀어낸다 (fcose 는 묶음 상자 안에서 가끔 겹침을 남김).
 * 겹친 방향 중 짧은 쪽으로 반씩 밀고, 겹침이 없어지거나 횟수를 다 쓰면 멈춘다.
 */
export function removeOverlaps(cy: Core, margin = 10, maxPasses = 60) {
  const nodes = cy.nodes(".cls").toArray();
  const pos = nodes.map((n) => ({ ...n.position() }));
  const half = nodes.map((n) => ({ w: n.outerWidth() / 2 + margin / 2, h: n.outerHeight() / 2 + margin / 2 }));
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const ox = half[i].w + half[j].w - Math.abs(dx);
        const oy = half[i].h + half[j].h - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = (dx >= 0 ? 1 : -1) * (ox / 2 + 0.5);
          pos[i].x -= s;
          pos[j].x += s;
        } else {
          const s = (dy >= 0 ? 1 : -1) * (oy / 2 + 0.5);
          pos[i].y -= s;
          pos[j].y += s;
        }
      }
    }
    if (!moved) break;
  }
  cy.batch(() => nodes.forEach((n, i) => n.position(pos[i])));
}

export function layoutFor(mode: ViewMode, nodeCount: number, animate: boolean, detail = false): LayoutOptions {
  // 상세 표시(상자가 큼)일 때는 더 넓게 벌려서 겹치지 않도록
  const spread = detail ? 2.2 : 1;
  if (mode === "inherit") {
    return {
      name: "elk",
      fit: true,
      padding: 40,
      animate: animate && nodeCount < 120,
      animationDuration: 450,
      elk: {
        algorithm: "layered",
        // 자식 → 부모 엣지이므로 UP 이면 부모가 위
        "elk.direction": "UP",
        "elk.layered.spacing.nodeNodeBetweenLayers": 55 * spread,
        "elk.spacing.nodeNode": 22 * spread,
        "elk.spacing.componentComponent": 40,
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.edgeRouting": "POLYLINE",
        // 연결되지 않은 작은 상속 트리들을 화면 비율에 맞게 여러 줄로 배치
        "elk.aspectRatio": 1.6,
        "elk.separateConnectedComponents": true,
      },
    } as unknown as LayoutOptions;
  }
  return {
    name: "fcose",
    quality: nodeCount > 150 ? "default" : "proof",
    randomize: true,
    animate: animate && nodeCount < 150,
    animationDuration: 500,
    fit: true,
    padding: 40,
    nodeDimensionsIncludeLabels: false,
    uniformNodeDimensions: false,
    packComponents: true,
    nodeRepulsion: () => (mode === "module" ? 7000 : 4000) * spread * spread,
    // 강한 관계(상속·같은 GameObject·GetComponent 등)는 짧고 단단하게, 단순 참조는 길고 느슨하게 (elements.ts 의 len/elastic)
    idealEdgeLength: (edge: { data(k: string): number | undefined }) => (edge.data("len") ?? (mode === "module" ? 110 : 80)) * spread,
    edgeElasticity: (edge: { data(k: string): number | undefined }) => edge.data("elastic") ?? 0.3,
    nestingFactor: 0.1,
    gravity: 0.45,
    // 묶음(그룹/모듈) 안의 클래스가 흩어지지 않도록 안쪽으로 당기는 힘
    gravityCompound: 2.2,
    gravityRangeCompound: 0.9,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 14 * spread,
    tilingPaddingHorizontal: 14 * spread,
    nodeSeparation: 75 * spread,
  } as unknown as LayoutOptions;
}
