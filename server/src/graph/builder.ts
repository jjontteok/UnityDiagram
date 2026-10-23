// 스캔 → 파싱 → 이름 해석 → 엣지/역할/모듈/지표 → ProjectGraph (SPEC 4)
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AssetUsage, Edge, EdgeKind, Evidence, Module, ModuleRule, ProjectGraph, RoleTag, TypeNode, UnityRole,
} from "../types.js";
import { assertUnityProject, scanProject } from "../scan/fileScanner.js";
import {
  isCollectionName, parseCSharpFile, parseTypeString, type RawType, type Receiver, type TypeContext,
} from "../parse/csharpParser.js";
import { TypeResolver, type ResolvableType } from "../parse/typeResolver.js";
import { readMetaGuid, scanUnityYaml } from "../parse/unityYaml.js";
import { computeMetrics } from "./metrics.js";
import { buildFeatureModules } from "./features.js";

export type ProgressFn = (phase: string, done: number, total: number) => void;

const MAX_EVIDENCE = 5;
const MAX_YAML_BYTES = 50 * 1024 * 1024;
const WARN_YAML_BYTES = 5 * 1024 * 1024;
const SINGLETON_MEMBERS = new Set(["Instance", "instance", "Singleton", "I", "Current", "Main", "Inst"]);

const MONO_BASES = new Set([
  "MonoBehaviour", "UIBehaviour", "Selectable", "Graphic", "MaskableGraphic", "Image", "RawImage",
  "Button", "Toggle", "Slider", "ScrollRect", "Text", "TMP_Text", "TextMeshProUGUI", "LayoutGroup",
  "HorizontalOrVerticalLayoutGroup", "BaseMeshEffect", "EventTrigger", "PlayableBehaviour",
]);
const NETWORK_BASES = new Set(["NetworkBehaviour", "NetworkTransform", "NetworkAnimator", "NetworkRigidbody", "NetworkRigidbody2D"]);
const SO_BASES = new Set(["ScriptableObject", "StateMachineBehaviour", "ScriptableSingleton", "PlayableAsset", "TileBase", "RuleTile", "LocalizationTable"]);
const EDITOR_BASES = new Set([
  "Editor", "EditorWindow", "PropertyDrawer", "DecoratorDrawer", "ScriptableWizard", "AssetPostprocessor",
  "ScriptedImporter", "SettingsProvider", "ShaderGUI", "MaterialPropertyDrawer",
]);
const UI_TYPES = new Set([
  "Text", "TMP_Text", "TextMeshProUGUI", "TextMeshPro", "Image", "RawImage", "Button", "Slider", "Toggle",
  "RectTransform", "Canvas", "CanvasGroup", "ScrollRect", "TMP_InputField", "InputField", "TMP_Dropdown",
  "Dropdown", "Scrollbar", "GridLayoutGroup", "VerticalLayoutGroup", "HorizontalLayoutGroup", "Mask",
]);

interface MemberHit {
  kind: "field" | "property" | "event" | "method" | "enumValue";
  type: string;
  isStatic: boolean;
  ownerId: string;
  ctx?: TypeContext;
}

interface ResolvedType {
  id?: string; // 프로젝트 타입
  elementId?: string; // 컬렉션/배열의 원소 타입
  raw?: string;
  ctx?: TypeContext;
}

