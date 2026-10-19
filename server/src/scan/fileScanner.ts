// Unity 프로젝트의 분석 대상 파일 목록 (SPEC 4.1)
import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";

/** 기본 제외: Unity 가 무시하는 폴더(~, 점으로 시작) + 서드파티 */
export const DEFAULT_EXCLUDES = [
  "Assets/Plugins/**",
  "Assets/TextMesh Pro/**",
  "Assets/_Recovery/**",
  "**/~*/**",
  "**/*~/**",
  "**/.*/**",
];

/** 제외된 폴더 중 "외부 라이브러리" 노드로 묶어 참조만 표시할 곳 */
export const LIBRARY_GLOBS = ["Assets/Plugins/*/", "Assets/TextMesh Pro/"];

export interface ScanResult {
  scripts: string[];
  metas: string[];
  prefabs: string[];
  scenes: string[];
  assets: string[];
  asmdefs: string[];
  /** 라이브러리 이름 → .cs 파일들 */
  libraries: Map<string, string[]>;
}

export async function assertUnityProject(root: string) {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`폴더를 찾을 수 없습니다: ${root}`);
  const assets = await fs.stat(path.join(root, "Assets")).catch(() => null);
  if (!assets?.isDirectory()) throw new Error(`Unity 프로젝트가 아닙니다 (Assets 폴더 없음): ${root}`);
}

export async function scanProject(root: string, excludeGlobs: string[]): Promise<ScanResult> {
  const opts = { cwd: root, ignore: excludeGlobs, dot: false, onlyFiles: true, followSymbolicLinks: false };
  const [scripts, prefabs, scenes, assets, asmdefs] = await Promise.all([
    fg("Assets/**/*.cs", opts),
    fg("Assets/**/*.prefab", opts),
    fg("Assets/**/*.unity", opts),
    fg("Assets/**/*.asset", opts),
    fg("Assets/**/*.asmdef", opts),
  ]);
  // .meta 는 제외 폴더와 무관하게 모두 읽는다 — 프리팹이 서드파티 스크립트를 참조할 수 있음
  const metas = await fg("Assets/**/*.cs.meta", { cwd: root, onlyFiles: true, ignore: ["**/~*/**", "**/*~/**", "**/.*/**"] });

  const libraries = new Map<string, string[]>();
  for (const lib of await fg(LIBRARY_GLOBS, { cwd: root, onlyDirectories: true, markDirectories: true })) {
    const dir = lib.replace(/\/$/, "");
    const files = await fg(`${fg.escapePath(dir)}/**/*.cs`, { cwd: root, ignore: ["**/Editor/**", "**/Tests/**", "**/Samples*/**"] });
    if (files.length) libraries.set(path.posix.basename(dir), files);
  }
  const sort = (a: string[]) => a.sort((x, y) => x.localeCompare(y));
  return { scripts: sort(scripts), metas, prefabs: sort(prefabs), scenes: sort(scenes), assets: sort(assets), asmdefs, libraries };
}
