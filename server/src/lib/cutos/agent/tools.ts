import { tool } from "ai"
import { z } from "zod"

// Action types returned by tools - client interprets these
export type AgentAction =
  | { action: "SPLIT_CLIP"; payload: { clipId: string; splitTimeSeconds: number } }
  | { action: "SPLIT_AT_TIME"; payload: { timeSeconds: number; trackId?: string } }
  | { action: "TRIM_CLIP"; payload: { clipId: string; trimStartSeconds?: number; trimEndSeconds?: number } }
  | { action: "DELETE_CLIP"; payload: { clipId: string } }
  | { action: "DELETE_AT_TIME"; payload: { timeSeconds: number; trackId?: string } }
  | { action: "DELETE_ALL_CLIPS"; payload: { trackId?: string } }
  | { action: "MOVE_CLIP"; payload: { clipId: string; newStartTimeSeconds?: number; newTrackId?: string } }
  | { action: "APPLY_EFFECT"; payload: { clipId: string; effect: string } }
  | { action: "APPLY_CHROMAKEY"; payload: { clipId: string; enabled: boolean; keyColor?: string; similarity?: number; smoothness?: number; spill?: number } }
  | { action: "ADD_MEDIA_TO_TIMELINE"; payload: { mediaId: string; trackId: string; startTimeSeconds?: number } }
  | { action: "DUB_CLIP"; payload: { clipId: string; targetLanguage: string } }
  | { action: "CREATE_MORPH_TRANSITION"; payload: { fromClipId: string; toClipId: string; durationSeconds: number } }
  | { action: "ISOLATE_VOICE"; payload: { clipId: string } }

const splitClipInput = z.object({
  clipId: z.string().describe("The ID of the clip to split"),
  splitTimeSeconds: z.number().describe("The timeline position (in seconds) where to split the clip"),
})

const splitAtTimeInput = z.object({
  timeSeconds: z.number().describe("The timeline position (in seconds) where to split."),
  trackId: z.string().optional().describe("Optional track ID (V1, V2, A1, A2)."),
})

const trimClipInput = z.object({
  clipId: z.string().describe("The ID of the clip to trim"),
  trimStartSeconds: z.number().optional().describe("Seconds to trim from the start"),
  trimEndSeconds: z.number().optional().describe("Seconds to trim from the end"),
})

const deleteClipInput = z.object({ clipId: z.string().describe("The ID of the clip to delete") })

const deleteAtTimeInput = z.object({
  timeSeconds: z.number().describe("The timeline position (in seconds)."),
  trackId: z.string().optional().describe("Optional track ID."),
})

const deleteAllClipsInput = z.object({
  trackId: z.string().optional().describe("Optional track ID. If not provided, deletes ALL clips."),
})

const moveClipInput = z.object({
  clipId: z.string().describe("The ID of the clip to move"),
  newStartTimeSeconds: z.number().optional().describe("New start position in seconds"),
  newTrackId: z.string().optional().describe("ID of the track to move to (V1, V2, A1, A2)"),
})

const applyEffectInput = z.object({
  clipId: z.string().describe("The ID of the clip to apply the effect to"),
  effect: z.enum(["none", "grayscale", "sepia", "invert", "cyberpunk", "noir", "vhs", "glitch", "ascii"]).describe("The effect preset"),
})

const applyChromakeyInput = z.object({
  clipId: z.string().describe("The ID of the clip to apply green screen removal to"),
  enabled: z.boolean().describe("Whether to enable or disable chromakey"),
  keyColor: z.string().optional().describe("Hex color to remove (e.g., '#00FF00')"),
  similarity: z.number().min(0).max(1).optional(),
  smoothness: z.number().min(0).max(1).optional(),
  spill: z.number().min(0).max(1).optional(),
})

const addMediaToTimelineInput = z.object({
  mediaId: z.string().describe("The ID of the media file to add"),
  trackId: z.string().describe("The track to add to (V1, V2, A1, A2)"),
  startTimeSeconds: z.number().optional().describe("Where to place it in seconds"),
})

const dubClipInput = z.object({
  clipId: z.string().describe("The ID of the clip to dub"),
  targetLanguage: z.string().describe("Target language code (ISO-639-1): en, es, fr, de, pt, zh, ja, etc."),
  replaceOriginal: z.boolean().optional(),
})

const createMorphTransitionInput = z.object({
  fromClipId: z.string().describe("The ID of the clip to morph from"),
  toClipId: z.string().describe("The ID of the clip to morph to"),
  durationSeconds: z.number().min(5).max(10).default(5).describe("Duration in seconds (5 or 10)"),
})

const isolateVoiceInput = z.object({
  clipId: z.string().describe("The ID of the clip to isolate voice from"),
})

