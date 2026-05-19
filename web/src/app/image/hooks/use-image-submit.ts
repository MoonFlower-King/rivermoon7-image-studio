"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";

import {
  editImage,
  generateImageWithOptions,
  PUBLIC_IMAGE_MODEL,
  resolveImageRequestModel,
  type ImageModel,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageResolutionAccess,
} from "@/lib/api";
import type {
  ImageConversation,
  ImageConversationTurn,
  ImageMode,
  StoredImage,
  StoredSourceImage,
} from "@/store/image-conversations";

import type { EditorTarget } from "./use-image-source-inputs";
import {
  buildConversationTitle,
  buildReferencedImagePrompt,
  createConversationTurn,
  createLoadingImages,
  dataUrlToFile,
  formatImageError,
  mergeResultImages,
  mergeSingleResultImage,
  runImageFanOutRequests,
} from "../submit-utils";
import { buildSourceImageUrl } from "../view-utils";

type ActiveRequestPayload = {
  conversationId: string;
  turnId: string;
  mode: ImageMode;
  count: number;
  variant: "standard" | "selection-edit";
};

type UseImageSubmitOptions = {
  mode: ImageMode;
  imagePrompt: string;
  imageModel: ImageModel;
  imageSources: StoredSourceImage[];
  maskSource: StoredSourceImage | null;
  sourceImages: StoredSourceImage[];
  parsedCount: number;
  imageSize: string;
  imageResolutionAccess: ImageResolutionAccess;
  imageQuality: ImageQuality;
  imageOutputFormat: ImageOutputFormat;
  outputCompression?: number;
  selectedConversationId: string | null;
  editorTarget: EditorTarget | null;
  makeId: () => string;
  focusConversation: (conversationId: string) => void;
  closeSelectionEditor: () => void;
  setImagePrompt: (value: string) => void;
  setSourceImages: (value: StoredSourceImage[]) => void;
  setSubmitElapsedSeconds: (value: number) => void;
  onRequestStart: (payload: ActiveRequestPayload) => void;
  onRequestFinish: (turnId: string, status: "success" | "error") => void;
  persistConversation: (conversation: ImageConversation) => Promise<void>;
  updateConversation: (
    conversationId: string,
    updater: (current: ImageConversation | null) => ImageConversation,
  ) => Promise<void>;
  resetComposer: (nextMode?: ImageMode) => void;
};

const OUTPUT_COMPRESSION = 85;
const IMAGE_FAN_OUT_CONCURRENCY = 2;
const IMAGE_EDIT_FAN_OUT_CONCURRENCY = 1;

function buildConversationBase(
  conversationId: string,
  draftTurn: ImageConversationTurn,
): ImageConversation {
  return {
    id: conversationId,
    title: draftTurn.title,
    mode: draftTurn.mode,
    prompt: draftTurn.prompt,
    model: draftTurn.model,
    count: draftTurn.count,
    size: draftTurn.size,
    resolutionAccess: draftTurn.resolutionAccess,
    quality: draftTurn.quality,
    outputFormat: draftTurn.outputFormat,
    scale: draftTurn.scale,
    sourceImages: draftTurn.sourceImages,
    images: draftTurn.images,
    createdAt: draftTurn.createdAt,
    status: draftTurn.status,
    error: draftTurn.error,
    turns: [draftTurn],
  };
}

function buildSourceReference(payload: {
  id: string;
  role: "image" | "mask";
  name: string;
  url: string;
  referenceLabel?: string;
  referenceAlias?: string;
}): StoredSourceImage {
  if (payload.url.startsWith("data:")) {
    return {
      id: payload.id,
      role: payload.role,
      name: payload.name,
      referenceLabel: payload.referenceLabel,
      referenceAlias: payload.referenceAlias,
      dataUrl: payload.url,
    };
  }
  return {
    id: payload.id,
    role: payload.role,
    name: payload.name,
    referenceLabel: payload.referenceLabel,
    referenceAlias: payload.referenceAlias,
    url: payload.url,
  };
}

function normalizeImageQuality(value: string | undefined, fallback: ImageQuality) {
  const trimmed = String(value || "").trim();
  if (
    trimmed === "low" ||
    trimmed === "medium" ||
    trimmed === "high" ||
    trimmed === "auto"
  ) {
    return trimmed;
  }
  return fallback;
}

