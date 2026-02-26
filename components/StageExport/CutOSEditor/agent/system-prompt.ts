// Re-export TimelineState for use-agent (matches server types)
export interface TimelineState {
  clips: {
    id: string
    mediaId: string
    label: string
    trackId: string
    startTimeSeconds: number
    durationSeconds: number
    type: "video" | "audio"
    effects: {
      preset: string
      blur: number
      brightness: number
      contrast: number
      saturate: number
      hueRotate: number
    }
  }[]
  media: {
    id: string
    name: string
    durationSeconds: number
  }[]
  currentTimeSeconds: number
  selectedClipId: string | null
}
