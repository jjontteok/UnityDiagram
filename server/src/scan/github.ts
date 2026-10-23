// GitHub 저장소 주소를 받아, 분석에 필요한 파일만 내려받는다 (git sparse checkout + partial clone).
// 텍스처·사운드 같은 큰 파일은 받지 않으므로 큰 Unity 저장소도 빠르게 가져온다.
// 비공개 저장소는 이 PC 의 git 로그인 정보(Git Credential Manager 등)를 그대로 쓴다.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TOOL_ROOT } from "../cache.js";

export interface GithubRef {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
  url: string; // https://github.com/owner/repo
}

export interface GithubCheckout {
  ref: GithubRef;
  dir: string; // 내려받은 폴더
  projectRoot: string; // 그 안의 Unity 프로젝트 루트
  commit: string;
  branch: string;
  warnings: string[];
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
// 브랜치에 공백·옵션처럼 보이는 값 등은 허용하지 않는다
const BRANCH = /^(?!-)[A-Za-z0-9_./-]{1,200}$/;

/** 분석에 필요한 파일 패턴 (sparse-checkout, non-cone) */
const SPARSE_PATTERNS = [
  "*.cs",
  "*.cs.meta",
  "*.prefab",
  "*.unity",
  "*.asset",
  "*.asset.meta",
  "*.asmdef",
  "ProjectVersion.txt",
  "manifest.json",
  // 플러그인 폴더 판별용 (fileScanner 의 MARKER_GLOBS)
  "LICENSE",
  "LICENSE.*",
  "LICENCE*",
  "License.*",
  "*Third-Party Notices*",
  "*Third Party Notices*",
  "package.json",
];

/** "https://github.com/o/r", "github.com/o/r/tree/main/sub", "git@github.com:o/r.git" 등을 해석. 아니면 null */
export function parseGithubUrl(input: string): GithubRef | null {
  const s = input.trim().replace(/^"(.*)"$/, "$1");
  let m = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(s);
  if (m) return make(m[1], m[2]);
  m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:\/(?:tree|blob)\/(.+?))?\/?(?:[?#].*)?$/.exec(s);
  if (!m) return null;
  const ref = make(m[1], m[2]);
  if (!ref) return null;
  if (m[3]) {
    // tree/<branch>/<path> — 브랜치 이름에 / 가 들어갈 수 있어 정확히 나눌 수 없으므로 첫 세그먼트를 브랜치로 본다
    const [branch, ...rest] = decodeURIComponent(m[3]).split("/");
    if (!BRANCH.test(branch)) return null;
    ref.branch = branch;
    if (rest.length) ref.subPath = rest.join("/");
  }
  return ref;

  function make(owner: string, repo: string): GithubRef | null {
    if (!NAME.test(owner) || !NAME.test(repo)) return null;
    return { owner, repo, url: `https://github.com/${owner}/${repo}` };
  }
}

function git(args: string[], cwd?: string, timeoutMs = 10 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        // 대화형 로그인 창 대신 실패하도록 (서버에서 멈추지 않게) / LFS 큰 파일은 받지 않음
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(friendlyGitError(stderr || err.message)));
        else resolve(stdout.trim());
      },
    );
  });
}

function friendlyGitError(msg: string): string {
  if (/not found|Repository not found/i.test(msg)) return "저장소를 찾을 수 없습니다. 주소가 맞는지, 비공개 저장소라면 이 PC 의 git 에 GitHub 로그인이 되어 있는지 확인하세요.";
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(msg)) {
    return "GitHub 인증이 필요합니다 (비공개 저장소). 명령 프롬프트에서 `git clone <주소>` 를 한 번 실행해 로그인한 뒤 다시 시도하세요.";
  }
  if (/Remote branch .* not found|couldn't find remote ref/i.test(msg)) return "브랜치를 찾을 수 없습니다.";
  if (/Could not resolve host|unable to access|timed out/i.test(msg)) return "GitHub 에 연결할 수 없습니다. 네트워크(프록시)를 확인하세요.";
  if (/ENOENT|not recognized/i.test(msg)) return "git 이 설치되어 있지 않습니다. https://git-scm.com 에서 설치하세요.";
  return `git 오류: ${msg.split("\n").filter(Boolean).slice(-2).join(" ")}`;
}

/** 저장소를 .cache/repos 아래로 내려받거나(처음) 최신으로 갱신(다음부터) */
export async function checkoutGithub(ref: GithubRef, onProgress: (label: string) => void): Promise<GithubCheckout> {
  const dir = path.join(TOOL_ROOT, ".cache", "repos", ref.owner, `${ref.repo}${ref.branch ? `@${ref.branch.replace(/[\\/]/g, "_")}` : ""}`);
  const warnings: string[] = [];
  const exists = await fs.stat(path.join(dir, ".git")).then(() => true, () => false);

  if (!exists) {
    onProgress("GitHub 저장소를 내려받는 중… (코드·프리팹·씬만)");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await git([
      "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--single-branch",
      ...(ref.branch ? ["--branch", ref.branch] : []),
      `${ref.url}.git`, dir,
    ]);
    await git(["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], dir);
    await git(["checkout"], dir);
  } else {
    onProgress("GitHub 저장소를 최신으로 갱신하는 중…");
    await git(["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], dir);
    await git(["fetch", "--depth", "1", "origin"], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
  }
  const commit = await git(["rev-parse", "HEAD"], dir);
  const branch = ref.branch ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir).catch(() => "HEAD"));

  // Unity 프로젝트 루트 찾기: 하위 경로가 주어졌으면 그곳, 아니면 Assets 폴더가 있는 가장 얕은 폴더
  let projectRoot = dir;
  if (ref.subPath) {
    projectRoot = path.resolve(dir, ref.subPath);
    if (path.relative(dir, projectRoot).startsWith("..")) throw new Error("잘못된 하위 경로입니다");
  }
  if (!(await isDir(path.join(projectRoot, "Assets")))) {
    const found = await findUnityRoots(projectRoot, 3);
    if (!found.length) throw new Error("저장소 안에서 Unity 프로젝트(Assets 폴더)를 찾지 못했습니다. 주소에 /tree/<브랜치>/<폴더> 로 프로젝트 폴더를 지정해 보세요.");
    projectRoot = found[0];
    if (found.length > 1) {
      warnings.push(`저장소에 Unity 프로젝트가 ${found.length}개 있어 첫 번째(${path.relative(dir, found[0]).replace(/\\/g, "/") || "/"})를 분석했습니다. 다른 것을 보려면 주소에 /tree/<브랜치>/<폴더> 를 붙이세요.`);
    }
  }
  return { ref, dir, projectRoot, commit, branch, warnings };
}

async function isDir(p: string) {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

async function findUnityRoots(base: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  let level = [base];
  for (let d = 0; d < depth && !out.length; d++) {
    const next: string[] = [];
    for (const dir of level) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
        const child = path.join(dir, e.name);
        if (await isDir(path.join(child, "Assets"))) out.push(child);
        else next.push(child);
      }
    }
    level = next;
  }
  return out.sort();
}
