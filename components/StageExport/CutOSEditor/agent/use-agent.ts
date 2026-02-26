"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAlert } from "@/components/GlobalAlert"
import {
  useEditor,
  PIXELS_PER_SECOND,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_EFFECTS,
  type TimelineClip,
} from "../editor-context"
import type { TimelineState } from "./system-prompt"
import type { AgentAction } from "./tools"
import { getActiveChatModel, getApiKeyForModel, getApiBaseUrlForModel } from "@/services/modelRegistry"

export type ToolCallInfo = {
  id: string
  name: string
  description: string
  status: "running" | "success" | "error"
}

export type DisplayMessage = {
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCallInfo[]
}

function getMessageText(message: { parts?: Array<{ type: string; text?: string }>; content?: string }): string {
  if (message.parts) {
    return message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
  }
  return typeof message.content === "string" ? message.content : ""
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  zh: "Chinese", ja: "Japanese", ar: "Arabic", ru: "Russian", hi: "Hindi",
  ko: "Korean", id: "Indonesian", it: "Italian", nl: "Dutch", tr: "Turkish",
  pl: "Polish", sv: "Swedish", fil: "Filipino", ms: "Malay", ro: "Romanian",
  uk: "Ukrainian", el: "Greek", cs: "Czech", da: "Danish", fi: "Finnish",
  bg: "Bulgarian", hr: "Croatian", sk: "Slovak", ta: "Tamil"
}

function getToolDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "splitClip": return `Split clip at ${input.splitTimeSeconds}s`
    case "splitAtTime": return `Split at ${input.timeSeconds}s${input.trackId ? ` on track ${input.trackId}` : ""}`
    case "trimClip": {
      const parts = []
      if (input.trimStartSeconds) parts.push(`${input.trimStartSeconds}s from start`)
      if (input.trimEndSeconds) parts.push(`${input.trimEndSeconds}s from end`)
      return `Trim ${parts.join(" and ")}`
    }
    case "deleteClip": return "Delete clip"
    case "deleteAtTime": return `Delete clip at ${input.timeSeconds}s${input.trackId ? ` on track ${input.trackId}` : ""}`
    case "deleteAllClips": return input.trackId ? `Clear track ${input.trackId}` : "Clear all clips"
    case "moveClip": {
      const parts = []
      if (input.newStartTimeSeconds !== undefined) parts.push(`to ${input.newStartTimeSeconds}s`)
      if (input.newTrackId) parts.push(`to track ${input.newTrackId}`)
      return `Move clip ${parts.join(" ")}`
    }
    case "applyEffect": return `Apply ${input.effect} effect`
    case "addMediaToTimeline": return `Add media to track ${input.trackId}${input.startTimeSeconds !== undefined ? ` at ${input.startTimeSeconds}s` : ""}`
    case "dubClip": {
      const langName = LANGUAGE_NAMES[input.targetLanguage as string] || input.targetLanguage
      return `Dubbing to ${langName}...`
    }
    case "createMorphTransition": return `Create ${input.durationSeconds}s morph transition`
    case "isolateVoice": return "Isolating voice from clip..."
    default: return toolName
  }
}

