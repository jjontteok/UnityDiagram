// 분석 결과(그래프)만으로 구조 해설 단계를 만든다. AI·외부 API 를 쓰지 않는다.
// 단계 형식은 SPEC 5.3 의 NarrationStep 과 같아서, 웹은 같은 방식으로 강조/애니메이션한다.
import type { Edge, EdgeKind, Module, NarrationFinish, NarrationStep, ProjectGraph, TypeNode } from "../types.js";

const short = (id: string) => id.replace(/^lib:/, "").replace(/^.*\./, "").replace(/`\d+$/, "");
const code = (id: string) => `\`${short(id)}\``;
const list = (ids: string[], max = 5) => ids.slice(0, max).map(code).join(", ") + (ids.length > max ? ` 외 ${ids.length - max}개` : "");

const KIND_SENTENCE: Record<EdgeKind, string> = {
  inherits: "을(를) 상속합니다",
  implements: "인터페이스를 구현합니다",
  nestedIn: "안에 중첩된 타입입니다",
  references: "을(를) 필드나 매개변수로 참조합니다",
  getsComponent: "을(를) GetComponent 로 찾아 씁니다",
  requiresComponent: "이(가) 같은 GameObject 에 반드시 있어야 합니다 ([RequireComponent])",
  usesSingleton: "에 정적 접근(.Instance 등)으로 바로 접근합니다",
  finds: "을(를) FindObjectOfType 계열로 씬에서 찾습니다",
  creates: "을(를) new 로 생성합니다",
  instantiates: "을(를) Instantiate 로 프리팹에서 생성합니다",
  subscribes: "의 이벤트를 구독합니다",
  callsStatic: "의 정적 멤버를 호출합니다",
  coLocated: "와(과) 같은 GameObject 에 붙어 함께 동작합니다",
  wiredInInspector: "이(가) 인스펙터에서 연결되어 있습니다",
};

const KIND_SHORT: Record<EdgeKind, string> = {
  inherits: "상속",
  implements: "구현",
  nestedIn: "중첩",
  references: "참조",
  getsComponent: "GetComponent",
  requiresComponent: "RequireComponent",
  usesSingleton: "싱글톤 접근",
  finds: "FindObjectOfType",
  creates: "new",
  instantiates: "Instantiate",
  subscribes: "이벤트 구독",
  callsStatic: "정적 호출",
  coLocated: "같은 GameObject",
  wiredInInspector: "인스펙터 연결",
};

const LIFECYCLE = [
  "Awake", "OnEnable", "OnNetworkSpawn", "Start", "FixedUpdate", "Update", "LateUpdate",
  "OnTriggerEnter2D", "OnTriggerEnter", "OnCollisionEnter2D", "OnCollisionEnter",
  "OnDisable", "OnNetworkDespawn", "OnDestroy",
];
const LIFECYCLE_NOTE: Record<string, string> = {
  Awake: "자기 자신 초기화",
  OnEnable: "활성화될 때 (이벤트 구독 위치로 흔함)",
  OnNetworkSpawn: "네트워크 오브젝트가 스폰될 때",
  Start: "첫 프레임 전, 다른 오브젝트 참조",
  FixedUpdate: "물리 주기마다",
  Update: "매 프레임",
  LateUpdate: "매 프레임 마지막 (카메라 추적 등)",
  OnTriggerEnter2D: "2D 트리거 충돌",
  OnTriggerEnter: "트리거 충돌",
  OnCollisionEnter2D: "2D 충돌",
  OnCollisionEnter: "충돌",
  OnDisable: "비활성화될 때 (구독 해제 위치)",
  OnNetworkDespawn: "네트워크 오브젝트가 사라질 때",
  OnDestroy: "파괴될 때",
};

function step(type: NarrationStep["type"], title: string, markdown: string, focus: Partial<NarrationStep["focus"]> = {}, sequence: NarrationStep["sequence"] = []): NarrationStep {
  return {
    stepIndex: 0,
    type,
    title,
    markdown,
    focus: { nodeIds: focus.nodeIds ?? [], edgeIds: focus.edgeIds ?? [], moduleIds: focus.moduleIds ?? [], camera: focus.camera ?? "fit" },
    sequence,
  };
}

class GraphView {
  nodes: TypeNode[];
  byId: Map<string, TypeNode>;
  out = new Map<string, Edge[]>();
  inc = new Map<string, Edge[]>();
  top: Module[];
  topOf = new Map<string, Module>();

  constructor(public g: ProjectGraph) {
    this.nodes = g.nodes.filter((n) => n.unityRole !== "External");
    this.byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) {
      this.out.set(e.source, [...(this.out.get(e.source) ?? []), e]);
      this.inc.set(e.target, [...(this.inc.get(e.target) ?? []), e]);
    }
    this.top = g.modules.filter((m) => !m.parent && m.id !== "module:(External)");
    for (const m of this.top) for (const id of m.nodeIds) this.topOf.set(id, m);
  }
  fanIn = (id: string) => this.g.metrics.fanIn[id] ?? 0;
  fanOut = (id: string) => this.g.metrics.fanOut[id] ?? 0;
  byFanIn = (ids: string[]) => [...ids].sort((a, b) => this.fanIn(b) - this.fanIn(a));
  isClass = (id: string) => !!this.byId.get(id) && this.byId.get(id)!.unityRole !== "External";
}

