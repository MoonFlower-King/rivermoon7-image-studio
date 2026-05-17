import { describe, expect, it, vi } from "vitest";

import {
  createConversationTurn,
  mergeSingleResultImage,
  runImageFanOutRequests,
} from "./submit-utils";

describe("runImageFanOutRequests", () => {
  it("requests each generated image separately with stable result slots", async () => {
    const requestImage = vi.fn(async (index: number) => ({
      data: [{ b64_json: `image-${index}` }],
    }));

    const images = await runImageFanOutRequests({
      turnId: "turn-1",
      count: 4,
      outputFormat: "jpeg",
      requestImage,
    });

    expect(requestImage).toHaveBeenCalledTimes(4);
    expect(requestImage.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3]);
    expect(images).toHaveLength(4);
    expect(images.map((image) => image.status)).toEqual([
      "success",
      "success",
      "success",
      "success",
    ]);
    expect(images.map((image) => image.b64_json)).toEqual([
      "image-0",
      "image-1",
      "image-2",
      "image-3",
    ]);
    expect(images.map((image) => image.id)).toEqual([
      "turn-1-0",
      "turn-1-1",
      "turn-1-2",
      "turn-1-3",
    ]);
    expect(images.some((image) => image.error === "接口返回的图片数量不足")).toBe(false);
  });

  it("keeps successful images when one fan-out request fails", async () => {
    const requestImage = vi.fn(async (index: number) => {
      if (index === 2) {
        throw new Error("上游临时失败");
      }
      return { data: [{ b64_json: `image-${index}` }] };
    });

    const images = await runImageFanOutRequests({
      turnId: "turn-2",
      count: 4,
      outputFormat: "jpeg",
      requestImage,
    });

    expect(requestImage).toHaveBeenCalledTimes(4);
    expect(images.map((image) => image.status)).toEqual([
      "success",
      "success",
      "error",
      "success",
    ]);
    expect(images[2]).toMatchObject({
      id: "turn-2-2",
      status: "error",
      error: "上游临时失败",
    });
  });

  it("limits concurrent image requests", async () => {
    let active = 0;
    let maxActive = 0;
    const requestImage = vi.fn(async (index: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: [{ b64_json: `image-${index}` }] };
    });

    const images = await runImageFanOutRequests({
      turnId: "turn-3",
      count: 5,
      concurrency: 2,
      outputFormat: "jpeg",
      requestImage,
    });

    expect(requestImage).toHaveBeenCalledTimes(5);
    expect(images).toHaveLength(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("keeps the selected output format on successful fan-out images", async () => {
    const requestImage = vi.fn(async () => ({
      data: [{ b64_json: "image-png" }],
    }));

    const images = await runImageFanOutRequests({
      turnId: "turn-png",
      count: 2,
      outputFormat: "png",
      requestImage,
    });

    expect(requestImage).toHaveBeenCalledTimes(2);
    expect(images.map((image) => image.mime_type)).toEqual([
      "image/png",
      "image/png",
    ]);
  });

  it("normalizes WebP base64 results to WebP MIME type", () => {
    const webpHeader = btoa("RIFFabcdWEBP");

    expect(
      mergeSingleResultImage(
        "turn-webp",
        0,
        [{ b64_json: webpHeader }],
        "webp",
      ),
    ).toMatchObject({
      id: "turn-webp-0",
      status: "success",
      mime_type: "image/webp",
    });
  });

  it("uses detected image bytes over requested output format", () => {
    const pngHeader = btoa("\x89PNG\r\n\x1a\n");

    expect(
      mergeSingleResultImage(
        "turn-webp-fallback",
        0,
        [{ b64_json: pngHeader }],
        "webp",
      ),
    ).toMatchObject({
      id: "turn-webp-fallback-0",
      status: "success",
      mime_type: "image/png",
    });
  });

  it("stores output format on created conversation turns", () => {
    const turn = createConversationTurn({
      turnId: "turn-format",
      title: "生成",
      mode: "generate",
      prompt: "draw",
      model: "image2.0",
      count: 1,
      outputFormat: "png",
      images: [],
      createdAt: "2026-05-15T00:00:00Z",
      status: "running",
    });

    expect(turn.outputFormat).toBe("png");
  });
});
