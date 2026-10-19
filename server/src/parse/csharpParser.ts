// tree-sitter 로 C# 파일 하나를 읽어 타입 선언과 "사용(usage)" 패턴을 추출한다 (SPEC 4.2).
// 이름 해석은 하지 않는다 — 원문 타입 이름과 문맥(네임스페이스/using)을 넘기고 graph/builder 가 해석한다.
import { createRequire } from "node:module";
import { Parser, Language, type Node } from "web-tree-sitter";
import type { Member, MethodInfo, TypeKind, TypeNode } from "../types.js";

const require = createRequire(import.meta.url);

let parserPromise: Promise<Parser> | null = null;

export function getParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    await Parser.init();
    const wasm = require.resolve("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm");
    const lang = await Language.load(wasm);
    const parser = new Parser();
    parser.setLanguage(lang);
    return parser;
  })();
  return parserPromise;
}

// ───────── 출력 타입 ─────────

export interface TypeContext {
  namespace?: string;
  usings: string[];
  aliases: Record<string, string>;
  /** 바깥 타입들의 id (가까운 것부터) — 중첩 타입 이름 해석용 */
  outerIds: string[];
  typeParams: string[];
}

export interface RawTypeRef {
  name: string; // 제네릭 인자를 뗀 이름 (A.B 형식 가능)
  arity: number;
  many: boolean;
}

export interface RawReference extends RawTypeRef {
  line: number;
  snippet: string;
  site: "field" | "property" | "event" | "param" | "return" | "local" | "cast" | "generic";
  serialized: boolean;
  memberName?: string;
}

/** `a.b.c` 같은 수신자 체인. localType 이 있으면 첫 세그먼트 대신 그 타입에서 시작 */
export interface Receiver {
  segments: string[];
  localType?: string;
  fromBase?: boolean;
}

export type RawUsage =
  | {
      kind: "getsComponent" | "finds" | "creates" | "instantiates";
      typeName: string;
      line: number;
      snippet: string;
      via: string; // GetComponent / FindObjectOfType / new / Instantiate ...
    }
  | {
      kind: "instantiateExpr";
      receiver: Receiver;
      line: number;
      snippet: string;
    }
  | {
      kind: "memberAccess";
      receiver: Receiver;
      member: string;
      isInvocation: boolean;
      line: number;
      snippet: string;
    }
  | {
      kind: "subscribe";
      receiver: Receiver;
      member: string;
      line: number;
      snippet: string;
      via: "+=" | "AddListener";
    };

export interface RawType {
  node: TypeNode;
  ctx: TypeContext;
  bases: { name: string; arity: number; line: number; snippet: string }[];
  requires: { typeName: string; line: number; snippet: string }[];
  references: RawReference[];
  usages: RawUsage[];
}

// ───────── 상수 ─────────

const COLLECTIONS = new Set([
  "List", "IList", "IReadOnlyList", "IEnumerable", "ICollection", "IReadOnlyCollection",
  "HashSet", "ISet", "Queue", "Stack", "LinkedList", "Dictionary", "IDictionary",
  "IReadOnlyDictionary", "SortedList", "SortedDictionary", "SortedSet", "ConcurrentDictionary",
  "ObservableCollection", "NetworkList", "NativeArray", "NativeList",
]);

const GET_COMPONENT = new Set([
  "GetComponent", "GetComponents", "GetComponentInChildren", "GetComponentsInChildren",
  "GetComponentInParent", "GetComponentsInParent", "TryGetComponent", "AddComponent",
]);

const FIND = new Set([
  "FindObjectOfType", "FindObjectsOfType", "FindFirstObjectByType", "FindAnyObjectByType",
  "FindObjectsByType",
]);