export function useVideoAgent() {
  const editor = useEditor()
  const { showAlert } = useAlert()
  const pendingActionsRef = useRef<AgentAction[]>([])
  const processedToolCallsRef = useRef<Set<string>>(new Set())
  const toolCallInfoRef = useRef<Map<string, ToolCallInfo>>(new Map())
  const timelineStateRef = useRef<TimelineState | null>(null)
  const [input, setInput] = useState("")
  const [, forceUpdate] = useState(0)

  const getTimelineContext = useCallback((): TimelineState => {
    return {
      clips: editor.timelineClips.map((clip) => ({
        id: clip.id,
        mediaId: clip.mediaId,
        label: clip.label,
        trackId: clip.trackId,
        startTimeSeconds: clip.startTime / PIXELS_PER_SECOND,
        durationSeconds: clip.duration / PIXELS_PER_SECOND,
        type: clip.type,
        effects: clip.effects,
      })),
      media: editor.mediaFiles.map((m) => ({
        id: m.id,
        name: m.name,
        durationSeconds: m.durationSeconds,
      })),
      currentTimeSeconds: editor.currentTime,
      selectedClipId: editor.selectedClipId,
    }
  }, [editor.timelineClips, editor.mediaFiles, editor.currentTime, editor.selectedClipId])

  useEffect(() => {
    timelineStateRef.current = getTimelineContext()
  }, [getTimelineContext])

  const buildModelConfig = useCallback(() => {
    const activeModel = getActiveChatModel()
    if (!activeModel) return null
    const apiKey = getApiKeyForModel(activeModel.id)
    if (!apiKey) return null
    return {
      apiBase: getApiBaseUrlForModel(activeModel.id),
      apiKey,
      endpoint: activeModel.endpoint || "/v1/chat/completions",
      model: activeModel.apiModel || activeModel.id,
    }
  }, [])

  const handleAction = useCallback(
    (action: AgentAction) => {
      switch (action.action) {
        case "SPLIT_CLIP":
          editor.splitClip(action.payload.clipId, action.payload.splitTimeSeconds)
          break
        case "SPLIT_AT_TIME": {
          const { timeSeconds, trackId } = action.payload
          const timePixels = timeSeconds * PIXELS_PER_SECOND
          const clipsAtTime = editor.timelineClips.filter((c) => {
            const matchesTrack = !trackId || c.trackId === trackId
            const withinClip = timePixels >= c.startTime && timePixels < c.startTime + c.duration
            return matchesTrack && withinClip
          })
          for (const clip of clipsAtTime) editor.splitClip(clip.id, timeSeconds)
          break
        }
        case "TRIM_CLIP": {
          const clip = editor.timelineClips.find((c) => c.id === action.payload.clipId)
          if (!clip) break
          const updates: Partial<TimelineClip> = {}
          const trimStart = action.payload.trimStartSeconds ?? 0
          const trimEnd = action.payload.trimEndSeconds ?? 0
          if (trimStart > 0) {
            const trimStartPixels = trimStart * PIXELS_PER_SECOND
            updates.startTime = clip.startTime + trimStartPixels
            updates.duration = clip.duration - trimStartPixels
            updates.mediaOffset = clip.mediaOffset + trimStartPixels
          }
          if (trimEnd > 0) {
            updates.duration = (updates.duration ?? clip.duration) - trimEnd * editor.pixelsPerSecond
          }
          if (Object.keys(updates).length > 0) editor.updateClip(action.payload.clipId, updates)
          break
        }
        case "DELETE_CLIP":
          editor.removeClip(action.payload.clipId)
          break
        case "DELETE_AT_TIME": {
          const { timeSeconds, trackId } = action.payload
          const timePixels = timeSeconds * PIXELS_PER_SECOND
          const clipsAtTime = editor.timelineClips.filter((c) => {
            const matchesTrack = !trackId || c.trackId === trackId
            const withinClip = timePixels >= c.startTime && timePixels < c.startTime + c.duration
            return matchesTrack && withinClip
          })
          for (const clip of clipsAtTime) editor.removeClip(clip.id)
          break
        }
        case "DELETE_ALL_CLIPS": {
          const clipsToDelete = action.payload.trackId
            ? editor.timelineClips.filter((c) => c.trackId === action.payload.trackId)
            : [...editor.timelineClips]
          for (const clip of clipsToDelete) editor.removeClip(clip.id)
          break
        }
        case "MOVE_CLIP": {
          const moveUpdates: Partial<TimelineClip> = {}
          if (action.payload.newStartTimeSeconds !== undefined) {
            moveUpdates.startTime = action.payload.newStartTimeSeconds * PIXELS_PER_SECOND
          }
          if (action.payload.newTrackId) moveUpdates.trackId = action.payload.newTrackId
          if (Object.keys(moveUpdates).length > 0) editor.updateClip(action.payload.clipId, moveUpdates)
          break
        }
        case "APPLY_EFFECT": {
          const targetClip = editor.timelineClips.find((c) => c.id === action.payload.clipId)
          if (targetClip) {
            const currentEffects = targetClip.effects ?? DEFAULT_CLIP_EFFECTS
            editor.updateClip(action.payload.clipId, {
              effects: { ...currentEffects, preset: action.payload.effect as typeof currentEffects.preset },
            })
          }
          break
        }
        case "APPLY_CHROMAKEY": {
          const targetClip = editor.timelineClips.find((c) => c.id === action.payload.clipId)
          if (targetClip) {
            const currentEffects = targetClip.effects ?? DEFAULT_CLIP_EFFECTS
            const currentChromakey = currentEffects.chromakey ?? {
              enabled: false,
              keyColor: "#00FF00",
              similarity: 0.4,
              smoothness: 0.1,
              spill: 0.3,
            }
            editor.updateClip(action.payload.clipId, {
              effects: {
                ...currentEffects,
                chromakey: {
                  enabled: action.payload.enabled,
                  keyColor: action.payload.keyColor ?? currentChromakey.keyColor,
                  similarity: action.payload.similarity ?? currentChromakey.similarity,
                  smoothness: action.payload.smoothness ?? currentChromakey.smoothness,
                  spill: action.payload.spill ?? currentChromakey.spill,
                },
              },
            })
          }
          break
        }
        case "ADD_MEDIA_TO_TIMELINE": {
          const media = editor.mediaFiles.find((m) => m.id === action.payload.mediaId)
          if (!media) break
          const trackClips = editor.timelineClips.filter((c) => c.trackId === action.payload.trackId)
          const trackEnd = trackClips.length > 0 ? Math.max(...trackClips.map((c) => c.startTime + c.duration)) : 0
          const startTimePixels =
            action.payload.startTimeSeconds !== undefined
              ? action.payload.startTimeSeconds * PIXELS_PER_SECOND
              : trackEnd
          const newClip: TimelineClip = {
            id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            mediaId: media.id,
            trackId: action.payload.trackId,
            startTime: startTimePixels,
            duration: media.durationSeconds * PIXELS_PER_SECOND,
            mediaOffset: 0,
            label: media.name,
            type: action.payload.trackId.startsWith("V") ? "video" : "audio",
            transform: { ...DEFAULT_CLIP_TRANSFORM },
            effects: { ...DEFAULT_CLIP_EFFECTS },
          }
          editor.addClipToTimeline(newClip)
          break
        }
        case "CREATE_MORPH_TRANSITION":
          break
          break
        case "DUB_CLIP":
          break
        case "ISOLATE_VOICE":
          break
      }
    },
    [editor]
  )

  const handleIsolateVoice = useCallback(
    async (clipId: string, _toolCallId: string): Promise<{ success: boolean; error?: string }> => {
      showAlert("语音分离功能暂未集成，请先在模型配置中配置相关 API", { type: "warning" })
      return { success: false, error: "功能暂未集成" }
    },
    [showAlert]
  )

  const handleDubClip = useCallback(
    async (
      clipId: string,
      targetLanguage: string,
      toolCallId: string
    ): Promise<{ success: boolean; error?: string }> => {
      showAlert("配音功能暂未集成，请先在模型配置中配置相关 API", { type: "warning" })
      return { success: false, error: "功能暂未集成" }
    },
    [showAlert]
  )

  const processPendingActions = useCallback(() => {
    while (pendingActionsRef.current.length > 0) {
      const action = pendingActionsRef.current.shift()
      if (action) handleAction(action)
    }
  }, [handleAction])

  const modelConfig = buildModelConfig()
  const transport = new DefaultChatTransport({
    api: "/api/cutos/agent",
    body: () => ({
      timelineState: timelineStateRef.current || getTimelineContext(),
      modelConfig: modelConfig || undefined,
    }),
  })

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onToolCall: ({ toolCall }) => {
      const tc = toolCall as {
        type: string
        toolCallId: string
        toolName: string
        input: Record<string, unknown>
      }
      if (!tc.toolName || !tc.input) return
      if (processedToolCallsRef.current.has(tc.toolCallId)) return

      const toolInfo: ToolCallInfo = {
        id: tc.toolCallId,
        name: tc.toolName,
        description: getToolDescription(tc.toolName, tc.input),
        status: "running",
      }
      toolCallInfoRef.current.set(tc.toolCallId, toolInfo)

      let action: AgentAction | null = null
      switch (tc.toolName) {
        case "splitClip":
          action = { action: "SPLIT_CLIP", payload: { clipId: tc.input.clipId as string, splitTimeSeconds: tc.input.splitTimeSeconds as number } }
          break
        case "splitAtTime":
          action = { action: "SPLIT_AT_TIME", payload: { timeSeconds: tc.input.timeSeconds as number, trackId: tc.input.trackId as string | undefined } }
          break
        case "trimClip":
          action = { action: "TRIM_CLIP", payload: { clipId: tc.input.clipId as string, trimStartSeconds: tc.input.trimStartSeconds as number | undefined, trimEndSeconds: tc.input.trimEndSeconds as number | undefined } }
          break
        case "deleteClip":
          action = { action: "DELETE_CLIP", payload: { clipId: tc.input.clipId as string } }
          break
        case "deleteAtTime":
          action = { action: "DELETE_AT_TIME", payload: { timeSeconds: tc.input.timeSeconds as number, trackId: tc.input.trackId as string | undefined } }
          break
        case "deleteAllClips":
          action = { action: "DELETE_ALL_CLIPS", payload: { trackId: tc.input.trackId as string | undefined } }
          break
        case "moveClip":
          action = { action: "MOVE_CLIP", payload: { clipId: tc.input.clipId as string, newStartTimeSeconds: tc.input.newStartTimeSeconds as number | undefined, newTrackId: tc.input.newTrackId as string | undefined } }
          break
        case "applyEffect":
          action = { action: "APPLY_EFFECT", payload: { clipId: tc.input.clipId as string, effect: tc.input.effect as string } }
          break
        case "applyChromakey":
          action = {
            action: "APPLY_CHROMAKEY",
            payload: {
              clipId: tc.input.clipId as string,
              enabled: tc.input.enabled as boolean,
              keyColor: tc.input.keyColor as string | undefined,
              similarity: tc.input.similarity as number | undefined,
              smoothness: tc.input.smoothness as number | undefined,
              spill: tc.input.spill as number | undefined,
            },
          }
          break
        case "addMediaToTimeline":
          action = { action: "ADD_MEDIA_TO_TIMELINE", payload: { mediaId: tc.input.mediaId as string, trackId: tc.input.trackId as string, startTimeSeconds: tc.input.startTimeSeconds as number | undefined } }
          break
        case "dubClip":
          processedToolCallsRef.current.add(tc.toolCallId)
          handleDubClip(tc.input.clipId as string, tc.input.targetLanguage as string, tc.toolCallId).then((result) => {
            toolInfo.status = result.success ? "success" : "error"
            toolInfo.description = result.success ? `Dubbed to ${LANGUAGE_NAMES[tc.input.targetLanguage as string] || tc.input.targetLanguage}` : (result.error || "Dubbing failed")
            toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
            forceUpdate((n) => n + 1)
          })
          return
        case "isolateVoice":
          processedToolCallsRef.current.add(tc.toolCallId)
          handleIsolateVoice(tc.input.clipId as string, tc.toolCallId).then((result) => {
            toolInfo.status = result.success ? "success" : "error"
            toolInfo.description = result.success ? "Voice isolated" : (result.error || "Voice isolation failed")
            toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
            forceUpdate((n) => n + 1)
          })
          return
        case "createMorphTransition": {
          processedToolCallsRef.current.add(tc.toolCallId)
          const fromClipId = tc.input.fromClipId as string
          const toClipId = tc.input.toClipId as string
          const durationSeconds = (tc.input.durationSeconds as number) || 5
          const fromClip = editor.timelineClips.find((c) => c.id === fromClipId)
          const toClip = editor.timelineClips.find((c) => c.id === toClipId)
          if (!fromClip || !toClip) {
            toolInfo.status = "error"
            toolInfo.description = "找不到要转场的片段"
            toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
            forceUpdate((n) => n + 1)
            return
          }
          import("@/lib/cutos/morph-transition")
            .then(({ createMorphTransition }) =>
              createMorphTransition(fromClip, toClip, editor.mediaFiles, editor.projectId || "", durationSeconds)
            )
            .then((result) => {
              editor.addMediaFiles([result.media])
              editor.addClipToTimeline(result.clip)
              editor.updateClip(result.toClipUpdate.clipId, { startTime: result.toClipUpdate.newStartTime })
              toolInfo.status = "success"
              toolInfo.description = "Morph 转场已添加"
              toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
              forceUpdate((n) => n + 1)
            })
            .catch((err) => {
              toolInfo.status = "error"
              toolInfo.description = err?.message || "Morph 转场失败"
              toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
              showAlert(err?.message || "Morph 转场失败", { type: "error" })
              forceUpdate((n) => n + 1)
            })
          return
        }
      }

      if (action) {
        processedToolCallsRef.current.add(tc.toolCallId)
        try {
          handleAction(action)
          toolInfo.status = "success"
                toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
        } catch (err) {
          toolInfo.status = "error"
          toolCallInfoRef.current.set(tc.toolCallId, { ...toolInfo })
        }
        forceUpdate((n) => n + 1)
      }
    },
  })

  const isLoading = status === "streaming" || status === "submitted"

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(processPendingActions, 100)
      return () => clearInterval(interval)
    }
  }, [isLoading, processPendingActions])

  useEffect(() => {
    for (const message of messages) {
      if (message.role === "assistant" && message.parts) {
        for (const part of message.parts) {
          const partAny = part as Record<string, unknown>
          let toolId: string | undefined
          let result: unknown
          if (partAny.type === "tool-result") {
            toolId = partAny.toolCallId as string
            result = partAny.result
          } else if (partAny.type?.toString().startsWith("tool-") && partAny.state === "output") {
            toolId = partAny.toolCallId as string
            result = partAny.output
          }
          if (toolId && result && !processedToolCallsRef.current.has(toolId)) {
            const action = result as AgentAction
            if (action?.action) {
              processedToolCallsRef.current.add(toolId)
              handleAction(action)
            }
          }
        }
      }
    }
  }, [messages, handleAction])

  useEffect(() => {
    if (status === "idle" && messages.length > 0) {
      const timer = setTimeout(() => {
        setMessages([])
        processedToolCallsRef.current.clear()
        toolCallInfoRef.current.clear()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [status, messages.length, setMessages])

  const displayMessages: DisplayMessage[] = messages.map((msg) => {
    const content = getMessageText(msg)
    const toolCalls: ToolCallInfo[] = []
    if (msg.role === "assistant" && msg.parts) {
      for (const part of msg.parts) {
        const partAny = part as Record<string, unknown>
        if (partAny.type === "tool-invocation" || partAny.type?.toString().startsWith("tool-")) {
          const toolCallId = partAny.toolCallId as string
          if (toolCallId) {
            const info = toolCallInfoRef.current.get(toolCallId)
            if (info) toolCalls.push(info)
          }
        }
      }
    }
    return { role: msg.role as "user" | "assistant", content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
  })

  const clearChat = useCallback(() => {
    setMessages([])
    processedToolCallsRef.current.clear()
    toolCallInfoRef.current.clear()
  }, [setMessages])

  return {
    messages: displayMessages,
    status,
    input,
    setInput,
    handleInputChange: useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput(e.target.value), []),
    handleSubmit: useCallback(
      async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!input.trim() || isLoading) return
        if (!modelConfig) {
          showAlert("请先在模型配置中配置对话模型（如通义千问、豆包等）并设置 API Key", { type: "warning" })
          return
        }
        const message = input
        setInput("")
        await sendMessage({ text: message })
      },
      [input, isLoading, sendMessage, modelConfig, showAlert]
    ),
    isLoading,
    isLoadingHistory: false,
    sendQuickAction: useCallback(async (message: string) => {
      if (isLoading) return
      if (!modelConfig) {
        showAlert("请先在模型配置中配置对话模型", { type: "warning" })
        return
      }
      await sendMessage({ text: message })
    }, [isLoading, sendMessage, modelConfig, showAlert]),
    sendMessage,
    clearChat,
    error,
  }
}
