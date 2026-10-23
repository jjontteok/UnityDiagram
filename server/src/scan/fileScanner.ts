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

/** 이름만으로 플러그인(서드파티) 폴더로 보는 것 — 어느 깊이에 있어도 (소문자, 공백·기호 제거 후 비교) */
const PLUGIN_NAMES = new Set([
  "plugins", "thirdparty", "3rdparty", "externalassets", "externals", "vendor", "vendors", "assetstore", "assetstoretools",
  "textmeshpro", "demigiant", "dotween", "sirenix", "photon", "unirx", "unitask", "fishnet", "moremountains",
  "addressableassetsdata",
]);
/** 여러 플러그인을 모아 두는 폴더 — 안의 하위 폴더 하나하나를 라이브러리로 본다 */
const CONTAINER_NAMES = new Set(["plugins", "thirdparty", "3rdparty", "externalassets", "externals", "vendor", "vendors", "assetstore"]);
/** 이 파일이 있는 폴더는 배포된 패키지(서드파티)로 본다 */
const MARKER_GLOBS = ["Assets/*/**/{LICENSE,LICENSE.*,LICENCE,LICENCE.*,License.*,*Third-Party Notices*,*Third Party Notices*,package.json}"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface PluginDir {
  path: string;
  scripts: number;
  reason: string;
}

export interface ScanResult {
  scripts: string[];
  metas: string[];
  prefabs: string[];
  scenes: string[];
  assets: string[];
  asmdefs: string[];
  /** 라이브러리 이름 → .cs 파일들 */
  libraries: Map<string, string[]>;
  /** 자동으로 제외한 플러그인 폴더 */
  plugins: PluginDir[];
}

export async function assertUnityProject(root: string) {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`폴더를 찾을 수 없습니다: ${root}`);
  const assets = await fs.stat(path.join(root, "Assets")).catch(() => null);
  if (!assets?.isDirectory()) throw new Error(`Unity 프로젝트가 아닙니다 (Assets 폴더 없음): ${root}`);
}

/** Assets 안에서 플러그인(에셋 스토어·외부 패키지)으로 보이는 폴더를 찾는다. 바깥쪽 폴더만 남긴다 */
export async function detectPluginDirs(root: string): Promise<{ path: string; reason: string }[]> {
  const ignore = ["**/~*/**", "**/*~/**", "**/.*/**"];
  const found = new Map<string, string>();
  const dirs = await fg("Assets/**", { cwd: root, onlyDirectories: true, ignore, followSymbolicLinks: false });
  for (const d of dirs) {
    const name = norm(path.posix.basename(d));
    if (PLUGIN_NAMES.has(name)) found.set(d, "플러그인 폴더 이름");
    // Package Manager 가 가져온 샘플 (Assets/Samples/패키지/버전)
    else if (d === "Assets/Samples") found.set(d, "패키지 샘플");
  }
  for (const f of await fg(MARKER_GLOBS, { cwd: root, onlyFiles: true, ignore, caseSensitiveMatch: false, followSymbolicLinks: false })) {
    const d = path.posix.dirname(f);
    if (!found.has(d)) found.set(d, `배포 패키지 파일(${path.posix.basename(f)})`);
  }
  const all = [...found.keys()].sort();
  return all.filter((d) => !all.some((o) => o !== d && d.startsWith(`${o}/`))).map((d) => ({ path: d, reason: found.get(d)! }));
}

export async function scanProject(root: string, excludeGlobs: string[], autoExcludePlugins = true): Promise<ScanResult> {
  let pluginDirs = autoExcludePlugins ? await detectPluginDirs(root) : [];
  const pluginIgnore = (dirs: { path: string }[]) => dirs.map((d) => `${fg.escapePath(d.path)}/**`);
  // 플러그인으로 판단한 폴더가 스크립트 전부라면 잘못 판단한 것이므로 자동 제외를 하지 않는다
  if (pluginDirs.length) {
    const own = await fg("Assets/**/*.cs", { cwd: root, ignore: [...excludeGlobs, ...pluginIgnore(pluginDirs)], onlyFiles: true });
    if (!own.length) pluginDirs = [];
  }
  const opts = { cwd: root, ignore: [...excludeGlobs, ...pluginIgnore(pluginDirs)], dot: false, onlyFiles: true, followSymbolicLinks: false };
  const [scripts, prefabs, scenes, assets, asmdefs] = await Promise.all([
    fg("Assets/**/*.cs", opts),
    fg("Assets/**/*.prefab", opts),
    fg("Assets/**/*.unity", opts),
    fg("Assets/**/*.asset", opts),
    fg("Assets/**/*.asmdef", opts),
  ]);
  // .meta 는 제외 폴더와 무관하게 모두 읽는다 — 프리팹이 서드파티 스크립트를 참조할 수 있음
  const metas = await fg("Assets/**/*.cs.meta", { cwd: root, onlyFiles: true, ignore: ["**/~*/**", "**/*~/**", "**/.*/**"] });

  // 제외한 폴더의 공개 타입은 "외부 라이브러리" 노드로 묶어, 프로젝트 코드가 무엇을 쓰는지만 보이게 한다
  const libDirs = new Set<string>();
  const queue = [...pluginDirs.map((p) => p.path), "Assets/Plugins", "Assets/TextMesh Pro"];
  while (queue.length) {
    const d = queue.shift()!;
    // ThirdParty/ExternalAssets 처럼 모음 폴더가 겹쳐 있으면 한 번 더 들어간다
    if (CONTAINER_NAMES.has(norm(path.posix.basename(d)))) queue.push(...(await fg(`${fg.escapePath(d)}/*`, { cwd: root, onlyDirectories: true })));
    else libDirs.add(d);
  }
  const libraries = new Map<string, string[]>();
  const plugins: PluginDir[] = [];
  const libIgnore = ["**/Editor/**", "**/Tests/**", "**/Samples*/**", "**/Demo*/**", "**/Example*/**"];
  for (const dir of libDirs) {
    const files = await fg(`${fg.escapePath(dir)}/**/*.cs`, { cwd: root, ignore: libIgnore });
    if (files.length) libraries.set(path.posix.basename(dir), [...(libraries.get(path.posix.basename(dir)) ?? []), ...files]);
  }
  for (const p of pluginDirs) {
    const n = (await fg(`${fg.escapePath(p.path)}/**/*.cs`, { cwd: root, onlyFiles: true })).length;
    if (n) plugins.push({ ...p, scripts: n });
  }
  const sort = (a: string[]) => a.sort((x, y) => x.localeCompare(y));
  return { scripts: sort(scripts), metas, prefabs: sort(prefabs), scenes: sort(scenes), assets: sort(assets), asmdefs, libraries, plugins };
}
