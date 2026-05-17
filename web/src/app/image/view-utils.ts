import type { ImageConversation, StoredImage, StoredSourceImage } from "@/store/image-conversations";
import webConfig from "@/constants/common-env";

function normalizeImageURL(url?: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^(data:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  const base = webConfig.apiUrl.replace(/\/$/, "");
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export function buildImageDataUrl(image: StoredImage) {
  if (image.url) {
    return normalizeImageURL(image.url);
  }
  if (!image.b64_json) {
    return "";
  }
  return `data:${image.mime_type || "image/png"};base64,${image.b64_json}`;
}

export function buildSourceImageUrl(source: StoredSourceImage) {
  return normalizeImageURL(source.dataUrl || source.url);
}

export function buildConversationSourceLabel(source: StoredSourceImage) {
  return source.role === "mask" ? "选区 / 遮罩" : "源图";
}

export function buildConversationPreviewSource(conversation: ImageConversation) {
  const latestSuccessfulImage = conversation.images.find(
    (image) => image.status === "success" && (image.b64_json || image.url),
  );
  if (latestSuccessfulImage) {
    return buildImageDataUrl(latestSuccessfulImage);
  }

  const firstSourceImage = conversation.sourceImages?.find((item) => item.role === "image");
  return firstSourceImage ? buildSourceImageUrl(firstSourceImage) : "";
}
