/**
 * 从 CutOS 复制 - 从视频中提取帧
 */

export interface MediaFileLike {
  objectUrl?: string
  storageUrl?: string
  durationSeconds: number
}

/**
 * 从视频指定时间提取帧
 */
export async function extractFrameFromClip(
  mediaFile: MediaFileLike,
  timeSeconds: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true

    const videoSrc = mediaFile.storageUrl || mediaFile.objectUrl || ""
    if (!videoSrc) {
      reject(new Error("No video URL available"))
      return
    }

    video.onloadedmetadata = () => {
      const clampedTime = Math.min(Math.max(0, timeSeconds), video.duration)
      video.currentTime = clampedTime
    }

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Could not get canvas context"))
          if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src)
          return
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error("Failed to create blob from canvas"))
            if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src)
          },
          "image/jpeg",
          0.85
        )
      } catch (error) {
        reject(error)
        if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src)
      }
    }

    video.onerror = () => {
      reject(new Error(`Failed to load video: ${videoSrc}`))
      if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src)
    }

    video.src = videoSrc
  })
}

export async function extractLastFrame(mediaFile: MediaFileLike): Promise<Blob> {
  const timeSeconds = Math.max(0, mediaFile.durationSeconds - 0.1)
  return extractFrameFromClip(mediaFile, timeSeconds)
}

export async function extractFirstFrame(mediaFile: MediaFileLike): Promise<Blob> {
  return extractFrameFromClip(mediaFile, 0)
}

export async function extractThirdFrame(mediaFile: MediaFileLike): Promise<Blob> {
  return extractFrameFromClip(mediaFile, 0.1)
}
