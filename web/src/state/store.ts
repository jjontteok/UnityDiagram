import { create } from "zustand";
import { streamPost } from "../api/client";
import type { EdgeKind, Module, ModuleRule, NarrationFinish, NarrationStep, ProjectGraph, TypeNode, UnityRole } from "../types";

export type ViewMode = "module" | "all" | "inherit" | "neighbor";
export type Selection = { kind: "node" | "edge" | "module"; id: string } | null;
export type GuideKind = "narrate" | "explain-node";

export interface NarrationSession {
  id: string;
  kind: GuideKind;
  title: string;
  target?: string;
  steps: NarrationStep[];
  finish?: NarrationFinish & { cached?: boolean };
  status: "streaming" | "done" | "error";
  error?: string;
  progress?: string;
  draft?: { stepIndex: number; title: string; markdown: string };
  cached?: boolean;
}

export const ROLES: UnityRole[] = ["MonoBehaviour", "NetworkBehaviour", "ScriptableObject", "Data", "Interface", "Enum", "EditorScript", "External"];
export const EDGE_KINDS: EdgeKind[] = [
  "inherits", "implements", "references", "getsComponent", "requiresComponent", "usesSingleton", "subscribes",
  "creates", "instantiates", "finds", "callsStatic", "coLocated", "wiredInInspector", "nestedIn",
];
export const EDGE_LABEL: Record<EdgeKind, string> = {
  inherits: "상속",
  implements: "인터페이스 구현",
  references: "참조",
  getsComponent: "GetComponent",
  requiresComponent: "RequireComponent",
  usesSingleton: "싱글톤(.Instance)",
  subscribes: "이벤트 구독",
  creates: "new 생성",
  instantiates: "Instantiate",
  finds: "FindObjectOfType",
  callsStatic: "정적 호출",
  coLocated: "같은 GameObject",
  wiredInInspector: "인스펙터 연결",
  nestedIn: "중첩 타입",
};

const DEFAULT_EDGE_FILTER = Object.fromEntries(EDGE_KINDS.map((k) => [k, k !== "nestedIn"])) as Record<EdgeKind, boolean>;
const DEFAULT_ROLE_FILTER = Object.fromEntries(ROLES.map((r) => [r, r !== "External"])) as Record<UnityRole, boolean>;

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

interface State {
  graph: ProjectGraph | null;
  nodeById: Map<string, TypeNode>;
  moduleRule: ModuleRule;
  viewMode: ViewMode;
  expanded: string[];
  hops: number;
  neighborRoot: string | null;
  roleFilter: Record<UnityRole, boolean>;
  edgeFilter: Record<EdgeKind, boolean>;
  selection: Selection;
  panelTab: "detail" | "ai" | "help";
  sessions: NarrationSession[];
  activeSessionId: string | null;
  stepIndex: number;
  playing: boolean;
  narrationActive: boolean;
  code: { filePath: string; line: number } | null;
  theme: "light" | "dark";
  toast: { text: string; kind: "info" | "warn" | "error" } | null;
  /** 확대하지 않아도 모든 클래스의 멤버 목록을 보여줄지 */
  detailAlways: boolean;

  loadGraph(g: ProjectGraph): void;
  closeProject(): void;
  setModuleRule(r: ModuleRule): void;
  setViewMode(m: ViewMode): void;
  toggleExpanded(moduleId: string): void;
  setExpanded(ids: string[]): void;
  ensureVisible(nodeIds: string[]): void;
  setHops(n: number): void;
  setNeighborRoot(id: string | null): void;
  toggleRole(r: UnityRole): void;
  toggleEdgeKind(k: EdgeKind): void;
  select(s: Selection): void;
  setPanelTab(t: "detail" | "ai" | "help"): void;
  setStep(i: number): void;
  setPlaying(p: boolean): void;
  endNarration(): void;
  setActiveSession(id: string): void;
  startGuide(kind: GuideKind, params: { nodeId?: string }): void;
  stopGuide(): void;
  openCode(filePath: string, line: number): void;
  closeCode(): void;
  toggleTheme(): void;
  toggleDetailAlways(): void;
  showToast(text: string, kind?: "info" | "warn" | "error"): void;
}

export const modulesOf = (g: ProjectGraph | null, rule: ModuleRule): Module[] => (g ? g.modulesByRule[rule] ?? g.modules : []);

