import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/release.yml", root), "utf8");
const releaseConfig = JSON.parse(readFileSync(new URL(".releaserc.json", root), "utf8")) as {
  plugins: unknown[];
};

describe("release publication ordering", () => {
  it("does not let semantic-release publish a public GitHub release", () => {
    expect(JSON.stringify(releaseConfig.plugins)).not.toContain("@semantic-release/github");
    expect(workflow).toContain('gh release create "v${VERSION}" --draft');
  });

  it("titles the release with the bare tag, matching the historical convention", () => {
    // Older releases (v1.0.0 … v1.5.0) are titled "vX.Y.Z". Set the title
    // explicitly rather than relying on tauri-action to overwrite a "Noteside …" name.
    expect(workflow).toContain('--title "v${VERSION}"');
    expect(workflow).not.toContain('--title "Noteside');
  });

  it("uploads every matrix artifact to the draft before publishing", () => {
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).not.toContain("releaseDraft: false");
    expect(workflow).toContain("needs: [release, build]");
    // The publish step flips the draft to a public "latest" release. Match the
    // flag-flip only (not the exact gh invocation) so adding flags like --repo
    // doesn't break this guard.
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--draft=false --latest");
    expect(workflow.indexOf("releaseDraft: true")).toBeLessThan(
      workflow.indexOf("--draft=false --latest"),
    );
  });
});
