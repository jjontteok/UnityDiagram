// GitHub 주소 해석
import { describe, expect, it } from "vitest";
import { parseGithubUrl } from "../src/scan/github.js";

describe("parseGithubUrl", () => {
  it.each([
    ["https://github.com/owner/repo", { owner: "owner", repo: "repo" }],
    ["https://github.com/owner/repo.git", { owner: "owner", repo: "repo" }],
    ["github.com/owner/repo/", { owner: "owner", repo: "repo" }],
    ["git@github.com:owner/my.repo.git", { owner: "owner", repo: "my.repo" }],
    ["https://github.com/owner/repo/tree/dev/Game/Client", { owner: "owner", repo: "repo", branch: "dev", subPath: "Game/Client" }],
  ])("%s", (input, expected) => {
    expect(parseGithubUrl(input)).toMatchObject(expected);
  });

  it.each(["C:\Users\me\Game", "https://gitlab.com/a/b", "https://github.com/owner", "https://github.com/a/b/tree/-x", "https://github.com/a;b/c"])(
    "거부: %s",
    (input) => {
      expect(parseGithubUrl(input)).toBeNull();
    },
  );
});
