/**
 * Morph 转场 - 使用万象首尾帧模型
 * 从两个相邻片段提取首尾帧，调用 DashScope 万象 kf2v API 生成转场视频
 */
import type { TimelineClip, MediaFile } from "@/components/StageExport/CutOSEditor/editor-context";
import { PIXELS_PER_SECOND, DEFAULT_CLIP_TRANSFORM, DEFAULT_CLIP_EFFECTS } from "@/components/StageExport/CutOSEditor/editor-context";
import { extractLastFrame, extractThirdFrame } from "./frame-extractor";
import { callVideoApi } from "@/services/adapters/videoAdapter";
import { getActiveVideoModel, getVideoModels } from "@/services/modelRegistry";

interface MorphTransitionResult {
  clip: TimelineClip;
  media: MediaFile;
  toClipUpdate: {
    clipId: string;
    newStartTime: number;
  };
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** 获取可用的首尾帧模型（万象 kf2v 或豆包 Seedance） */
function getMorphVideoModel() {
  const active = getActiveVideoModel();
  // 万象首尾帧 或 豆包 Seedance（均支持 startImage + endImage）
  if (
    active &&
    active.isEnabled &&
    ((active.providerId === "qwen" && (active.id.includes("kf2v") || (active.apiModel || "").includes("kf2v"))) ||
      (active.providerId === "doubao" && (active.apiModel || active.id).includes("seedance")))
  ) {
    return active;
  }
  const videoModels = getVideoModels();
  return videoModels.find(
    (m) =>
      m.isEnabled &&
      ((m.providerId === "qwen" && (m.id.includes("kf2v") || (m.apiModel || "").includes("kf2v"))) ||
        (m.providerId === "doubao" && (m.apiModel || m.id).includes("seedance")))
  );
}

/** Blob 转 base64 data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** base64/URL 转 Blob */
async function toBlob(data: string): Promise<Blob> {
  if (data.startsWith("data:")) {
    const res = await fetch(data);
    return res.blob();
  }
  if (data.startsWith("http")) {
    const res = await fetch(data);
    return res.blob();
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "video/mp4" });
}

/** 获取视频时长（秒） */
function getVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve(video.duration);
      video.src = "";
    };
    video.onerror = () => resolve(5);
    video.src = URL.createObjectURL(blob);
  });
}

/**
 * 使用万象首尾帧模型创建 Morph 转场
 */
export async function createMorphTransition(
  fromClip: TimelineClip,
  toClip: TimelineClip,
  mediaFiles: MediaFile[],
  _projectId: string,
  durationSeconds: number = 5
): Promise<MorphTransitionResult> {
  const fromMedia = mediaFiles.find((m) => m.id === fromClip.mediaId);
  const toMedia = mediaFiles.find((m) => m.id === toClip.mediaId);

  if (!fromMedia || !toMedia) {
    throw new Error("找不到源媒体文件");
  }

  const morphModel = getMorphVideoModel();
  if (!morphModel) {
    throw new Error(
      "请先在模型配置中启用万象首尾帧模型（如「万象 2.2 首尾帧 Flash」）或豆包 Seedance，并配置对应 API Key"
    );
  }

  const videoSrc = fromMedia.storageUrl || fromMedia.objectUrl || "";
  if (!videoSrc) {
    throw new Error("媒体文件暂无可用 URL，请等待加载完成");
  }

  const toSrc = toMedia.storageUrl || toMedia.objectUrl || "";
  if (!toSrc) {
    throw new Error("目标媒体文件暂无可用 URL");
  }

  const [startFrameBlob, endFrameBlob] = await Promise.all([
    extractLastFrame(fromMedia),
    extractThirdFrame(toMedia),
  ]);

  const [startBase64, endBase64] = await Promise.all([
    blobToDataUrl(startFrameBlob),
    blobToDataUrl(endFrameBlob),
  ]);

  const videoResult = await callVideoApi(
    {
      prompt: "平滑过渡转场，保持画面连贯自然",
      startImage: startBase64,
      endImage: endBase64,
      aspectRatio: "16:9",
      duration: 4,
    },
    morphModel
  );

  const videoBlob = await toBlob(videoResult);
  const objectUrl = URL.createObjectURL(videoBlob);
  const actualDuration = await getVideoDuration(videoBlob);

  const mediaId = `morph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const morphMedia: MediaFile = {
    id: mediaId,
    name: "Morph 转场",
    duration: formatDuration(actualDuration),
    durationSeconds: actualDuration,
    thumbnail: null,
    type: "video",
    objectUrl,
  };

  const startPosition = fromClip.startTime + fromClip.duration;
  const durationPixels = actualDuration * PIXELS_PER_SECOND;

  const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const morphClip: TimelineClip = {
    id: clipId,
    mediaId,
    trackId: fromClip.trackId,
    startTime: startPosition,
    duration: durationPixels,
    mediaOffset: 0,
    label: "Morph 转场",
    type: "video",
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    effects: { ...DEFAULT_CLIP_EFFECTS },
  };

  return {
    clip: morphClip,
    media: morphMedia,
    toClipUpdate: {
      clipId: toClip.id,
      newStartTime: startPosition + durationPixels,
    },
  };
}
