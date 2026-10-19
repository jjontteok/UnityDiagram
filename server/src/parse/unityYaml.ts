// Unity YAML(.meta / .prefab / .unity / .asset) 라인 파서 (SPEC 4.5).
// Unity YAML 은 `--- !u!114 &123` 태그 때문에 일반 YAML 파서로 읽기 어려워 필요한 키만 정규식으로 뽑는다.

export function readMetaGuid(text: string): string | undefined {
  return /^guid:\s*([0-9a-f]{32})/m.exec(text)?.[1];
}

export interface YamlComponent {
  fileId: string;
  line: number;
  gameObjectId?: string;
  scriptGuid?: string;
  /** 직렬화 필드에 연결된 오브젝트 참조 */
  refs: { field: string; fileId: string; guid?: string; line: number }[];
}

export interface YamlDocumentSummary {
  /** MonoBehaviour(클래스 114) 컴포넌트 */
  components: YamlComponent[];
  /** GameObject fileID → 이름 */
  gameObjectNames: Map<string, string>;
}

const HEADER = /^--- !u!(\d+) &(-?\d+)/;
const REF = /\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?/;
const SKIP_FIELDS = new Set([
  "m_Script", "m_GameObject", "m_CorrespondingSourceObject", "m_PrefabInstance", "m_PrefabAsset",
  "m_ObjectHideFlags", "m_EditorHideFlags", "m_EditorClassIdentifier",
]);

export function scanUnityYaml(text: string): YamlDocumentSummary {
  const components: YamlComponent[] = [];
  const gameObjectNames = new Map<string, string>();
  let cls = "";
  let current: YamlComponent | null = null;
  let currentGoId = "";
  let lastKey = "";

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADER.exec(line);
    if (h) {
      cls = h[1];
      current = null;
      currentGoId = "";
      if (cls === "114") {
        current = { fileId: h[2], line: i + 1, refs: [] };
        components.push(current);
      } else if (cls === "1") {
        currentGoId = h[2];
      }
      continue;
    }
    if (currentGoId) {
      const m = /^ {2}m_Name:\s*(.*)$/.exec(line);
      if (m) gameObjectNames.set(currentGoId, m[1].trim());
      continue;
    }
    if (!current) continue;

    // 최상위 키는 2칸 들여쓰기 (`  fieldName: ...`)
    const kv = /^ {2}([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv) {
      lastKey = kv[1];
      const value = kv[2];
      if (lastKey === "m_GameObject") current.gameObjectId = REF.exec(value)?.[1];
      else if (lastKey === "m_Script") current.scriptGuid = REF.exec(value)?.[2];
      else if (!SKIP_FIELDS.has(lastKey)) pushRef(current, lastKey, value, i + 1);
      continue;
    }
    // 배열 요소 (`  - {fileID: ...}`) 또는 더 깊은 중첩
    if (lastKey && !SKIP_FIELDS.has(lastKey) && /^ {2,}(- )?/.test(line)) pushRef(current, lastKey, line, i + 1);
  }
  return { components, gameObjectNames };
}

function pushRef(c: YamlComponent, fieldName: string, value: string, line: number) {
  const m = REF.exec(value);
  if (!m || m[1] === "0") return;
  c.refs.push({ field: fieldName, fileId: m[1], guid: m[2], line });
}
