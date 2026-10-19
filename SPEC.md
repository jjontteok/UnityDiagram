# Unity 클래스 다이어그램 뷰어 — 구현 명세서 (AI 빌드용)

> **이 문서의 용도**
> 이 문서는 AI 코딩 에이전트(Claude Code 등)가 읽고 **그대로 구현할 수 있도록** 작성된 명세서입니다.
> 구현 에이전트는 이 문서의 모든 "필수(MUST)" 항목을 충족해야 하며, "권장(SHOULD)" 항목은 가능한 한 구현합니다.
> 모호한 부분은 이 문서의 [11. 결정 기본값](#11-결정-기본값-모호할-때-따를-규칙) 을 따릅니다.

---

## 0. 한 줄 요약

로컬에 있는 **Unity 프로젝트 폴더를 지정**하면, C# 스크립트·프리팹·씬을 **정적 분석**해서 클래스 그래프를 만들고,
**"클래스 다이어그램 보기"** 버튼을 누르면 **AI가 그래프를 해석**하면서
"이 프로젝트는 어떤 계층으로 이루어져 있고, 각 클래스가 어떻게 상호작용하는지"를
**다이어그램을 하이라이트하며 단계별로 설명(가이드 투어)** 해 주는 **로컬 웹앱**.

---

## 1. 목표 / 비목표

### 1.1 목표 (MUST)
1. 임의의 Unity 프로젝트 경로(예: `C:\Users\...\MeowTruck`)를 입력받아 `Assets/` 하위 C# 코드를 분석한다.
2. 클래스·인터페이스·enum·struct 와 그들 사이의 관계(상속, 구현, 참조, 생성, 이벤트, 컴포넌트 의존 등)를 그래프로 만든다.
3. 그래프를 웹 브라우저에서 **인터랙티브 다이어그램**으로 보여준다 (줌/팬/검색/필터/노드 클릭 상세).
4. **"클래스 다이어그램 보기"** 버튼을 누르면 AI가:
   - 프로젝트 전체 아키텍처를 **계층(Layer)/모듈** 단위로 요약하고,
   - 핵심 클래스와 **상호작용 흐름(시나리오)** 을 설명하며,
   - 설명하는 단계마다 다이어그램의 해당 노드/엣지를 **하이라이트 + 카메라 이동**한다.
   - 결과는 **스트리밍**으로 점진적으로 표시된다 ("AI가 돌면서 설명하는" 느낌).
5. 로컬 전용. 외부로 나가는 네트워크는 **AI API 호출 하나뿐**이다.

### 1.2 비목표
- Unity 에디터 플러그인으로 만들지 않는다 (독립 웹앱).
- 코드 수정/리팩터링 기능 없음 (읽기 전용).
- 완전한 C# 컴파일러 수준의 타입 해석은 하지 않는다 (휴리스틱 허용, 단 [4.4](#44-정확도-원칙) 원칙 준수).
- 인증/멀티유저/배포 없음.

---

## 2. 사용자 시나리오

```
1) 터미널에서 `npm run dev` (또는 `start.bat`) 실행 → 브라우저 http://localhost:5173 자동 오픈
2) 첫 화면: "Unity 프로젝트 경로" 입력창 + [분석 시작] 버튼
   - 최근 사용 경로 목록 표시 (로컬 저장)
3) [분석 시작] → 진행률 바 ("스크립트 188개 파싱 중… 프리팹 42개 스캔 중…")
4) 분석 완료 → 좌측: 폴더/네임스페이스 트리, 중앙: 다이어그램(기본: 모듈 요약 뷰), 우측: 상세 패널
5) 상단의 큰 버튼 [🧭 클래스 다이어그램 보기] 클릭
   → 우측 패널이 "AI 해설" 탭으로 전환, 텍스트가 스트리밍으로 출력
   → 각 단계(Step)가 도착할 때마다 다이어그램이 해당 영역으로 줌 & 하이라이트
   → 하단에 [◀ 이전] [▶ 다음] [⏸ 자동재생] 컨트롤
6) 해설 중 노드를 클릭하면 "이 클래스에 대해 더 설명해줘" 버튼 → 해당 클래스 심화 해설 (AI)
7) 자유 질문 입력창: "플레이어가 아이템을 주우면 어떤 클래스들이 호출돼?" → AI 답변 + 관련 노드 하이라이트
8) 결과는 캐시되어, 코드가 바뀌지 않았다면 다음 실행 시 AI 재호출 없이 즉시 표시
```

---

## 3. 시스템 아키텍처

```
┌──────────────────────── Browser (React SPA) ─────────────────────────┐
│  ProjectPicker │ DiagramCanvas (Cytoscape.js) │ SidePanel(상세/AI해설) │
│                         ▲  highlight(ids)                ▲ SSE stream │
└─────────────────────────┼────────────────────────────────┼────────────┘
                          │ REST / SSE (localhost only)    │
┌─────────────────────────┴────────────────────────────────┴────────────┐
│                     Local Server (Node.js + Fastify)                  │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │ Scanner    │→ │ C# Parser    │→ │ Graph       │→ │ AI Narrator  │──┼──► Claude API
│  │ (fs walk)  │  │ (tree-sitter)│  │ Builder     │  │ (prompt+SSE) │  │
│  └────────────┘  └──────────────┘  └─────────────┘  └──────────────┘  │
│  ┌────────────┐                    ┌─────────────┐                    │
│  │ Unity YAML │ (prefab/scene/meta)│ Cache       │ (.cache/*.json)    │
│  │ Scanner    │──────────────────► │ (hash 기반) │                    │
│  └────────────┘                    └─────────────┘                    │
└───────────────────────────────────────────────────────────────────────┘
```

**왜 서버가 필요한가:** 브라우저는 로컬 파일시스템을 자유롭게 읽을 수 없고, AI API 키를 브라우저에 노출하면 안 되기 때문. 서버는 `127.0.0.1` 에만 바인딩한다 (MUST).

### 3.1 기술 스택 (기본값)

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | Node.js 20+ / TypeScript | 모노레포 1개 (`server/`, `web/`) |
| 서버 | Fastify | REST + SSE |
| C# 파싱 | `web-tree-sitter` + `tree-sitter-c-sharp` (WASM) | 네이티브 빌드 불필요 → Windows에서 설치 쉬움 |
| Unity YAML | 직접 정규식/라인 파서 | Unity YAML은 표준 YAML 파서로 깨지는 경우가 많음 (`--- !u!114 &123` 태그) |
| 프론트 | Vite + React + TypeScript | |
| 다이어그램 | **Cytoscape.js** + `cytoscape-elk` (레이아웃) + `cytoscape-expand-collapse` | 수백 노드 처리, 하이라이트/애니메이션 용이 |
| 보조 출력 | Mermaid `classDiagram` 텍스트 내보내기 | 문서 붙여넣기용 |
| 마크다운 렌더 | `react-markdown` | AI 해설 표시 |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) | 모델 기본값 `claude-sonnet-5-5`, 심화/전체 해설은 `claude-opus-5-5` 선택 가능 |
| 설정 | `.env` (`ANTHROPIC_API_KEY`, `AI_MODEL`, `PORT`) | `.env.example` 제공 |

