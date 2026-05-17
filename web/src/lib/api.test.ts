import { beforeEach, describe, expect, it, vi } from "vitest";

const httpRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/request", () => ({
  httpRequest: httpRequestMock,
}));

vi.mock("@/constants/common-env", () => ({
  default: {
    apiUrl: "",
  },
}));

import {
  editImage,
  getImageModelForSize,
  generateImageWithOptions,
  PUBLIC_4K_IMAGE_MODEL,
  PUBLIC_IMAGE_MODEL,
  resolveImageRequestModel,
} from "./api";

describe("image API requests", () => {
  beforeEach(() => {
    httpRequestMock.mockReset();
    httpRequestMock.mockResolvedValue({ created: 0, data: [] });
  });

  it("marks image generation requests as async relay jobs", async () => {
    await generateImageWithOptions("draw a moon", { count: 1 });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Rivermoon-Async": "1" },
        body: expect.objectContaining({
          model: "image2.0",
          n: 1,
        }),
      }),
    );
  });

  it("sends PNG image generation requests without compression", async () => {
    await generateImageWithOptions("draw a moon", {
      count: 1,
      outputFormat: "png",
      outputCompression: 85,
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        body: expect.objectContaining({
          n: 1,
          output_format: "png",
        }),
      }),
    );
    const [, options] = httpRequestMock.mock.calls[0];
    expect(options.body).not.toHaveProperty("output_compression");
  });

  it("sends JPEG image generation requests with compression", async () => {
    await generateImageWithOptions("draw a moon", {
      count: 1,
      outputFormat: "jpeg",
      outputCompression: 85,
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        body: expect.objectContaining({
          n: 1,
          output_format: "jpeg",
          output_compression: 85,
        }),
      }),
    );
  });

  it("uses the 4K image model for true 4K generation sizes", async () => {
    await generateImageWithOptions("draw a moon", {
      count: 1,
      size: "3840x2160",
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        body: expect.objectContaining({
          model: "image2.0-4k",
          n: 1,
          size: "3840x2160",
        }),
      }),
    );
  });

  it("does not let the legacy default model override true 4K generation sizes", async () => {
    await generateImageWithOptions("draw a moon", {
      model: PUBLIC_IMAGE_MODEL,
      count: 1,
      size: "2160x3840",
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        body: expect.objectContaining({
          model: "image2.0-4k",
          n: 1,
          size: "2160x3840",
        }),
      }),
    );
  });

  it("keeps 2K generation sizes on the standard image model", async () => {
    await generateImageWithOptions("draw a moon", {
      count: 1,
      size: "2048x2048",
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      "/v1/images/generations",
      expect.objectContaining({
        body: expect.objectContaining({
          model: "image2.0",
          n: 1,
          size: "2048x2048",
        }),
      }),
    );
  });

  it("marks image edit requests as async relay jobs", async () => {
    await editImage({
      prompt: "change the color",
      images: [new File(["image"], "source.png", { type: "image/png" })],
      count: 1,
    });

    const [, options] = httpRequestMock.mock.calls[0];
    expect(options).toMatchObject({
      method: "POST",
      headers: { "X-Rivermoon-Async": "1" },
    });
    expect(options.body.get("model")).toBe("image2.0");
    expect(options.body.get("n")).toBe("1");
    expect(options.body.getAll("image")).toHaveLength(1);
  });

  it("sends WebP image edit requests through multipart fields", async () => {
    await editImage({
      prompt: "change the color",
      images: [new File(["image"], "source.png", { type: "image/png" })],
      count: 1,
      outputFormat: "webp",
      outputCompression: 85,
    });

    const [, options] = httpRequestMock.mock.calls[0];
    expect(options.body.get("output_format")).toBe("webp");
    expect(options.body.get("output_compression")).toBe("85");
    expect(options.body.get("n")).toBe("1");
  });

  it("uses the 4K image model for true 4K edit sizes", async () => {
    await editImage({
      prompt: "change the color",
      images: [new File(["image"], "source.png", { type: "image/png" })],
      count: 1,
      size: "2160x3840",
    });

    const [, options] = httpRequestMock.mock.calls[0];
    expect(options.body.get("model")).toBe("image2.0-4k");
    expect(options.body.get("size")).toBe("2160x3840");
  });

  it("does not let the legacy default model override true 4K edit sizes", async () => {
    await editImage({
      prompt: "change the color",
      images: [new File(["image"], "source.png", { type: "image/png" })],
      model: PUBLIC_IMAGE_MODEL,
      count: 1,
      size: "2160x3840",
    });

    const [, options] = httpRequestMock.mock.calls[0];
    expect(options.body.get("model")).toBe("image2.0-4k");
  });

  it("classifies only true 4K and larger sizes as image2.0-4k", () => {
    expect(getImageModelForSize("1024x1024")).toBe(PUBLIC_IMAGE_MODEL);
    expect(getImageModelForSize("2048x2048")).toBe(PUBLIC_IMAGE_MODEL);
    expect(getImageModelForSize("2048x1152")).toBe(PUBLIC_IMAGE_MODEL);
    expect(getImageModelForSize("3840x2160")).toBe(PUBLIC_4K_IMAGE_MODEL);
    expect(getImageModelForSize("2160x3840")).toBe(PUBLIC_4K_IMAGE_MODEL);
    expect(getImageModelForSize("4096x4096")).toBe(PUBLIC_4K_IMAGE_MODEL);
    expect(getImageModelForSize("auto")).toBe(PUBLIC_IMAGE_MODEL);
  });

  it("resolves the stored/display model from the requested size", () => {
    expect(resolveImageRequestModel("1024x1024", PUBLIC_IMAGE_MODEL)).toBe(
      PUBLIC_IMAGE_MODEL,
    );
    expect(resolveImageRequestModel("2160x3840", PUBLIC_IMAGE_MODEL)).toBe(
      PUBLIC_4K_IMAGE_MODEL,
    );
  });

  it("polls async image edit jobs until the final image response is available", async () => {
    httpRequestMock
      .mockResolvedValueOnce({
        object: "rivermoon_image_job",
        id: "job-1",
        status: "queued",
        poll_after_ms: 1,
      })
      .mockResolvedValueOnce({
        object: "rivermoon_image_job",
        id: "job-1",
        status: "running",
        poll_after_ms: 1,
      })
      .mockResolvedValueOnce({
        object: "rivermoon_image_job",
        id: "job-1",
        status: "succeeded",
        response_status: 200,
        content_type: "application/json",
        body: {
          created: 1,
          data: [{ b64_json: "final-image" }],
        },
      });

    const result = await editImage({
      prompt: "change the color",
      images: [new File(["image"], "source.png", { type: "image/png" })],
      count: 1,
    });

    expect(result.data).toEqual([{ b64_json: "final-image" }]);
    expect(httpRequestMock.mock.calls.map(([path]) => path)).toEqual([
      "/v1/images/edits",
      "/v1/images/edits?job_id=job-1",
      "/v1/images/edits?job_id=job-1",
    ]);
  });
});
