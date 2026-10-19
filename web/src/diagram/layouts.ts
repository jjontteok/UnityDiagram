// 뷰 모드별 레이아웃.
// - 상속 뷰: ELK layered (베이스 클래스가 위로 오는 계층 배치)
// - 모듈/전체/주변 뷰: fcose — 의존 그래프에 순환이 많아 layered 는 가로로 길게 퍼지므로, 모듈 상자(compound)를 지원하는 force 계열이 더 읽기 좋다
import type { LayoutOptions } from "cytoscape";
import type { ViewMode } from "../state/store";

export function layoutFor(mode: ViewMode, nodeCount: number, animate: boolean): LayoutOptions {
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
        "elk.layered.spacing.nodeNodeBetweenLayers": 55,
        "elk.spacing.nodeNode": 22,
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
    nodeRepulsion: () => (mode === "module" ? 9000 : 6500),
    idealEdgeLength: () => (mode === "module" ? 110 : 80),
    edgeElasticity: () => 0.25,
    nestingFactor: 0.12,
    gravity: 0.3,
    gravityCompound: 1.2,
    gravityRangeCompound: 1.4,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 14,
    tilingPaddingHorizontal: 14,
  } as unknown as LayoutOptions;
}