---

## 4. 분석 파이프라인 (서버)

### 4.1 스캔 대상

| 대상 | 경로 규칙 | 용도 |
|---|---|---|
| C# 스크립트 | `Assets/**/*.cs` | 클래스/관계 추출 |
| 메타 파일 | `Assets/**/*.cs.meta` | `guid` → 스크립트 매핑 |
| 프리팹 | `Assets/**/*.prefab` | 어떤 컴포넌트들이 **같은 GameObject에 붙어 있는지** |
| 씬 | `Assets/**/*.unity` | 씬별로 사용되는 스크립트 |
| ScriptableObject 에셋 | `Assets/**/*.asset` | SO 인스턴스가 어떤 스크립트 타입인지 |
| asmdef | `Assets/**/*.asmdef` | 어셈블리 경계(모듈) |

**제외 (MUST):** `Library/`, `Temp/`, `Logs/`, `obj/`, `Packages/`, `Assets/Plugins/**`, `Assets/TextMesh Pro/**`, 그리고 사용자가 설정한 제외 glob.
제외 목록은 UI의 "설정"에서 편집 가능 (SHOULD). 서드파티 폴더(예: `Assets/Plugins`)는 "외부 라이브러리" 노드로 묶어서 참조만 표시.

### 4.2 C# 에서 추출할 정보

각 타입 선언(class / struct / interface / enum / record)마다:

