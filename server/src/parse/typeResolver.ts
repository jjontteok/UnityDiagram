// using / 네임스페이스 / 중첩 타입 규칙으로 원문 타입 이름을 프로젝트 타입 id 로 해석한다 (SPEC 4.4).
// 확실하지 않으면 null — 추측으로 엣지를 만들지 않는다.
import type { TypeContext } from "./csharpParser.js";

export interface ResolvableType {
  id: string;
  name: string;
  namespace?: string;
  arity: number;
  outerId?: string;
}

export type ResolveResult =
  | { status: "ok"; id: string }
  | { status: "external" } // 프로젝트에 같은 이름이 없음 (Unity API 등)
  | { status: "unresolved" }; // 같은 이름은 있지만 문맥상 도달 불가 / 모호

export class TypeResolver {
  private byId = new Map<string, ResolvableType>();
  private bySimple = new Map<string, ResolvableType[]>();

  constructor(types: ResolvableType[]) {
    for (const t of types) {
      this.byId.set(t.id, t);
      const list = this.bySimple.get(t.name) ?? [];
      list.push(t);
      this.bySimple.set(t.name, list);
    }
  }

  has(id: string) {
    return this.byId.has(id);
  }

  hasSimpleName(name: string) {
    return this.bySimple.has(name);
  }

  resolve(rawName: string, arity: number, ctx: TypeContext): ResolveResult {
    let name = rawName.replace(/^global::/, "").replace(/\s+/g, "");
    // 제네릭 인자가 문자열에 남아 있으면 떼어냄
    const lt = name.indexOf("<");
    if (lt >= 0) {
      if (!arity) arity = name.slice(lt).split(",").length;
      name = name.slice(0, lt);
    }
    name = name.replace(/\?$/, "").replace(/(\[[,\s]*\])+$/, "");
    if (!name || ctx.typeParams.includes(name)) return { status: "external" };

    const parts = name.split(".");
    // 별칭 (using X = A.B;)
    if (ctx.aliases[parts[0]]) {
      parts.splice(0, 1, ...ctx.aliases[parts[0]].split("."));
      name = parts.join(".");
    }
    const simple = parts[parts.length - 1];
    const candidates = (this.bySimple.get(simple) ?? []).filter((c) => c.arity === arity || arity < 0);
    if (!candidates.length) return { status: "external" };

    const key = (fullName: string) => (arity > 0 ? `${fullName}\`${arity}` : fullName);

    if (parts.length > 1) {
      // 정규화된 이름: 그대로 / 현재 네임스페이스 기준 / using 기준 / 바깥 타입 기준
      const tries = [key(name)];
      for (const prefix of nsChain(ctx.namespace)) tries.push(key(`${prefix}.${name}`));
      for (const u of ctx.usings) tries.push(key(`${u}.${name}`));
      for (const o of ctx.outerIds) tries.push(key(`${o}.${name}`));
      // 중간 세그먼트가 중첩 타입일 수 있으므로 (Outer.Inner) 첫 세그먼트를 타입으로 해석해 본다
      const head = this.resolve(parts[0], 0, ctx);
      if (head.status === "ok") tries.push(key(`${head.id}.${parts.slice(1).join(".")}`));
      for (const t of tries) if (this.byId.has(t)) return { status: "ok", id: t };
      return { status: "unresolved" };
    }

    // 1) 바깥 타입의 중첩 타입 (가까운 것부터) — 상속받은 중첩 타입은 고려하지 않음
    for (const o of ctx.outerIds) {
      const id = key(`${o}.${simple}`);
      if (this.byId.has(id)) return { status: "ok", id };
    }
    // 2) 현재 네임스페이스와 상위 네임스페이스 (가장 안쪽부터)
    for (const ns of nsChain(ctx.namespace)) {
      const id = key(`${ns}.${simple}`);
      if (this.byId.has(id)) return { status: "ok", id };
    }
    // 3) using 으로 가져온 네임스페이스 — 둘 이상 맞으면 모호
    const viaUsing = ctx.usings.map((u) => key(`${u}.${simple}`)).filter((id) => this.byId.has(id));
    const unique = [...new Set(viaUsing)];
    // 4) 전역 네임스페이스
    const global = this.byId.has(key(simple)) && !this.byId.get(key(simple))!.outerId ? key(simple) : null;
    if (unique.length === 1 && !global) return { status: "ok", id: unique[0] };
    if (unique.length === 0 && global) return { status: "ok", id: global };
    if (unique.length + (global ? 1 : 0) > 1) return { status: "unresolved" };
    // 프로젝트에 같은 이름은 있지만 이 파일에서 보이지 않음 → 동명의 외부 타입일 가능성
    return { status: "unresolved" };
  }
}

/** "A.B.C" → ["A.B.C", "A.B", "A"] */
function nsChain(ns: string | undefined): string[] {
  if (!ns) return [];
  const parts = ns.split(".");
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join("."));
  return out;
}
