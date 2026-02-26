"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Download, Loader2, Check, AlertCircle, Film } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { useEditor, PIXELS_PER_SECOND, DEFAULT_CLIP_TRANSFORM, DEFAULT_CLIP_EFFECTS, type TimelineClip } from "./editor-context"
import type { ClipEffects } from "./types"
import { ChromakeyProcessor, type ChromakeyOptions } from "../../../lib/cutos/chromakey"

interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ExportFormat = "mp4" | "webm"
type ExportQuality = "low" | "medium" | "high"

const QUALITY_SETTINGS: Record<ExportQuality, { bitrate: number; label: string }> = {
  low: { bitrate: 2_500_000, label: "Low (2.5 Mbps)" },
  medium: { bitrate: 5_000_000, label: "Medium (5 Mbps)" },
  high: { bitrate: 10_000_000, label: "High (10 Mbps)" },
}

// Build CSS filter string from effects
function buildFilterString(effects: ClipEffects): string {
  const filters: string[] = []

  switch (effects.preset) {
    case "grayscale":
      filters.push("grayscale(100%)")
      break
    case "sepia":
      filters.push("sepia(100%)")
      break
    case "invert":
      filters.push("invert(100%)")
      break
    case "cyberpunk":
      filters.push("saturate(180%)", "hue-rotate(280deg)", "contrast(130%)", "brightness(110%)")
      break
    case "noir":
      filters.push("grayscale(100%)", "contrast(150%)", "brightness(85%)")
      break
    case "vhs":
      filters.push("saturate(130%)", "contrast(115%)", "brightness(105%)", "sepia(20%)")
      break
    case "glitch":
      filters.push("contrast(130%)", "saturate(150%)")
      break
    case "ascii":
      // Dreamy/Bloom effect - soft glow look
      filters.push("brightness(115%)", "contrast(90%)", "saturate(120%)", "blur(0.5px)")
      break
  }

  if (effects.blur > 0) filters.push(`blur(${effects.blur}px)`)
  if (effects.brightness !== 100) filters.push(`brightness(${effects.brightness}%)`)
  if (effects.contrast !== 100) filters.push(`contrast(${effects.contrast}%)`)
  if (effects.saturate !== 100) filters.push(`saturate(${effects.saturate}%)`)
  if (effects.hueRotate > 0) filters.push(`hue-rotate(${effects.hueRotate}deg)`)

  return filters.join(" ")
}

// Check if requestVideoFrameCallback is supported
const supportsVideoFrameCallback = typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype

