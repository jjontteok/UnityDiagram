import { useRef } from "react";
import { useStore, type ViewMode } from "../state/store";

/** 사용법 안내. 오른쪽 패널의 "사용법" 탭과 첫 화면의 사용법 창에서 함께 쓴다 */
export function HelpPanel() {
  const graph = useStore((s) => s.graph);
  const bodyRef = useRef<HTMLDivElement>(null);

  const go = (id: string) => bodyRef.current?.querySelector(`#help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const tryView = (m: ViewMode) => useStore.getState().setViewMode(m);

  const TOC: [string, string][] = [
    ["about", "이 도구는?"],
    ["start", "시작하기"],
    ["layout", "화면 구성"],
    ["read", "다이어그램 읽는 법"],
    ["views", "보기 방식 4가지"],
    ["control", "조작법"],
    ["detail", "상세 정보와 코드 보기"],
    ["guide", "구조 해설"],
    ["filter", "필터와 모듈 기준"],
    ["export", "내보내기"],
    ["keys", "단축키"],
    ["faq", "자주 묻는 질문"],
  ];

  return (
    <div className="help" ref={bodyRef}>
      <nav className="help-toc">
        {TOC.map(([id, label]) => (
          <button key={id} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>

      <section id="help-about">
        <h3>이 도구는?</h3>
        <p>
          Unity 프로젝트의 C# 스크립트, 프리팹, 씬 파일을 읽어서 <b>클래스들이 어떻게 연결되어 있는지</b>를 그림(클래스 다이어그램)으로 보여주고,
          그 구조를 <b>단계별로 설명</b>해 주는 도구입니다.
        </p>
        <ul>
          <li>처음 보는 프로젝트의 전체 구조를 빠르게 파악할 때</li>
          <li>어떤 클래스를 고치기 전에 "이걸 누가 쓰고 있지?"를 확인할 때</li>
          <li>팀원에게 구조를 설명하거나 문서에 그림을 넣을 때</li>
        </ul>
        <p className="muted small">
          AI 나 외부 계정을 쓰지 않습니다. 모든 그림과 설명은 이 프로그램이 코드를 분석해서 직접 만들며, 코드는 이 PC 밖으로 나가지 않습니다.
        </p>
      </section>

      <section id="help-start">
        <h3>시작하기</h3>
        <ol>
          <li>
            첫 화면의 입력칸에 <b>Unity 프로젝트 폴더 경로</b>나 <b>GitHub 주소</b>를 넣습니다.
            <div className="help-example mono">C:\Users\me\Documents\MeowTruck</div>
            <div className="help-example mono">https://github.com/owner/repo</div>
            <div className="help-example mono">https://github.com/owner/repo/tree/브랜치/하위폴더</div>
          </li>
          <li><b>분석 시작</b>을 누르면 진행 막대가 나오고, 보통 몇 초 안에 다이어그램이 열립니다.</li>
          <li>한 번 분석한 프로젝트는 첫 화면의 <b>최근 프로젝트</b>에서 바로 열 수 있습니다. 코드가 바뀌었다면 <b>다시 분석</b>을 누르세요.</li>
        </ol>
        <p className="muted small">
          <b>제외할 경로</b>: 서드파티 플러그인처럼 분석하고 싶지 않은 폴더를 지정합니다. 기본으로 <code>Assets/Plugins</code>, <code>Assets/TextMesh Pro</code> 등이 빠져 있습니다.
          GitHub 주소는 코드·프리팹·씬만 내려받고(그림·사운드 제외), 비공개 저장소는 이 PC 의 git 에 GitHub 로그인이 되어 있어야 합니다.
        </p>
      </section>

      <section id="help-layout">
        <h3>화면 구성</h3>
        <dl className="help-dl">
          <dt>위쪽 막대</dt>
          <dd>프로젝트 이름(누르면 다른 프로젝트 열기), 🔍 클래스 검색, 보기 방식, 🧭 클래스 다이어그램 보기(구조 해설), ⤓ 내보내기, ☾ 테마, ❓ 사용법</dd>
          <dt>왼쪽</dt>
          <dd>모듈(폴더/네임스페이스) 목록, 역할·연결선 종류 필터, 분석 통계</dd>
          <dt>가운데</dt>
          <dd>클래스 다이어그램. 오른쪽 위 <b>범례</b>, 오른쪽 아래 <b>＋ − ⤢</b> 버튼</dd>
          <dt>오른쪽</dt>
          <dd><b>상세</b>(선택한 것의 정보) · <b>구조 해설</b>(단계별 설명) · <b>사용법</b>(지금 이 화면)</dd>
        </dl>
      </section>

      <section id="help-read">
        <h3>다이어그램 읽는 법</h3>
        <h4>상자(클래스) 색과 모양</h4>
        <div className="help-grid">
          <span className="sw role-MonoBehaviour" /> <span><b>파랑</b> — MonoBehaviour: GameObject 에 붙는 컴포넌트</span>
          <span className="sw role-NetworkBehaviour" /> <span><b>남색</b> — NetworkBehaviour: 네트워크로 동기화되는 컴포넌트</span>
          <span className="sw role-ScriptableObject" /> <span><b>초록</b> — ScriptableObject: 에셋으로 저장되는 데이터</span>
          <span className="sw role-Data" /> <span><b>노랑</b> — 일반 C# 클래스/구조체</span>
          <span className="sw tag-ui" /> <span><b>보라</b> — UI 를 다루는 컴포넌트</span>
          <span className="sw singleton" /> <span><b>빨간 테두리</b> — 싱글톤/매니저 (어디서나 정적으로 접근)</span>
          <span className="sw iface" /> <span><b>점선 테두리</b> — 인터페이스</span>
          <span className="sw role-Enum" /> <span><b>회색</b> — enum</span>
        </div>
        <p>
          상자 위쪽의 <code>«MonoBehaviour»</code> 같은 글자는 종류이고, 아래 기호는
          🌐 네트워크 · ⭐ 싱글톤 · 📦N 프리팹/씬 N곳에서 사용 · 🗂N 데이터 에셋 N개 · 🔁 순환 참조 를 뜻합니다.
          확대하면 상자 안에 주요 필드와 메서드가 나타납니다 (◆ 인스펙터 필드, ◇ Unity 메시지, ⇄ RPC).
        </p>
        <h4>연결선</h4>
        <div className="help-grid">
          <span className="ln inherits" /> <span><b>상속</b> — 빈 삼각형 화살표가 부모 클래스를 가리킴</span>
          <span className="ln implements" /> <span><b>인터페이스 구현</b> — 점선 + 빈 삼각형</span>
          <span className="ln serialized" /> <span><b>[SerializeField]</b> — 인스펙터에서 연결하는 필드 (마름모 쪽이 가진 쪽)</span>
          <span className="ln" /> <span><b>참조</b> — 필드·매개변수로 사용하거나 메서드를 호출 (* 는 리스트/배열)</span>
          <span className="ln singleton" /> <span><b>.Instance</b> — 싱글톤/정적 접근</span>
          <span className="ln subscribes" /> <span><b>event</b> — 이벤트 구독 (구독하는 쪽 → 보내는 쪽)</span>
          <span className="ln creates" /> <span><b>new / Instantiate</b> — 생성</span>
          <span className="ln colocated" /> <span><b>same GameObject</b> — 프리팹/씬에서 같은 오브젝트에 함께 붙어 있음</span>
        </div>
        <p className="muted small">
          그 밖에 GetComponent(파선), RequireComponent, FindObjectOfType, 정적 호출, 인스펙터 연결(프리팹에서 실제로 연결된 것)이 있습니다.
          연결선에 마우스를 올리면 근거가 된 코드 줄이 보입니다. 모듈끼리 잇는 굵은 선의 숫자는 그 사이 연결 개수입니다.
        </p>
      </section>

      <section id="help-views">
        <h3>보기 방식 4가지</h3>
        <dl className="help-dl">
          <dt>모듈 {graph && <button className="link small" onClick={() => tryView("module")}>보기</button>}</dt>
          <dd>처음 화면. 모듈(폴더/네임스페이스) 단위로 묶어 큰 그림을 봅니다. 모듈 상자를 <b>더블클릭</b>하면 안의 클래스가 펼쳐집니다.</dd>
          <dt>전체 {graph && <button className="link small" onClick={() => tryView("all")}>보기</button>}</dt>
          <dd>모든 모듈을 펼친 상태. 클래스가 많으면 하위 모듈은 접힌 채로 시작합니다.</dd>
          <dt>상속 {graph && <button className="link small" onClick={() => tryView("inherit")}>보기</button>}</dt>
          <dd>상속·인터페이스 관계만 위(부모) → 아래(자식) 계층으로 보여줍니다. 베이스 클래스 구조를 볼 때 좋습니다.</dd>
          <dt>선택 주변</dt>
          <dd>선택한 클래스와 직접 연결된 클래스만 보여줍니다. 위쪽 막대로 1~3단계까지 넓힐 수 있습니다. 클래스를 <b>더블클릭</b>해도 이 보기로 바뀝니다.</dd>
        </dl>
      </section>

      <section id="help-control">
        <h3>조작법</h3>
        <ul>
          <li><b>마우스 휠</b> 또는 오른쪽 아래 <b>＋ / −</b>: 확대·축소, <b>⤢</b>: 전체가 보이게 맞춤</li>
          <li><b>빈 곳 드래그</b>: 화면 이동 · <b>상자 드래그</b>: 위치 옮기기 (옮긴 위치는 기억됩니다)</li>
          <li><b>클릭</b>: 클래스·모듈·연결선 선택 → 오른쪽 상세에 정보 표시</li>
          <li><b>더블클릭</b>: 모듈은 펼치기/접기, 클래스는 "선택 주변" 보기</li>
          <li><b>🔍 검색</b>: 클래스 이름 일부를 입력하고 Enter → 그 클래스로 이동 (접힌 모듈은 자동으로 펼침)</li>
          <li>왼쪽 목록에서 모듈을 펼쳐 클래스 이름을 눌러도 이동합니다</li>
        </ul>
      </section>

      <section id="help-detail">
        <h3>상세 정보와 코드 보기</h3>
        <dl className="help-dl">
          <dt>클래스를 선택하면</dt>
          <dd>
            종류, 네임스페이스, 파일 위치, 주석 설명, 사용 중인 프리팹/씬, 필드·이벤트·프로퍼티·메서드 목록,
            <b> 이 클래스가 사용하는 것 →</b> 과 <b>← 이 클래스를 사용하는 것</b> 이 나옵니다.
            파일 경로나 멤버를 누르면 <b>코드 보기</b> 창이 해당 줄에서 열립니다.
          </dd>
          <dt>연결선을 선택하면</dt>
          <dd>어떤 관계인지, 어떤 메서드/필드를 썼는지, 그리고 <b>근거가 된 코드 줄</b> 목록이 나옵니다. 근거를 누르면 코드로 이동합니다.</dd>
          <dt>모듈을 선택하면</dt>
          <dd>그 모듈의 클래스 목록(많이 쓰이는 순)과 펼치기/접기 버튼이 나옵니다.</dd>
        </dl>
        <p className="muted small">GitHub 에서 가져온 프로젝트는 코드 보기 창의 <b>GitHub 에서 보기</b> 로 같은 줄을 GitHub 에서 열 수 있습니다.</p>
      </section>

      <section id="help-guide">
        <h3>구조 해설</h3>
        <p>
          위쪽의 <b>🧭 클래스 다이어그램 보기</b>를 누르면 오른쪽 <b>구조 해설</b> 탭에 설명이 단계별로 나오고,
          단계마다 다이어그램이 해당 클래스로 이동해 주황색으로 강조합니다.
        </p>
        <ol>
          <li><b>개요</b> — 프로젝트 규모, 쓰는 기술(멀티플레이·2D·Input System 등), 중심 클래스</li>
          <li><b>계층</b> — 모듈마다 무슨 역할인지, 어느 모듈에 의존하는지</li>
          <li><b>흐름</b> — 실제 동작이 이어지는 순서. 연결선 위로 점이 움직이며 순서를 보여줍니다</li>
          <li><b>이벤트 흐름</b> — 어떤 클래스가 이벤트를 보내고 누가 받는지</li>
          <li><b>패턴</b> — 싱글톤 매니저, 컴포넌트 조합, ScriptableObject 데이터, 네트워크, 상태 머신</li>
          <li><b>주의점</b> — 순환 참조, 일이 너무 많이 몰린 클래스, FindObjectOfType 사용 등</li>
          <li><b>정리</b> — 처음 읽으면 좋은 파일 순서</li>
        </ol>
        <p>
          <b>◀ 이전 / 다음 ▶</b> (또는 ← →) 으로 넘기고, <b>▶ 자동재생</b> 으로 자동으로 넘길 수 있습니다.
          설명 속 파란 클래스 이름을 누르면 그 클래스로 이동합니다. <b>해설 종료</b>(ESC)를 누르면 강조가 풀립니다.
        </p>
        <p>
          클래스 하나만 알고 싶으면 클래스를 선택하고 상세 탭의 <b>📖 이 클래스 설명</b> 을 누르세요.
          역할, Unity 생명주기(Awake → Start → Update…), 네트워크 RPC, 의존 관계, 주의점을 정리해 줍니다.
        </p>
        {graph && (
          <button className="btn primary" onClick={() => document.querySelector<HTMLButtonElement>(".topbar .btn.big")?.click()}>
            🧭 지금 해설 시작하기
          </button>
        )}
      </section>

      <section id="help-filter">
        <h3>필터와 모듈 기준</h3>
        <ul>
          <li><b>역할 필터</b>: MonoBehaviour, enum 등 종류별로 보이기/숨기기. 다이어그램이 복잡하면 enum·인터페이스를 끄면 깔끔해집니다.</li>
          <li><b>엣지 종류</b>: 연결선 종류별로 보이기/숨기기. 예) "참조"를 끄면 싱글톤·이벤트·GetComponent 같은 핵심 연결만 남습니다.</li>
          <li><b>모듈 기준</b> (왼쪽 위 선택 상자): 폴더 / 네임스페이스 / asmdef 중 어떤 기준으로 묶을지 고릅니다.</li>
          <li>왼쪽 아래 <b>경고</b>·<b>미해결 타입</b>: 분석하다 확실히 알 수 없었던 것들입니다. 확실하지 않은 연결은 그리지 않습니다.</li>
        </ul>
      </section>

      <section id="help-export">
        <h3>내보내기 (⤓)</h3>
        <ul>
          <li><b>PNG / SVG</b>: 지금 보이는 다이어그램을 그림 파일로 저장 (문서·발표용)</li>
          <li><b>Mermaid 텍스트 복사</b>: GitHub README, Notion 등에 붙여 넣으면 다이어그램으로 보이는 텍스트</li>
          <li><b>구조 해설 .md 저장</b>: 지금까지 본 해설을 마크다운 문서로 저장</li>
        </ul>
      </section>

      <section id="help-keys">
        <h3>단축키</h3>
        <table className="help-table">
          <tbody>
            <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>해설 이전/다음 단계</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>해설 종료 · 코드 보기 창 닫기</td></tr>
            <tr><td><kbd>Enter</kbd> (검색칸)</td><td>첫 번째 검색 결과로 이동</td></tr>
            <tr><td>마우스 휠</td><td>확대 / 축소</td></tr>
            <tr><td>더블클릭</td><td>모듈 펼치기·접기 / 클래스 주변 보기</td></tr>
          </tbody>
        </table>
      </section>

      <section id="help-faq">
        <h3>자주 묻는 질문</h3>
        <dl className="help-dl">
          <dt>코드를 고쳤는데 다이어그램이 그대로예요</dt>
          <dd>첫 화면(프로젝트 이름 클릭)에서 <b>다시 분석</b>을 누르세요. GitHub 프로젝트는 최신 커밋을 다시 받아옵니다.</dd>
          <dt>도구를 업데이트했는데 화면이나 기능이 안 바뀌어요</dt>
          <dd>실행 중인 <code>start.bat</code> 창을 닫고 다시 실행하세요.</dd>
          <dt>다이어그램이 너무 복잡해요</dt>
          <dd>"모듈" 보기에서 필요한 모듈만 펼치거나, 클래스를 더블클릭해 "선택 주변"만 보세요. 엣지 종류에서 "참조"를 끄는 것도 도움이 됩니다.</dd>
          <dt>글자가 안 보여요</dt>
          <dd>＋ 버튼이나 휠로 확대하세요. 어느 정도 확대하면 상자 안에 멤버 목록까지 보입니다.</dd>
          <dt>있어야 할 연결선이 없어요</dt>
          <dd>
            코드만 보고 분석하므로 리플렉션, 문자열로 찾는 경우(<code>Find("이름")</code>), 람다 안의 일부 호출은 놓칠 수 있습니다.
            확실하지 않은 연결은 일부러 그리지 않습니다. 왼쪽 아래 "미해결 타입" 을 확인해 보세요.
          </dd>
          <dt>GitHub 비공개 저장소가 안 열려요</dt>
          <dd>명령 프롬프트에서 <code>git clone &lt;주소&gt;</code> 를 한 번 실행해 GitHub 에 로그인한 뒤 다시 시도하세요.</dd>
          <dt>분석 결과는 어디에 저장되나요?</dt>
          <dd>도구 폴더의 <code>.cache</code> 폴더입니다. 지워도 다시 분석하면 됩니다.</dd>
        </dl>
      </section>
    </div>
  );
}
