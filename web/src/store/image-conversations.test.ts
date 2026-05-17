import { describe, expect, it } from "vitest";

import { normalizeConversation } from "./image-conversations";

describe("normalizeConversation", () => {
  it("preserves 4K image model names in history", () => {
    const conversation = normalizeConversation({
      id: "conversation-4k",
      title: "4K",
      mode: "generate",
      prompt: "draw",
      model: "image2.0-4k",
      count: 1,
      size: "3840x2160",
      images: [],
      createdAt: "2026-05-15T00:00:00Z",
      updatedAt: "2026-05-15T00:00:00Z",
      status: "success",
      turns: [
        {
          id: "turn-4k",
          title: "4K",
          mode: "generate",
          prompt: "draw",
          model: "image2.0-4k",
          count: 1,
          size: "3840x2160",
          images: [],
          createdAt: "2026-05-15T00:00:00Z",
          status: "success",
        },
      ],
    });

    expect(conversation.model).toBe("image2.0-4k");
    expect(conversation.turns[0].model).toBe("image2.0-4k");
  });
});