// Type for requestVideoFrameCallback
type VideoFrameCallbackMetadata = {
  presentationTime: number
  expectedDisplayTime: number
  width: number
  height: number
  mediaTime: number
  presentedFrames: number
  processingDuration?: number
}

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const { sortedVideoClips, mediaFiles } = useEditor()

  const [format, setFormat] = useState<ExportFormat>("webm")
  const [quality, setQuality] = useState<ExportQuality>("medium")
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef(false)

  // Keep a ref to the latest sortedVideoClips to avoid stale closure issues
  // This ensures handleExport always uses the most current clip data
  // Update synchronously during render (not via useEffect which runs after render)
  const sortedVideoClipsRef = useRef(sortedVideoClips)
  sortedVideoClipsRef.current = sortedVideoClips

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setProgress(0)
      setError(null)
      setSuccess(false)
      abortRef.current = false
    }
  }, [open])

  const handleExport = useCallback(async () => {
    // Use ref to get the latest clips, avoiding stale closure issues
    const currentClips = sortedVideoClipsRef.current
    if (!canvasRef.current || currentClips.length === 0) return

    setIsExporting(true)
    setProgress(0)
    setError(null)
    setSuccess(false)
    abortRef.current = false

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx) {
      setError("Failed to get canvas context")
      setIsExporting(false)
      return
    }

    // Set canvas size (1080p)
    canvas.width = 1920
    canvas.height = 1080

    // Check if Canvas filter is supported
    const supportsCanvasFilter = typeof ctx.filter !== 'undefined'
    console.log("[Export] Canvas filter support:", supportsCanvasFilter)

    // Sort clips by start time
    const clips = [...currentClips].sort((a, b) => a.startTime - b.startTime)

    // Calculate timeline end time from the clips we're actually exporting
    // This ensures consistency and avoids stale closure values
    const exportEndTime = clips.reduce((max, clip) => {
      const clipEnd = (clip.startTime + clip.duration) / PIXELS_PER_SECOND
      return Math.max(max, clipEnd)
    }, 0)

    // Debug: Log clip effects summary at export start
    console.log("[Export] Starting export with", clips.length, "clips, duration:", exportEndTime, "seconds")
    clips.forEach((c, i) => {
      const effects = c.effects ?? DEFAULT_CLIP_EFFECTS
      console.log(`  [${i + 1}] ${c.label}: preset=${effects.preset}, brightness=${effects.brightness}%, contrast=${effects.contrast}%, blur=${effects.blur}px`)
    })

    // Create and preload video elements for each clip
    const videoElements: Map<string, HTMLVideoElement> = new Map()

    try {
      for (const clip of clips) {
        const media = mediaFiles.find(m => m.id === clip.mediaId)
        if (!media) {
          console.warn(`[Export] Media not found for clip: ${clip.id}`)
          continue
        }

        if (!media.objectUrl && !media.storageUrl) {
          console.warn(`[Export] No URL available for media: ${media.name}`)
          continue
        }

        // Prefer storageUrl (Supabase) over objectUrl (might be blob URL)
        // Blob URLs can become invalid and don't work well with crossOrigin
        const videoUrl = media.storageUrl || media.objectUrl

        console.log(`[Export] Loading video for clip: ${clip.label}`, {
          usingUrl: videoUrl?.substring(0, 100),
          objectUrl: media.objectUrl?.substring(0, 100),
          storageUrl: media.storageUrl?.substring(0, 100),
          isBlob: media.objectUrl?.startsWith('blob:'),
        })

        const video = document.createElement("video")
        video.muted = true
        video.playsInline = true
        video.preload = "auto"
        video.crossOrigin = "anonymous"

        // Wait for video to be fully loaded
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error(`Timeout loading video: ${media.name}`))
          }, 30000) // 30 second timeout

          video.oncanplaythrough = () => {
            clearTimeout(timeoutId)
            console.log(`[Export] Video loaded: ${media.name}`)
            resolve()
          }
          video.onerror = () => {
            clearTimeout(timeoutId)
            // Get detailed error info from MediaError
            const mediaError = video.error
            const errorMessages: Record<number, string> = {
              1: "MEDIA_ERR_ABORTED - fetching process aborted",
              2: "MEDIA_ERR_NETWORK - network error while downloading",
              3: "MEDIA_ERR_DECODE - error decoding media",
              4: "MEDIA_ERR_SRC_NOT_SUPPORTED - media format not supported or URL invalid",
            }
            const errorCode = mediaError?.code ?? 0
            const errorDetail = errorMessages[errorCode] || `Unknown error (code: ${errorCode})`
            console.error(`[Export] Video load error for ${media.name}: ${errorDetail}`, {
              url: videoUrl?.substring(0, 100),
              mediaError,
            })
            reject(new Error(`Failed to load video: ${media.name} - ${errorDetail}`))
          }
          video.src = videoUrl
          video.load()
        })

        // Pre-seek to the clip's media offset
        const mediaOffset = clip.mediaOffset / PIXELS_PER_SECOND
        video.currentTime = mediaOffset

        await new Promise<void>(resolve => {
          video.onseeked = () => resolve()
          setTimeout(resolve, 500) // Timeout fallback
        })

        videoElements.set(clip.id, video)
      }

      // Check if all clips have videos loaded
      const missingClips = clips.filter(c => !videoElements.has(c.id))
      if (missingClips.length > 0) {
        console.warn(`[Export] Missing videos for clips:`, missingClips.map(c => c.label))
        if (videoElements.size === 0) {
          throw new Error("No videos could be loaded for export")
        }
      }

      console.log(`[Export] Successfully loaded ${videoElements.size}/${clips.length} videos`)
    } catch (e) {
      console.error("[Export] Failed to load videos:", e)
      setError(e instanceof Error ? e.message : "Failed to load videos")
      setIsExporting(false)
      return
    }

    // Setup MediaRecorder with supported codec
    let mimeType = "video/webm;codecs=vp9,opus"
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm;codecs=vp8,opus"
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm"
      }
    }

    const stream = canvas.captureStream(30)

    // Setup audio capture using Web Audio API
    let audioContext: AudioContext | null = null
    let audioDestination: MediaStreamAudioDestinationNode | null = null
    const audioSources: Map<string, MediaElementAudioSourceNode> = new Map()

    try {
      audioContext = new AudioContext()
      audioDestination = audioContext.createMediaStreamDestination()

      // Create audio sources for each video element
      // Connect to Web Audio BEFORE unmuting to prevent audio leak to speakers
      for (const [clipId, video] of videoElements) {
        const source = audioContext.createMediaElementSource(video)
        source.connect(audioDestination)
        audioSources.set(clipId, source)

        // Now unmute - audio will only flow through Web Audio graph, not speakers
        video.muted = false
        video.volume = 1
      }

      // Add audio track to the stream
      const audioTracks = audioDestination.stream.getAudioTracks()
      if (audioTracks.length > 0) {
        stream.addTrack(audioTracks[0])
      }
    } catch (e) {
      console.warn("Could not setup audio capture:", e)
      // Continue without audio if it fails
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: QUALITY_SETTINGS[quality].bitrate,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data)
      }
    }

    const exportPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Recording failed"))
      recorder.onstop = () => {
        if (abortRef.current) {
          reject(new Error("Export cancelled"))
          return
        }
        resolve(new Blob(chunks, { type: mimeType }))
      }
    })

    recorder.start(100)

    // Track export state
    let exportStartTime = performance.now()

    // Track logged clips to avoid flooding console
    const loggedClips = new Set<string>()

    // Setup chromakey processor for clips that need it
    const chromakeyCanvas = document.createElement("canvas")
    chromakeyCanvas.width = canvas.width
    chromakeyCanvas.height = canvas.height
    let chromakeyProcessor: ChromakeyProcessor | null = null

    // Check if any clip needs chromakey
    const hasChromakeyClips = clips.some(c => c.effects?.chromakey?.enabled)
    if (hasChromakeyClips) {
      chromakeyProcessor = new ChromakeyProcessor(chromakeyCanvas)
      if (!chromakeyProcessor.isReady()) {
        console.warn("[Export] Chromakey processor failed to initialize")
        chromakeyProcessor = null
      } else {
        console.log("[Export] Chromakey processor initialized")
      }
    }

    // Helper to find all clips at a given timeline time, sorted by track
    // Returns clips sorted for drawing order (bottom to top): A1, A2, V1, V2
    const findClipsAtTime = (timelineTime: number): TimelineClip[] => {
      const timePixels = timelineTime * PIXELS_PER_SECOND
      const clipsAtTime = clips.filter(c => {
        return timePixels >= c.startTime && timePixels < c.startTime + c.duration
      })
      // Sort by track for drawing order - bottom first (A1 < A2 < V1 < V2)
      const trackDrawOrder = ["A1", "A2", "V1", "V2"]
      return clipsAtTime.sort((a, b) => {
        const aIndex = trackDrawOrder.indexOf(a.trackId)
        const bIndex = trackDrawOrder.indexOf(b.trackId)
        return aIndex - bIndex
      })
    }

    // Helper to calculate draw dimensions and position for a video
    const getDrawParams = (video: HTMLVideoElement, clip: TimelineClip) => {
      const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
      const videoAspect = video.videoWidth / video.videoHeight
      const canvasAspect = canvas.width / canvas.height

      let drawWidth: number, drawHeight: number
      if (videoAspect > canvasAspect) {
        drawWidth = canvas.width
        drawHeight = canvas.width / videoAspect
      } else {
        drawHeight = canvas.height
        drawWidth = canvas.height * videoAspect
      }

      // Apply scale
      const scale = transform.scale / 100
      drawWidth *= scale
      drawHeight *= scale

      const drawX = (canvas.width - drawWidth) / 2 + transform.positionX
      const drawY = (canvas.height - drawHeight) / 2 + transform.positionY

      return { drawX, drawY, drawWidth, drawHeight, transform }
    }

    // Helper to draw a single video layer (without chromakey)
    const drawVideoLayer = (video: HTMLVideoElement, clip: TimelineClip, clearCanvas: boolean = true) => {
      const effects = clip.effects ?? DEFAULT_CLIP_EFFECTS
      const { drawX, drawY, drawWidth, drawHeight, transform } = getDrawParams(video, clip)

      if (clearCanvas) {
        ctx.fillStyle = "#000000"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      ctx.save()
      const filterString = buildFilterString(effects)
      ctx.filter = filterString || "none"
      ctx.globalAlpha = transform.opacity / 100

      try {
        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight)
      } catch (e) {
        console.warn("Draw error:", e)
      }

      ctx.restore()
    }

    // Helper to draw a frame with chromakey compositing
    const drawFrameWithChromakey = (
      foregroundVideo: HTMLVideoElement,
      foregroundClip: TimelineClip,
      backgroundVideo: HTMLVideoElement | null,
      backgroundClip: TimelineClip | null
    ) => {
      const effects = foregroundClip.effects ?? DEFAULT_CLIP_EFFECTS
      const { drawX, drawY, drawWidth, drawHeight, transform } = getDrawParams(foregroundVideo, foregroundClip)

      // Clear canvas
      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw background first if available
      if (backgroundVideo && backgroundClip) {
        drawVideoLayer(backgroundVideo, backgroundClip, false)
      }

      // Process foreground through chromakey
      if (chromakeyProcessor && chromakeyProcessor.isReady()) {
        const chromakeyOptions: ChromakeyOptions = {
          keyColor: effects.chromakey?.keyColor ?? "#00FF00",
          similarity: effects.chromakey?.similarity ?? 0.4,
          smoothness: effects.chromakey?.smoothness ?? 0.1,
          spill: effects.chromakey?.spill ?? 0.3,
        }

        // Process the foreground video through chromakey
        chromakeyProcessor.processFrame(foregroundVideo, chromakeyOptions)

        // Draw the chromakeyed result onto the main canvas
        ctx.save()
        const filterString = buildFilterString(effects)
        ctx.filter = filterString || "none"
        ctx.globalAlpha = transform.opacity / 100

        try {
          ctx.drawImage(chromakeyCanvas, drawX, drawY, drawWidth, drawHeight)
        } catch (e) {
          console.warn("Chromakey draw error:", e)
        }

        ctx.restore()
      } else {
        // Fallback: draw without chromakey if processor not available
        drawVideoLayer(foregroundVideo, foregroundClip, false)
      }
    }

    // Main helper to draw a frame to canvas
    const drawFrame = (video: HTMLVideoElement, clip: TimelineClip, timelineTime: number) => {
      const effects = clip.effects ?? DEFAULT_CLIP_EFFECTS

      // Debug: Log effects only once per clip
      if (!loggedClips.has(clip.id)) {
        const filterString = buildFilterString(effects)
        console.log("[Export] Rendering clip:", clip.id, {
          preset: effects.preset,
          brightness: effects.brightness,
          contrast: effects.contrast,
          saturate: effects.saturate,
          blur: effects.blur,
          chromakeyEnabled: effects.chromakey?.enabled ?? false,
          filterString: filterString || "(none)",
        })
        loggedClips.add(clip.id)
      }

      // Check if chromakey is enabled for this clip
      if (effects.chromakey?.enabled && chromakeyProcessor) {
        // Find the background clip (the next clip in the layer order)
        const clipsAtTime = findClipsAtTime(timelineTime)
        const clipIndex = clipsAtTime.findIndex(c => c.id === clip.id)
        const backgroundClip = clipIndex >= 0 && clipIndex < clipsAtTime.length - 1
          ? clipsAtTime[clipIndex + 1]
          : null
        const backgroundVideo = backgroundClip ? videoElements.get(backgroundClip.id) ?? null : null

        drawFrameWithChromakey(video, clip, backgroundVideo, backgroundClip)
      } else {
        // Regular drawing without chromakey
        drawVideoLayer(video, clip, true)
      }
    }

    // Calculate timeline time from elapsed export time
    const getTimelineTime = () => {
      return (performance.now() - exportStartTime) / 1000
    }

    // Track which videos are currently active for audio management
    const activeVideoIds = new Set<string>()

    // Main render loop using requestAnimationFrame with explicit time sync
    const renderLoop = async () => {
      if (abortRef.current) {
        // Pause all videos
        videoElements.forEach(video => video.pause())
        recorder.stop()
        return
      }

      const timelineTime = getTimelineTime()

      // Check if export is complete
      if (timelineTime >= exportEndTime) {
        videoElements.forEach(video => video.pause())
        recorder.stop()
        return
      }

      // Update progress
      setProgress(Math.round((timelineTime / exportEndTime) * 100))

      // Find ALL clips at the current time, sorted for drawing (bottom to top)
      const clipsAtTime = findClipsAtTime(timelineTime)

      if (clipsAtTime.length > 0) {
        // Clear canvas once before drawing all layers
        ctx.fillStyle = "#000000"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Track which clips are currently active
        const newActiveVideoIds = new Set<string>()

        // Draw each clip in order (bottom to top)
        for (const clip of clipsAtTime) {
          const video = videoElements.get(clip.id)
          if (!video || video.readyState < 2) continue

          newActiveVideoIds.add(clip.id)

          // Calculate expected video position
          const clipStart = clip.startTime / PIXELS_PER_SECOND
          const mediaOffset = clip.mediaOffset / PIXELS_PER_SECOND
          const expectedVideoTime = mediaOffset + (timelineTime - clipStart)

          // Check if we need to sync position
          const drift = Math.abs(video.currentTime - expectedVideoTime)
          if (drift > 0.1) {
            video.currentTime = Math.max(mediaOffset, Math.min(expectedVideoTime, video.duration - 0.1))
          }

          // Start/resume playback if needed
          if (video.paused) {
            try {
              await video.play()
            } catch (e) {
              console.warn("Play failed for clip:", clip.id, e)
            }
          }

          // Check if this clip has chromakey enabled
          const effects = clip.effects ?? DEFAULT_CLIP_EFFECTS
          if (effects.chromakey?.enabled && chromakeyProcessor) {
            // For chromakey, the background is already drawn by previous clips
            // Just draw this clip with chromakey (transparency)
            if (chromakeyProcessor.isReady()) {
              const chromakeyOptions: ChromakeyOptions = {
                keyColor: effects.chromakey?.keyColor ?? "#00FF00",
                similarity: effects.chromakey?.similarity ?? 0.4,
                smoothness: effects.chromakey?.smoothness ?? 0.1,
                spill: effects.chromakey?.spill ?? 0.3,
              }

              chromakeyProcessor.processFrame(video, chromakeyOptions)

              const { drawX, drawY, drawWidth, drawHeight, transform } = getDrawParams(video, clip)
              ctx.save()
              const filterString = buildFilterString(effects)
              ctx.filter = filterString || "none"
              ctx.globalAlpha = transform.opacity / 100
              try {
                ctx.drawImage(chromakeyCanvas, drawX, drawY, drawWidth, drawHeight)
              } catch (e) {
                console.warn("Chromakey draw error:", e)
              }
              ctx.restore()
            }
          } else {
            // Draw without chromakey (don't clear canvas - we're layering)
            drawVideoLayer(video, clip, false)
          }

          // Log clip rendering once
          if (!loggedClips.has(clip.id)) {
            console.log("[Export] Rendering clip:", clip.label, "on track", clip.trackId)
            loggedClips.add(clip.id)
          }
        }

        // Pause videos that are no longer active
        for (const clipId of activeVideoIds) {
          if (!newActiveVideoIds.has(clipId)) {
            const video = videoElements.get(clipId)
            if (video && !video.paused) {
              video.pause()
            }
          }
        }

        // Update active video set
        activeVideoIds.clear()
        newActiveVideoIds.forEach(id => activeVideoIds.add(id))

      } else {
        // No clips at this time, draw black
        ctx.fillStyle = "#000000"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Pause all videos if we're in a gap
        videoElements.forEach(video => {
          if (!video.paused) video.pause()
        })
        activeVideoIds.clear()
      }

      // Schedule next frame
      requestAnimationFrame(renderLoop)
    }

    // Start the render loop - it will handle clip initialization
    exportStartTime = performance.now()
    renderLoop()

    try {
      const blob = await exportPromise

      // Download the file
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `export-${Date.now()}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setSuccess(true)
    } catch (e) {
      if (!abortRef.current) {
        setError(e instanceof Error ? e.message : "Export failed")
      }
    } finally {
      setIsExporting(false)
      // Cleanup audio context
      if (audioContext) {
        try {
          await audioContext.close()
        } catch (e) {
          console.warn("Error closing audio context:", e)
        }
      }
      // Cleanup video elements
      videoElements.forEach(video => {
        video.pause()
        video.src = ""
        video.load()
      })
      // Cleanup chromakey processor
      if (chromakeyProcessor) {
        chromakeyProcessor.dispose()
      }
    }

  }, [mediaFiles, quality])

  const handleCancel = () => {
    if (isExporting) {
      abortRef.current = true
    } else {
      onOpenChange(false)
    }
  }

  const hasClips = sortedVideoClips.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Video
          </DialogTitle>
          <DialogDescription>
            Render your project to a video file
          </DialogDescription>
        </DialogHeader>

        {!hasClips ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Film className="h-12 w-12 text-[var(--text-muted)] mb-3" />
            <p className="text-sm text-[var(--text-muted)]">
              Add clips to the timeline before exporting
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Format Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Format</label>
              <div className="grid grid-cols-2 gap-2">
                {(["webm", "mp4"] as ExportFormat[]).map((f) => (
                  <motion.button
                    key={f}
                    onClick={() => setFormat(f)}
                    disabled={isExporting}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                      format === f
                        ? "bg-[var(--accent)] text-[var(--accent-on)]"
                        : "bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/80"
                    }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  >
                    {f.toUpperCase()}
                    {f === "mp4" && (
                      <span className="block text-[10px] opacity-70">
                        (exported as WebM)
                      </span>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Quality Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Quality</label>
              <div className="space-y-1">
                {(Object.entries(QUALITY_SETTINGS) as [ExportQuality, { bitrate: number; label: string }][]).map(([q, settings]) => (
                  <motion.button
                    key={q}
                    onClick={() => setQuality(q)}
                    disabled={isExporting}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors cursor-pointer disabled:opacity-50 ${
                      quality === q
                        ? "bg-[var(--accent-bg)] text-[var(--accent)] border border-[var(--accent)]/30"
                        : "bg-[var(--bg-secondary)]/50 text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                    }`}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  >
                    <span className="capitalize">{q}</span>
                    <span className="text-xs text-[var(--text-muted)]">{settings.label.split("(")[1]?.replace(")", "")}</span>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Progress */}
            <AnimatePresence>
              {isExporting && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Exporting...</span>
                    <span className="font-mono">{progress}%</span>
                  </div>
                  <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[var(--accent)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {supportsVideoFrameCallback
                      ? "Using frame-accurate rendering"
                      : "Export runs at 1x speed"}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 text-sm text-[var(--error-text)] bg-[var(--error-bg)] px-3 py-2 rounded-md"
                >
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success */}
            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 px-3 py-2 rounded-md"
                >
                  <Check className="h-4 w-4" />
                  Export complete! Your download should start automatically.
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hidden canvas for rendering */}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4">
          <motion.button
            onClick={handleCancel}
            className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/80 transition-colors cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            {isExporting ? "Cancel" : "Close"}
          </motion.button>
          {hasClips && !success && (
            <motion.button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
              whileHover={!isExporting ? { scale: 1.02 } : {}}
              whileTap={!isExporting ? { scale: 0.98 } : {}}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export
                </>
              )}
            </motion.button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