export const UNITY_MESSAGES = new Set([
  "Awake", "OnEnable", "Start", "Update", "FixedUpdate", "LateUpdate", "OnDisable", "OnDestroy",
  "OnValidate", "Reset", "OnGUI", "OnApplicationQuit", "OnApplicationPause", "OnApplicationFocus",
  "OnTriggerEnter", "OnTriggerExit", "OnTriggerStay", "OnTriggerEnter2D", "OnTriggerExit2D",
  "OnTriggerStay2D", "OnCollisionEnter", "OnCollisionExit", "OnCollisionStay",
  "OnCollisionEnter2D", "OnCollisionExit2D", "OnCollisionStay2D", "OnMouseDown", "OnMouseUp",
  "OnMouseEnter", "OnMouseExit", "OnMouseOver", "OnMouseDrag", "OnBecameVisible",
  "OnBecameInvisible", "OnDrawGizmos", "OnDrawGizmosSelected", "OnAnimatorMove", "OnAnimatorIK",
  "OnParticleCollision", "OnTransformParentChanged", "OnRectTransformDimensionsChange",
  "OnNetworkSpawn", "OnNetworkDespawn", "OnGainedOwnership", "OnLostOwnership",
  "OnNetworkObjectParentChanged", "OnStateEnter", "OnStateExit", "OnStateUpdate", "OnStateMove",
  "OnStateIK", "OnStateMachineEnter", "OnStateMachineExit",
]);

const TYPE_DECLS: Record<string, TypeKind> = {
  class_declaration: "class",
  struct_declaration: "struct",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "record",
  record_struct_declaration: "record",
};

const DELEGATE_TYPES = new Set(["Action", "Func", "UnityEvent", "UnityAction", "EventHandler", "Predicate"]);

// ───────── 헬퍼 ─────────

function kids(n: Node | null | undefined): Node[] {
  if (!n) return [];
  return n.namedChildren.filter((c): c is Node => c != null);
}

function field(n: Node | null | undefined, name: string): Node | null {
  return n ? n.childForFieldName(name) : null;
}

function modifiersOf(n: Node): string[] {
  return kids(n).filter((c) => c.type === "modifier").map((c) => c.text);
}

function accessOf(mods: string[], fallback: string): string {
  for (const m of ["public", "protected", "internal", "private"]) if (mods.includes(m)) return m;
  return fallback;
}

/** [A, B(x)] → ["A", "B(x)"] */
function attributesOf(n: Node): { name: string; text: string; node: Node }[] {
  const out: { name: string; text: string; node: Node }[] = [];
  for (const list of kids(n).filter((c) => c.type === "attribute_list")) {
    for (const a of kids(list).filter((c) => c.type === "attribute")) {
      const name = (field(a, "name")?.text ?? "").replace(/Attribute$/, "");
      out.push({ name: name.split(".").pop()!, text: a.text, node: a });
    }
  }
  return out;
}

/** 타입 노드에서 참조되는 타입 이름들 (제네릭 인자 포함) */
export function typeRefsOf(t: Node | null, many = false): RawTypeRef[] {
  if (!t) return [];
  switch (t.type) {
    case "identifier":
      return [{ name: t.text, arity: 0, many }];
    case "qualified_name": {
      const right = field(t, "name");
      if (right?.type === "generic_name") {
        const q = field(t, "qualifier")?.text ?? "";
        const inner = typeRefsOf(right, many);
        if (inner[0]) inner[0].name = `${q}.${inner[0].name}`;
        return inner;
      }
      return [{ name: t.text.replace(/\s+/g, ""), arity: 0, many }];
    }
    case "alias_qualified_name":
      return [{ name: t.text.replace(/^global::/, ""), arity: 0, many }];
    case "generic_name": {
      const id = kids(t).find((c) => c.type === "identifier");
      const args = kids(kids(t).find((c) => c.type === "type_argument_list"));
      const name = id?.text ?? t.text;
      const childMany = many || COLLECTIONS.has(name);
      const out: RawTypeRef[] = [{ name, arity: args.length, many }];
      for (const a of args) out.push(...typeRefsOf(a, childMany));
      return out;
    }
    case "array_type":
      return typeRefsOf(field(t, "type"), true);
    case "nullable_type":
    case "pointer_type":
    case "ref_type":
    case "scoped_type":
      return typeRefsOf(field(t, "type") ?? kids(t)[0], many);
    case "tuple_type":
      return kids(t).flatMap((e) => typeRefsOf(field(e, "type") ?? kids(e)[0], many));
    default:
      return [];
  }
}

/** "List<Enemy>" 같은 문자열 → 구조. builder 가 멤버 타입을 따라갈 때 사용 */
export interface ParsedTypeString {
  name: string;
  args: ParsedTypeString[];
  array: boolean;
}