export const videoEditingTools = {
  splitClip: tool({
    description: "Split a specific clip into two parts at a timeline position.",
    inputSchema: splitClipInput,
    execute: async (input: z.infer<typeof splitClipInput>) => ({
      action: "SPLIT_CLIP" as const,
      payload: { clipId: input.clipId, splitTimeSeconds: input.splitTimeSeconds },
    }),
  }),
  splitAtTime: tool({
    description: "Split at a timeline position. Automatically finds the clip at that time.",
    inputSchema: splitAtTimeInput,
    execute: async (input: z.infer<typeof splitAtTimeInput>) => ({
      action: "SPLIT_AT_TIME" as const,
      payload: { timeSeconds: input.timeSeconds, trackId: input.trackId },
    }),
  }),
  trimClip: tool({
    description: "Trim the start or end of a clip.",
    inputSchema: trimClipInput,
    execute: async (input: z.infer<typeof trimClipInput>) => ({
      action: "TRIM_CLIP" as const,
      payload: { clipId: input.clipId, trimStartSeconds: input.trimStartSeconds, trimEndSeconds: input.trimEndSeconds },
    }),
  }),
  deleteClip: tool({
    description: "Remove a specific clip from the timeline by ID.",
    inputSchema: deleteClipInput,
    execute: async (input: z.infer<typeof deleteClipInput>) => ({
      action: "DELETE_CLIP" as const,
      payload: { clipId: input.clipId },
    }),
  }),
  deleteAtTime: tool({
    description: "Delete the clip at a specific timeline position.",
    inputSchema: deleteAtTimeInput,
    execute: async (input: z.infer<typeof deleteAtTimeInput>) => ({
      action: "DELETE_AT_TIME" as const,
      payload: { timeSeconds: input.timeSeconds, trackId: input.trackId },
    }),
  }),
  deleteAllClips: tool({
    description: "Delete all clips from the timeline or from a specific track.",
    inputSchema: deleteAllClipsInput,
    execute: async (input: z.infer<typeof deleteAllClipsInput>) => ({
      action: "DELETE_ALL_CLIPS" as const,
      payload: { trackId: input.trackId },
    }),
  }),
  moveClip: tool({
    description: "Move a clip to a new position or track.",
    inputSchema: moveClipInput,
    execute: async (input: z.infer<typeof moveClipInput>) => ({
      action: "MOVE_CLIP" as const,
      payload: { clipId: input.clipId, newStartTimeSeconds: input.newStartTimeSeconds, newTrackId: input.newTrackId },
    }),
  }),
  applyEffect: tool({
    description: "Apply a visual effect preset: grayscale, sepia, noir, vhs, glitch, ascii, or none.",
    inputSchema: applyEffectInput,
    execute: async (input: z.infer<typeof applyEffectInput>) => ({
      action: "APPLY_EFFECT" as const,
      payload: { clipId: input.clipId, effect: input.effect },
    }),
  }),
  applyChromakey: tool({
    description: "Remove green screen or any colored background from a video clip.",
    inputSchema: applyChromakeyInput,
    execute: async (input: z.infer<typeof applyChromakeyInput>) => ({
      action: "APPLY_CHROMAKEY" as const,
      payload: {
        clipId: input.clipId,
        enabled: input.enabled,
        keyColor: input.keyColor,
        similarity: input.similarity,
        smoothness: input.smoothness,
        spill: input.spill,
      },
    }),
  }),
  addMediaToTimeline: tool({
    description: "Add a media file from the media pool to the timeline.",
    inputSchema: addMediaToTimelineInput,
    execute: async (input: z.infer<typeof addMediaToTimelineInput>) => ({
      action: "ADD_MEDIA_TO_TIMELINE" as const,
      payload: { mediaId: input.mediaId, trackId: input.trackId, startTimeSeconds: input.startTimeSeconds },
    }),
  }),
  dubClip: tool({
    description: "Dub/translate the audio of a video clip to another language. Clip must be uploaded first.",
    inputSchema: dubClipInput,
    execute: async (input: z.infer<typeof dubClipInput>) => ({
      action: "DUB_CLIP" as const,
      payload: { clipId: input.clipId, targetLanguage: input.targetLanguage, replaceOriginal: true },
    }),
  }),
  createMorphTransition: tool({
    description: "Create an AI morph transition between two sequential clips on the same track.",
    inputSchema: createMorphTransitionInput,
    execute: async (input: z.infer<typeof createMorphTransitionInput>) => ({
      action: "CREATE_MORPH_TRANSITION" as const,
      payload: { fromClipId: input.fromClipId, toClipId: input.toClipId, durationSeconds: input.durationSeconds },
    }),
  }),
  isolateVoice: tool({
    description: "Remove background noise and isolate voice from a video clip. Clip must be uploaded first.",
    inputSchema: isolateVoiceInput,
    execute: async (input: z.infer<typeof isolateVoiceInput>) => ({
      action: "ISOLATE_VOICE" as const,
      payload: { clipId: input.clipId, replaceOriginal: true },
    }),
  }),
}