export async function analyzeProject(projectRoot: string, excludeGlobs: string[], progress: ProgressFn, autoExcludePlugins = true): Promise<ProjectGraph> {
  const started = Date.now();
  const root = path.resolve(projectRoot);
  await assertUnityProject(root);
  const warnings: string[] = [];

  progress("scan", 0, 1);
  const scan = await scanProject(root, excludeGlobs, autoExcludePlugins);
  progress("scan", 1, 1);

  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(excludeGlobs));
  hash.update(JSON.stringify(scan.plugins.map((p) => p.path)));
  hash.update(root); // 같은 내용이라도 다른 위치(로컬/GitHub)면 다른 그래프
  const read = async (rel: string) => {
    const text = await fs.readFile(path.join(root, rel), "utf8");
    hash.update(rel);
    hash.update(text);
    return text;
  };

  // ───── C# 파싱 ─────
  const raws: RawType[] = [];
  const scriptRoot = commonFolder(scan.scripts.map((s) => assetsRelDir(s)));
  for (let i = 0; i < scan.scripts.length; i++) {
    const rel = scan.scripts[i];
    try {
      const text = await read(rel);
      raws.push(...(await parseCSharpFile(text, rel, assetsRelDir(rel))));
    } catch (e) {
      warnings.push(`파싱 실패: ${rel} (${(e as Error).message})`);
    }
    if (i % 10 === 0 || i === scan.scripts.length - 1) progress("parse", i + 1, scan.scripts.length);
  }

  // partial class 병합
  const byId = new Map<string, RawType>();
  const memberCtx = new WeakMap<object, TypeContext>();
  const extraFiles = new Map<string, string[]>();
  for (const r of raws) {
    const prev = byId.get(r.node.id);
    if (!prev) {
      byId.set(r.node.id, r);
      continue;
    }
    const a = prev.node;
    const b = r.node;
    for (const m of [...b.fields, ...b.properties, ...b.methods, ...b.events, ...b.networkVars]) {
      memberCtx.set(m, r.ctx);
      if (b.filePath !== a.filePath) m.filePath = b.filePath;
    }
    a.fields.push(...b.fields);
    a.properties.push(...b.properties);
    a.methods.push(...b.methods);
    a.events.push(...b.events);
    a.networkVars.push(...b.networkVars);
    a.attributes.push(...b.attributes);
    a.baseTypes.push(...b.baseTypes.filter((x) => !a.baseTypes.includes(x)));
    a.modifiers = [...new Set([...a.modifiers, ...b.modifiers])];
    a.loc += b.loc;
    a.summary ??= b.summary;
    // 다른 파일의 partial 은 그 파일의 문맥(using)으로 해석해야 하므로 항목마다 문맥을 함께 보관
    for (const x of [...r.bases, ...r.requires, ...r.references, ...r.usages]) Object.assign(x, { ctx: r.ctx, file: b.filePath });
    prev.bases.push(...r.bases);
    prev.requires.push(...r.requires);
    prev.references.push(...r.references);
    prev.usages.push(...r.usages);
    if (b.filePath !== a.filePath) extraFiles.set(a.id, [...(extraFiles.get(a.id) ?? []), b.filePath]);
  }
  const types = [...byId.values()];
  const nodeById = new Map(types.map((t) => [t.node.id, t.node]));

  // ───── 외부 라이브러리 (Plugins 등) ─────
  const libTypes: (ResolvableType & { lib: string })[] = [];
  for (const [lib, files] of scan.libraries) {
    for (const f of files) {
      const text = await fs.readFile(path.join(root, f), "utf8").catch(() => "");
      let ns: string | undefined;
      for (const line of text.split(/\r?\n/)) {
        const n = /^\s*namespace\s+([\w.]+)/.exec(line);
        if (n) ns = n[1];
        const t = /^\s*(?:(?:public|internal|static|sealed|abstract|partial|readonly|ref|unsafe)\s+)*(?:class|struct|interface|enum|record)\s+(\w+)\s*(<[^>]*>)?/.exec(line);
        if (t && /\bpublic\b/.test(line)) {
          const arity = t[2] ? t[2].split(",").length : 0;
          const local = arity ? `${t[1]}\`${arity}` : t[1];
          libTypes.push({ id: ns ? `${ns}.${local}` : local, name: t[1], namespace: ns, arity, lib });
        }
      }
    }
  }
  const libOf = new Map(libTypes.map((t) => [t.id, `lib:${t.lib}`]));

  const resolver = new TypeResolver([
    ...types.map((t) => ({
      id: t.node.id,
      name: t.node.name,
      namespace: t.node.namespace,
      arity: Number(/`(\d+)$/.exec(t.node.id)?.[1] ?? 0),
      outerId: t.node.outerId,
    })),
    ...libTypes.filter((t) => !nodeById.has(t.id)),
  ]);

  // ───── 엣지 누적기 ─────
  const edges = new Map<string, Edge>();
  const unresolved = new Map<string, ProjectGraph["unresolved"][number]>();
  const usedLibs = new Set<string>();

  const target = (id: string) => {
    const lib = libOf.get(id);
    if (lib && !nodeById.has(id)) {
      usedLibs.add(lib);
      return lib;
    }
    return id;
  };

  function addEdge(kind: EdgeKind, source: string, rawTarget: string, ev: Evidence | null, opts: { many?: boolean; serialized?: boolean; call?: string } = {}) {
    const tgt = target(rawTarget);
    if (source === tgt) return;
    const id = `${kind}:${source}->${tgt}`;
    let e = edges.get(id);
    if (!e) {
      e = { id, source, target: tgt, kind, weight: 0, evidence: [] };
      edges.set(id, e);
    }
    if (ev && !e.evidence.some((x) => x.filePath === ev.filePath && x.line === ev.line)) {
      e.weight++;
      if (e.evidence.length < MAX_EVIDENCE) e.evidence.push(ev);
    } else if (!ev) e.weight = Math.max(e.weight, 1);
    if (opts.many) e.multiplicity = "many";
    else if (!e.multiplicity && kind === "references") e.multiplicity = "one";
    if (opts.serialized) e.serialized = true;
    if (opts.call) {
      e.calls ??= [];
      if (!e.calls.includes(opts.call) && e.calls.length < 30) e.calls.push(opts.call);
    }
  }

  function resolveName(name: string, arity: number, ctx: TypeContext, from: string, filePath: string, line: number): string | undefined {
    const r = resolver.resolve(name, arity, ctx);
    if (r.status === "ok") return r.id;
    if (r.status === "unresolved") {
      const key = `${from}|${name}`;
      if (!unresolved.has(key)) unresolved.set(key, { from, typeName: name, filePath, line });
    }
    return undefined;
  }

  const ctxOf = (x: unknown, fallback: TypeContext): TypeContext => ((x as any).ctx as TypeContext) ?? fallback;
  const fileOf = (x: unknown, fallback: string): string => ((x as any).file as string) ?? fallback;

  // ───── 멤버 탐색 (상속 체인 포함) ─────
  const projectBase = new Map<string, string>(); // 클래스 → 프로젝트 내 부모 클래스
  const externalBase = new Map<string, string>(); // 클래스 → 첫 외부 부모 이름

  for (const t of types) {
    const n = t.node;
    for (const b of t.bases) {
      const ev = { filePath: fileOf(b, n.filePath), line: b.line, snippet: b.snippet };
      const id = resolveName(b.name, b.arity, ctxOf(b, t.ctx), n.id, n.filePath, b.line);
      if (id && nodeById.has(id)) {
        const tk = nodeById.get(id)!.kind;
        if (tk === "interface" && n.kind !== "interface") addEdge("implements", n.id, id, ev);
        else {
          addEdge("inherits", n.id, id, ev);
          if (n.kind !== "interface") projectBase.set(n.id, id);
        }
      } else if (id) {
        addEdge(looksLikeInterface(b.name) ? "implements" : "inherits", n.id, id, ev);
      } else if (!externalBase.has(n.id) && !looksLikeInterface(b.name)) {
        externalBase.set(n.id, b.name.split(".").pop()!);
      }
    }
  }

  function baseChain(id: string): string[] {
    const chain = [id];
    const seen = new Set(chain);
    let cur = projectBase.get(id);
    while (cur && !seen.has(cur)) {
      chain.push(cur);
      seen.add(cur);
      cur = projectBase.get(cur);
    }
    return chain;
  }

  function findMember(typeId: string, name: string): MemberHit | undefined {
    for (const id of baseChain(typeId)) {
      const n = nodeById.get(id);
      if (!n) continue;
      if (n.kind === "enum") return { kind: "enumValue", type: n.id, isStatic: true, ownerId: id };
      const f = n.fields.find((m) => m.name === name) ?? n.networkVars.find((m) => m.name === name);
      if (f) return { kind: "field", type: f.type, isStatic: f.isStatic, ownerId: id, ctx: memberCtx.get(f) };
      const p = n.properties.find((m) => m.name === name);
      if (p) return { kind: "property", type: p.type, isStatic: p.isStatic, ownerId: id, ctx: memberCtx.get(p) };
      const ev = n.events.find((m) => m.name === name);
      if (ev) return { kind: "event", type: ev.type, isStatic: ev.isStatic, ownerId: id, ctx: memberCtx.get(ev) };
      const m = n.methods.find((x) => x.name === name);
      if (m) return { kind: "method", type: m.returnType, isStatic: m.isStatic, ownerId: id, ctx: memberCtx.get(m) };
    }
    return undefined;
  }

  function resolveTypeString(raw: string, ctx: TypeContext, from: string, filePath: string, line: number): ResolvedType {
    const p = parseTypeString(raw);
    const out: ResolvedType = { raw, ctx };
    const arity = p.args.length;
    const main = resolveName(p.name, arity, ctx, from, filePath, line);
    if (p.array) {
      out.elementId = resolveName(p.name, arity, ctx, from, filePath, line);
      return out;
    }
    if (main) out.id = main;
    if (isCollectionName(p.name) && p.args.length) {
      const el = p.args[p.args.length - 1];
      out.elementId = resolveName(el.name, el.args.length, ctx, from, filePath, line);
    }
    return out;
  }

  /**
   * 수신자 체인을 따라가며 static/싱글톤/호출 엣지를 만든다.
   * 반환값: 체인 끝(member 직전까지)의 타입
   */
  function walkChain(self: RawType, ctx: TypeContext, recv: Receiver, member: string | null, ev: Evidence, emit: boolean, isInvocation: boolean): ResolvedType | undefined {
    const from = self.node.id;
    let cur: ResolvedType | undefined;
    let isStaticCtx = false;
    let segs = [...recv.segments];

    if (recv.localType) {
      cur = resolveTypeString(recv.localType, ctx, from, ev.filePath, ev.line);
    } else if (recv.fromBase) {
      const b = projectBase.get(from);
      cur = b ? { id: b } : undefined;
    } else if (!segs.length) {
      cur = { id: from };
    } else {
      const first = segs[0];
      const m = findMember(from, first);
      if (m && m.kind !== "method") {
        cur = memberType(m);
        segs = segs.slice(1);
      } else {
        // 가장 긴 접두사를 타입 이름으로 (MeowTruck.Data.ItemType.Food 같은 경우)
        const all = member ? [...segs, member] : segs;
        for (let k = Math.min(all.length - (member ? 1 : 0), 4); k >= 1; k--) {
          const id = resolver.resolve(all.slice(0, k).join("."), 0, ctx);
          if (id.status === "ok") {
            cur = { id: id.id };
            isStaticCtx = true;
            segs = segs.slice(k);
            break;
          }
        }
        if (!cur) return undefined;
      }
    }

    const steps = member ? [...segs, member] : segs;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const last = i === steps.length - 1;
      if (!cur) return undefined;
      if (s === "[]") {
        cur = cur.elementId ? { id: cur.elementId } : undefined;
        isStaticCtx = false;
        continue;
      }
      const tid = cur.id;
      if (!tid) return undefined;
      const local = nodeById.has(tid);
      const call = s + (last && isInvocation ? "()" : "");

      if (isStaticCtx) {
        const hit = local ? findMember(tid, s) : undefined;
        if (hit?.kind === "enumValue") {
          if (emit) addEdge("references", from, tid, ev, { call: s });
          return undefined;
        }
        if (hit?.kind === "method" || (!hit && last && isInvocation)) {
          if (emit) addEdge("callsStatic", from, tid, ev, { call });
          return undefined;
        }
        if (hit) {
          const mt = memberType(hit);
          const own = mt.id === tid;
          const projectClass = mt.id && nodeById.has(mt.id) && nodeById.get(mt.id)!.kind !== "enum";
          if (own || SINGLETON_MEMBERS.has(s) || projectClass) {
            if (emit) {
              addEdge("usesSingleton", from, tid, ev, { call: s });
              if (projectClass && !own) addEdge("usesSingleton", from, mt.id!, ev);
            }
          } else if (emit) addEdge("callsStatic", from, tid, ev, { call: s });
          cur = mt;
        } else if (SINGLETON_MEMBERS.has(s)) {
          // 외부 베이스(Singleton<T> 등)에서 상속된 Instance
          if (emit) addEdge("usesSingleton", from, tid, ev, { call: s });
          cur = { id: tid };
        } else {
          if (emit) addEdge("callsStatic", from, tid, ev, { call: s });
          return undefined;
        }
        isStaticCtx = false;
        continue;
      }

      // 인스턴스 멤버 접근
      if (emit && tid !== from && (local || libOf.has(tid))) addEdge("references", from, tid, ev, { call });
      if (!local) return last ? cur : undefined;
      const hit = findMember(tid, s);
      if (last) return cur;
      if (!hit || hit.kind === "method" || hit.kind === "enumValue") return undefined;
      cur = memberType(hit);
    }
    return cur;
  }

  function memberType(m: MemberHit): ResolvedType {
    const owner = byId.get(m.ownerId);
    if (!owner) return {};
    return resolveTypeString(m.type, m.ctx ?? owner.ctx, owner.node.id, owner.node.filePath, owner.node.lineStart);
  }

  // ───── 참조 / 사용 패턴 → 엣지 ─────
  for (const t of types) {
    const n = t.node;
    if (n.outerId && nodeById.has(n.outerId)) {
      addEdge("nestedIn", n.id, n.outerId, { filePath: n.filePath, line: n.lineStart, snippet: `${n.kind} ${n.name}` });
    }
    for (const r of t.requires) {
      const id = resolveName(r.typeName, 0, ctxOf(r, t.ctx), n.id, n.filePath, r.line);
      if (id) addEdge("requiresComponent", n.id, id, { filePath: fileOf(r, n.filePath), line: r.line, snippet: r.snippet });
    }
    for (const ref of t.references) {
      const ctx = ctxOf(ref, t.ctx);
      const id = resolveName(ref.name, ref.arity, ctx, n.id, n.filePath, ref.line);
      if (!id) continue;
      addEdge("references", n.id, id, { filePath: fileOf(ref, n.filePath), line: ref.line, snippet: ref.snippet }, {
        many: ref.many,
        serialized: ref.serialized && ref.site === "field",
      });
    }
    for (const u of t.usages) {
      const ctx = ctxOf(u, t.ctx);
      const ev: Evidence = { filePath: fileOf(u, n.filePath), line: u.line, snippet: u.snippet };
      switch (u.kind) {
        case "getsComponent":
        case "finds":
        case "creates":
        case "instantiates": {
          const id = resolveName(u.typeName, 0, ctx, n.id, n.filePath, u.line);
          if (id) addEdge(u.kind, n.id, id, ev, { call: u.via });
          break;
        }
        case "instantiateExpr": {
          const rt = walkChain(t, ctx, u.receiver, null, ev, false, false);
          const id = rt?.id ?? rt?.elementId;
          if (id && nodeById.has(id)) addEdge("instantiates", n.id, id, ev, { call: "Instantiate" });
          break;
        }
        case "memberAccess":
          walkChain(t, ctx, u.receiver, u.member, ev, true, u.isInvocation);
          break;
        case "subscribe": {
          const pub = walkChain(t, ctx, u.receiver, null, ev, false, false);
          const pid = pub?.id;
          if (!pid || pid === n.id || !nodeById.has(pid)) break;
          const hit = findMember(pid, u.member);
          const isEvent =
            hit && (hit.kind === "event" || /^(Action|Func|UnityEvent|UnityAction|EventHandler|delegate)\b/.test(hit.type));
          if (isEvent) addEdge("subscribes", n.id, hit!.ownerId, ev, { call: u.member });
          break;
        }
      }
    }
  }

  // ───── 역할 분류 (SPEC 4.3) ─────
  for (const t of types) {
    const n = t.node;
    const chain = baseChain(n.id);
    const ext = chain.map((c) => externalBase.get(c)).find(Boolean);
    const extNames = chain.map((c) => externalBase.get(c)).filter(Boolean) as string[];
    let role: UnityRole;
    const inEditorFolder = /(^|\/)Editor(\/|$)/.test(n.folder);
    if (n.kind === "interface") role = "Interface";
    else if (n.kind === "enum") role = "Enum";
    else if (inEditorFolder || (ext && EDITOR_BASES.has(ext))) role = "EditorScript";
    else if (extNames.some((x) => NETWORK_BASES.has(x))) role = "NetworkBehaviour";
    else if (extNames.some((x) => MONO_BASES.has(x) || /Singleton/.test(x))) role = "MonoBehaviour";
    else if (extNames.some((x) => SO_BASES.has(x))) role = "ScriptableObject";
    else role = "Data";
    n.unityRole = role;

    const tags = new Set<RoleTag>();
    const staticInstance = [...n.properties, ...n.fields].some(
      (m) => m.isStatic && SINGLETON_MEMBERS.has(m.name) && parseTypeString(m.type).name.split(".").pop() === n.name,
    );
    const chainNames = chain.map((c) => nodeById.get(c)?.name ?? "").concat(extNames);
    if (role !== "Interface" && role !== "Enum" && (staticInstance || chainNames.some((x) => /Singleton/.test(x)) || /Manager$/.test(n.name))) {
      tags.add("singleton");
    }
    const uiField = [...n.fields, ...n.properties].some((m) => UI_TYPES.has(parseTypeString(m.type).name.split(".").pop()!));
    if ((role === "MonoBehaviour" || role === "NetworkBehaviour") && (uiField || /(^|\/)UI(\/|$)/.test(n.folder) || extNames.some((x) => MONO_BASES.has(x) && x !== "MonoBehaviour"))) {
      tags.add("ui");
    }
    n.tags = [...tags];
  }

  // ───── Unity YAML ─────
  const guidToType = new Map<string, string>();
  const typesByFile = new Map<string, TypeNode[]>();
  for (const n of nodeById.values()) {
    const list = typesByFile.get(n.filePath) ?? [];
    list.push(n);
    typesByFile.set(n.filePath, list);
  }
  for (const [id, files] of extraFiles) for (const f of files) typesByFile.set(f, [...(typesByFile.get(f) ?? []), nodeById.get(id)!]);

  for (const meta of scan.metas) {
    const csPath = meta.replace(/\.meta$/, "");
    const inFile = typesByFile.get(csPath);
    if (!inFile?.length) continue;
    const text = await fs.readFile(path.join(root, meta), "utf8").catch(() => "");
    hash.update(text);
    const guid = readMetaGuid(text);
    if (!guid) continue;
    const base = path.posix.basename(csPath, ".cs");
    const pick = inFile.find((x) => x.name === base && !x.outerId) ?? inFile.find((x) => !x.outerId && x.kind === "class");
    if (pick) guidToType.set(guid, pick.id);
  }

  const assetGuidToType = new Map<string, string>();
  const scriptableAssets: AssetUsage[] = [];
  const yamlFiles = [
    ...scan.assets.map((p) => ({ p, kind: "asset" as const })),
    ...scan.prefabs.map((p) => ({ p, kind: "prefab" as const })),
    ...scan.scenes.map((p) => ({ p, kind: "scene" as const })),
  ];
  const prefabs: AssetUsage[] = [];
  const scenes: AssetUsage[] = [];
  const usedIn = new Map<string, Set<string>>();

  for (let i = 0; i < yamlFiles.length; i++) {
    const { p, kind } = yamlFiles[i];
    if (i % 20 === 0 || i === yamlFiles.length - 1) progress("unity", i + 1, yamlFiles.length);
    const abs = path.join(root, p);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    if (st.size > MAX_YAML_BYTES) {
      warnings.push(`너무 큰 파일이라 건너뜀 (${(st.size / 1e6).toFixed(1)}MB): ${p}`);
      continue;
    }
    if (st.size > WARN_YAML_BYTES) warnings.push(`큰 파일 (${(st.size / 1e6).toFixed(1)}MB): ${p}`);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch (e) {
      warnings.push(`읽기 실패: ${p} (${(e as Error).message})`);
      continue;
    }
    if (!text.startsWith("%YAML")) continue; // 바이너리 직렬화 에셋
    hash.update(p);
    hash.update(`${st.size}:${st.mtimeMs}`);
    const doc = scanUnityYaml(text);
    const assetRel = p.replace(/^Assets\//, "");
    const scripts = new Set<string>();
    for (const c of doc.components) {
      const tid = c.scriptGuid ? guidToType.get(c.scriptGuid) : undefined;
      if (tid) scripts.add(tid);
    }
    if (kind === "asset") {
      if (!scripts.size) continue;
      scriptableAssets.push({ path: assetRel, scripts: [...scripts] });
      for (const s of scripts) nodeById.get(s)!.assetInstances++;
      const metaText = await fs.readFile(`${abs}.meta`, "utf8").catch(() => "");
      const g = readMetaGuid(metaText);
      const main = doc.components.find((c) => c.scriptGuid && guidToType.has(c.scriptGuid));
      if (g && main) assetGuidToType.set(g, guidToType.get(main.scriptGuid!)!);
      continue;
    }
    (kind === "prefab" ? prefabs : scenes).push({ path: assetRel, scripts: [...scripts] });
    for (const s of scripts) {
      const set = usedIn.get(s) ?? new Set();
      set.add(assetRel);
      usedIn.set(s, set);
    }
    // 같은 GameObject 에 붙은 컴포넌트들
    const byGo = new Map<string, { tid: string; line: number }[]>();
    const compType = new Map<string, string>();
    for (const c of doc.components) {
      const tid = c.scriptGuid ? guidToType.get(c.scriptGuid) : undefined;
      if (!tid) continue;
      compType.set(c.fileId, tid);
      if (!c.gameObjectId) continue;
      const list = byGo.get(c.gameObjectId) ?? [];
      list.push({ tid, line: c.line });
      byGo.set(c.gameObjectId, list);
    }
    for (const [go, list] of byGo) {
      const uniq = [...new Map(list.map((x) => [x.tid, x])).values()].sort((a, b) => a.tid.localeCompare(b.tid));
      const goName = doc.gameObjectNames.get(go) ?? "?";
      for (let a = 0; a < uniq.length; a++)
        for (let b = a + 1; b < uniq.length; b++) {
          addEdge("coLocated", uniq[a].tid, uniq[b].tid, { filePath: p, line: uniq[a].line, snippet: `GameObject "${goName}" (${path.posix.basename(p)})` });
        }
    }
    // 인스펙터 연결
    for (const c of doc.components) {
      const from = c.scriptGuid ? guidToType.get(c.scriptGuid) : undefined;
      if (!from) continue;
      for (const r of c.refs) {
        const to = r.guid ? assetGuidToType.get(r.guid) : compType.get(r.fileId);
        if (to && to !== from) {
          addEdge("wiredInInspector", from, to, { filePath: p, line: r.line, snippet: `${r.field} → ${nodeById.get(to)?.name} (${path.posix.basename(p)})` }, { call: r.field });
        }
      }
    }
  }
  for (const [tid, set] of usedIn) nodeById.get(tid)!.usedIn = [...set].sort();

  // ───── 라이브러리 노드 ─────
  const libNodes: TypeNode[] = [...usedLibs].map((lib) => ({
    id: lib,
    name: lib.replace(/^lib:/, ""),
    kind: "class",
    modifiers: [],
    filePath: "",
    folder: `(외부 라이브러리)`,
    lineStart: 0,
    lineEnd: 0,
    baseTypes: [],
    unityRole: "External",
    tags: ["library"],
    attributes: [],
    fields: [],
    properties: [],
    methods: [],
    events: [],
    networkVars: [],
    summary: "Assets/Plugins 등 분석 제외 폴더의 서드파티 라이브러리",
    loc: 0,
    usedIn: [],
    assetInstances: 0,
  }));

  const nodes = [...nodeById.values(), ...libNodes];
  const nodeIds = new Set(nodes.map((x) => x.id));
  const edgeList = [...edges.values()].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // ───── 모듈 ─────
  const asmdefs: { dir: string; name: string }[] = [];
  for (const a of scan.asmdefs) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(root, a), "utf8"));
      asmdefs.push({ dir: path.posix.dirname(a), name: j.name ?? path.posix.basename(a, ".asmdef") });
    } catch {
      warnings.push(`asmdef 읽기 실패: ${a}`);
    }
  }
  const relFolder = (n: TypeNode) => (scriptRoot ? n.folder.slice(scriptRoot.length).replace(/^\//, "") : n.folder);
  // 한 폴더(예: Assets/Scripts)에 대부분이 몰려 있으면 그 안쪽 폴더를 모듈 단위로 쓴다
  let dominant = "";
  const typed = [...nodeById.values()].map(relFolder);
  for (;;) {
    const inside = typed.filter((f) => !dominant || f === dominant || f.startsWith(`${dominant}/`));
    const counts = new Map<string, number>();
    for (const f of inside) {
      const rest = dominant ? f.slice(dominant.length).replace(/^\//, "") : f;
      const seg = rest.split("/")[0];
      if (seg) counts.set(seg, (counts.get(seg) ?? 0) + 1);
    }
    const [seg, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (!seg || c < typed.length * 0.7 || counts.size === 0) break;
    const next = dominant ? `${dominant}/${seg}` : seg;
    // 더 내려가도 하위 폴더가 없으면 멈춤
    if (!typed.some((f) => f.startsWith(`${next}/`))) break;
    dominant = next;
  }
  const modulesByRule: ProjectGraph["modulesByRule"] = {
    folder: buildModules(nodes, "folder", (n) => {
      const rel = relFolder(n);
      if (dominant && (rel === dominant || rel.startsWith(`${dominant}/`))) {
        const inner = rel.slice(dominant.length).replace(/^\//, "");
        return inner ? inner.split("/") : [dominant.split("/").pop()!];
      }
      return rel ? rel.split("/") : [];
    }, scriptRoot || "Assets"),
  };
  const namespaced = nodeById.size ? [...nodeById.values()].filter((n) => n.namespace).length / nodeById.size : 0;
  if (namespaced > 0) {
    const nsRoot = commonNamespace([...nodeById.values()].map((n) => n.namespace).filter(Boolean) as string[]);
    modulesByRule.namespace = buildModules(nodes, "namespace", (n) => {
      if (!n.namespace) return ["(global)"];
      const rel = nsRoot ? n.namespace.slice(nsRoot.length).replace(/^\./, "") : n.namespace;
      return rel ? rel.split(".") : [];
    }, nsRoot || "(global)");
  }
  if (asmdefs.length) {
    const sorted = [...asmdefs].sort((a, b) => b.dir.length - a.dir.length);
    modulesByRule.asmdef = buildModules(nodes, "asmdef", (n) => {
      const a = sorted.find((x) => n.filePath.startsWith(`${x.dir}/`));
      if (!a) {
        const asm = /(^|\/)Editor(\/|$)/.test(n.folder) ? "Assembly-CSharp-Editor" : "Assembly-CSharp";
        return [asm];
      }
      const sub = path.posix.dirname(n.filePath).slice(a.dir.length).replace(/^\//, "").split("/")[0];
      return sub ? [a.name, sub] : [a.name];
    }, "Assembly-CSharp");
  }
  // asmdef 가 있어도 대부분이 기본 어셈블리 하나에 몰려 있으면 나눠 보는 의미가 없으므로 다음 규칙으로
  const largestAsmdefShare = modulesByRule.asmdef
    ? Math.max(...modulesByRule.asmdef.filter((m) => !m.parent).map((m) => m.nodeIds.length)) / Math.max(1, nodes.length)
    : 1;
  // 기능 기준: 연결이 강한 클래스끼리 묶음. 기능이 둘 이상 나오면 처음 보는 사람에게 가장 알기 쉬우므로 기본으로
  modulesByRule.feature = buildFeatureModules(nodes, edgeList);
  const features = modulesByRule.feature.filter((m) => !m.parent && m.label !== "공통·기타").length;
  const defaultModuleRule: ModuleRule =
    features >= 2 ? "feature" : modulesByRule.asmdef && largestAsmdefShare < 0.6 ? "asmdef" : namespaced >= 0.5 ? "namespace" : "folder";

  const metrics = computeMetrics(nodes, edgeList);
  const contentHash = hash.digest("hex");
  const projectName = path.basename(root);
  const unityVersion = await fs
    .readFile(path.join(root, "ProjectSettings", "ProjectVersion.txt"), "utf8")
    .then((t) => /m_EditorVersion:\s*(\S+)/.exec(t)?.[1])
    .catch(() => undefined);
  const packages = await fs
    .readFile(path.join(root, "Packages", "manifest.json"), "utf8")
    .then((t) => Object.keys(JSON.parse(t).dependencies ?? {}).filter((k) => !k.startsWith("com.unity.modules.")))
    .catch(() => [] as string[]);

  return {
    graphId: contentHash.slice(0, 16),
    projectName,
    projectRoot: root,
    unityVersion,
    packages,
    analyzedAt: new Date().toISOString(),
    contentHash,
    scriptRoot,
    nodes,
    edges: edgeList,
    modules: modulesByRule[defaultModuleRule]!,
    defaultModuleRule,
    modulesByRule,
    assets: { prefabs, scenes, scriptableAssets },
    metrics,
    warnings,
    unresolved: [...unresolved.values()],
    plugins: scan.plugins,
    stats: {
      scripts: scan.scripts.length,
      prefabs: scan.prefabs.length,
      scenes: scan.scenes.length,
      assets: scriptableAssets.length,
      durationMs: Date.now() - started,
    },
  };
}

/** 노드마다 경로 세그먼트를 받아 2단계(상위/하위) 모듈을 만든다 */
function buildModules(nodes: TypeNode[], rule: ModuleRule, segmentsOf: (n: TypeNode) => string[], rootLabel: string): Module[] {
  const mods = new Map<string, Module>();
  const get = (id: string, label: string, parent?: string) => {
    let m = mods.get(id);
    if (!m) {
      m = { id, label, rule, parent, nodeIds: [] };
      mods.set(id, m);
    }
    return m;
  };
  for (const n of nodes) {
    let segs: string[];
    if (n.unityRole === "External") segs = ["(External)"];
    else segs = segmentsOf(n);
    if (!segs.length) segs = [`(${rootLabel})`];
    const top = get(`module:${segs[0]}`, segs[0]);
    top.nodeIds.push(n.id);
    if (segs.length > 1) get(`module:${segs[0]}/${segs[1]}`, segs[1], top.id).nodeIds.push(n.id);
  }
  return [...mods.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** "Assets/1_Scripts/Foo/Bar.cs" → "1_Scripts/Foo" */
function assetsRelDir(p: string): string {
  return path.posix.dirname(p).replace(/^Assets\/?/, "");
}

function commonFolder(dirs: string[]): string {
  if (!dirs.length) return "";
  let common = dirs[0].split("/");
  for (const d of dirs) {
    const parts = d.split("/");
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}

function commonNamespace(nss: string[]): string {
  if (!nss.length) return "";
  let common = nss[0].split(".");
  for (const ns of nss) {
    const parts = ns.split(".");
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join(".");
}

function looksLikeInterface(name: string) {
  const simple = name.split(".").pop()!;
  return /^I[A-Z]/.test(simple);
}
