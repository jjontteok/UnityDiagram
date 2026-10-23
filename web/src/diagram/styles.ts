// Cytoscape 스타일 (SPEC 4.3 색상, 7.3 노드, 7.4 엣지)
import type { StylesheetJson } from "cytoscape";
import type { UnityRole } from "../types";

interface Palette {
  bg: string;
  text: string;
  muted: string;
  edge: string;
  moduleFill: string;
  moduleBorder: string;
  collapsedFill: string;
  focus: string;
  incoming: string;
  role: Record<UnityRole, { fill: string; border: string }>;
  ui: { fill: string; border: string };
  singleton: string;
  green: string;
  purple: string;
  red: string;
}

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#f7f8fa",
    text: "#1d2330",
    muted: "#6b7385",
    edge: "#8a93a6",
    moduleFill: "#eef1f6",
    moduleBorder: "#c7cedb",
    collapsedFill: "#e3e8f1",
    focus: "#00b4d8",
    incoming: "#d6336c",
    role: {
      MonoBehaviour: { fill: "#dbe8ff", border: "#4a7bd0" },
      NetworkBehaviour: { fill: "#ffcc94", border: "#e8740c" },
      ScriptableObject: { fill: "#d9f2e3", border: "#2f9a5c" },
      EditorScript: { fill: "#e6e6e6", border: "#8c8c8c" },
      Interface: { fill: "#ffffff", border: "#6b7385" },
      Data: { fill: "#fff3cc", border: "#c9a227" },
      Enum: { fill: "#eceff3", border: "#9aa3b2" },
      External: { fill: "#f0f0f0", border: "#a0a0a0" },
    },
    ui: { fill: "#eadcff", border: "#8a4fd8" },
    singleton: "#d93b3b",
    green: "#2f9a5c",
    purple: "#8a4fd8",
    red: "#d93b3b",
  },
  dark: {
    bg: "#14171d",
    text: "#e4e8f0",
    muted: "#99a2b4",
    edge: "#6d7689",
    moduleFill: "#1b2029",
    moduleBorder: "#363e4d",
    collapsedFill: "#232a36",
    focus: "#3fd0f0",
    incoming: "#ff6b9d",
    role: {
      MonoBehaviour: { fill: "#1f3354", border: "#6f9ce8" },
      NetworkBehaviour: { fill: "#7a3a00", border: "#ff9a3c" },
      ScriptableObject: { fill: "#1c3a2a", border: "#5cc48a" },
      EditorScript: { fill: "#2c2c2c", border: "#8c8c8c" },
      Interface: { fill: "#1b2029", border: "#99a2b4" },
      Data: { fill: "#3a321a", border: "#d9b440" },
      Enum: { fill: "#262b33", border: "#7d8697" },
      External: { fill: "#262626", border: "#7a7a7a" },
    },
    ui: { fill: "#33244d", border: "#b48af0" },
    singleton: "#ff6b6b",
    green: "#5cc48a",
    purple: "#b48af0",
    red: "#ff6b6b",
  },
};