```ts
interface TypeNode {
  id: string;                 // "Namespace.Outer.Name" (네임스페이스 없으면 "Name"), 제네릭은 "Name`1"
  name: string;
  namespace?: string;
  kind: "class" | "struct" | "interface" | "enum" | "record";
  modifiers: string[];        // abstract, sealed, static, partial
  filePath: string;           // Assets/ 기준 상대경로
  folder: string;             // 예: "1_Scripts/Controllers/Player"
  lineStart: number; lineEnd: number;
  baseTypes: string[];        // 원문 그대로 (해석 전)
  unityRole: UnityRole;       // 아래 4.3
  attributes: string[];       // [RequireComponent(typeof(X))], [CreateAssetMenu], [Serializable] ...
  fields: Member[];           // 이름, 타입, 접근자, [SerializeField] 여부, static 여부
  properties: Member[];
  methods: MethodInfo[];      // 이름, 반환형, 파라미터, 접근자, isUnityMessage, isRpc
  events: Member[];           // event / UnityEvent / Action / Func 필드
  summary?: string;           // /// <summary> XML 주석
  loc: number;
}
```

**메서드 본문에서 추출할 "사용(usage)" 패턴** — 관계 엣지의 근거가 됨:

| 패턴 | 예시 | 엣지 종류 |
|---|---|---|
| `GetComponent<T>()`, `GetComponentInChildren<T>`, `TryGetComponent(out T)`, `AddComponent<T>` | `GetComponent<Rigidbody2D>()` | `getsComponent` |
| `FindObjectOfType<T>`, `FindFirstObjectByType<T>`, `FindAnyObjectByType<T>` | | `finds` |
| 싱글톤 접근 `X.Instance` / `X.Singleton` / `X.I` | `DungeonManager.Instance.SpawnRoom()` | `usesSingleton` |
| `new T(...)` | | `creates` |
| `Instantiate(prefab)` 결과를 `T`로 받거나 `.GetComponent<T>()` 체인 | | `instantiates` |
| 이벤트 구독 `a.OnX += Handler` / `AddListener` | | `subscribes` (구독자 → 발행자) |
| 이벤트 발행 `OnX?.Invoke()` | | (발행자 노드 메타데이터) |
| 정적 메서드 호출 `T.Method()` | | `callsStatic` |
| 필드/프로퍼티/파라미터 타입 | `[SerializeField] PlayerController player;` | `references` (`serialized: true` 표시) |
| Netcode RPC `[ServerRpc]`, `[ClientRpc]`, `[Rpc(...)]` | | 메서드 메타 `isRpc` + 방향 |
| `NetworkVariable<T>` 필드 | | 노드 메타 `networkVars[]` |
| `StartCoroutine` / `async UniTask` | | 메서드 메타 `isAsync` |

### 4.3 Unity 역할(UnityRole) 분류

베이스 타입 체인과 어트리뷰트를 따라 아래 중 하나를 부여 (다이어그램 색상·아이콘·AI 해설의 핵심):

| UnityRole | 판정 규칙 | 색상 |
|---|---|---|
| `MonoBehaviour` | 체인에 `MonoBehaviour` | 파랑 |
| `NetworkBehaviour` | 체인에 `NetworkBehaviour` (Netcode for GameObjects) | 남색 |
| `ScriptableObject` | 체인에 `ScriptableObject` | 초록 |
| `EditorScript` | `Editor/` 폴더 또는 `UnityEditor` 상속 (`Editor`, `EditorWindow`, `PropertyDrawer`) | 회색 |
| `Singleton/Manager` | 위 역할 + (`static Instance` 보유 또는 `Singleton<T>` 상속 또는 이름이 `*Manager`) | 빨강 테두리 (다른 역할과 **중첩** 표시) |
| `UI` | `UnityEngine.UI` / `TMPro` 필드 사용 또는 `UI/` 폴더 | 보라 |
| `Interface` | `interface` | 점선 테두리 |
| `Data/POCO` | 위에 해당 없는 class/struct/record | 노랑 |
| `Enum` | enum | 연회색 |
| `External` | 프로젝트 밖 타입 (Unity API, 플러그인) | 노드로 만들지 않음 (옵션으로 표시) |

> 판정 시 **사용자 정의 중간 베이스 클래스**도 따라가야 한다 (예: `NormalRoom : DungeonRoomBase : MonoBehaviour` → `NormalRoom` 은 MonoBehaviour).

### 4.4 정확도 원칙

- 타입 이름 해석: 같은 파일의 `using`, 네임스페이스, 프로젝트 내 타입 테이블로 해석. 해석 실패 시 **엣지를 만들지 않고** `unresolved[]` 에 기록 (MUST). 추측으로 엣지를 만들지 않는다.
- 모든 엣지는 **근거(evidence)** 를 가진다: `{ filePath, line, snippet(1줄) }` 최대 5개. UI와 AI 모두 이 근거를 사용.
- `partial class` 는 하나의 노드로 병합.
- 중첩 클래스는 별도 노드 + `nestedIn` 엣지.
- 제네릭 인자(`List<Enemy>`, `Dictionary<int, Item>`)도 내부 타입을 참조로 인식, `multiplicity: "many"` 표시.

### 4.5 Unity YAML 스캔 (프리팹/씬/에셋)

1. 모든 `*.cs.meta` 에서 `guid:` 읽어 `guid → TypeNode.id` 맵 생성 (파일명 = 클래스명 규칙 이용).
2. `.prefab` / `.unity` 파일에서 `--- !u!114 &<fileID>` (MonoBehaviour 블록) 의 `m_Script: {fileID: 11500000, guid: <guid>, type: 3}` 를 읽어 스크립트 식별.
3. 같은 `m_GameObject: {fileID: X}` 를 공유하는 컴포넌트끼리 묶음 → **`coLocated` 엣지** (같은 GameObject에 함께 붙는 관계).
4. 프리팹/씬별 사용 스크립트 목록 저장 → 노드 상세에 "사용처: 1_Room.prefab, 0_InitScene.unity".
5. `.asset` 에서 SO 인스턴스 → 해당 SO 타입 노드에 "인스턴스 N개" 표시.
6. 직렬화 필드에 다른 오브젝트가 연결된 경우(`fieldName: {fileID: ..., guid: ...}`)는 **SHOULD**: 인스펙터 연결 관계(`wiredInInspector` 엣지)로 표시.

> 파일이 크거나(>5MB) 파싱 실패해도 전체 분석은 계속한다. 경고만 남긴다.

### 4.6 그래프 모델 (서버 → 클라이언트)

```ts
type EdgeKind =
  | "inherits" | "implements" | "nestedIn"
  | "references" | "getsComponent" | "requiresComponent"
  | "usesSingleton" | "finds" | "creates" | "instantiates"
  | "subscribes" | "callsStatic" | "coLocated" | "wiredInInspector";

interface Edge {
  id: string;                 // `${kind}:${source}->${target}`
  source: string; target: string;
  kind: EdgeKind;
  weight: number;             // 근거 개수
  multiplicity?: "one" | "many";
  serialized?: boolean;
  evidence: { filePath: string; line: number; snippet: string }[];
}

