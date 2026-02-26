// AgentAction types - client interprets these when handling tool results
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
