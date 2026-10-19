// flow 단계의 sequence 를 엣지 위로 이동하는 점(토큰)으로 재생 (SPEC 7.5)
import type { Core } from "cytoscape";

export interface FlowHop {
  from: string; // 화면 요소 id
  to: string;
  edgeId?: string; // 화면 엣지 id
}

export function playFlow(cy: Core, hops: FlowHop[], onHop: (i: number) => void, signal: { cancelled: boolean }) {
  let i = 0;
  const next = () => {
    if (signal.cancelled || cy.destroyed()) return;
    cy.$(".seq-active").removeClass("seq-active");
    cy.$("node.token").remove();
    if (i >= hops.length) {
      onHop(-1);
      return;
    }
    const hop = hops[i];
    onHop(i);
    const a = cy.getElementById(hop.from);
    const b = cy.getElementById(hop.to);
    if (hop.edgeId) cy.getElementById(hop.edgeId).addClass("seq-active");
    if (a.empty() || b.empty() || hop.from === hop.to) {
      i++;
      window.setTimeout(next, 500);
      return;
    }
    const token = cy.add({ group: "nodes", data: { id: `token-${Date.now()}` }, classes: "token", position: { ...a.position() } });
    token.animate({ position: { ...b.position() } }, {
      duration: 800,
      easing: "ease-in-out-sine",
      complete: () => {
        token.remove();
        b.flashClass("pulse", 400);
        i++;
        window.setTimeout(next, 250);
      },
    });
  };
  next();
}
