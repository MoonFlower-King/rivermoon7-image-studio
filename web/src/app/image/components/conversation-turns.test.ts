import { describe, expect, it } from "vitest";

import { buildDownloadName } from "./conversation-turns";

describe("buildDownloadName", () => {
  it("uses JPG extension for JPEG MIME results", () => {
    expect(
      buildDownloadName(
        "2026-05-15T00:02:39Z",
        "turn-download",
        0,
        { id: "image-1", mime_type: "image/jpeg" },
        "png",
      ),
    ).toMatch(/-01\.jpg$/);
  });

  it("uses PNG extension for selected PNG output format", () => {
    expect(
      buildDownloadName(
        "2026-05-15T00:02:39Z",
        "turn-download",
        0,
        { id: "image-1" },
        "png",
      ),
    ).toMatch(/-01\.png$/);
  });

  it("uses WebP extension for WebP data URLs", () => {
    expect(
      buildDownloadName(
        "2026-05-15T00:02:39Z",
        "turn-download",
        0,
        { id: "image-1", url: "data:image/webp;base64,abcd" },
      ),
    ).toMatch(/-01\.webp$/);
  });
});