export function parseTypeString(s: string): ParsedTypeString {
  s = s.trim().replace(/\?$/, "");
  let array = false;
  while (/\[[,\s]*\]$/.test(s)) {
    array = true;
    s = s.replace(/\[[,\s]*\]$/, "").trim();
  }
  const lt = s.indexOf("<");
  if (lt < 0) return { name: s, args: [], array };
  const name = s.slice(0, lt).trim();
  const inner = s.slice(lt + 1, s.lastIndexOf(">"));
  const args: ParsedTypeString[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      args.push(parseTypeString(inner.slice(start, i)));
      start = i + 1;
    }
  }
  if (inner.trim()) args.push(parseTypeString(inner.slice(start)));
  return { name, args, array };
}

export function isCollectionName(name: string): boolean {
  return COLLECTIONS.has(name.split(".").pop()!);
}

function summaryOf(decl: Node): string | undefined {
  const lines: string[] = [];
  let prev = decl.previousNamedSibling;
  while (prev && prev.type === "comment" && prev.text.startsWith("///")) {
    lines.unshift(prev.text);
    prev = prev.previousNamedSibling;
  }
  if (!lines.length) return undefined;
  const text = lines
    .map((l) => l.replace(/^\/\/\/\s?/, ""))
    .join(" ")
    .replace(/<see\s+cref="([^"]+)"\s*\/>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

// ───────── 파일 파싱 ─────────

