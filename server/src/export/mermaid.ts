// Mermaid classDiagram 텍스트 내보내기 (SPEC 3.1 보조 출력)
import type { EdgeKind, ProjectGraph } from "../types.js";

const ARROWS: Partial<Record<EdgeKind, (a: string, b: string) => string>> = {
  inherits: (a, b) => `${b} <|-- ${a}`,
  implements: (a, b) => `${b} <|.. ${a}`,
  nestedIn: (a, b) => `${b} +-- ${a}`,
};

export function toMermaid(g: ProjectGraph, moduleId?: string, maxMembers = 6): string {
  const mod = moduleId ? Object.values(g.modulesByRule).flatMap((m) => m!).find((m) => m.id === moduleId) : undefined;
  const ids = new Set(mod ? mod.nodeIds : g.nodes.map((n) => n.id));
  const nodes = g.nodes.filter((n) => ids.has(n.id));
  const used = new Map<string, string>();
  const safe = (id: string) => {
    let s = used.get(id);
    if (!s) {
      const base = id.replace(/^lib:/, "").replace(/^.*\./, "").replace(/`(\d+)$/, "_$1").replace(/[^A-Za-z0-9_]/g, "_");
      s = base;
      let i = 2;
      while ([...used.values()].includes(s)) s = `${base}_${i++}`;
      used.set(id, s);
    }
    return s;
  };
  const clean = (t: string) => t.replace(/</g, "~").replace(/>/g, "~").replace(/[{}]/g, "");

  const lines = ["classDiagram"];
  for (const n of nodes) {
    lines.push(`  class ${safe(n.id)} {`);
    const stereo = n.kind === "interface" ? "interface" : n.kind === "enum" ? "enumeration" : n.unityRole;
    lines.push(`    <<${stereo}>>`);
    const fields = n.fields.filter((f) => f.serialized || f.access === "public").slice(0, maxMembers);
    for (const f of fields) lines.push(`    ${f.access === "public" ? "+" : "-"}${clean(f.type)} ${f.name}`);
    const methods = n.methods.filter((m) => m.access === "public" || m.isUnityMessage || m.isRpc).slice(0, maxMembers);
    for (const m of methods) lines.push(`    ${m.access === "public" ? "+" : "-"}${m.name}()${m.returnType && m.returnType !== "void" ? ` ${clean(m.returnType)}` : ""}`);
    lines.push("  }");
  }
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const a = safe(e.source);
    const b = safe(e.target);
    const arrow = ARROWS[e.kind];
    if (arrow) lines.push(`  ${arrow(a, b)}`);
    else if (e.kind === "references") lines.push(`  ${a} ${e.serialized ? "o--" : "-->"} ${b}${e.multiplicity === "many" ? ' : "*"' : ""}`);
    else if (e.kind === "coLocated") lines.push(`  ${a} .. ${b} : same GameObject`);
    else lines.push(`  ${a} ..> ${b} : ${e.kind}`);
  }
  return lines.join("\n") + "\n";
}
