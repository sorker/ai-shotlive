"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Send, MessageSquarePlus, Zap, Loader2, AlertCircle, Mic } from "lucide-react"
import { useEditor } from "./editor-context"
import { useVideoAgent } from "./agent/use-agent"
import { getProviderById } from "@/services/modelRegistry"
import { AutoEnhanceModal } from "./auto-enhance-modal"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"

export function InspectorPanel() {
  return (
    <div className="flex h-full flex-col">
      <AgentTab />
    </div>
  )
}

function AgentTab() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    isLoadingHistory,
    sendQuickAction,
    clearChat,
    status,
    sendMessage,
  } = useVideoAgent()
  const { timelineClips } = useEditor()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [showNewChatDialog, setShowNewChatDialog] = useState(false)
  const [showAutoEnhanceModal, setShowAutoEnhanceModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, status])

  const handleQuickAction = (action: string) => {
    sendQuickAction(action)
  }

  const handleNewChat = () => setShowNewChatDialog(true)
  const confirmNewChat = () => {
    clearChat()
    setShowNewChatDialog(false)
  }

  const startRecording = useCallback(async () => {
    setTranscriptionError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        const dashScopeKey = getProviderById("qwen")?.apiKey
        if (!dashScopeKey) {
          setTranscriptionError("Please configure DashScope API Key in model settings first")
          setIsTranscribing(false)
          return
        }
        setIsTranscribing(true)
        try {
          const reader = new FileReader()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(audioBlob)
          })
          const res = await fetch("/api/cutos/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioDataUrl: dataUrl, apiKey: dashScopeKey, targetLang: "zh" }),
          })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error || "Transcription failed")
          }
          const { text } = await res.json()
          if (text?.trim()) await sendMessage({ text: text.trim() })
        } catch (err) {
          setTranscriptionError(err instanceof Error ? err.message : "Transcription failed")
        } finally {
          setIsTranscribing(false)
        }
      }
      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch {
      setTranscriptionError("Failed to access microphone. Please check permissions.")
    }
  }, [sendMessage])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
      setIsRecording(false)
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording()
    else startRecording()
  }, [isRecording, startRecording, stopRecording])

  useEffect(() => {
    if (transcriptionError) {
      const t = setTimeout(() => setTranscriptionError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [transcriptionError])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.key === "`" || e.key === "Backquote") && !isLoading && !isTranscribing && !isRecording) {
        e.preventDefault()
        startRecording()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === "`" || e.key === "Backquote") && isRecording) {
        e.preventDefault()
        stopRecording()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [isLoading, isTranscribing, isRecording, startRecording, stopRecording])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-3 py-2">
        <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">AI Assistant</span>
        <motion.button
          onClick={handleNewChat}
          disabled={isLoading || messages.length === 0}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Start new chat"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <MessageSquarePlus className="h-3 w-3" />
          New Chat
        </motion.button>
      </div>

      <div className="border-b border-[var(--border-primary)] p-3">
        <div className="mb-2 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Smart Enhance</div>
        <motion.button
          onClick={() => setShowAutoEnhanceModal(true)}
          disabled={isLoading || timelineClips.length === 0}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[var(--accent)]/20 to-[var(--accent)]/10 border border-[var(--accent)]/30 px-3 py-2.5 text-[11px] font-medium text-[var(--accent)] hover:from-[var(--accent)]/30 hover:to-[var(--accent)]/20 hover:border-[var(--accent)]/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
          whileHover={{ scale: isLoading || timelineClips.length === 0 ? 1 : 1.02 }}
          whileTap={{ scale: isLoading || timelineClips.length === 0 ? 1 : 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <motion.div
            animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 2, repeat: isLoading ? Infinity : 0, ease: "linear" }}
          >
            <Zap className="h-4 w-4" />
          </motion.div>
          <span>Auto Enhance Video</span>
        </motion.button>
        <p className="mt-1.5 text-[9px] text-[var(--text-tertiary)]/80 text-center">
          AI + Video RAG for smart enhancements
        </p>
      </div>

      <AutoEnhanceModal
        open={showAutoEnhanceModal}
        onOpenChange={setShowAutoEnhanceModal}
        onEnhance={(prompt) => sendQuickAction(prompt)}
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
        <AnimatePresence>
          {isLoadingHistory && (
            <motion.div className="flex justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading chat history...
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!isLoadingHistory && messages.length === 0 && (
            <motion.div
              className="flex justify-start"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)]">
                Hi! I&apos;m your AI editing assistant. I can split, trim, delete, move clips, and apply effects. Just tell me what you&apos;d like to do!
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="popLayout">
          {messages.map((message, i) => {
            const isLastMessage = i === messages.length - 1
            const isStreaming = isLastMessage && message.role === "assistant" && status === "streaming"
            const hasContent = message.content.trim().length > 0
            const hasToolCalls = message.toolCalls && message.toolCalls.length > 0

            if (message.role === "assistant" && !hasContent && !hasToolCalls && !isStreaming) return null

            return (
              <motion.div
                key={i}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                initial={{ opacity: 0, y: 10, x: message.role === "user" ? 20 : -20 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 25, delay: isLastMessage ? 0 : 0.05 }}
                layout
              >
                <motion.div
                  className={`max-w-[85%] rounded-lg text-xs ${
                    message.role === "user"
                      ? "bg-[var(--accent)] text-[var(--accent-on)] px-3 py-2"
                      : "bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)]"
                  }`}
                  whileHover={{ scale: 1.01 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  {hasToolCalls && (
                    <div className={`space-y-1 ${hasContent ? "px-3 pt-2 pb-1" : "p-2"}`}>
                      {message.toolCalls!.map((tc, tcIndex) => (
                        <motion.div
                          key={tc.id}
                          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] ${
                            tc.status === "success"
                              ? "bg-green-500/15 text-green-600 dark:text-green-400"
                              : tc.status === "error"
                              ? "bg-red-500/15 text-red-600 dark:text-red-400"
                              : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          }`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: tcIndex * 0.1, type: "spring", stiffness: 400, damping: 20 }}
                        >
                          {tc.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                          {tc.status === "success" && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                              <span className="text-green-600">✓</span>
                            </motion.div>
                          )}
                          {tc.status === "error" && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                              <AlertCircle className="h-3 w-3" />
                            </motion.div>
                          )}
                          <span>{tc.description}</span>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {hasContent && (
                    <div className={hasToolCalls ? "px-3 pb-2 pt-1" : "px-3 py-2"}>
                      {message.content}
                      {isStreaming && (
                        <motion.span
                          className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--text-primary)]/70"
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                    </div>
                  )}

                  {!hasContent && !hasToolCalls && isStreaming && (
                    <div className="px-3 py-2">
                      <motion.span
                        className="inline-block w-1.5 h-3 bg-[var(--text-primary)]/70"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <AnimatePresence>
          {status === "submitted" && (
            <motion.div
              className="flex justify-start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Thinking...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--border-primary)] p-3">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Ask AI to edit your video..."
            value={input}
            onChange={handleInputChange}
            disabled={isLoading || isRecording}
            className="flex-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
          />
          {input.trim() ? (
            <motion.button
              type="submit"
              className="flex items-center justify-center rounded-md bg-[var(--accent)] px-3 py-2.5 text-[var(--accent-on)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              disabled={!input.trim() || isLoading}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <Send className="h-3.5 w-3.5" />
            </motion.button>
          ) : (
            <div className="relative">
              <AnimatePresence>
                {isRecording && (
                  <>
                    <motion.div
                      className="absolute inset-0 rounded-md bg-red-500"
                      initial={{ opacity: 0.6, scale: 1 }}
                      animate={{ opacity: 0, scale: 1.8 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.div
                      className="absolute inset-0 rounded-md bg-red-500"
                      initial={{ opacity: 0.4, scale: 1 }}
                      animate={{ opacity: 0, scale: 1.5 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
                    />
                  </>
                )}
              </AnimatePresence>
              <motion.button
                type="button"
                onClick={toggleRecording}
                disabled={isLoading || isTranscribing}
                className={`relative flex items-center justify-center rounded-md px-3 py-2.5 text-[var(--accent-on)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  isRecording ? "bg-red-500" : "bg-[var(--accent)]"
                }`}
                title={isRecording ? "Stop recording" : "Start voice recording"}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                animate={isRecording ? { backgroundColor: ["#ef4444", "#dc2626", "#ef4444"] } : {}}
                transition={{
                  backgroundColor: { duration: 0.8, repeat: Infinity, ease: "easeInOut" },
                  scale: { type: "spring", stiffness: 400, damping: 17 },
                }}
              >
                <AnimatePresence mode="wait">
                  {isTranscribing ? (
                    <motion.div
                      key="transcribing"
                      initial={{ opacity: 0, rotate: 0 }}
                      animate={{ opacity: 1, rotate: 360 }}
                      exit={{ opacity: 0 }}
                      transition={{ rotate: { duration: 1, repeat: Infinity, ease: "linear" } }}
                    >
                      <Loader2 className="h-3.5 w-3.5" />
                    </motion.div>
                  ) : isRecording ? (
                    <motion.div
                      key="recording"
                      className="flex items-center gap-0.5"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    >
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-0.5 bg-white rounded-full"
                          animate={{ height: ["8px", "14px", "8px"] }}
                          transition={{
                            duration: 0.5,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.15,
                          }}
                        />
                      ))}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    >
                      <Mic className="h-3.5 w-3.5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          )}
        </div>
        <AnimatePresence>
          {transcriptionError && (
            <motion.div
              className="mt-2 flex items-center gap-2 rounded-md bg-[var(--error-bg)] border border-[var(--error-border)] px-3 py-2 text-[10px] text-[var(--error-text)]"
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              <span className="flex-1">{transcriptionError}</span>
              <button type="button" onClick={() => setTranscriptionError(null)} className="text-[var(--error-text)]/60 hover:text-[var(--error-text)]">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isTranscribing && !transcriptionError && (
            <motion.div
              className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Transcribing audio...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      <Dialog open={showNewChatDialog} onOpenChange={setShowNewChatDialog}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Chat?</DialogTitle>
            <DialogDescription>
              This will clear your current conversation. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <motion.button
              onClick={() => setShowNewChatDialog(false)}
              className="inline-flex items-center justify-center rounded-md border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              Cancel
            </motion.button>
            <motion.button
              onClick={confirmNewChat}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-[var(--accent-on)] hover:bg-[var(--error)]/90 transition-colors cursor-pointer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <MessageSquarePlus className="h-4 w-4" />
              Start New Chat
            </motion.button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