async function sourceImageToFile(source: StoredSourceImage, fallbackName: string) {
  const fileName = source.name?.trim() || fallbackName;
  if (source.dataUrl) {
    return dataUrlToFile(source.dataUrl, fileName);
  }

  const url = buildSourceImageUrl(source);
  if (!url) {
    throw new Error(`源图 ${fileName} 缺少图片数据`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取源图失败 (${response.status})`);
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

async function sourceImagesToFiles(sources: StoredSourceImage[]) {
  const imageSources = sources.filter((item) => item.role === "image");
  return Promise.all(
    imageSources.map((source, index) =>
      sourceImageToFile(source, source.name || `source-${index + 1}.png`),
    ),
  );
}

async function sourceMaskToFile(source: StoredSourceImage | null) {
  if (!source) {
    return null;
  }
  return sourceImageToFile(source, source.name || "mask.png");
}

function mergeRetryImageResult(
  currentImages: StoredImage[],
  resultImages: StoredImage[],
  retryImageIndex: number,
) {
  if (retryImageIndex < 0) {
    return currentImages;
  }
  return currentImages.map((image, index) =>
    index === retryImageIndex ? (resultImages[0] ?? image) : image,
  );
}

function getTurnStatusFromImages(images: StoredImage[]) {
  return images.some((image) => image.status === "error") ? "error" : "success";
}

function getTurnErrorFromImages(images: StoredImage[]) {
  return images.find((image) => image.status === "error")?.error;
}

export function useImageSubmit({
  mode,
  imagePrompt,
  imageModel,
  imageSources,
  maskSource,
  sourceImages,
  parsedCount,
  imageSize,
  imageResolutionAccess,
  imageQuality,
  imageOutputFormat,
  outputCompression = OUTPUT_COMPRESSION,
  selectedConversationId,
  editorTarget,
  makeId,
  focusConversation,
  closeSelectionEditor,
  setImagePrompt,
  setSourceImages,
  setSubmitElapsedSeconds,
  onRequestStart,
  onRequestFinish,
  persistConversation,
  updateConversation,
  resetComposer,
}: UseImageSubmitOptions) {
  const isSelectionEditDispatchingRef = useRef(false);
  const isSubmitDispatchingRef = useRef(false);
  const retryingTurnIdsRef = useRef<Set<string>>(new Set());

  const finalizeTurn = useCallback(
    async (
      conversationId: string,
      turnId: string,
      draftTurn: ImageConversationTurn,
      images: StoredImage[],
    ) => {
      const status = getTurnStatusFromImages(images);
      const error = getTurnErrorFromImages(images);
      await updateConversation(conversationId, (current) => ({
        ...(current ?? buildConversationBase(conversationId, draftTurn)),
        status,
        error,
        images,
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status,
                error,
                images,
                finishedAt: new Date().toISOString(),
              }
            : turn,
        ),
      }));
      return status;
    },
    [updateConversation],
  );

  const markTurnError = useCallback(
    async (
      conversationId: string,
      turnId: string,
      draftTurn: ImageConversationTurn,
      message: string,
    ) => {
      await updateConversation(conversationId, (current) => ({
        ...(current ?? buildConversationBase(conversationId, draftTurn)),
        status: "error",
        error: message,
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                error: message,
                finishedAt: new Date().toISOString(),
                images: turn.images.map((image) => ({
                  ...image,
                  status: "error" as const,
                  error: message,
                })),
              }
            : turn,
        ),
      }));
    },
    [updateConversation],
  );

  const replaceTurnImage = useCallback(
    async (
      conversationId: string,
      turnId: string,
      draftTurn: ImageConversationTurn,
      imageIndex: number,
      image: StoredImage,
    ) => {
      await updateConversation(conversationId, (current) => {
        const base = current ?? buildConversationBase(conversationId, draftTurn);
        const turns = (base.turns ?? [draftTurn]).map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          const images = [...turn.images];
          images[imageIndex] = image;
          return {
            ...turn,
            images,
          };
        });
        const latestTurn = turns[turns.length - 1] ?? draftTurn;
        return {
          ...base,
          images: latestTurn.id === turnId ? latestTurn.images : base.images,
          turns,
        };
      });
    },
    [updateConversation],
  );

  const handleSelectionEditSubmit = useCallback(
    async ({
      prompt,
      mask,
      aspectRatio: _aspectRatio,
      resolutionTier: _resolutionTier,
      quality: overrideQuality,
    }: {
      prompt: string;
      mask: {
        file: File;
        previewDataUrl: string;
      };
      aspectRatio?: string;
      resolutionTier?: string;
      quality?: string;
    }) => {
      if (isSelectionEditDispatchingRef.current || !editorTarget) {
        return;
      }
      isSelectionEditDispatchingRef.current = true;

      const targetConversationId =
        editorTarget.conversationId ?? selectedConversationId;
      const conversationId = targetConversationId ?? makeId();
      const nextQuality = normalizeImageQuality(overrideQuality, imageQuality);
      const turnId = makeId();
      const now = new Date().toISOString();
      const selectionSourceImage = buildSourceReference({
        id: makeId(),
        role: "image",
        name: editorTarget.imageName,
        referenceLabel: "@图1",
        url: editorTarget.sourceDataUrl,
      });
      const draftTurn = createConversationTurn({
        turnId,
        title: buildConversationTitle("edit", prompt),
        mode: "edit",
        prompt,
        model: resolveImageRequestModel(imageSize, imageModel),
        count: 1,
        size: imageSize,
        resolutionAccess: imageResolutionAccess,
        quality: nextQuality,
        outputFormat: imageOutputFormat,
        sourceImages: [
          selectionSourceImage,
          {
            id: makeId(),
            role: "mask",
            name: "mask.png",
            dataUrl: mask.previewDataUrl,
          },
        ],
        images: createLoadingImages(1, turnId),
        createdAt: now,
        status: "running",
      });

      setSubmitElapsedSeconds(0);
      focusConversation(conversationId);
      setImagePrompt("");
      setSourceImages([]);
      closeSelectionEditor();

      try {
        if (targetConversationId) {
          await updateConversation(conversationId, (current) => {
            if (!current) {
              return buildConversationBase(conversationId, draftTurn);
            }
            return {
              ...current,
              turns: [...(current.turns ?? []), draftTurn],
            };
          });
        } else {
          await persistConversation(
            buildConversationBase(conversationId, draftTurn),
          );
        }

        onRequestStart({
          conversationId,
          turnId,
          mode: "edit",
          count: 1,
          variant: "selection-edit",
        });

        const sourceFile = await dataUrlToFile(
          editorTarget.sourceDataUrl,
          editorTarget.imageName || "source.png",
        );
        const result = await editImage({
          prompt: buildReferencedImagePrompt(prompt, [selectionSourceImage]),
          images: [sourceFile],
          mask: mask.file,
          size: imageSize,
          quality: nextQuality,
          model: PUBLIC_IMAGE_MODEL,
          outputFormat: imageOutputFormat,
          outputCompression,
        });
        const resultImages = mergeResultImages(
          turnId,
          result.data || [],
          1,
          imageOutputFormat,
        );
        const status = await finalizeTurn(
          conversationId,
          turnId,
          draftTurn,
          resultImages,
        );
        onRequestFinish(turnId, status === "success" ? "success" : "error");
        toast[status === "success" ? "success" : "error"](
          status === "success" ? "图片编辑完成" : "图片编辑返回异常",
        );
      } catch (error) {
        const message = formatImageError(error);
        await markTurnError(conversationId, turnId, draftTurn, message);
        onRequestFinish(turnId, "error");
        toast.error(message);
      } finally {
        isSelectionEditDispatchingRef.current = false;
      }
    },
    [
      closeSelectionEditor,
      editorTarget,
      finalizeTurn,
      focusConversation,
      imageModel,
      imageQuality,
      imageOutputFormat,
      imageResolutionAccess,
      imageSize,
      makeId,
      markTurnError,
      onRequestFinish,
      onRequestStart,
      outputCompression,
      persistConversation,
      selectedConversationId,
      setImagePrompt,
      setSourceImages,
      setSubmitElapsedSeconds,
      updateConversation,
    ],
  );

  const handleRetryTurn = useCallback(
    async (
      conversationId: string,
      turn: ImageConversationTurn,
      imageIndex?: number,
    ) => {
      if (retryingTurnIdsRef.current.has(turn.id)) {
        return;
      }

      const prompt = turn.prompt?.trim() ?? "";
      const turnMode = turn.mode || "generate";
      const turnSourceImages = Array.isArray(turn.sourceImages)
        ? turn.sourceImages
        : [];
      const turnImageSources = turnSourceImages.filter(
        (item) => item.role === "image" && buildSourceImageUrl(item),
      );
      const turnMaskSource =
        turnSourceImages.find((item) => item.role === "mask") ?? null;
      const turnQuality = turn.quality || "low";
      const turnOutputFormat = turn.outputFormat || imageOutputFormat;
      const isSingleImageRetry =
        turnMode === "generate" &&
        typeof imageIndex === "number" &&
        imageIndex >= 0 &&
        (turn.count || 1) > 1;
      const displayCount = Math.max(1, turn.count || 1);
      const requestCount = isSingleImageRetry ? 1 : displayCount;
      const usesEditEndpoint = turnMode === "edit" || turnImageSources.length > 0;

      if (turnMode === "generate" && !prompt) {
        toast.error("该记录缺少提示词，无法重试");
        return;
      }
      if (usesEditEndpoint && turnImageSources.length === 0) {
        toast.error("该记录缺少源图，无法重试");
        return;
      }

      retryingTurnIdsRef.current.add(turn.id);
      const nextImages = isSingleImageRetry
        ? turn.images.map((image, index) =>
            index === imageIndex
              ? {
                  ...image,
                  status: "loading" as const,
                  error: undefined,
                }
              : image,
          )
        : createLoadingImages(requestCount, turn.id);
      const draftTurn = createConversationTurn({
        turnId: turn.id,
        title: buildConversationTitle(turnMode, prompt),
        mode: turnMode,
        prompt,
        model: resolveImageRequestModel(turn.size, PUBLIC_IMAGE_MODEL),
        count: displayCount,
        size: turn.size,
        resolutionAccess: turn.resolutionAccess,
        quality: turnQuality,
        outputFormat: turnOutputFormat,
        sourceImages: turnSourceImages,
        sourceReference: turn.sourceReference,
        images: nextImages,
        createdAt: new Date().toISOString(),
        status: "running",
      });

      setSubmitElapsedSeconds(0);
      focusConversation(conversationId);

      try {
        await updateConversation(conversationId, (current) => ({
          ...(current ?? buildConversationBase(conversationId, draftTurn)),
          turns:
            current?.turns?.map((item) =>
              item.id === turn.id ? draftTurn : item,
            ) ?? [draftTurn],
        }));

        onRequestStart({
          conversationId,
          turnId: turn.id,
          mode: turnMode,
          count: requestCount,
          variant: "standard",
        });

        const editFiles = usesEditEndpoint
          ? await sourceImagesToFiles(turnImageSources)
          : [];
        const editMask = usesEditEndpoint
          ? await sourceMaskToFile(turnMaskSource)
          : null;
      const requestPrompt = buildReferencedImagePrompt(prompt, turnImageSources);
      const requestOneImage = () =>
          usesEditEndpoint
            ? editImage({
                prompt: requestPrompt,
                images: editFiles,
                mask: editMask,
                size: turn.size,
                quality: turnQuality,
                model: PUBLIC_IMAGE_MODEL,
                count: 1,
                outputFormat: turnOutputFormat,
                outputCompression,
              })
            : generateImageWithOptions(requestPrompt, {
                model: PUBLIC_IMAGE_MODEL,
                count: 1,
                size: turn.size,
                quality: turnQuality,
                outputFormat: turnOutputFormat,
                outputCompression,
              });
        const finalImages = isSingleImageRetry
          ? mergeRetryImageResult(
              turn.images,
              [
                mergeSingleResultImage(
                  turn.id,
                  imageIndex,
                  (await requestOneImage()).data || [],
                  turnOutputFormat,
                ),
              ],
              imageIndex,
            )
          : await runImageFanOutRequests({
              turnId: turn.id,
              count: requestCount,
              concurrency: usesEditEndpoint
                ? IMAGE_EDIT_FAN_OUT_CONCURRENCY
                : IMAGE_FAN_OUT_CONCURRENCY,
              outputFormat: turnOutputFormat,
              requestImage: requestOneImage,
              onImageSettled: (image, index) =>
                replaceTurnImage(conversationId, turn.id, draftTurn, index, image),
            });
        const status = await finalizeTurn(
          conversationId,
          turn.id,
          draftTurn,
          finalImages,
        );
        onRequestFinish(turn.id, status === "success" ? "success" : "error");
        toast[status === "success" ? "success" : "error"](
          status === "success" ? "重试完成" : "重试返回异常",
        );
      } catch (error) {
        const message = formatImageError(error);
        if (isSingleImageRetry) {
          const finalImages = mergeRetryImageResult(
            turn.images,
            [
              {
                id: `${turn.id}-${imageIndex}`,
                status: "error",
                error: message,
              },
            ],
            imageIndex,
          );
          const status = await finalizeTurn(
            conversationId,
            turn.id,
            draftTurn,
            finalImages,
          );
          onRequestFinish(turn.id, status === "success" ? "success" : "error");
          toast.error(message);
          return;
        }
        await markTurnError(conversationId, turn.id, draftTurn, message);
        onRequestFinish(turn.id, "error");
        toast.error(message);
      } finally {
        retryingTurnIdsRef.current.delete(turn.id);
      }
    },
    [
      finalizeTurn,
      focusConversation,
      imageOutputFormat,
      makeId,
      markTurnError,
      onRequestFinish,
      onRequestStart,
      outputCompression,
      replaceTurnImage,
      setSubmitElapsedSeconds,
      updateConversation,
    ],
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitDispatchingRef.current) {
      return;
    }
    const prompt = imagePrompt.trim();
    const usesEditEndpoint = mode === "edit" || imageSources.length > 0;
    if (!prompt) {
      toast.error(mode === "edit" ? "编辑模式需要提示词" : "请输入提示词");
      return;
    }
    if (mode === "edit" && imageSources.length === 0) {
      toast.error("编辑模式至少需要一张源图");
      return;
    }
    isSubmitDispatchingRef.current = true;

    const conversationId = selectedConversationId ?? makeId();
    const turnId = makeId();
    const expectedCount = mode === "generate" ? parsedCount : 1;
    const requestPrompt = buildReferencedImagePrompt(prompt, imageSources);
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle(mode, prompt),
      mode,
      prompt,
      model: resolveImageRequestModel(imageSize, imageModel),
      count: expectedCount,
      size: imageSize,
      resolutionAccess: imageResolutionAccess,
      quality: imageQuality,
      outputFormat: imageOutputFormat,
      sourceImages,
      images: createLoadingImages(expectedCount, turnId),
      createdAt: new Date().toISOString(),
      status: "running",
    });

    setSubmitElapsedSeconds(0);
    focusConversation(conversationId);
    setImagePrompt("");
    setSourceImages([]);

    try {
      if (selectedConversationId) {
        await updateConversation(conversationId, (current) => ({
          ...(current ?? buildConversationBase(conversationId, draftTurn)),
          turns: [...(current?.turns ?? []), draftTurn],
        }));
      } else {
        await persistConversation(
          buildConversationBase(conversationId, draftTurn),
        );
      }

      onRequestStart({
        conversationId,
        turnId,
        mode,
        count: expectedCount,
        variant: "standard",
      });
      isSubmitDispatchingRef.current = false;

      const editFiles = usesEditEndpoint
        ? await sourceImagesToFiles(imageSources)
        : [];
      const editMask = usesEditEndpoint
        ? await sourceMaskToFile(maskSource)
        : null;
      const resultImages = await runImageFanOutRequests({
        turnId,
        count: expectedCount,
        concurrency: usesEditEndpoint
          ? IMAGE_EDIT_FAN_OUT_CONCURRENCY
          : IMAGE_FAN_OUT_CONCURRENCY,
        outputFormat: imageOutputFormat,
        requestImage: () =>
          usesEditEndpoint
            ? editImage({
                prompt: requestPrompt,
                images: editFiles,
                mask: editMask,
                size: imageSize,
                quality: imageQuality,
                model: PUBLIC_IMAGE_MODEL,
                count: 1,
                outputFormat: imageOutputFormat,
                outputCompression,
              })
            : generateImageWithOptions(requestPrompt, {
                model: PUBLIC_IMAGE_MODEL,
                count: 1,
                size: imageSize,
                quality: imageQuality,
                outputFormat: imageOutputFormat,
                outputCompression,
              }),
        onImageSettled: (image, index) =>
          replaceTurnImage(conversationId, turnId, draftTurn, index, image),
      });
      const status = await finalizeTurn(
        conversationId,
        turnId,
        draftTurn,
        resultImages,
      );
      onRequestFinish(turnId, status === "success" ? "success" : "error");
      resetComposer(mode === "generate" ? "generate" : "edit");
      toast[status === "success" ? "success" : "error"](
        status === "success" ? "图片生成完成" : "图片生成返回异常",
      );
    } catch (error) {
      const message = formatImageError(error);
      await markTurnError(conversationId, turnId, draftTurn, message);
      onRequestFinish(turnId, "error");
      toast.error(message);
    } finally {
      isSubmitDispatchingRef.current = false;
    }
  }, [
    finalizeTurn,
    focusConversation,
    imageModel,
    imageOutputFormat,
    imagePrompt,
    imageSources,
    makeId,
    markTurnError,
    mode,
    imageSize,
    imageResolutionAccess,
    imageQuality,
    maskSource,
    onRequestFinish,
    onRequestStart,
    outputCompression,
    parsedCount,
    persistConversation,
    replaceTurnImage,
    resetComposer,
    selectedConversationId,
    setImagePrompt,
    setSourceImages,
    setSubmitElapsedSeconds,
    sourceImages,
    updateConversation,
  ]);

  return {
    handleSelectionEditSubmit,
    handleRetryTurn,
    handleSubmit,
  };
}
