// 서버와 웹이 공유하는 그래프 모델 (SPEC 4.2 / 4.6).
// web/src/types.ts 는 이 파일을 그대로 re-export 한다.

export type TypeKind = "class" | "struct" | "interface" | "enum" | "record";

export type UnityRole =
  | "MonoBehaviour"
  | "NetworkBehaviour"
  | "ScriptableObject"
  | "EditorScript"
  | "Interface"
  | "Data"
  | "Enum"
  | "External";

/** 역할과 중첩되는 표시용 태그 (SPEC 4.3 의 Singleton/Manager, UI) */
export type RoleTag = "singleton" | "ui" | "library";

export interface Member {
  name: string;
  type: string;
  access: string; // public / private / protected / internal
  isStatic: boolean;
  serialized?: boolean; // [SerializeField] 또는 직렬화되는 public 필드
  line: number;
  /** partial 클래스에서 다른 파일에 선언된 경우 그 파일 */
  filePath?: string;
}

export interface MethodInfo {
  name: string;
  returnType: string;
  params: { name: string; type: string }[];
  access: string;
  isStatic: boolean;
  isUnityMessage: boolean;
  isRpc: boolean;
  rpcKind?: "ServerRpc" | "ClientRpc" | "Rpc";
  isAsync: boolean;
  isOverride: boolean;
  line: number;
  filePath?: string;
}

export interface TypeNode {
  id: string;
  name: string;
  namespace?: string;
  kind: TypeKind;
  modifiers: string[];
  filePath: string; // 프로젝트 루트 기준 (예: Assets/1_Scripts/Foo.cs)
  folder: string; // Assets 기준 폴더 (예: 1_Scripts/Controllers/Player)
  lineStart: number;
  lineEnd: number;
  baseTypes: string[];
  unityRole: UnityRole;
  tags: RoleTag[];
  attributes: string[];
  fields: Member[];
  properties: Member[];
  methods: MethodInfo[];
  events: Member[];
  networkVars: Member[];
  summary?: string;
  loc: number;
  outerId?: string;
  /** 프리팹/씬/에셋에서의 사용처 (Assets 기준 경로) */
  usedIn: string[];
  /** ScriptableObject 인스턴스(.asset) 개수 */
  assetInstances: number;
}

export type EdgeKind =
  | "inherits"
  | "implements"
  | "nestedIn"
  | "references"
  | "getsComponent"
  | "requiresComponent"
  | "usesSingleton"
  | "finds"
  | "creates"
  | "instantiates"
  | "subscribes"
  | "callsStatic"
  | "coLocated"
  | "wiredInInspector";

export interface Evidence {
  filePath: string;
  line: number;
  snippet: string;
}

export interface Edge {
  id: string; // `${kind}:${source}->${target}`
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  multiplicity?: "one" | "many";
  serialized?: boolean;
  /** source 가 target 에서 호출하는 메서드/멤버 이름 (references/usesSingleton/callsStatic) */
  calls?: string[];
  evidence: Evidence[];
}

export type ModuleRule = "feature" | "asmdef" | "namespace" | "folder";

export interface Module {
  id: string; // "module:Controllers" / "module:Controllers/Player"
  label: string;
  rule: ModuleRule;
  parent?: string;
  nodeIds: string[]; // 이 모듈(하위 모듈 포함)에 속한 모든 노드
}

export interface AssetUsage {
  path: string; // Assets 기준
  scripts: string[]; // TypeNode id
}

export interface ProjectGraph {
  graphId: string;
  projectName: string;
  projectRoot: string;
  /** GitHub 에서 가져온 경우 */
  source?: { kind: "github"; url: string; branch: string; commit: string; subPath: string };
  unityVersion?: string;
  packages: string[];
  analyzedAt: string;
  contentHash: string;
  scriptRoot: string;
  nodes: TypeNode[];
  edges: Edge[];
  /** SPEC 규칙(asmdef → namespace → folder)으로 고른 기본 모듈 */
  modules: Module[];
  defaultModuleRule: ModuleRule;
  /** 모든 규칙의 모듈 (UI에서 전환) */
  modulesByRule: Partial<Record<ModuleRule, Module[]>>;
  assets: { prefabs: AssetUsage[]; scenes: AssetUsage[]; scriptableAssets: AssetUsage[] };
  metrics: {
    fanIn: Record<string, number>;
    fanOut: Record<string, number>;
    cycles: string[][];
    hubs: string[];
  };
  warnings: string[];
  unresolved: { from: string; typeName: string; filePath: string; line: number }[];
  stats: { scripts: number; prefabs: number; scenes: number; assets: number; durationMs: number };
  /** 플러그인(서드파티)으로 판단해 분석에서 뺀 폴더 */
  plugins?: { path: string; scripts: number; reason: string }[];
}

// ───────── AI 해설 (SPEC 5.3) ─────────

export type StepType = "overview" | "layer" | "module" | "flow" | "pattern" | "risk" | "summary";

export interface NarrationStep {
  stepIndex: number;
  type: StepType;
  title: string;
  markdown: string;
  focus: {
    nodeIds: string[];
    edgeIds: string[];
    moduleIds: string[];
    camera: "fit" | "zoomIn" | "zoomOut";
  };
  sequence: { from: string; to: string; label: string; edgeId: string }[];
}

export interface NarrationFinish {
  oneLineSummary: string;
  suggestedQuestions: string[];
}

export interface AnalyzeOptions {
  projectPath: string;
  excludeGlobs?: string[];
  /** 플러그인 폴더 자동 제외 (기본 true) */
  autoExcludePlugins?: boolean;
}