let guideAbort: AbortController | null = null;
let toastTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  graph: null,
  nodeById: new Map(),
  moduleRule: "folder",
  viewMode: "module",
  expanded: [],
  hops: 1,
  neighborRoot: null,
  roleFilter: DEFAULT_ROLE_FILTER,
  edgeFilter: DEFAULT_EDGE_FILTER,
  selection: null,
  panelTab: "detail",
  sessions: [],
  activeSessionId: null,
  stepIndex: 0,
  playing: false,
  narrationActive: false,
  code: null,
  theme: readLocal<"light" | "dark">("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  toast: null,
  detailAlways: readLocal("detailAlways", false),


  loadGraph: (g) => {
    const prefs = readLocal<{ moduleRule?: ModuleRule }>(`prefs:${g.projectRoot}`, {});
    const rule = prefs.moduleRule && g.modulesByRule[prefs.moduleRule] ? prefs.moduleRule : g.defaultModuleRule;
    guideAbort?.abort();
    set({
      graph: g,
      nodeById: new Map(g.nodes.map((n) => [n.id, n])),
      moduleRule: rule,
      viewMode: "module",
      expanded: [],
      neighborRoot: null,
      selection: null,
      sessions: [],
      activeSessionId: null,
      stepIndex: 0,
      playing: false,
      narrationActive: false,
      panelTab: "detail",
    });
    writeLocal("lastGraph", g.graphId);
  },

  closeProject: () => {
    guideAbort?.abort();
    writeLocal("lastGraph", null);
    set({ graph: null, sessions: [], selection: null, narrationActive: false });
  },

  setModuleRule: (r) => {
    const g = get().graph;
    if (g) writeLocal(`prefs:${g.projectRoot}`, { moduleRule: r });
    set({ moduleRule: r, expanded: [] });
  },

  setViewMode: (m) => {
    const { graph, moduleRule, selection } = get();
    if (m === "all" && graph) {
      const mods = modulesOf(graph, moduleRule);
      if (graph.nodes.length > 150) {
        // 노드가 많으면 상위 모듈만 펼친 상태로 시작 (SPEC 7.2)
        set({ viewMode: "all", expanded: mods.filter((x) => !x.parent).map((x) => x.id) });
        get().showToast(`노드가 ${graph.nodes.length}개라 하위 모듈은 접힌 상태로 시작합니다. 모듈을 더블클릭해 펼치세요.`, "warn");
        return;
      }
      set({ viewMode: "all", expanded: mods.map((x) => x.id) });
      return;
    }
    if (m === "neighbor") {
      const root = selection?.kind === "node" ? selection.id : get().neighborRoot ?? graph?.metrics.hubs[0] ?? null;
      set({ viewMode: m, neighborRoot: root });
      return;
    }
    set({ viewMode: m, expanded: m === "module" ? [] : get().expanded });
  },

  toggleExpanded: (id) => {
    const ex = new Set(get().expanded);
    if (ex.has(id)) {
      ex.delete(id);
      // 상위를 접으면 하위도 접는다
      for (const m of modulesOf(get().graph, get().moduleRule)) if (m.parent === id) ex.delete(m.id);
    } else ex.add(id);
    set({ expanded: [...ex] });
  },

  setExpanded: (ids) => set({ expanded: ids }),

  ensureVisible: (nodeIds) => {
    const { graph, moduleRule, viewMode, roleFilter } = get();
    if (!graph) return;
    const roles = new Set(nodeIds.map((id) => get().nodeById.get(id)?.unityRole).filter(Boolean) as UnityRole[]);
    const hiddenRoles = [...roles].filter((r) => !roleFilter[r]);
    if (hiddenRoles.length) set({ roleFilter: { ...roleFilter, ...Object.fromEntries(hiddenRoles.map((r) => [r, true])) } });
    if (viewMode === "inherit" || viewMode === "neighbor") {
      if (viewMode === "neighbor" && nodeIds.length) {
        const root = get().neighborRoot;
        if (!root || !nodeIds.includes(root)) set({ viewMode: "module" });
        else return;
      } else if (viewMode === "inherit") {
        const inh = new Set(graph.edges.filter((e) => e.kind === "inherits" || e.kind === "implements").flatMap((e) => [e.source, e.target]));
        if (nodeIds.every((id) => inh.has(id))) return;
        set({ viewMode: "module" });
      }
    }
    const ex = new Set(get().expanded);
    for (const m of modulesOf(graph, moduleRule)) if (nodeIds.some((id) => m.nodeIds.includes(id))) ex.add(m.id);
    set({ expanded: [...ex] });
  },

  setHops: (n) => set({ hops: n }),
  setNeighborRoot: (id) => set({ neighborRoot: id }),
  toggleRole: (r) => set({ roleFilter: { ...get().roleFilter, [r]: !get().roleFilter[r] } }),
  toggleEdgeKind: (k) => set({ edgeFilter: { ...get().edgeFilter, [k]: !get().edgeFilter[k] } }),
  select: (s) => set({ selection: s, panelTab: s && !get().narrationActive ? "detail" : get().panelTab }),
  setPanelTab: (t) => set({ panelTab: t }),
  setStep: (i) => {
    const s = get().sessions.find((x) => x.id === get().activeSessionId);
    if (!s || !s.steps.length) return;
    set({ stepIndex: Math.max(0, Math.min(i, s.steps.length - 1)), narrationActive: true });
  },
  setPlaying: (p) => set({ playing: p, narrationActive: p || get().narrationActive }),
  endNarration: () => set({ narrationActive: false, playing: false }),
  setActiveSession: (id) => set({ activeSessionId: id, stepIndex: 0, narrationActive: true, panelTab: "ai" }),

  startGuide: (kind, params) => {
    const { graph } = get();
    if (!graph) return;
    guideAbort?.abort();
    const ctrl = new AbortController();
    guideAbort = ctrl;
    const id = `${Date.now()}`;
    const node = params.nodeId ? get().nodeById.get(params.nodeId) : undefined;
    const title = kind === "narrate" ? "전체 구조 해설" : `${node?.name ?? params.nodeId} 설명`;
    const session: NarrationSession = { id, kind, title, target: params.nodeId, steps: [], status: "streaming", progress: "구조를 정리하는 중…" };
    set({ sessions: [session, ...get().sessions.filter((s) => s.status !== "streaming")].slice(0, 20), activeSessionId: id, stepIndex: 0, panelTab: "ai", narrationActive: true, playing: false });

    const patch = (fn: (s: NarrationSession) => Partial<NarrationSession>) =>
      set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, ...fn(s) } : s)) });

    const url = kind === "narrate" ? "/api/guide/narrate" : "/api/guide/explain-node";
    streamPost(
      url,
      { graphId: graph.graphId, nodeId: params.nodeId },
      (event, data) => {
        switch (event) {
          case "progress":
            patch(() => ({ progress: data.message, cached: data.cached ?? false }));
            break;
          case "draft":
            patch(() => ({ draft: data }));
            break;
          case "step": {
            const before = get().sessions.find((s) => s.id === id);
            // 사용자가 마지막 단계를 보고 있었다면 새 단계로 따라간다 (실시간 따라가기)
            const following = get().activeSessionId === id && (before?.steps.length ?? 0) - 1 <= get().stepIndex;
            patch((s) => ({ steps: [...s.steps, data], draft: undefined }));
            if (following && get().narrationActive) set({ stepIndex: (before?.steps.length ?? 0) });
            break;
          }
          case "finish":
            patch(() => ({ finish: data, status: "done", progress: undefined, draft: undefined }));
            break;
          case "error":
            patch(() => ({ status: "error", error: data.message, progress: undefined, draft: undefined }));
            break;
        }
      },
      ctrl.signal,
    )
      .then(() => {
        const s = get().sessions.find((x) => x.id === id);
        if (s?.status === "streaming") patch(() => ({ status: s.steps.length ? "done" : "error", error: s.steps.length ? undefined : "응답이 비어 있습니다", progress: undefined }));
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted) {
          patch((s) => ({ status: s.steps.length ? "done" : "error", error: s.steps.length ? undefined : "중단됨", progress: undefined, draft: undefined }));
          return;
        }
        patch(() => ({ status: "error", error: e.message, progress: undefined }));
      });
  },

  stopGuide: () => guideAbort?.abort(),
  openCode: (filePath, line) => set({ code: { filePath, line } }),
  closeCode: () => set({ code: null }),
  toggleDetailAlways: () => {
    const v = !get().detailAlways;
    writeLocal("detailAlways", v);
    set({ detailAlways: v });
  },
  toggleTheme: () => {
    const t = get().theme === "dark" ? "light" : "dark";
    writeLocal("theme", t);
    set({ theme: t });
  },
  showToast: (text, kind = "info") => {
    window.clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 5000);
  },
}));

export const activeSession = (s: State) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null;
export const currentStep = (s: State): NarrationStep | null => {
  const sess = activeSession(s);
  return s.narrationActive && sess ? sess.steps[s.stepIndex] ?? null : null;
};