/** 패키지·클래스 이름으로 프로젝트 성격 추정 */
function projectTraits(g: ProjectGraph, v: GraphView): string[] {
  const p = g.packages.join(" ");
  const t: string[] = [];
  if (/netcode/.test(p)) t.push(/facepunch|steam/.test(p) ? "Steam(Facepunch) 기반 멀티플레이" : "Netcode for GameObjects 멀티플레이");
  if (/2d\./.test(p) || /tilemap/.test(p)) t.push("2D");
  if (/render-pipelines\.universal/.test(p)) t.push("URP 렌더링");
  if (/inputsystem/.test(p)) t.push("새 Input System");
  if (/localization/.test(p)) t.push("다국어(Localization)");
  if (/addressables/.test(p)) t.push("Addressables 리소스 관리");
  if (v.nodes.some((n) => /UniTask/.test(n.methods.map((m) => m.returnType).join(" "))) || g.nodes.some((n) => n.id === "lib:UniTask")) t.push("UniTask 비동기");
  return t;
}

/** 모듈이 어떤 계층 역할인지 이름과 구성으로 추정 */
function layerName(m: Module, v: GraphView): string {
  const ns = m.nodeIds.map((id) => v.byId.get(id)).filter(Boolean) as TypeNode[];
  const count = (pred: (n: TypeNode) => boolean) => ns.filter(pred).length;
  const label = m.label.toLowerCase();
  if (/^ui$|ui|hud|view/.test(label) || count((n) => n.tags.includes("ui")) > ns.length / 2) return "UI 계층";
  if (/manager|core|system|service/.test(label) || count((n) => n.tags.includes("singleton")) > ns.length / 2) return "매니저/핵심 시스템 계층";
  if (/data|config|setting|table/.test(label) || count((n) => n.unityRole === "ScriptableObject" || n.unityRole === "Data" || n.unityRole === "Enum") > ns.length * 0.6) return "데이터 계층";
  if (/controller|entit|player|enemy|npc|character|boss/.test(label)) return "게임플레이(컨트롤러/엔티티) 계층";
  if (/util|common|helper|component|extension/.test(label)) return "공용 유틸/컴포넌트 계층";
  return "기능 모듈";
}

