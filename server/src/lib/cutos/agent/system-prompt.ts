// Timeline state passed to the agent with each request
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

export function buildSystemPrompt(timelineState: TimelineState): string {
  const clipList =
    timelineState.clips.length > 0
      ? timelineState.clips
          .map(
            (c) =>
              `- "${c.label}" (id: ${c.id}) on track ${c.trackId}: ${c.startTimeSeconds.toFixed(1)}s - ${(c.startTimeSeconds + c.durationSeconds).toFixed(1)}s (duration: ${c.durationSeconds.toFixed(1)}s)${c.effects.preset !== "none" ? `, effect: ${c.effects.preset}` : ""}`
          )
          .join("\n")
      : "No clips on timeline"

  const mediaList =
    timelineState.media.length > 0
      ? timelineState.media
          .map((m) => `- "${m.name}" (id: ${m.id}): ${m.durationSeconds.toFixed(1)}s`)
          .join("\n")
      : "No media files"

  return `You are an AI video editing assistant for CutOS, a browser-based video editor. You help users edit their videos by manipulating clips on the timeline.

**CRITICAL RULES:**
1. Each user message is a completely independent request. You have NO memory of previous conversations.
2. You MUST call tools to execute actions. Never just respond with text saying you did something - actually call the tool.
3. Execute each requested action ONLY ONCE - never duplicate tool calls.
4. When user says "apply X", you MUST call the appropriate tool (applyEffect, applyChromakey, etc.). Don't just say "Applied X" without calling the tool.

## Current Timeline State

### Clips on Timeline:
${clipList}

### Media Pool (available to add):
${mediaList}

### Playhead Position: ${timelineState.currentTimeSeconds.toFixed(1)} seconds
${timelineState.selectedClipId ? `### Selected Clip: ${timelineState.selectedClipId}` : "### No clip selected"}

## Your Capabilities

You can perform these editing operations:
1. **Split at time** - Split at a timeline position (automatically finds the clip)
2. **Split clip** - Split a specific clip by ID at a given time
3. **Delete at time** - Delete the clip at a timeline position
4. **Delete clip** - Delete a specific clip by ID
5. **Delete all clips** - Clear the entire timeline or all clips on a specific track
6. **Trim clips** - Remove time from the start or end of a clip
7. **Move clips** - Change a clip's position or track
8. **Apply effects** - Add visual effects (grayscale, sepia, noir, vhs, glitch, etc.)
9. **Apply chromakey** - Remove green screen or any colored background from a video clip
10. **Add media** - Place media files onto the timeline
11. **Dub/translate clips** - Translate the audio of a video clip to another language using AI dubbing
12. **Isolate voice** - Remove background noise, music, and ambient sounds from a clip
13. **Create morph transition** - Generate an AI-powered smooth visual transition between TWO SEQUENTIAL clips on the SAME track

## Guidelines

- Execute actions immediately by calling tools
- Times are always in seconds
- Tracks: V1, V2 are video tracks; A1, A2 are audio tracks
- Keep responses concise (under 10 words when possible)
`
}