interface Module {             // 다이어그램의 "묶음" (compound node)
  id: string;                  // "module:Controllers/Player"
  label: string;
  rule: "asmdef" | "namespace" | "folder";
  nodeIds: string[];
}

interface ProjectGraph {
  projectName: string;
  unityVersion?: string;       // ProjectSettings/ProjectVersion.txt
  packages: string[];          // Packages/manifest.json dependencies 키
  analyzedAt: string;
  contentHash: string;         // 모든 입력 파일 해시 → 캐시 키
  nodes: TypeNode[];
  edges: Edge[];
  modules: Module[];
  assets: { prefabs: AssetUsage[]; scenes: AssetUsage[]; scriptableAssets: AssetUsage[] };
  metrics: { fanIn: Record<string, number>; fanOut: Record<string, number>; cycles: string[][] };
  warnings: string[];
  unresolved: { from: string; typeName: string; filePath: string; line: number }[];
}
```

**모듈 묶음 규칙 (우선순위):** asmdef 가 있으면 asmdef → 없으면 네임스페이스 → 없으면 `Assets/<스크립트루트>/<1단계>/<2단계>` 폴더.
(예: MeowTruck 처럼 `1_Scripts/Controllers/Player` 구조면 1단계=`Controllers` 가 상위 모듈, 2단계=`Player` 가 하위 모듈)

**지표:** fan-in/fan-out, 순환 참조(Tarjan SCC), "허브 클래스" 상위 10개(fan-in 기준). AI 프롬프트에 함께 전달.

---

## 5. AI 해설 기능 ("클래스 다이어그램 보기")

### 5.1 핵심 아이디어

AI에게 **원본 코드 전체를 주지 않는다.** 분석된 **그래프 요약(JSON)** + **허브 클래스의 핵심 시그니처** + **엣지 근거 스니펫**만 준다.
→ 토큰을 절약하고, AI가 **그래프에 실제로 존재하는 노드/엣지 ID만** 참조하도록 강제한다 (환각 방지).

### 5.2 AI 입력 구성 (서버의 `buildNarrationContext()`)

토큰 예산 기본 60k. 넘치면 아래 순서로 줄인다.

1. 프로젝트 메타: 이름, Unity 버전, 주요 패키지 (Netcode, InputSystem, Addressables, UniTask 등 → AI가 아키텍처 추론에 사용)
2. 모듈 목록 + 각 모듈의 노드 수 + 모듈 간 엣지 집계 (`Controllers → Managers: 23`)
3. 노드 목록 (compact): `id | kind | unityRole | module | fanIn | fanOut | summary(80자)`
4. 엣지 목록 (compact): `source | kind | target | weight`  (weight 낮은 `references` 부터 잘라냄)
5. 허브 클래스 상위 15개의 **public 시그니처** + Unity 메시지 메서드(Awake/Start/Update/OnTriggerEnter...) + RPC 목록
6. 순환 참조, 미해결 타입 개수, 경고

### 5.3 AI 출력 형식 (MUST: 구조화)

Anthropic **tool use** 로 출력 스키마를 강제한다. AI는 `emit_step` 도구를 단계마다 호출하고, 서버는 각 호출을 받는 즉시 SSE로 프론트에 흘려보낸다 → "AI가 돌면서 하나씩 설명"하는 경험.

```jsonc
// tool: emit_step  (여러 번 호출됨)
{
  "stepIndex": 0,
  "type": "overview" | "layer" | "module" | "flow" | "pattern" | "risk" | "summary",
  "title": "전체 구조: 매니저 중심의 레이어드 아키텍처",
  "markdown": "이 프로젝트는 ... (한국어, 3~8문장, 클래스명은 `코드` 표기)",
  "focus": {
    "nodeIds": ["DungeonManager", "DungeonRoomBase", "NormalRoom"],   // 반드시 그래프에 존재하는 ID
    "edgeIds": ["inherits:NormalRoom->DungeonRoomBase"],
    "moduleIds": ["module:Managers"],
    "camera": "fit" | "zoomIn" | "zoomOut"
  },
  "sequence": [                                   // type=flow 일 때만: 상호작용 순서
    { "from": "PlayerController", "to": "Interactable", "label": "OnTriggerEnter2D → Interact()", "edgeId": "..." }
  ]
}
```

```jsonc
// tool: finish  (마지막 1회)
{ "oneLineSummary": "...", "suggestedQuestions": ["...", "...", "..."] }
```

**서버 검증 (MUST):** `focus` 의 ID가 그래프에 없으면 해당 ID를 제거하고 경고 로그. 모든 ID가 무효면 `camera: "fit"` 으로 대체. AI 출력이 스키마를 어기면 1회 재시도.

### 5.4 해설 단계 구성 (시스템 프롬프트에 명시)

AI는 아래 순서로 **8~14 단계**를 생성한다:

1. **overview** — 프로젝트 장르 추정(패키지/클래스명 근거), 전체 아키텍처 스타일 한 문단
2. **layer** ×2~4 — 계층별 설명. Unity 프로젝트의 전형적 계층으로 매핑:
   - *Core/Managers* (게임 상태, 씬 전환, 네트워크, 싱글톤)
   - *Controllers / Entities* (플레이어, 적, NPC — MonoBehaviour 행위)
   - *Systems* (인벤토리, 주문, 배치 등 도메인 로직)
   - *Data* (ScriptableObject, 데이터 클래스, 구조체)
   - *UI* (화면, HUD, 팝업)
   - *Utils / Components* (재사용 컴포넌트, 풀링)
3. **flow** ×2~4 — 실제 상호작용 시나리오. 예: "플레이어 입력 → 이동/공격 → 적 피격 → 드롭 → 인벤토리 → UI 갱신". 각 단계는 `sequence` 로 표시하고 근거 엣지 ID를 연결.
4. **pattern** ×1~3 — 사용된 설계 패턴 (싱글톤 매니저, 옵저버/이벤트, 컴포넌트 조합, 상태 머신, 오브젝트 풀, 데이터-주도(SO), 서버 권한 네트워크 등). 반드시 근거 노드 제시.
5. **risk** ×0~2 — 설계상 주의점 (순환 참조, God 클래스(fan-out 과다), 싱글톤 남용, `FindObjectOfType` 의존 등). 비난조 금지, 사실 + 개선 제안 1줄.
6. **summary** — 신규 개발자가 "어디부터 읽어야 하는지" 파일 3~5개 추천.

### 5.5 시스템 프롬프트 (초안 — 구현 시 `server/prompts/narrate.md` 로 저장)

```text
당신은 Unity 게임 클라이언트 아키텍처를 설명하는 시니어 개발자입니다.
입력으로 Unity 프로젝트의 정적 분석 결과(클래스 그래프)가 주어집니다.
목표: 이 프로젝트를 처음 보는 개발자가 "구조가 어떻게 이루어져 있고, 클래스들이 어떻게 상호작용하는지"를
다이어그램을 따라가며 이해하도록 단계별로 설명하세요.