export async function parseCSharpFile(source: string, filePath: string, folder: string): Promise<RawType[]> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree) return [];
  const lines = source.split(/\r?\n/);
  const snippetAt = (row: number) => (lines[row] ?? "").trim().slice(0, 160);
  const out: RawType[] = [];

  try {
    const fileUsings: string[] = [];
    const fileAliases: Record<string, string> = {};
    walkScope(tree.rootNode, undefined, fileUsings, fileAliases, []);
  } finally {
    tree.delete();
  }
  return out;

  function collectUsing(u: Node, usings: string[], aliases: Record<string, string>) {
    const alias = field(u, "name");
    const targets = kids(u).filter((c) => c !== alias);
    const target = targets[targets.length - 1]?.text.replace(/\s+/g, "");
    if (!target) return;
    if (alias) aliases[alias.text] = target;
    else usings.push(target); // using static 도 타입 접근 경로로 취급
  }

  /** compilation_unit / namespace 본문을 순회 */
  function walkScope(
    scope: Node,
    ns: string | undefined,
    usingsIn: string[],
    aliasesIn: Record<string, string>,
    outer: { id: string; typeParams: string[] }[],
  ) {
    const usings = [...usingsIn];
    const aliases = { ...aliasesIn };
    let currentNs = ns;
    for (const c of kids(scope)) {
      if (c.type === "using_directive") collectUsing(c, usings, aliases);
      else if (c.type === "file_scoped_namespace_declaration") {
        currentNs = join(ns, field(c, "name")?.text);
      } else if (c.type === "namespace_declaration") {
        walkScope(field(c, "body") ?? c, join(currentNs, field(c, "name")?.text), usings, aliases, outer);
      } else if (c.type === "declaration_list") {
        walkScope(c, currentNs, usings, aliases, outer);
      } else if (TYPE_DECLS[c.type]) {
        visitType(c, currentNs, usings, aliases, outer);
      }
    }
  }

  function join(a: string | undefined, b: string | undefined) {
    const nb = b?.replace(/\s+/g, "");
    if (!nb) return a;
    return a ? `${a}.${nb}` : nb;
  }

  function visitType(
    decl: Node,
    ns: string | undefined,
    usings: string[],
    aliases: Record<string, string>,
    outer: { id: string; typeParams: string[] }[],
  ) {
    const kind = TYPE_DECLS[decl.type];
    const name = field(decl, "name")?.text ?? "?";
    const typeParams = kids(kids(decl).find((c) => c.type === "type_parameter_list")).map(
      (tp) => field(tp, "name")?.text ?? tp.text,
    );
    const arity = typeParams.length;
    const localName = arity ? `${name}\`${arity}` : name;
    const id = outer.length ? `${outer[outer.length - 1].id}.${localName}` : ns ? `${ns}.${localName}` : localName;
    const mods = modifiersOf(decl);
    const attrs = attributesOf(decl);
    const allTypeParams = [...typeParams, ...outer.flatMap((o) => o.typeParams)];

    const node: TypeNode = {
      id,
      name,
      namespace: ns,
      kind,
      modifiers: mods.filter((m) => ["abstract", "sealed", "static", "partial", "readonly"].includes(m)),
      filePath,
      folder,
      lineStart: decl.startPosition.row + 1,
      lineEnd: decl.endPosition.row + 1,
      baseTypes: [],
      unityRole: "Data",
      tags: [],
      attributes: attrs.map((a) => a.text),
      fields: [],
      properties: [],
      methods: [],
      events: [],
      networkVars: [],
      summary: summaryOf(decl),
      loc: decl.endPosition.row - decl.startPosition.row + 1,
      outerId: outer.length ? outer[outer.length - 1].id : undefined,
      usedIn: [],
      assetInstances: 0,
    };

    const raw: RawType = {
      node,
      // 자기 자신의 중첩 타입이 가장 먼저 보이도록 self 를 맨 앞에
      ctx: { namespace: ns, usings, aliases, outerIds: [id, ...outer.map((o) => o.id).reverse()], typeParams: allTypeParams },
      bases: [],
      requires: [],
      references: [],
      usages: [],
    };
    out.push(raw);

    // 베이스 타입
    const baseList = kids(decl).find((c) => c.type === "base_list");
    for (const b of kids(baseList)) {
      // record Foo(int X) : Bar(X) 형태는 primary_constructor_base_type
      const t = b.type === "primary_constructor_base_type" ? field(b, "type") ?? kids(b)[0] : b;
      const refs = typeRefsOf(t);
      if (!refs[0]) continue;
      node.baseTypes.push(t.text);
      raw.bases.push({ name: refs[0].name, arity: refs[0].arity, line: b.startPosition.row + 1, snippet: snippetAt(b.startPosition.row) });
      // Singleton<Foo> 같은 제네릭 인자도 참조로
      for (const r of refs.slice(1)) addRef(raw, r, b, "generic", false);
    }

    // [RequireComponent(typeof(X), typeof(Y))]
    for (const a of attrs.filter((x) => x.name === "RequireComponent")) {
      walk(a.node, (n) => {
        if (n.type === "typeof_expression") {
          const r = typeRefsOf(field(n, "type"))[0];
          if (r) raw.requires.push({ typeName: r.name, line: n.startPosition.row + 1, snippet: snippetAt(n.startPosition.row) });
        }
      });
    }

    if (kind === "enum") return;

    // record 의 위치 매개변수는 프로퍼티
    const recordParams = kids(decl).find((c) => c.type === "parameter_list");
    for (const p of kids(recordParams)) {
      const t = field(p, "type");
      const pname = field(p, "name")?.text;
      if (!t || !pname) continue;
      node.properties.push({ name: pname, type: t.text, access: "public", isStatic: false, line: p.startPosition.row + 1 });
      for (const r of typeRefsOf(t)) addRef(raw, r, p, "property", false, pname);
    }

    const body = field(decl, "body");
    const innerOuter = [...outer, { id, typeParams }];
    for (const m of kids(body)) {
      if (TYPE_DECLS[m.type]) {
        visitType(m, ns, usings, aliases, innerOuter);
        continue;
      }
      visitMember(raw, m, kind);
    }
  }

  function addRef(raw: RawType, r: RawTypeRef, at: Node, site: RawReference["site"], serialized: boolean, memberName?: string) {
    if (raw.ctx.typeParams.includes(r.name)) return;
    raw.references.push({ ...r, line: at.startPosition.row + 1, snippet: snippetAt(at.startPosition.row), site, serialized, memberName });
  }

  function visitMember(raw: RawType, m: Node, ownerKind: TypeKind) {
    const node = raw.node;
    const mods = modifiersOf(m);
    const defaultAccess = ownerKind === "interface" ? "public" : "private";
    const access = accessOf(mods, defaultAccess);
    const isStatic = mods.includes("static") || mods.includes("const");
    const attrs = attributesOf(m);
    const line = m.startPosition.row + 1;

    switch (m.type) {
      case "field_declaration":
      case "event_field_declaration": {
        const vd = kids(m).find((c) => c.type === "variable_declaration");
        const t = field(vd, "type");
        if (!t) return;
        const isEvent = m.type === "event_field_declaration";
        const hasSerializeAttr = attrs.some((a) => a.name === "SerializeField" || a.name === "SerializeReference");
        const nonSerialized = attrs.some((a) => a.name === "NonSerialized");
        const serialized =
          !isEvent &&
          !nonSerialized &&
          !isStatic &&
          !mods.includes("readonly") &&
          (hasSerializeAttr || access === "public");
        const head = typeRefsOf(t)[0]?.name.split(".").pop() ?? "";
        for (const d of kids(vd).filter((c) => c.type === "variable_declarator")) {
          const fname = field(d, "name")?.text ?? "?";
          const member: Member = { name: fname, type: t.text, access, isStatic, serialized, line };
          if (isEvent || DELEGATE_TYPES.has(head)) node.events.push(member);
          else if (head === "NetworkVariable") node.networkVars.push(member);
          else node.fields.push(member);
          for (const r of typeRefsOf(t)) addRef(raw, r, m, isEvent ? "event" : "field", serialized, fname);
          // 필드 초기화식 안의 사용 패턴 (new Foo(), GetComponent 등)
          const init = kids(d).find((c) => c !== field(d, "name"));
          if (init) scanBody(raw, init, new Map());
        }
        return;
      }
      case "property_declaration":
      case "event_declaration":
      case "indexer_declaration": {
        const t = field(m, "type");
        const pname = field(m, "name")?.text ?? "this[]";
        if (!t) return;
        const head = typeRefsOf(t)[0]?.name.split(".").pop() ?? "";
        const member: Member = { name: pname, type: t.text, access, isStatic, line };
        if (m.type === "event_declaration" || DELEGATE_TYPES.has(head)) node.events.push(member);
        else node.properties.push(member);
        for (const r of typeRefsOf(t)) addRef(raw, r, m, m.type === "event_declaration" ? "event" : "property", false, pname);
        const locals = new Map<string, string>();
        if (m.type === "indexer_declaration") collectParams(raw, field(m, "parameters"), locals, m);
        for (const c of kids(m)) if (c !== t) scanBody(raw, c, locals);
        return;
      }
      case "method_declaration":
      case "constructor_declaration":
      case "destructor_declaration":
      case "operator_declaration":
      case "conversion_operator_declaration": {
        const isCtor = m.type !== "method_declaration";
        const mname = isCtor ? (m.type === "constructor_declaration" ? ".ctor" : field(m, "name")?.text ?? m.type) : field(m, "name")?.text ?? "?";
        const returns = field(m, "returns") ?? field(m, "type");
        const params = field(m, "parameters");
        const locals = new Map<string, string>();
        const methodTypeParams = kids(kids(m).find((c) => c.type === "type_parameter_list")).map(
          (tp) => field(tp, "name")?.text ?? tp.text,
        );
        const saved = raw.ctx.typeParams;
        raw.ctx.typeParams = [...saved, ...methodTypeParams];
        const plist = collectParams(raw, params, locals, m);
        if (returns && m.type === "method_declaration") for (const r of typeRefsOf(returns)) addRef(raw, r, m, "return", false, mname);
        const rpcAttr = attrs.find((a) => a.name === "ServerRpc" || a.name === "ClientRpc" || a.name === "Rpc");
        const retText = returns?.text ?? "void";
        if (m.type === "method_declaration" || m.type === "constructor_declaration") {
          const info: MethodInfo = {
            name: mname,
            returnType: isCtor ? "" : retText,
            params: plist,
            access,
            isStatic,
            isUnityMessage: UNITY_MESSAGES.has(mname),
            isRpc: !!rpcAttr,
            rpcKind: rpcAttr?.name as MethodInfo["rpcKind"],
            isAsync: mods.includes("async") || /^(UniTask|Task|IEnumerator|Awaitable)\b/.test(retText),
            isOverride: mods.includes("override"),
            line,
          };
          node.methods.push(info);
        }
        const body = field(m, "body") ?? kids(m).find((c) => c.type === "arrow_expression_clause");
        if (body) scanBody(raw, body, locals);
        // 생성자 : base(...) / this(...)
        const init = kids(m).find((c) => c.type === "constructor_initializer");
        if (init) scanBody(raw, init, locals);
        raw.ctx.typeParams = saved;
        return;
      }
      case "delegate_declaration":
        return;
      default:
        return;
    }
  }

  function collectParams(raw: RawType, params: Node | null, locals: Map<string, string>, at: Node) {
    const plist: { name: string; type: string }[] = [];
    for (const p of kids(params).filter((c) => c.type === "parameter")) {
      const t = field(p, "type");
      const pn = field(p, "name")?.text ?? "?";
      plist.push({ name: pn, type: t?.text ?? "?" });
      if (t) {
        locals.set(pn, t.text);
        for (const r of typeRefsOf(t)) addRef(raw, r, at, "param", false, pn);
      }
    }
    return plist;
  }

  /** 메서드 본문 등에서 사용 패턴을 찾는다 */
  function scanBody(raw: RawType, root: Node, locals: Map<string, string>) {
    walk(root, (n) => {
      const row = n.startPosition.row;
      const line = row + 1;
      const snippet = snippetAt(row);
      switch (n.type) {
        case "local_declaration_statement":
        case "using_statement":
        case "field_declaration": {
          const vd = kids(n).find((c) => c.type === "variable_declaration");
          const t = field(vd, "type");
          for (const d of kids(vd).filter((c) => c.type === "variable_declarator")) {
            const vname = field(d, "name")?.text;
            if (!vname) continue;
            const init = kids(d).find((c) => c !== field(d, "name"));
            const declared = t && t.type !== "implicit_type" ? t.text : inferExprType(init);
            if (declared) locals.set(vname, declared);
          }
          if (t && t.type !== "implicit_type") for (const r of typeRefsOf(t)) addRef(raw, r, n, "local", false);
          break;
        }
        case "foreach_statement": {
          const t = field(n, "type");
          const left = field(n, "left");
          if (t && left && t.type !== "implicit_type") {
            locals.set(left.text, t.text);
            for (const r of typeRefsOf(t)) addRef(raw, r, n, "local", false);
          }
          break;
        }
        case "declaration_expression":
        case "declaration_pattern":
        case "recursive_pattern": {
          const t = field(n, "type");
          const vn = field(n, "name") ?? kids(n).find((c) => c.type === "identifier" && c !== t);
          if (t && t.type !== "implicit_type") {
            if (vn) locals.set(vn.text, t.text);
            for (const r of typeRefsOf(t)) addRef(raw, r, n, "cast", false);
          }
          break;
        }
        case "cast_expression":
          for (const r of typeRefsOf(field(n, "type"))) addRef(raw, r, n, "cast", false);
          break;
        case "as_expression":
        case "is_expression":
          for (const r of typeRefsOf(field(n, "right"))) addRef(raw, r, n, "cast", false);
          break;
        case "type_pattern":
        case "constant_pattern":
          break;
        case "object_creation_expression": {
          const t = field(n, "type");
          const r = typeRefsOf(t)[0];
          if (r && !raw.ctx.typeParams.includes(r.name)) {
            raw.usages.push({ kind: "creates", typeName: r.name, line, snippet, via: "new" });
            for (const g of typeRefsOf(t).slice(1)) addRef(raw, g, n, "generic", false);
          }
          break;
        }
        case "invocation_expression":
          handleInvocation(raw, n, locals, line, snippet);
          break;
        case "assignment_expression": {
          const op = n.child(1)?.type;
          const left = field(n, "left");
          if (op === "+=" && left) {
            const target = splitMember(left, locals);
            if (target && target.receiver.segments.length + (target.receiver.localType ? 1 : 0) > 0) {
              raw.usages.push({ kind: "subscribe", receiver: target.receiver, member: target.member, line, snippet, via: "+=" });
            }
          }
          break;
        }
        case "member_access_expression":
        case "conditional_access_expression": {
          // 체인의 가장 바깥 노드에서만 한 번 기록 (호출의 function 위치는 handleInvocation 에서)
          const parent = n.parent;
          if (parent && (parent.type === "member_access_expression" && field(parent, "expression")?.id === n.id)) break;
          if (parent && parent.type === "invocation_expression" && field(parent, "function")?.id === n.id) break;
          if (parent && parent.type === "conditional_access_expression" && field(parent, "condition")?.id === n.id) break;
          const target = splitMember(n, locals);
          if (target && (target.receiver.segments.length || target.receiver.localType)) {
            raw.usages.push({ kind: "memberAccess", receiver: target.receiver, member: target.member, isInvocation: false, line, snippet });
          }
          break;
        }
      }
    });
  }

  function handleInvocation(raw: RawType, n: Node, locals: Map<string, string>, line: number, snippet: string) {
    const fn = field(n, "function");
    if (!fn) return;
    const args = kids(field(n, "arguments")).filter((c) => c.type === "argument");
    let calleeNode: Node | null = fn;
    if (fn.type === "member_access_expression") calleeNode = field(fn, "name");
    else if (fn.type === "conditional_access_expression") calleeNode = field(kids(fn).find((c) => c.type === "member_binding_expression"), "name");
    if (!calleeNode) return;
    const callee = calleeNode.type === "generic_name" ? kids(calleeNode).find((c) => c.type === "identifier")?.text ?? "" : calleeNode.text;
    const genericArgs = calleeNode.type === "generic_name" ? kids(kids(calleeNode).find((c) => c.type === "type_argument_list")) : [];
    const firstGeneric = genericArgs[0] ? typeRefsOf(genericArgs[0])[0] : undefined;
    const typeofArg = () => {
      for (const a of args) {
        const e = kids(a)[0];
        if (e?.type === "typeof_expression") return typeRefsOf(field(e, "type"))[0];
      }
      return undefined;
    };
    const outArg = () => {
      for (const a of args) {
        const e = kids(a).find((c) => c.type === "declaration_expression");
        if (e) return typeRefsOf(field(e, "type"))[0];
      }
      return undefined;
    };

    if (GET_COMPONENT.has(callee)) {
      const t = firstGeneric ?? typeofArg() ?? (callee === "TryGetComponent" ? outArg() : undefined);
      if (t && !raw.ctx.typeParams.includes(t.name)) {
        raw.usages.push({ kind: "getsComponent", typeName: t.name, line, snippet, via: callee });
        // Instantiate(prefab).GetComponent<T>() → instantiates T
        const recv = fn.type === "member_access_expression" ? field(fn, "expression") : null;
        if (recv?.type === "invocation_expression" && /^Instantiate\b/.test(field(recv, "function")?.text ?? "")) {
          raw.usages.push({ kind: "instantiates", typeName: t.name, line, snippet, via: "Instantiate" });
        }
      }
      return;
    }
    if (FIND.has(callee)) {
      const t = firstGeneric ?? typeofArg();
      if (t && !raw.ctx.typeParams.includes(t.name)) raw.usages.push({ kind: "finds", typeName: t.name, line, snippet, via: callee });
      return;
    }
    if (callee === "Instantiate") {
      if (firstGeneric && !raw.ctx.typeParams.includes(firstGeneric.name)) {
        raw.usages.push({ kind: "instantiates", typeName: firstGeneric.name, line, snippet, via: "Instantiate" });
      } else if (args[0]) {
        const r = receiverOf(kids(args[0])[0], locals);
        if (r) raw.usages.push({ kind: "instantiateExpr", receiver: r, line, snippet });
      }
      return;
    }
    // 그 밖의 제네릭 인자는 단순 참조 (Load<ItemData>() 등)
    for (const g of genericArgs) for (const r of typeRefsOf(g)) addRef(raw, r, n, "generic", false);

    if (callee === "AddListener" && fn.type === "member_access_expression") {
      const evt = field(fn, "expression");
      const target = evt ? splitMember(evt, locals) : null;
      if (target) raw.usages.push({ kind: "subscribe", receiver: target.receiver, member: target.member, line, snippet, via: "AddListener" });
      // 아래에서 수신자 체인(GameManager.Instance.onX)의 싱글톤/참조 엣지도 기록
    }
    if (fn.type === "member_access_expression" || fn.type === "conditional_access_expression") {
      const target = splitMember(fn, locals);
      if (target && (target.receiver.segments.length || target.receiver.localType || target.receiver.fromBase)) {
        raw.usages.push({ kind: "memberAccess", receiver: target.receiver, member: target.member, isInvocation: true, line, snippet });
      }
    }
  }

  /** a.b.c → { receiver: [a, b], member: c } */
  function splitMember(n: Node, locals: Map<string, string>): { receiver: Receiver; member: string } | null {
    if (n.type === "member_access_expression") {
      const nameNode = field(n, "name");
      const member = nameNode?.type === "generic_name" ? kids(nameNode).find((c) => c.type === "identifier")?.text : nameNode?.text;
      if (!member) return null;
      const expr = field(n, "expression");
      if (!expr) {
        const first = n.child(0)?.type;
        return { receiver: { segments: [], fromBase: first === "base" }, member };
      }
      const r = receiverOf(expr, locals);
      return r ? { receiver: r, member } : null;
    }
    if (n.type === "conditional_access_expression") {
      const binding = kids(n).find((c) => c.type === "member_binding_expression");
      const member = field(binding, "name")?.text;
      const cond = field(n, "condition");
      if (!member || !cond) return null;
      const r = receiverOf(cond, locals);
      return r ? { receiver: r, member } : null;
    }
    if (n.type === "identifier") return { receiver: { segments: [] }, member: n.text };
    return null;
  }

  /** 수신자 식 → 세그먼트 체인 */
  function receiverOf(e: Node | undefined | null, locals: Map<string, string>): Receiver | null {
    if (!e) return null;
    switch (e.type) {
      case "identifier": {
        const lt = locals.get(e.text);
        return lt ? { segments: [], localType: lt } : { segments: [e.text] };
      }
      case "this_expression":
      case "this":
        return { segments: [] };
      case "base_expression":
      case "base":
        return { segments: [], fromBase: true };
      case "qualified_name":
        return { segments: e.text.replace(/\s+/g, "").split(".") };
      case "parenthesized_expression":
        return receiverOf(kids(e)[0], locals);
      case "cast_expression": {
        const t = field(e, "type");
        return t ? { segments: [], localType: t.text } : null;
      }
      case "as_expression": {
        const t = field(e, "right");
        return t ? { segments: [], localType: t.text } : null;
      }
      case "member_access_expression":
      case "conditional_access_expression": {
        const s = splitMember(e, locals);
        return s ? { ...s.receiver, segments: [...s.receiver.segments, s.member] } : null;
      }
      case "element_access_expression": {
        const r = receiverOf(field(e, "expression"), locals);
        return r ? { ...r, segments: [...r.segments, "[]"] } : null;
      }
      case "invocation_expression": {
        const t = inferExprType(e);
        return t ? { segments: [], localType: t } : null;
      }
      case "object_creation_expression": {
        const t = field(e, "type");
        return t ? { segments: [], localType: t.text } : null;
      }
      default:
        return null;
    }
  }

  /** var x = ... 의 타입 추론 (간단한 경우만) */
  function inferExprType(e: Node | undefined | null): string | undefined {
    if (!e) return undefined;
    switch (e.type) {
      case "object_creation_expression":
        return field(e, "type")?.text;
      case "cast_expression":
        return field(e, "type")?.text;
      case "as_expression":
        return field(e, "right")?.text;
      case "parenthesized_expression":
        return inferExprType(kids(e)[0]);
      case "invocation_expression": {
        const fn = field(e, "function");
        const nameNode = fn?.type === "member_access_expression" ? field(fn, "name") : fn;
        if (nameNode?.type !== "generic_name") return undefined;
        const callee = kids(nameNode).find((c) => c.type === "identifier")?.text ?? "";
        const arg = kids(kids(nameNode).find((c) => c.type === "type_argument_list"))[0];
        if (!arg) return undefined;
        if (/^(GetComponents|FindObjectsOfType|FindObjectsByType)/.test(callee)) return `${arg.text}[]`;
        if (GET_COMPONENT.has(callee) || FIND.has(callee) || callee === "Instantiate") return arg.text;
        return undefined;
      }
      default:
        return undefined;
    }
  }
}

function walk(n: Node, visit: (n: Node) => void) {
  // 재귀 대신 명시적 스택 — 깊은 식에서도 안전
  const stack: Node[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    visit(cur);
    const children = cur.namedChildren;
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      // 지역 함수/람다 안도 같은 메서드로 취급하되, 중첩 타입 선언은 건너뜀
      if (c && !TYPE_DECLS[c.type]) stack.push(c);
    }
  }
}
