// .cache/ 아래에 분석 그래프와 최근 경로를 저장
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectGraph } from "./types.js";

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_DIR = path.join(TOOL_ROOT, ".cache");

const graphs = new Map<string, ProjectGraph>();

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function saveGraph(g: ProjectGraph) {
  graphs.set(g.graphId, g);
  await writeJson(path.join(CACHE_DIR, "graphs", `${g.graphId}.json`), g);
}

export async function loadGraph(graphId: string): Promise<ProjectGraph | undefined> {
  if (!/^[0-9a-f]{16}$/.test(graphId)) return undefined;
  const hit = graphs.get(graphId);
  if (hit) return hit;
  const g = await readJson<ProjectGraph>(path.join(CACHE_DIR, "graphs", `${graphId}.json`));
  if (g) graphs.set(graphId, g);
  return g;
}

// ───── 최근 프로젝트 ─────

const RECENT_FILE = path.join(CACHE_DIR, "recent.json");

export interface RecentProject {
  path: string;
  projectName: string;
  graphId: string;
  analyzedAt: string;
}

export async function loadRecent(): Promise<RecentProject[]> {
  return (await readJson<RecentProject[]>(RECENT_FILE)) ?? [];
}

export async function pushRecent(r: RecentProject) {
  const key = (p: string) => (/^(https?:|git@)/.test(p) ? p.replace(/\.git$|\/$/g, "").toLowerCase() : path.resolve(p));
  const list = (await loadRecent()).filter((x) => key(x.path) !== key(r.path));
  list.unshift(r);
  await writeJson(RECENT_FILE, list.slice(0, 10));
}