규칙:
- 반드시 emit_step 도구로 한 단계씩 출력하고, 마지막에 finish 를 호출하세요.
- focus 에는 입력 그래프에 실제로 존재하는 nodeId / edgeId / moduleId 만 쓰세요. 없는 ID를 만들지 마세요.
- 근거 없는 추측은 "추정" 이라고 명시하세요. 근거는 엣지 종류(getsComponent, usesSingleton 등)와 evidence 로 대세요.
- Unity 개념을 자연스럽게 섞어 설명하세요: MonoBehaviour 생명주기(Awake→OnEnable→Start→Update),
  컴포넌트 기반 설계, 프리팹, ScriptableObject, 인스펙터 직렬화, Netcode의 서버/클라이언트 권한과 RPC.
- 한국어로, 단계당 3~8문장. 클래스명은 `백틱`.
- 단계 순서: overview → layer(2~4) → flow(2~4) → pattern(1~3) → risk(0~2) → summary.
```

### 5.6 추가 AI 기능

| 기능 | 트리거 | 입력 | 출력 |
|---|---|---|---|
| **클래스 심화 해설** (MUST) | 노드 상세 패널의 [AI로 설명] | 해당 노드 전체 정보 + 1-hop 이웃 + **해당 파일 원본 코드**(최대 400줄) | 같은 `emit_step` 형식, 3~5단계 (역할 / 생명주기 / 협력 클래스 / 주의점) |
| **자유 질문** (MUST) | 하단 질문 입력창 | 질문 + 5.2 컨텍스트 + 질문 키워드로 찾은 관련 노드 원본 코드(최대 3파일) | `emit_step` 1~4개 |
| **시나리오 추적** (SHOULD) | "A에서 B까지 어떻게 연결돼?" | 두 노드 간 최단 경로들(BFS, 최대 3개) | `flow` 단계 |

### 5.7 스트리밍 & 캐시

- 엔드포인트는 SSE: `event: step`, `event: finish`, `event: error`, `event: progress`.
- 캐시 키 = `sha256(contentHash + promptVersion + model + 요청종류 + 대상ID/질문)`. 저장 위치 `.cache/ai/<key>.json`.
- 캐시 히트 시에도 **스텝을 300ms 간격으로 재생** → 동일한 UX (SHOULD). [다시 생성] 버튼으로 캐시 무시.
- AI 호출 실패/키 없음 → 다이어그램 기능은 정상 동작, AI 패널에 안내 메시지 ("`.env` 에 ANTHROPIC_API_KEY 를 설정하세요").

---

## 6. REST API

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/analyze` | body `{ projectPath, excludeGlobs? }` → `{ jobId }` |
| `GET` | `/api/analyze/:jobId/events` | SSE 진행률 (`progress {phase, done, total}`, `done {graphId}`, `error`) |
| `GET` | `/api/graph/:graphId` | `ProjectGraph` JSON |
| `GET` | `/api/source?graphId&filePath&from&to` | 원본 코드 일부 (프로젝트 루트 밖 경로 요청은 403 — **path traversal 방지 MUST**) |
| `POST` | `/api/ai/narrate` | body `{ graphId, model? }` → SSE |
| `POST` | `/api/ai/explain-node` | body `{ graphId, nodeId }` → SSE |
| `POST` | `/api/ai/ask` | body `{ graphId, question }` → SSE |
| `GET` | `/api/export/mermaid?graphId&moduleId?` | Mermaid `classDiagram` 텍스트 |
| `GET` | `/api/recent` | 최근 프로젝트 경로 |

