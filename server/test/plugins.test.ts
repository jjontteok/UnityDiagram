// 플러그인(서드파티) 폴더 자동 제외
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDES, scanProject } from "../src/scan/fileScanner.js";

let root: string;
const put = (rel: string, text = "public class A {}") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ucd-plugins-"));
  put("Assets/Scripts/Player.cs", "public class Player {}");
  put("Assets/Scripts/Readme.md", "내 프로젝트 설명"); // README 만으로는 플러그인으로 보지 않음
  put("Assets/Demigiant/DOTween/Tween.cs", "namespace DG.Tweening { public class Tween {} }");
  put("Assets/ThirdParty/ExternalAssets/UIFX/Fx.cs", "public class Fx {}");
  put("Assets/SomeAsset/LICENSE.md", "MIT");
  put("Assets/SomeAsset/Runtime/Thing.cs", "public class Thing {}");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("플러그인 폴더 자동 제외", () => {
  it("이름·LICENSE 로 찾은 폴더를 빼고 직접 만든 스크립트만 남긴다", async () => {
    const s = await scanProject(root, DEFAULT_EXCLUDES);
    expect(s.scripts).toEqual(["Assets/Scripts/Player.cs"]);
    expect(s.plugins.map((p) => p.path).sort()).toEqual(["Assets/Demigiant", "Assets/SomeAsset", "Assets/ThirdParty"]);
    // 모음 폴더(ThirdParty/ExternalAssets)는 안쪽 폴더 단위로 외부 라이브러리가 된다
    expect([...s.libraries.keys()].sort()).toEqual(["Demigiant", "SomeAsset", "UIFX"]);
  });

  it("끄면 모두 분석한다", async () => {
    const s = await scanProject(root, DEFAULT_EXCLUDES, false);
    expect(s.scripts).toHaveLength(4);
    expect(s.plugins).toEqual([]);
  });
});