function roleBreakdown(ns: TypeNode[]) {
  const c: Record<string, number> = {};
  for (const n of ns) c[n.unityRole] = (c[n.unityRole] ?? 0) + 1;
  const label: Record<string, string> = {
    MonoBehaviour: "MonoBehaviour", NetworkBehaviour: "NetworkBehaviour", ScriptableObject: "ScriptableObject",
    Data: "일반 클래스", Enum: "enum", Interface: "인터페이스", EditorScript: "에디터 스크립트",
  };
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${label[k] ?? k} ${n}`).join(", ");
}

const callsText = (e: Edge) => (e.calls?.length ? ` (${e.calls.slice(0, 3).map((c) => `\`${c}\``).join(", ")})` : "");

/** 프로젝트 전체 구조 해설 */
export function buildOverview(g: ProjectGraph): { steps: NarrationStep[]; finish: NarrationFinish } {
  const v = new GraphView(g);
  const steps: NarrationStep[] = [];
  const hubs = g.metrics.hubs.filter(v.isClass);

  // 1. 개요
  const traits = projectTraits(g, v);
  steps.push(
    step(
      "overview",
      `전체 구조: ${g.projectName}`,
      [
        `${g.projectName} 은(는) ${g.unityVersion ? `Unity ${g.unityVersion} 프로젝트로, ` : ""}스크립트 ${g.stats.scripts}개에 타입 ${v.nodes.length}개가 있습니다 (${roleBreakdown(v.nodes)}).`,
        traits.length ? `사용 패키지로 보아 **${traits.join(" · ")}** 를 쓰는 프로젝트로 보입니다.` : "",
        `코드는 ${v.top.length}개 모듈(${g.defaultModuleRule === "namespace" ? "네임스페이스" : g.defaultModuleRule === "asmdef" ? "어셈블리" : "폴더"} 기준)로 나뉘어 있고, 가장 많이 참조되는 중심 클래스는 ${list(hubs, 5)} 입니다.`,
        "다이어그램의 모듈 상자를 더블클릭하면 안의 클래스가 펼쳐집니다.",
      ].filter(Boolean).join(" "),
      { nodeIds: hubs.slice(0, 6) },
    ),
  );

  // 2. 계층(모듈)별
  const topMods = [...v.top].sort((a, b) => b.nodeIds.length - a.nodeIds.length).slice(0, 4);
  for (const m of topMods) {
    const ids = v.byFanIn(m.nodeIds.filter(v.isClass));
    const ns = ids.map((id) => v.byId.get(id)!);
    const dep = new Map<string, number>();
    const used = new Map<string, number>();
    for (const id of ids) {
      for (const e of v.out.get(id) ?? []) {
        const t = v.topOf.get(e.target);
        if (t && t.id !== m.id) dep.set(t.label, (dep.get(t.label) ?? 0) + e.weight);
      }
      for (const e of v.inc.get(id) ?? []) {
        const s = v.topOf.get(e.source);
        if (s && s.id !== m.id) used.set(s.label, (used.get(s.label) ?? 0) + e.weight);
      }
    }
    const topK = (mp: Map<string, number>) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `\`${k}\``).join(", ");
    steps.push(
      step(
        "layer",
        `${layerName(m, v)}: ${m.label}`,
        [
          `\`${m.label}\` 모듈에는 타입 ${ids.length}개가 있습니다 (${roleBreakdown(ns)}).`,
          `이 모듈에서 가장 많이 쓰이는 클래스는 ${list(ids, 4)} 입니다.`,
          dep.size ? `주로 ${topK(dep)} 모듈에 의존하고,` : "다른 모듈에 거의 의존하지 않고,",
          used.size ? `${topK(used)} 모듈이 이 모듈을 많이 사용합니다.` : "다른 모듈에서 거의 사용하지 않습니다.",
        ].join(" "),
        { nodeIds: ids.slice(0, 10), moduleIds: [m.id] },
      ),
    );
  }

  // 3. 흐름: Unity 메시지를 가진 진입점에서 강한 의존을 따라감
  const flowKinds: EdgeKind[] = ["usesSingleton", "getsComponent", "instantiates", "subscribes", "references", "callsStatic", "finds", "creates"];
  const entries = v.nodes
    .filter((n) => (n.unityRole === "MonoBehaviour" || n.unityRole === "NetworkBehaviour") && n.methods.some((m) => m.isUnityMessage))
    .sort((a, b) => v.fanOut(b.id) - v.fanOut(a.id))
    .slice(0, 2);
  for (const start of entries) {
    const seq: NarrationStep["sequence"] = [];
    const seen = new Set([start.id]);
    let cur = start.id;
    for (let i = 0; i < 4; i++) {
      const next = (v.out.get(cur) ?? [])
        .filter((e) => flowKinds.includes(e.kind) && v.isClass(e.target) && v.byId.get(e.target)!.kind !== "enum" && !seen.has(e.target))
        // 호출 멤버가 기록된 엣지를 우선
        .sort((a, b) => (b.calls?.length ? 1 : 0) - (a.calls?.length ? 1 : 0) || b.weight - a.weight)[0];
      if (!next) break;
      seq.push({ from: cur, to: next.target, label: `${KIND_SHORT[next.kind]}${next.calls?.length ? ` · ${next.calls.slice(0, 2).join(", ")}` : ""}`, edgeId: next.id });
      seen.add(next.target);
      cur = next.target;
    }
    if (!seq.length) continue;
    const msgs = start.methods.filter((m) => m.isUnityMessage).map((m) => `\`${m.name}\``);
    steps.push(
      step(
        "flow",
        `흐름: ${start.name} 에서 시작`,
        [
          `${code(start.id)} 는 ${msgs.slice(0, 4).join(", ")} 같은 Unity 메시지로 동작을 시작하며, 다른 클래스 ${v.fanOut(start.id)}개에 의존합니다.`,
          "가장 강한 연결을 따라가면:",
          ...seq.map((s, i) => {
            const e = g.edges.find((x) => x.id === s.edgeId)!;
            return `${i + 1}. ${code(s.from)} → ${code(s.to)}${KIND_SENTENCE[e.kind]}${callsText(e)}.`;
          }),
        ].join("\n"),
        { nodeIds: [...seen] },
        seq,
      ),
    );
  }

  // 이벤트 흐름: 구독자가 가장 많은 발행자
  const subs = g.edges.filter((e) => e.kind === "subscribes" && v.isClass(e.source) && v.isClass(e.target));
  const byPublisher = new Map<string, Edge[]>();
  for (const e of subs) byPublisher.set(e.target, [...(byPublisher.get(e.target) ?? []), e]);
  const topPub = [...byPublisher.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topPub) {
    const [pub, es] = topPub;
    const events = [...new Set(es.flatMap((e) => e.calls ?? []))];
    steps.push(
      step(
        "flow",
        `이벤트 흐름: ${short(pub)}`,
        `${code(pub)} 가 ${events.slice(0, 4).map((x) => `\`${x}\``).join(", ")} 이벤트를 발행하면, 이를 구독한 ${list(es.map((e) => e.source), 5)} 가 반응합니다. 발행자는 구독자를 몰라도 되므로 서로 느슨하게 연결됩니다 (옵저버 패턴).`,
        { nodeIds: [pub, ...es.map((e) => e.source)].slice(0, 10), edgeIds: es.slice(0, 8).map((e) => e.id) },
        es.slice(0, 4).map((e) => ({ from: e.source, to: pub, label: `구독 · ${(e.calls ?? []).slice(0, 2).join(", ")}`, edgeId: e.id })),
      ),
    );
  }

  // 4. 패턴
  const singletons = v.byFanIn(v.nodes.filter((n) => n.tags.includes("singleton")).map((n) => n.id));
  const singletonUse = g.edges.filter((e) => e.kind === "usesSingleton");
  if (singletons.length) {
    steps.push(
      step(
        "pattern",
        "패턴: 싱글톤 매니저 / 정적 접근",
        `${list(singletons, 6)} 같은 매니저가 정적 접근(\`.Instance\`, \`Managers.X\` 등)으로 쓰입니다. 이런 접근이 프로젝트 전체에서 ${singletonUse.length}곳에 있습니다. 어디서든 쉽게 부를 수 있는 대신, 많이 쓰일수록 클래스 사이의 결합이 강해지고 초기화 순서(Awake 순서)에 주의해야 합니다.`,
        { nodeIds: singletons.slice(0, 12), edgeIds: singletonUse.slice(0, 10).map((e) => e.id) },
      ),
    );
  }
  const getComp = g.edges.filter((e) => e.kind === "getsComponent").length;
  const coLoc = g.edges.filter((e) => e.kind === "coLocated");
  if (getComp + coLoc.length > 0) {
    const ids = [...new Set(coLoc.slice(0, 6).flatMap((e) => [e.source, e.target]))];
    steps.push(
      step(
        "pattern",
        "패턴: 컴포넌트 조합",
        `Unity 는 상속보다 **조합**을 씁니다. GetComponent 로 다른 컴포넌트를 찾는 곳이 ${getComp}곳, 프리팹/씬에서 같은 GameObject 에 함께 붙어 있는 클래스 쌍이 ${coLoc.length}개입니다.${coLoc[0] ? ` 예: ${code(coLoc[0].source)} + ${code(coLoc[0].target)} (${coLoc[0].evidence[0]?.snippet ?? ""}).` : ""}`,
        { nodeIds: ids, edgeIds: coLoc.slice(0, 6).map((e) => e.id) },
      ),
    );
  }
  const sos = v.byFanIn(v.nodes.filter((n) => n.unityRole === "ScriptableObject").map((n) => n.id));
  if (sos.length) {
    const inst = v.nodes.filter((n) => n.unityRole === "ScriptableObject").reduce((s, n) => s + n.assetInstances, 0);
    steps.push(
      step(
        "pattern",
        "패턴: ScriptableObject 데이터",
        `ScriptableObject 타입 ${sos.length}개(${list(sos, 5)})로 데이터를 코드와 분리합니다. 프로젝트에 이 타입의 에셋이 ${inst}개 있습니다. 아이템·스탯·레시피 같은 값은 코드 수정 없이 에셋에서 바꿀 수 있습니다.`,
        { nodeIds: sos.slice(0, 12) },
      ),
    );
  }
  const net = v.nodes.filter((n) => n.unityRole === "NetworkBehaviour");
  if (net.length) {
    const rpcs = net.flatMap((n) => n.methods.filter((m) => m.isRpc));
    const vars = net.reduce((s, n) => s + n.networkVars.length, 0);
    const busiest = [...net].sort((a, b) => b.methods.filter((m) => m.isRpc).length - a.methods.filter((m) => m.isRpc).length).map((n) => n.id);
    steps.push(
      step(
        "pattern",
        "패턴: 네트워크 (Netcode)",
        `NetworkBehaviour ${net.length}개가 네트워크로 동기화됩니다. RPC 메서드 ${rpcs.length}개(ServerRpc ${rpcs.filter((r) => r.rpcKind === "ServerRpc").length} · ClientRpc ${rpcs.filter((r) => r.rpcKind === "ClientRpc").length} · Rpc ${rpcs.filter((r) => r.rpcKind === "Rpc").length})와 NetworkVariable ${vars}개가 있습니다. 클라이언트가 ServerRpc 로 요청하면 서버가 처리하고 ClientRpc / NetworkVariable 로 결과를 퍼뜨리는 서버 권한 구조입니다. RPC 가 많은 클래스: ${list(busiest, 4)}.`,
        { nodeIds: busiest.slice(0, 12) },
      ),
    );
  }
  // 같은 이름의 중첩 enum State 등은 한 번만
  const states = [...new Map(v.nodes.filter((n) => /State(Machine|Base)?$/.test(n.name) && n.kind !== "enum").map((n) => [n.name, n.id])).values()];
  if (states.length >= 3) {
    steps.push(
      step("pattern", "패턴: 상태 머신", `${list(states, 6)} 처럼 상태별 클래스로 동작을 나누는 상태 머신 구조가 있습니다. 새 동작은 상태 클래스를 추가하는 방식으로 늘릴 수 있습니다.`, { nodeIds: states.slice(0, 12) }),
    );
  }

  // 5. 주의점
  const risks: string[] = [];
  const riskNodes: string[] = [];
  if (g.metrics.cycles.length) {
    const c = g.metrics.cycles[0];
    risks.push(`서로 의존하는 클래스 묶음(순환 참조)이 ${g.metrics.cycles.length}개 있고, 가장 큰 묶음은 ${c.length}개 클래스입니다 (${list(c, 4)}). 한 곳을 고치면 묶음 전체에 영향이 갈 수 있으니, 이벤트나 인터페이스로 방향을 끊는 것을 고려해 보세요.`);
    riskNodes.push(...v.byFanIn(c).slice(0, 8));
  }
  const god = [...v.nodes].sort((a, b) => v.fanOut(b.id) - v.fanOut(a.id))[0];
  if (god && v.fanOut(god.id) >= 15) {
    risks.push(`${code(god.id)} 는 다른 클래스 ${v.fanOut(god.id)}개에 의존하고 메서드가 ${god.methods.length}개입니다. 책임이 많이 몰려 있어 기능별로 나누면 수정이 쉬워집니다.`);
    riskNodes.push(god.id);
  }
  const finds = g.edges.filter((e) => e.kind === "finds");
  if (finds.length) {
    risks.push(`\`FindObjectOfType\` 계열 호출이 ${finds.length}곳 있습니다 (${list([...new Set(finds.map((e) => e.source))], 3)}). 느리고 씬 구성에 의존하므로, 인스펙터 연결이나 등록 방식으로 바꾸면 안전합니다.`);
    riskNodes.push(...finds.map((e) => e.source));
  }
  if (risks.length) steps.push(step("risk", "주의할 점", risks.map((r) => `- ${r}`).join("\n"), { nodeIds: [...new Set(riskNodes)].slice(0, 15) }));

  // 6. 정리
  const reading = [...new Set([...hubs.slice(0, 3), ...entries.map((n) => n.id)])].slice(0, 5).map((id) => v.byId.get(id)!);
  steps.push(
    step(
      "summary",
      "어디부터 읽을까",
      ["처음 코드를 볼 때는 아래 순서를 추천합니다 (많이 참조되는 클래스 → 동작의 시작점):", ...reading.map((n) => `- ${code(n.id)} — \`${n.filePath}\``)].join("\n"),
      { nodeIds: reading.map((n) => n.id) },
    ),
  );

  return {
    steps: steps.map((s, i) => ({ ...s, stepIndex: i })),
    finish: {
      oneLineSummary: `${v.top.length}개 모듈, 중심 클래스는 ${hubs.slice(0, 3).map(short).join(" · ")}.`,
      suggestedQuestions: [],
    },
  };
}