---

## 7. 프론트엔드 UI 명세

### 7.1 레이아웃

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MeowTruck ▾  │ 🔍 클래스 검색 │ 뷰: [모듈][전체][상속][선택 주변] │ [🧭 클래스 다이어그램 보기] │
├────────────┬───────────────────────────────────────────┬─────────────────┤
│ 탐색 트리   │                                           │ [상세] [AI 해설] │
│ ▸ Controllers│           DiagramCanvas                  │                 │
│   ▸ Player  │     (compound 노드 = 모듈, 내부 = 클래스)    │  Step 3 / 11    │
│ ▸ Managers  │                                           │  ## 레이어: ...  │
│ ▸ Systems   │                                           │  (마크다운)       │
│ 필터:        │                                           │                 │
│ ☑ MonoBeh.. │                                           │ ◀ ▶ ⏸           │
│ ☑ Network.. │                                           │                 │
│ ☐ Enum      │                                           │                 │
│ 엣지 종류 ☑…│                                           │                 │
├────────────┴───────────────────────────────────────────┴─────────────────┤
│ 💬 질문하기: [플레이어가 아이템을 주우면 어떤 클래스들이 호출돼?        ] [전송] │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 다이어그램 뷰 모드

| 모드 | 설명 |
|---|---|
| **모듈 뷰** (기본) | 모듈을 노드로, 모듈 간 엣지를 집계(굵기=weight). 더블클릭 시 펼침 |
| **전체 뷰** | 모든 클래스. 노드 > 150 이면 경고 후 모듈 단위 접힘 상태로 시작 |
| **상속 뷰** | `inherits`/`implements` 만, 위→아래 계층 레이아웃 (ELK layered) |
| **선택 주변** | 선택 노드 기준 N-hop (1~3 슬라이더) |

