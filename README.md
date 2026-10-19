# Unity 클래스 다이어그램 뷰어

로컬 Unity 프로젝트의 C# 스크립트·프리팹·씬을 정적 분석해 **인터랙티브 클래스 다이어그램**을 그리고,
**🧭 클래스 다이어그램 보기** 버튼을 누르면 구조와 상호작용을 단계별로 설명하면서
다이어그램의 해당 부분을 강조해 주는 로컬 웹앱입니다. 명세는 [SPEC.md](SPEC.md) 참고.

**AI·외부 계정 없이 동작합니다.** 다이어그램과 설명 모두 이 프로그램이 코드를 분석한 결과로 직접 만들며, 인터넷 연결도 필요 없습니다 (GitHub 주소로 분석할 때만 저장소를 내려받습니다).

## 요구 사항

- Node.js 20 이상 (24 에서 확인)

## 실행

### 가장 간단하게 (Windows)

`start.bat` 더블클릭 → 의존성 설치(최초 1회) → 빌드 → 서버 시작 → 브라우저가 `http://localhost:5173` 으로 열립니다.

### 명령어로

```bash
npm install
npm run start             # 웹 빌드 후 http://localhost:5173 에서 실행 (브라우저 자동 오픈)
```

개발 모드 (코드 수정 시 자동 반영):

```bash
npm run dev               # API 서버 :5174 + Vite :5173 (/api 프록시)
```

## 설정 (`.env`, 선택)

| 키 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `5173` | `npm run start` 포트 |
| `DEV_API_PORT` | `5174` | `npm run dev` 의 API 서버 포트 |

## 사용법