export function buildStyles(theme: "light" | "dark"): StylesheetJson {
  const p = PALETTES[theme];
  const roleStyles = (Object.keys(p.role) as UnityRole[]).map((r) => ({
    selector: `node.role-${r}`,
    style: { "background-color": p.role[r].fill, "border-color": p.role[r].border },
  }));
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: p.text,
        "font-family": "'Pretendard', 'Segoe UI', 'Malgun Gothic', sans-serif",
        "font-size": 11,
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "min-zoomed-font-size": 5,
      },
    },
    {
      selector: "node.cls",
      style: {
        shape: "round-rectangle",
        width: "data(w)",
        height: "data(h)",
        "border-width": 1.5,
        "line-height": 1.25,
        "text-justification": "center",
      },
    },
    {
      selector: "node.cls.detail",
      style: { label: "data(labelFull)", width: "data(wFull)", height: "data(hFull)", "text-justification": "left", "font-size": 10 },
    },
    ...roleStyles,
    { selector: "node.tag-ui", style: { "background-color": p.ui.fill, "border-color": p.ui.border } },
    { selector: "node.tag-singleton", style: { "border-color": p.singleton, "border-width": 3 } },
    { selector: "node.iface", style: { "border-style": "dashed" } },
    { selector: "node.cycle", style: { "outline-width": 0 } },
    {
      selector: "node.module",
      style: {
        shape: "round-rectangle",
        "background-color": p.moduleFill,
        "border-color": p.moduleBorder,
        "border-width": 1.5,
        color: p.muted,
        "font-size": 13,
        "font-weight": "bold",
      },
    },
    {
      selector: "node.module.expanded",
      style: {
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -6,
        padding: "26px",
        "background-opacity": 0.55,
        // 펼친 모듈(기능) 이름: 멀리서도 읽히게 크게, 글자 뒤에 바탕
        color: p.text,
        "font-size": 20,
        "text-background-color": p.moduleBorder,
        "text-background-opacity": 0.9,
        "text-background-padding": "4px",
        "text-background-shape": "roundrectangle",
      },
    },
    {
      selector: "node.module.collapsed",
      style: {
        width: "data(w)",
        height: "data(h)",
        "background-color": p.collapsedFill,
        color: p.text,
        "border-width": 2,
        "border-style": "double",
      },
    },
    {
      // 관련 묶음 상자: 눈에 덜 띄게
      selector: "node.group",
      style: {
        shape: "round-rectangle",
        "background-color": p.moduleFill,
        "background-opacity": 0.35,
        "border-width": 1,
        "border-style": "dashed",
        "border-color": p.moduleBorder,
        label: "data(label)",
        // 묶음 이름: 작고 흐리면 무엇으로 묶였는지 알 수 없으므로 크고 진하게
        color: p.text,
        "font-size": 15,
        "font-weight": "bold",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -4,
        "text-background-color": p.moduleFill,
        "text-background-opacity": 1,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
        "text-border-color": p.moduleBorder,
        "text-border-width": 1,
        "text-border-opacity": 1,
        padding: "18px",
      },
    },
    { selector: "node:selected", style: { "border-color": p.focus, "border-width": 3.5 } },

    {
      selector: "edge",
      style: {
        width: 1.3,
        "line-color": p.edge,
        "target-arrow-color": p.edge,
        "source-arrow-color": p.edge,
        "curve-style": "bezier",
        "target-arrow-shape": "vee",
        "arrow-scale": 0.9,
        label: "data(label)",
        "font-size": 8,
        color: p.muted,
        "text-rotation": "autorotate",
        "text-background-color": p.bg,
        "text-background-opacity": 0.85,
        "text-background-padding": "1px",
        "min-zoomed-font-size": 9,
        opacity: 0.85,
      },
    },
    { selector: "edge.k-inherits", style: { "target-arrow-shape": "triangle", "target-arrow-fill": "hollow", "arrow-scale": 1.3, width: 1.8, label: "" } },
    { selector: "edge.k-implements", style: { "line-style": "dashed", "target-arrow-shape": "triangle", "target-arrow-fill": "hollow", "arrow-scale": 1.3, label: "" } },
    { selector: "edge.k-references.serialized", style: { "source-arrow-shape": "diamond", "source-arrow-fill": "hollow", "target-arrow-shape": "none" } },
    { selector: "edge.k-getsComponent, edge.k-requiresComponent", style: { "line-style": "dashed", "line-dash-pattern": [6, 3] } },
    { selector: "edge.k-usesSingleton", style: { "line-style": "dashed", "line-color": p.red, "target-arrow-color": p.red } },
    { selector: "edge.k-subscribes", style: { "line-style": "dotted", width: 2, "line-color": p.purple, "target-arrow-color": p.purple } },
    { selector: "edge.k-creates, edge.k-instantiates", style: { "line-style": "dashed", "line-color": p.green, "target-arrow-color": p.green } },
    { selector: "edge.k-coLocated", style: { "line-style": "double", width: 3, "target-arrow-shape": "none", "line-color": p.muted } },
    { selector: "edge.k-wiredInInspector", style: { "line-style": "dashed", "line-dash-pattern": [2, 4], "target-arrow-shape": "circle-triangle" } },
    { selector: "edge.k-nestedIn", style: { "target-arrow-shape": "circle", label: "" } },
    { selector: "edge.k-callsStatic, edge.k-finds", style: { "line-style": "dashed", "line-dash-pattern": [2, 3] } },
    {
      selector: "edge.agg",
      style: { width: "data(width)", "curve-style": "bezier", opacity: 0.6, "font-size": 9, "text-rotation": "none" },
    },
    { selector: "edge.agg-inherit", style: { "target-arrow-shape": "triangle", "target-arrow-fill": "hollow" } },
    // 선택한 노드와 연결된 화살표: 나가는 것(하늘색) / 들어오는 것(분홍색), 나머지는 흐리게
    { selector: "edge.sel-fade", style: { opacity: 0.18 } },
    {
      selector: "edge.sel-out",
      style: { "line-color": p.focus, "target-arrow-color": p.focus, "source-arrow-color": p.focus, width: 2.6, opacity: 1, "z-index": 15, color: p.text },
    },
    {
      selector: "edge.sel-in",
      style: { "line-color": p.incoming, "target-arrow-color": p.incoming, "source-arrow-color": p.incoming, width: 2.6, opacity: 1, "z-index": 15, color: p.text },
    },
    { selector: "edge:selected", style: { "line-color": p.focus, "target-arrow-color": p.focus, "source-arrow-color": p.focus, width: 3, opacity: 1 } },

    // 해설 하이라이트 (SPEC 7.5)
    { selector: ".dim", style: { opacity: 0.15 } },
    { selector: "node.module.dim", style: { opacity: 0.35 } },
    {
      selector: "node.focus",
      style: {
        opacity: 1,
        "border-color": p.focus,
        "border-width": 4,
        "underlay-color": p.focus,
        "underlay-opacity": 0.25,
        "underlay-padding": 8,
        // 멀리서 봐도 강조된 클래스 이름은 읽히도록
        "min-zoomed-font-size": 0,
        "font-weight": "bold",
        "z-index": 30,
      },
    },
    { selector: "node.module.focus-module", style: { opacity: 1, "border-color": p.focus, "border-width": 3 } },
    { selector: "edge.focus", style: { opacity: 1, "line-color": p.focus, "target-arrow-color": p.focus, "source-arrow-color": p.focus, width: 3, "z-index": 10 } },
    { selector: "edge.seq-active", style: { opacity: 1, "line-color": p.focus, "target-arrow-color": p.focus, width: 4.5, "z-index": 20 } },
    { selector: "node.pulse", style: { "underlay-opacity": 0.55, "underlay-padding": 16 } },
    { selector: "node.search-hit", style: { "border-color": p.focus, "border-width": 4 } },
    {
      selector: "node.token",
      style: {
        width: 14,
        height: 14,
        shape: "ellipse",
        "background-color": p.focus,
        "border-width": 2,
        "border-color": "#fff",
        label: "",
        "z-index": 100,
        events: "no",
      },
    },
  ] as StylesheetJson;
}
