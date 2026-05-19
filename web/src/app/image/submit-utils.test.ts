import { describe, expect, it, vi } from "vitest";

import {
  buildReferencedImagePrompt,
  createConversationTurn,
  mergeSingleResultImage,
  runImageFanOutRequests,
  withStableSourceImageLabels,
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

describe("buildReferencedImagePrompt", () => {
  it("assigns stable image labels without renumbering existing sources", () => {
    const existingSources = [
      {
        id: "source-2",
        role: "image" as const,
        name: "kept.png",
        referenceLabel: "@图2",
      },
    ];

    const nextSources = withStableSourceImageLabels(existingSources, [
      {
        id: "source-3",
        role: "image",
        name: "new.png",
      },
      {
        id: "mask-1",
        role: "mask",
        name: "mask.png",
      },
    ]);

    expect(existingSources[0].referenceLabel).toBe("@图2");
    expect(nextSources[0].referenceLabel).toBe("@图3");
    expect(nextSources[1].referenceLabel).toBeUndefined();
  });

  it("adds a reference guide when prompt uses source image mentions", () => {
    const prompt = buildReferencedImagePrompt("让 @图1 穿上 @衣服 的外套", [
      {
        id: "source-1",
        role: "image",
        name: "person.png",
        referenceLabel: "@图1",
      },
      {
        id: "source-2",
        role: "image",
        name: "coat.png",
        referenceLabel: "@图2",
        referenceAlias: "@衣服",
      },
    ]);

    expect(prompt).toContain("参考图说明：");
    expect(prompt).toContain("- @图1：第 1 张参考图，文件名 person.png");
    expect(prompt).toContain("- @图2 / @衣服：第 2 张参考图，文件名 coat.png");
    expect(prompt).toContain("用户要求：\n让 @图1 穿上 @衣服 的外套");
  });

  it("keeps prompts without source images unchanged", () => {
    expect(buildReferencedImagePrompt("生成一张城市夜景", [])).toBe(
      "生成一张城市夜景",
    );
  });

  it("adds ordering guidance for multiple source images without explicit mentions", () => {
    const prompt = buildReferencedImagePrompt("合成一张产品海报", [
      {
        id: "source-1",
        role: "image",
        name: "product.png",
        referenceLabel: "@图1",
      },
      {
        id: "source-2",
        role: "image",
        name: "background.png",
        referenceLabel: "@图2",
      },
    ]);

    expect(prompt).toContain("如果用户要求没有点名某张图，请按上述编号和上传顺序区分参考图，避免混淆。");
    expect(prompt).toContain("用户要求：\n合成一张产品海报");
  });
});