1. Unity 프로젝트 경로(예: `C:\Users\me\Documents\MeowTruck`) 또는 **GitHub 주소**를 입력하고 **분석 시작**.
   - GitHub: `https://github.com/owner/repo`, 브랜치·하위 폴더 지정은 `https://github.com/owner/repo/tree/브랜치/폴더`
   - 코드·프리팹·씬 파일만 내려받습니다(텍스처·사운드 제외). 저장 위치는 도구 폴더의 `.cache/repos/` 이며 지워도 됩니다.
   - 저장소 안에 Unity 프로젝트가 하위 폴더에 있으면 자동으로 찾습니다.
   - 비공개 저장소는 이 PC 의 git 에 GitHub 로그인이 되어 있어야 합니다 (명령 프롬프트에서 `git clone <주소>` 를 한 번 해서 로그인).
   - 다시 분석하면 최신 커밋으로 갱신하고, 코드 뷰어의 **GitHub 에서 보기** 로 해당 줄을 GitHub 에서 엽니다.
   - git 이 필요합니다 (https://git-scm.com).
2. 기본 화면은 **모듈 뷰** — 모듈을 더블클릭하면 펼쳐지고, 클래스를 더블클릭하면 그 주변만 봅니다.
   - 서로 강하게 연결된 클래스는 점선 상자("○○ 관련")로 자동으로 묶여 가까이 놓입니다.
   - 화면 이동은 **휠 버튼(가운데 버튼)을 누른 채 드래그**, 확대·축소는 휠 굴리기 또는 오른쪽 아래 ＋ / − / ⤢
   - 상단 뷰 전환: 모듈 / 전체 / 상속 / 선택 주변(1~3단계)
   - 왼쪽: 모듈 트리(폴더·네임스페이스·asmdef 기준 전환), 역할·엣지 종류 필터
   - 클래스·연결선을 클릭하면 오른쪽에 상세 정보. 근거(코드 줄)를 클릭하면 코드 뷰어가 열립니다.
   - 연결선에 마우스를 올리면 근거 코드 스니펫이 보입니다.
3. **🧭 클래스 다이어그램 보기** → 구조 해설 탭에 전체 개요 → 계층(모듈) → 흐름 → 설계 패턴 → 주의점 → 읽을 순서가 단계별로 나오고,
   단계마다 다이어그램이 이동·강조됩니다. 흐름 단계는 연결선 위로 점이 이동하며 호출 순서를 보여줍니다.
   `←` `→` 로 이동, `ESC` 로 해설 종료. 다이어그램 오른쪽 아래 ＋ / − / ⤢ 로 확대·축소·전체 보기.
4. 클래스 상세의 **📖 이 클래스 설명** → 역할, 생명주기(Awake→Start→Update…), RPC, 의존하는 것 / 사용하는 곳, 주의점.
5. 우측 상단 ⤓: PNG/SVG 저장, Mermaid `classDiagram` 복사, 해설 `.md` 저장.

설명은 분석 결과(상속, GetComponent, 싱글톤 접근, 이벤트 구독, 프리팹 구성, 지표 등)를 규칙에 따라 문장으로 만든 것입니다.
코드의 "의도"까지 추측하지는 않으며, 클래스의 `/// <summary>` 주석이 있으면 함께 보여줍니다.

## 분석하는 것

- **C#** (tree-sitter): 클래스/구조체/인터페이스/enum/record, 필드·프로퍼티·메서드·이벤트, `partial` 병합, 중첩 타입
- **관계(엣지)**: 상속, 구현, 참조(직렬화 필드 표시), `GetComponent`, `[RequireComponent]`, 싱글톤 `.Instance`/`Managers.X` 같은 정적 접근,
  이벤트 구독(`+=`, `AddListener`), `new`, `Instantiate`, `FindObjectOfType`, 정적 호출, 같은 GameObject(프리팹/씬), 인스펙터 연결
- **Unity 역할**: MonoBehaviour / NetworkBehaviour / ScriptableObject / Editor / 데이터 클래스 + 싱글톤·UI 태그
  (사용자 정의 중간 베이스 클래스를 거쳐도 판정)
- **Netcode**: `[ServerRpc]`/`[ClientRpc]`/`[Rpc]`, `NetworkVariable<T>`
- **지표**: fan-in/out, 순환 참조, 허브 클래스

모든 엣지에는 근거(파일·줄·코드 한 줄)가 붙고, 이름을 확실히 해석하지 못하면 엣지를 만들지 않고 "미해결 타입"으로 기록합니다.
기본 제외 경로: `Assets/Plugins`, `Assets/TextMesh Pro`, `Assets/_Recovery`, `~` 로 시작/끝나는 폴더 (분석 화면에서 편집 가능).
`Assets/Plugins` 아래 라이브러리는 참조만 "외부 라이브러리" 노드로 묶어 표시합니다.

## 보안

- 서버는 `127.0.0.1` 에만 바인딩되고, 다른 출처(Origin)에서 온 요청은 거부합니다.
- `/api/source` 는 분석한 프로젝트의 `Assets/` 안 파일만 읽습니다 (경로 조작·심볼릭 링크 우회 차단).
- GitHub 주소로 분석할 때 저장소를 내려받는 것 외에는 외부 네트워크 요청이 없습니다. 코드는 이 PC 밖으로 나가지 않습니다.
- GitHub 주소는 github.com 의 owner/repo 형식만 받고, git 은 셸을 거치지 않고 인자 배열로 실행합니다.

## 구조

```
server/  Fastify + TypeScript (tsx 로 직접 실행)
  src/scan/        파일 목록
  src/parse/       C# 파서(tree-sitter WASM), 이름 해석, Unity YAML
  src/graph/       엣지·역할·모듈·지표 → ProjectGraph
  src/guide/       분석 결과 → 단계별 구조 해설 문장
  src/routes/      REST + SSE
  test/            픽스처 프로젝트 + 테스트 (npm test)
web/     Vite + React + Cytoscape.js
```

## SPEC 과 다른 점

- **레이아웃**: 상속 뷰는 SPEC 대로 ELK layered 를 쓰지만, 모듈/전체/주변 뷰는 **fcose** 를 씁니다.
  의존 그래프에 순환이 많아 layered 배치는 가로로 길게 퍼져 글자를 읽을 수 없었기 때문입니다.
  모듈 접기/펼치기는 `cytoscape-expand-collapse` 대신 요소를 다시 만드는 방식으로 직접 구현했습니다.
- **AI 제거**: SPEC 5장의 AI(Claude API) 해설 대신, 분석 결과로 같은 형식(개요·계층·흐름·패턴·주의점·정리)의 해설을 직접 만듭니다.
  API 키·계정·인터넷이 필요 없습니다. 대신 자유 질문 기능은 없습니다.
- 모듈 기본 규칙은 SPEC 우선순위(asmdef → 네임스페이스 → 폴더)를 따르되, 화면에서 다른 규칙으로 바꿀 수 있습니다.

## 테스트

```bash
npm test          # 파서/그래프(SPEC 10.2 픽스처) + 구조 해설 생성 검증
npm run typecheck
```