/** 클래스 하나의 설명 */
export function buildNodeExplain(g: ProjectGraph, nodeId: string): { steps: NarrationStep[]; finish: NarrationFinish } {
  const v = new GraphView(g);
  const n = v.byId.get(nodeId);
  if (!n) return { steps: [], finish: { oneLineSummary: "", suggestedQuestions: [] } };
  const out = (v.out.get(n.id) ?? []).filter((e) => e.kind !== "nestedIn" && v.byId.has(e.target));
  const inc = (v.inc.get(n.id) ?? []).filter((e) => e.kind !== "nestedIn");
  const steps: NarrationStep[] = [];

  const roleText: Record<string, string> = {
    MonoBehaviour: "GameObject 에 붙어 동작하는 컴포넌트(MonoBehaviour)",
    NetworkBehaviour: "네트워크로 동기화되는 컴포넌트(NetworkBehaviour)",
    ScriptableObject: "에셋으로 저장되는 데이터(ScriptableObject)",
    Data: "일반 C# 클래스",
    Interface: "인터페이스",
    Enum: "열거형(enum)",
    EditorScript: "에디터 전용 스크립트",
    External: "외부 라이브러리",
  };
  steps.push(
    step(
      "overview",
      `역할: ${n.name}`,
      [
        `${code(n.id)} 는 ${roleText[n.unityRole]}${n.kind === "struct" ? "(struct)" : ""} 입니다.`,
        n.summary ? `주석 설명: "${n.summary}"` : "",
        n.baseTypes.length ? `\`${n.baseTypes.join(", ")}\` 를 상속/구현합니다.` : "",
        n.tags.includes("singleton") ? "정적 접근으로 쓰이는 매니저/싱글톤입니다." : "",
        n.tags.includes("ui") ? "UI 요소를 다룹니다." : "",
        `\`${n.filePath}\` (${n.loc}줄), 메서드 ${n.methods.length}개 · 필드 ${n.fields.length}개.`,
        n.usedIn.length ? `프리팹/씬 ${n.usedIn.length}곳에서 사용됩니다 (${n.usedIn.slice(0, 3).map((p) => `\`${p.split("/").pop()}\``).join(", ")}).` : "",
        n.assetInstances ? `이 타입의 에셋이 ${n.assetInstances}개 있습니다.` : "",
      ].filter(Boolean).join(" "),
      { nodeIds: [n.id], camera: "zoomIn" },
    ),
  );

  const msgs = LIFECYCLE.filter((m) => n.methods.some((x) => x.name === m));
  const rpcs = n.methods.filter((m) => m.isRpc);
  const serialized = n.fields.filter((f) => f.serialized);
  if (msgs.length || rpcs.length || serialized.length || n.networkVars.length) {
    steps.push(
      step(
        "flow",
        "생명주기와 입력",
        [
          msgs.length ? `Unity 가 다음 순서로 호출합니다: ${msgs.map((m) => `\`${m}\`(${LIFECYCLE_NOTE[m]})`).join(" → ")}.` : "Unity 생명주기 메서드는 직접 구현하지 않습니다.",
          rpcs.length ? `네트워크 RPC: ${rpcs.map((r) => `\`${r.name}\`(${r.rpcKind})`).join(", ")}.` : "",
          n.networkVars.length ? `동기화되는 값(NetworkVariable): ${n.networkVars.map((f) => `\`${f.name}\``).join(", ")}.` : "",
          serialized.length ? `인스펙터에서 설정하는 필드 ${serialized.length}개: ${serialized.slice(0, 6).map((f) => `\`${f.name}\``).join(", ")}${serialized.length > 6 ? " …" : ""}.` : "",
        ].filter(Boolean).join("\n"),
        { nodeIds: [n.id], camera: "zoomIn" },
      ),
    );
  }

  if (out.length) {
    const byKind = new Map<EdgeKind, Edge[]>();
    for (const e of out) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
    const order: EdgeKind[] = ["inherits", "implements", "usesSingleton", "getsComponent", "requiresComponent", "subscribes", "instantiates", "creates", "finds", "callsStatic", "wiredInInspector", "coLocated", "references"];
    const lines = order
      .filter((k) => byKind.has(k))
      .map((k) => `- **${KIND_SHORT[k]}**: ${byKind.get(k)!.slice(0, 5).map((e) => `${code(e.target)}${callsText(e)}`).join(", ")}${byKind.get(k)!.length > 5 ? ` 외 ${byKind.get(k)!.length - 5}개` : ""}`);
    const strongest = [...out].sort((a, b) => b.weight - a.weight).slice(0, 4);
    steps.push(
      step(
        "module",
        `이 클래스가 사용하는 것 (${new Set(out.map((e) => e.target)).size}개)`,
        lines.join("\n"),
        { nodeIds: [n.id, ...out.map((e) => e.target)].slice(0, 15), edgeIds: out.slice(0, 15).map((e) => e.id) },
        strongest.map((e) => ({ from: n.id, to: e.target, label: `${KIND_SHORT[e.kind]}${e.calls?.length ? ` · ${e.calls.slice(0, 2).join(", ")}` : ""}`, edgeId: e.id })),
      ),
    );
  }
  if (inc.length) {
    const users = [...new Set(inc.map((e) => e.source))];
    steps.push(
      step(
        "module",
        `이 클래스를 사용하는 곳 (${users.length}개)`,
        inc
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 8)
          .map((e) => `- ${code(e.source)} 가 ${code(n.id)}${KIND_SENTENCE[e.kind]}${callsText(e)}`)
          .join("\n") + (inc.length > 8 ? `\n- 외 ${inc.length - 8}건` : ""),
        { nodeIds: [n.id, ...users].slice(0, 15), edgeIds: inc.slice(0, 15).map((e) => e.id) },
      ),
    );
  }

  const risks: string[] = [];
  if (v.fanOut(n.id) >= 15) risks.push(`의존하는 클래스가 ${v.fanOut(n.id)}개로 많습니다. 기능별로 나누면 수정 영향이 줄어듭니다.`);
  if (v.fanIn(n.id) >= 15) risks.push(`${v.fanIn(n.id)}개 클래스가 이 클래스에 의존합니다. 공개 메서드를 바꾸면 영향 범위가 큽니다.`);
  if (g.metrics.cycles.some((c) => c.includes(n.id))) risks.push("순환 참조 묶음에 속해 있습니다.");
  if (out.some((e) => e.kind === "finds")) risks.push("`FindObjectOfType` 계열로 다른 오브젝트를 찾습니다 — 씬 구성이 바뀌면 깨질 수 있습니다.");
  const subsOut = out.filter((e) => e.kind === "subscribes");
  if (subsOut.length && !n.methods.some((m) => m.name === "OnDisable" || m.name === "OnDestroy")) {
    risks.push("이벤트를 구독하지만 `OnDisable`/`OnDestroy` 가 없습니다 — 구독 해제를 확인하세요.");
  }
  if (risks.length) steps.push(step("risk", "주의할 점", risks.map((r) => `- ${r}`).join("\n"), { nodeIds: [n.id] }));

  return {
    steps: steps.map((s, i) => ({ ...s, stepIndex: i })),
    finish: { oneLineSummary: "", suggestedQuestions: [] },
  };
}