### 7.3 노드 표현
- UML 박스 스타일: 상단 `«MonoBehaviour»` 스테레오타입 + 클래스명, 줌인(>1.2) 시 주요 필드/메서드 목록 표시 (줌아웃 시 이름만).
- 색상/테두리: [4.3](#43-unity-역할unityrole-분류) 표.
- 배지: 🌐 NetworkBehaviour, ⭐ 싱글톤, 📦 프리팹에서 사용됨(N), 🔁 순환 참조 포함.

### 7.4 엣지 표현

| kind | UML 스타일 |
|---|---|
| inherits | 실선 + 빈 삼각형 화살표 |
| implements | 점선 + 빈 삼각형 |
| references (serialized) | 실선 + 마름모(aggregation), 라벨 `[SerializeField]` |
| references | 실선 + 열린 화살표 |
| getsComponent / requiresComponent | 파선, 라벨 `GetComponent` |
| usesSingleton | 빨간 파선, 라벨 `.Instance` |
| subscribes | 보라 점선, 라벨 `event` |
| creates / instantiates | 초록 파선, 라벨 `new`/`Instantiate` |
| coLocated | 회색 이중선 (무방향), 라벨 `same GameObject` |

엣지 hover → 툴팁에 evidence 스니펫. 클릭 → 우측 상세에 근거 목록, 각 근거 클릭 시 코드 뷰어(읽기 전용, 구문 강조, 해당 줄 하이라이트).

### 7.5 AI 해설 연동 (가장 중요한 UX)
- 스텝 도착 시: `focus` 노드/엣지 외 요소는 opacity 0.15 로 dim, focus 요소는 테두리 글로우 + 펄스 애니메이션 1회, `cy.animate({ fit: { eles, padding: 80 } }, 600ms)`.
- `type: flow` 스텝: `sequence` 를 순서대로 엣지 위에 **이동하는 점(토큰) 애니메이션** 으로 재생 (각 0.8s), 우측에 번호 매긴 시퀀스 목록 동시 하이라이트.
- 해설 텍스트 내 `클래스명` 백틱 → 클릭 가능한 링크 (그래프 노드 선택).
- 스트리밍 중에는 스텝 목록에 스켈레톤 + "AI가 구조를 분석하는 중…" 표시.
- 자동재생: 스텝당 (글자수 × 40ms, 최소 4s).
- [ESC] 또는 [해설 종료] → dim 해제.

### 7.6 기타
- 다크/라이트 테마.
- 다이어그램 PNG/SVG 내보내기, Mermaid 텍스트 복사, AI 해설 전체를 `.md` 로 저장.
- 마지막 레이아웃 위치 저장 (localStorage, 프로젝트별).

---

## 8. 디렉터리 구조 (구현 결과물)

```
unity-class-diagram/
├─ package.json            # workspaces: server, web ; scripts: dev, build, start
├─ start.bat               # Windows 원클릭 실행 (npm i 확인 → npm run start → 브라우저 오픈)
├─ .env.example
├─ README.md               # 설치/실행/설정 방법
├─ server/
│  ├─ src/
│  │  ├─ index.ts                 # Fastify 부트스트랩 (127.0.0.1 바인딩)
│  │  ├─ routes/{analyze,graph,source,ai,export}.ts
│  │  ├─ scan/fileScanner.ts      # glob + exclude
│  │  ├─ parse/csharpParser.ts    # tree-sitter → TypeNode, usages
│  │  ├─ parse/typeResolver.ts    # using/namespace 기반 이름 해석
│  │  ├─ parse/unityYaml.ts       # meta/prefab/scene/asset
│  │  ├─ graph/builder.ts         # 엣지 생성, 모듈, 역할 분류
│  │  ├─ graph/metrics.ts         # fan-in/out, SCC
│  │  ├─ ai/context.ts            # buildNarrationContext (토큰 예산)
│  │  ├─ ai/narrator.ts           # Anthropic 스트리밍 + tool use → SSE
│  │  ├─ ai/validate.ts           # focus ID 검증
│  │  ├─ cache.ts
│  │  └─ export/mermaid.ts
│  ├─ prompts/{narrate,explainNode,ask}.md
│  └─ test/fixtures/SampleUnityProject/   # 테스트용 미니 Unity 프로젝트 (아래 10.2)
└─ web/
   └─ src/
      ├─ App.tsx
      ├─ api/client.ts            # fetch + EventSource 래퍼
      ├─ state/store.ts           # zustand
      ├─ components/
      │  ├─ ProjectPicker.tsx
      │  ├─ DiagramCanvas.tsx     # cytoscape 초기화, 스타일시트, highlight(focus)
      │  ├─ ExplorerTree.tsx
      │  ├─ DetailPanel.tsx
      │  ├─ NarrationPanel.tsx    # 스텝 목록, 재생 컨트롤
      │  ├─ CodeViewer.tsx
      │  └─ AskBar.tsx
      └─ diagram/{styles.ts,layouts.ts,flowAnimation.ts}
```

> 이 도구는 Unity 프로젝트 **밖**의 별도 폴더에 만든다 (Unity가 `node_modules` 를 임포트하지 않도록). 예: `C:\Users\CEMWARE\Documents\unity-class-diagram\`

---

## 9. 구현 단계 (마일스톤)

| # | 내용 | 완료 기준 |
|---|---|---|
| M1 | 스캐너 + C# 파서 + 그래프 빌더 + `/api/graph` | fixture 프로젝트에서 10.2 기대 결과 JSON 일치 |
| M2 | 다이어그램 UI (모듈/전체/상속 뷰, 검색, 필터, 상세, 코드 뷰어) | 200노드 프로젝트에서 줌/팬 60fps 근접, 초기 렌더 < 2s |
| M3 | Unity YAML 스캔 (coLocated, 사용처) | 프리팹 기반 엣지 표시 |
| M4 | AI 해설 (narrate) + 스트리밍 + 하이라이트 연동 + 캐시 | 버튼 클릭 → 3초 내 첫 스텝 표시 |
| M5 | 클래스 심화 해설, 자유 질문, flow 애니메이션 | |
| M6 | 내보내기, 테마, start.bat, README | |

---

## 10. 테스트 / 수락 기준

### 10.1 수락 기준 (MUST)
- [ ] 프로젝트 경로 입력 → 분석 → 다이어그램 표시까지 오류 없이 동작 (188개 스크립트 규모에서 분석 < 15s)
- [ ] `NormalRoom → DungeonRoomBase` 처럼 **사용자 정의 중간 베이스**를 거친 MonoBehaviour 판정이 정확
- [ ] 모든 엣지에 evidence 가 1개 이상 있고, 클릭 시 해당 코드 줄로 이동
- [ ] "클래스 다이어그램 보기" → 스텝이 스트리밍으로 도착하며 각 스텝마다 다이어그램 포커스 이동
- [ ] AI가 존재하지 않는 ID를 내도 UI가 깨지지 않음 (검증 로직)
- [ ] API 키 없이도 분석·다이어그램 기능 사용 가능
- [ ] 서버는 `127.0.0.1` 에만 바인딩, `/api/source` 는 프로젝트 루트 밖 접근 거부
- [ ] 코드 변경 없을 때 재실행 시 AI 재호출 없음 (캐시)

### 10.2 테스트 픽스처 (`server/test/fixtures/SampleUnityProject/Assets/Scripts`)
구현 에이전트는 아래 파일을 만들고 파서 단위 테스트를 작성한다.

```csharp
// GameManager.cs
public class GameManager : MonoBehaviour {
    public static GameManager Instance { get; private set; }
    public event System.Action<int> OnScoreChanged;
    void Awake() { Instance = this; }
    public void AddScore(int v) { OnScoreChanged?.Invoke(v); }
}
// EntityBase.cs
public abstract class EntityBase : MonoBehaviour, IDamageable {
    [SerializeField] protected EntityData data;
    public abstract void TakeDamage(int amount);
}
// Enemy.cs
public class Enemy : EntityBase {
    Rigidbody2D rb;
    void Awake() { rb = GetComponent<Rigidbody2D>(); }
    public override void TakeDamage(int amount) { GameManager.Instance.AddScore(10); }
}
// Player.cs
[RequireComponent(typeof(PlayerInput))]
public class Player : NetworkBehaviour {
    [SerializeField] List<Weapon> weapons;
    [ServerRpc] void AttackServerRpc() { }
}
// IDamageable.cs / EntityData.cs(ScriptableObject) / Weapon.cs(POCO) / PlayerInput.cs(MonoBehaviour)
// ScoreUI.cs
public class ScoreUI : MonoBehaviour {
    [SerializeField] TMPro.TMP_Text label;
    void OnEnable() { GameManager.Instance.OnScoreChanged += OnScore; }
    void OnScore(int v) { }
}
```

**기대 엣지:** `Enemy -inherits-> EntityBase`, `EntityBase -implements-> IDamageable`, `EntityBase -references(serialized)-> EntityData`,
`Enemy -usesSingleton-> GameManager`, `Player -references(serialized, many)-> Weapon`, `Player -requiresComponent-> PlayerInput`,
`ScoreUI -subscribes-> GameManager`, `ScoreUI -usesSingleton-> GameManager`.
**기대 역할:** `Enemy`=MonoBehaviour, `Player`=NetworkBehaviour(+isRpc 메서드 1), `EntityData`=ScriptableObject, `GameManager`=MonoBehaviour+Singleton, `ScoreUI`=MonoBehaviour+UI.
(`Rigidbody2D` 는 External 이므로 기본적으로 노드 없음.)

### 10.3 AI 테스트
- `narrate` 를 mock(고정 응답) 모드로 돌릴 수 있는 `AI_MOCK=1` 환경변수 제공 → UI 개발 시 API 비용 없이 테스트.

---

## 11. 결정 기본값 (모호할 때 따를 규칙)

1. 기능 vs 단순함 충돌 → **단순함** 우선, 단 MUST 항목은 생략 금지.
2. 타입 해석 불확실 → 엣지 생성 안 함, `unresolved` 기록.
3. UI 문구는 **한국어**, 코드/식별자는 영어.
4. AI 모델 기본값 `claude-sonnet-5-5`, 설정에서 `claude-opus-5-5` 선택 가능. 모델명은 `.env` 의 `AI_MODEL` 로 덮어쓰기.
5. 큰 프로젝트(>500 타입) → 기본 뷰는 모듈 뷰, AI 컨텍스트는 허브 중심으로 축약.
6. 새 의존성 추가는 Windows에서 네이티브 빌드가 필요 없는 것만.
7. 텔레메트리/외부 전송 없음 (AI API 제외).

---

## 부록 A. Unity 개념 사전 (AI 해설 품질용 — 프롬프트에 포함해도 됨)

| 개념 | 설명 (해설에 쓸 표현) |
|---|---|
| GameObject & Component | Unity는 상속보다 **조합**: 빈 GameObject에 여러 컴포넌트(MonoBehaviour)를 붙여 기능을 만든다. `coLocated` 엣지가 이 조합을 보여준다. |
| MonoBehaviour 생명주기 | `Awake`(자기 초기화) → `OnEnable` → `Start`(다른 객체 참조) → `Update`/`FixedUpdate`(매 프레임/물리) → `OnDisable` → `OnDestroy` |
| 인스펙터 직렬화 | `[SerializeField]`/public 필드는 에디터에서 드래그로 연결 → 코드에 `new` 가 없어도 의존 관계가 존재 |
| Prefab | 재사용 가능한 GameObject 템플릿. `Instantiate` 로 런타임 생성 |
| ScriptableObject | 씬과 독립된 데이터 에셋. 아이템/레시피/스탯 같은 **데이터 주도 설계**에 사용 |
| 싱글톤 매니저 | `static Instance` 로 전역 접근. 편리하지만 결합도↑, 초기화 순서 문제 주의 |
| 이벤트/옵저버 | `event Action`, `UnityEvent` 로 발행자-구독자 분리. UI 갱신에 흔함. `OnDisable` 에서 해제 필요 |
| GetComponent | 같은/자식 GameObject의 다른 컴포넌트를 런타임에 찾음. `RequireComponent` 로 존재 보장 |
| Netcode for GameObjects | `NetworkBehaviour`, `NetworkVariable<T>`(동기화 상태), `ServerRpc`(클라→서버), `ClientRpc`(서버→클라). 서버 권한 모델 |
| Object Pooling | 생성/파괴 비용을 줄이기 위해 오브젝트 재사용 |
| Input System | `PlayerInput`/InputAction 기반 입력 → Controller 로 전달 |
| UniTask | async/await 기반 비동기 (코루틴 대체) |

## 부록 B. MeowTruck 프로젝트에서 확인된 특성 (첫 테스트 대상)

- 경로: `C:\Users\CEMWARE\Documents\MeowTruck`, 스크립트 루트 `Assets/1_Scripts` (C# 약 188개), asmdef 없음 → **폴더 기반 모듈**
- 상위 모듈 후보: `Animation, Components, Controllers, Data, Entities, Environments, Interactables, Items, Managers, Structs, Systems, UI, Utils`
  (`~Misc`, `~Shaders` 처럼 `~` 로 시작하는 폴더는 Unity가 무시하는 폴더 → 기본 제외)
- 주요 패키지: Netcode for GameObjects + Facepunch(Steam) Transport, Input System, Localization, Addressables, URP 2D, UniTask, DOTween
  → AI 해설에서 "Steam 기반 멀티플레이 2D 게임" 으로 추정 가능, Netcode 권한 흐름 설명 필요
- 프리팹/씬: `Assets/Resources/Dungeon/Rooms/*.prefab`, `Assets/0_Scenes/*.unity`
- 제외 권장: `Assets/Plugins`, `Assets/TextMesh Pro`, `Assets/_Recovery`, `Assets/~Settings`
