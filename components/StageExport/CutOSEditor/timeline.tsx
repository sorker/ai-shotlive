"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { Video, Volume2, Lock, Eye, Film, Trash2, Scissors, Undo2, Redo2, Copy, Clipboard } from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "./ui/button"
import { useEditor, TimelineClip, PIXELS_PER_SECOND, DEFAULT_CLIP_TRANSFORM, DEFAULT_CLIP_EFFECTS } from "./editor-context"

export function Timeline() {
  const {
    mediaFiles,
    timelineClips,
    addClipToTimeline,
    updateClip,
    removeClip,
    selectedClipId,
    setSelectedClipId,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    timelineEndTime,
    isScrubbing,
    setIsScrubbing,
    activeClip,
    splitClip,
    undo,
    redo,
    canUndo,
    canRedo,
    copyClip,
    pasteClip,
    canPaste,
    zoomLevel,
    zoomIn,
    zoomOut,
    zoomToFit,
    pixelsPerSecond,
  } = useEditor()

  // Editing actions
  const handleCut = () => {
    if (activeClip) {
      splitClip(activeClip.id, currentTime)
    }
  }

  const handleDelete = () => {
    if (selectedClipId) {
      removeClip(selectedClipId)
    } else if (activeClip) {
      removeClip(activeClip.id)
    }
  }

  const handleCopy = () => {
    if (selectedClipId) {
      copyClip(selectedClipId)
    } else if (activeClip) {
      copyClip(activeClip.id)
    }
  }

  // Local state for smooth playhead animation
  const [localPlayheadPosition, setLocalPlayheadPosition] = useState(currentTime * pixelsPerSecond)
  const animationRef = useRef<number | null>(null)

  // Sync local position with context when not playing or when currentTime/zoom changes
  useEffect(() => {
    if (!isPlaying) {
      setLocalPlayheadPosition(currentTime * pixelsPerSecond)
    }
  }, [currentTime, isPlaying, pixelsPerSecond])

  // Animate playhead smoothly during playback
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      return
    }

    const animate = () => {
      // Read current time from context and update local position
      setLocalPlayheadPosition(currentTime * pixelsPerSecond)
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [isPlaying, currentTime, pixelsPerSecond])

  const playheadPosition = localPlayheadPosition

  const [draggedClip, setDraggedClip] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [liveTransform, setLiveTransform] = useState<{ clipId: string; x: number; trackId?: string } | null>(null)
  const draggedClipRef = useRef<string | null>(null)
  const lastUpdateTimeRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<{ clipId: string; updates: Partial<TimelineClip> } | null>(null)
  const [trimState, setTrimState] = useState<{
    clipId: string
    edge: 'left' | 'right'
    initialX: number
    initialStartTime: number
    initialDuration: number
    initialMediaOffset: number
  } | null>(null)
  const [liveTrim, setLiveTrim] = useState<{
    clipId: string
    edge: 'left' | 'right'
    deltaX: number
  } | null>(null)
  const [dropTargetTrack, setDropTargetTrack] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    x: number
    trackId: string
    duration: number
    label: string
    isSnapped?: boolean
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    clipId: string
  } | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const tracks = ["V2", "V1", "A2", "A1"]
  
  // Timeline layout constants
  const TRACK_HEIGHT = 48 // Track height in pixels (h-12)
  const RULER_HEIGHT = 24 // Ruler height in pixels (h-6)

  const handleTrimStart = useCallback((e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    
    const clip = timelineClips.find(c => c.id === clipId)
    if (!clip || !timelineRef.current) return
    
    const timelineRect = timelineRef.current.getBoundingClientRect()
    const mouseXInTimeline = e.clientX - timelineRect.left - 96
    
    setTrimState({
      clipId,
      edge,
      initialX: mouseXInTimeline,
      initialStartTime: clip.startTime,
      initialDuration: clip.duration,
      initialMediaOffset: clip.mediaOffset,
    })
    setSelectedClipId(clipId)
  }, [timelineClips, setSelectedClipId])

  const handleClipContextMenu = useCallback((e: React.MouseEvent, clipId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      clipId,
    })
    setSelectedClipId(clipId)
  }, [setSelectedClipId])

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    // Don't start dragging if we're on a trim handle
    if ((e.target as HTMLElement).getAttribute('data-trim-handle')) {
      return
    }
    
    e.preventDefault() // Prevent text selection and default drag behavior
    e.stopPropagation()
    setContextMenu(null) // Close context menu on any click
    if (!timelineRef.current) return
    
    // Calculate offset relative to timeline, not the clip itself
    const timelineRect = timelineRef.current.getBoundingClientRect()
    const clip = timelineClips.find(c => c.id === clipId)
    if (!clip) return
    
    // Calculate where the mouse is within the timeline (visual pixels)
    const mouseXInTimeline = e.clientX - timelineRect.left - 96 // Subtract track label width
    
    // Calculate where the clip starts (visual pixels)
    const clipVisualStart = (clip.startTime / PIXELS_PER_SECOND) * pixelsPerSecond
    
    // The drag offset is how far into the clip the user clicked (visual pixels)
    setDragOffset(mouseXInTimeline - clipVisualStart)
    setDraggedClip(clipId)
    setSelectedClipId(clipId)
  }, [timelineClips, pixelsPerSecond, setSelectedClipId])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
    // Handle trim operations with live visual feedback
    if (trimState && timelineRef.current) {
      const timelineRect = timelineRef.current.getBoundingClientRect()
      const mouseXInTimeline = e.clientX - timelineRect.left - 96
      const deltaVisual = mouseXInTimeline - trimState.initialX
      
      // Check bounds before showing visual feedback
      const deltaBase = (deltaVisual / pixelsPerSecond) * PIXELS_PER_SECOND
      const clip = timelineClips.find(c => c.id === trimState.clipId)
      const media = clip ? mediaFiles.find(m => m.id === clip.mediaId) : null
      if (!clip || !media) return
      
      const maxMediaDuration = media.durationSeconds * PIXELS_PER_SECOND
      let validDeltaVisual = deltaVisual
      
      if (trimState.edge === 'left') {
        const newStartTime = Math.max(0, trimState.initialStartTime + deltaBase)
        const actualDelta = newStartTime - trimState.initialStartTime
        const newDuration = trimState.initialDuration - actualDelta
        const newMediaOffset = trimState.initialMediaOffset + actualDelta
        
        // Clamp the delta to valid bounds
        if (newMediaOffset < 0) {
          // Can't trim before media start
          const maxDelta = -trimState.initialMediaOffset
          validDeltaVisual = (maxDelta / PIXELS_PER_SECOND) * pixelsPerSecond
        } else if (newMediaOffset >= maxMediaDuration) {
          // Can't trim past media end
          const maxDelta = maxMediaDuration - trimState.initialMediaOffset
          validDeltaVisual = (maxDelta / PIXELS_PER_SECOND) * pixelsPerSecond
        } else if (newDuration < PIXELS_PER_SECOND * 0.1) {
          // Minimum duration
          const maxDelta = trimState.initialDuration - PIXELS_PER_SECOND * 0.1
          validDeltaVisual = (maxDelta / PIXELS_PER_SECOND) * pixelsPerSecond
        }
        
        if (newMediaOffset >= 0 && newMediaOffset < maxMediaDuration && newDuration > PIXELS_PER_SECOND * 0.1) {
          pendingUpdateRef.current = {
            clipId: trimState.clipId,
            updates: { startTime: newStartTime, duration: newDuration, mediaOffset: newMediaOffset }
          }
        }
      } else {
        const newDuration = Math.max(PIXELS_PER_SECOND * 0.1, trimState.initialDuration + deltaBase)
        const endInMedia = trimState.initialMediaOffset + newDuration
        
        // Clamp the delta to valid bounds
        if (endInMedia > maxMediaDuration) {
          // Can't extend past media end
          const maxDuration = maxMediaDuration - trimState.initialMediaOffset
          const maxDelta = maxDuration - trimState.initialDuration
          validDeltaVisual = (maxDelta / PIXELS_PER_SECOND) * pixelsPerSecond
        } else if (newDuration < PIXELS_PER_SECOND * 0.1) {
          // Minimum duration
          const minDelta = PIXELS_PER_SECOND * 0.1 - trimState.initialDuration
          validDeltaVisual = (minDelta / PIXELS_PER_SECOND) * pixelsPerSecond
        }
        
        if (endInMedia <= maxMediaDuration && newDuration > PIXELS_PER_SECOND * 0.1) {
          pendingUpdateRef.current = {
            clipId: trimState.clipId,
            updates: { duration: newDuration }
          }
        }
      }
      
      // Only show visual feedback with valid delta
      setLiveTrim({
        clipId: trimState.clipId,
        edge: trimState.edge,
        deltaX: validDeltaVisual
      })
      
      return
    }
    
    if (!draggedClip || !timelineRef.current) return

    const timelineRect = timelineRef.current.getBoundingClientRect()
    const mouseXInTimeline = e.clientX - timelineRect.left - 96
    const relativeY = e.clientY - timelineRect.top
    const relativeX = mouseXInTimeline - dragOffset

    const clip = timelineClips.find(c => c.id === draggedClip)
    if (!clip) return

    const clipVisualDuration = (clip.duration / PIXELS_PER_SECOND) * pixelsPerSecond
    const gridSize = pixelsPerSecond
    let snappedVisualX = Math.max(0, Math.round(relativeX / gridSize) * gridSize)
    
    const snapThreshold = 15
    const trackIndex = Math.floor((relativeY - RULER_HEIGHT) / TRACK_HEIGHT)
    const targetTrack = trackIndex >= 0 && trackIndex < tracks.length ? tracks[trackIndex] : null
    
    if (targetTrack) {
      const otherClips = timelineClips.filter(c => 
        c.trackId === targetTrack && c.id !== draggedClip
      )
      
      for (const otherClip of otherClips) {
        const otherVisualStart = (otherClip.startTime / PIXELS_PER_SECOND) * pixelsPerSecond
        const otherVisualEnd = otherVisualStart + (otherClip.duration / PIXELS_PER_SECOND) * pixelsPerSecond
        
        if (Math.abs(relativeX - otherVisualEnd) < snapThreshold) {
          snappedVisualX = otherVisualEnd
          break
        }
        
        const currentClipEnd = relativeX + clipVisualDuration
        if (Math.abs(currentClipEnd - otherVisualStart) < snapThreshold) {
          snappedVisualX = otherVisualStart - clipVisualDuration
          break
        }
        
        if (Math.abs(relativeX - otherVisualStart) < snapThreshold) {
          snappedVisualX = otherVisualStart
          break
        }
        
        if (Math.abs(currentClipEnd - otherVisualEnd) < snapThreshold) {
          snappedVisualX = otherVisualEnd - clipVisualDuration
          break
        }
      }
    }
    
    // Validate target track compatibility
    const snappedX = (snappedVisualX / pixelsPerSecond) * PIXELS_PER_SECOND
    let validTargetTrack: string | undefined = undefined
    
    if (targetTrack) {
      const isVideoTrack = targetTrack.startsWith("V")
      const isVideoClip = clip.type === "video"
      
      if ((isVideoClip && isVideoTrack) || (!isVideoClip && !isVideoTrack)) {
        validTargetTrack = targetTrack
      }
    }
    
    // Instant visual feedback with CSS transform
    setLiveTransform({
      clipId: draggedClip,
      x: snappedVisualX,
      trackId: validTargetTrack
    })

    const updates: Partial<TimelineClip> = { startTime: snappedX }
    if (validTargetTrack && validTargetTrack !== clip.trackId) {
      updates.trackId = validTargetTrack
    }

    pendingUpdateRef.current = { clipId: draggedClip, updates }
    },
    [draggedClip, dragOffset, timelineClips, tracks, pixelsPerSecond, trimState, mediaFiles]
    )

  const handleMouseUp = useCallback(() => {
    // Apply any pending updates
    if (pendingUpdateRef.current) {
      updateClip(pendingUpdateRef.current.clipId, pendingUpdateRef.current.updates)
      pendingUpdateRef.current = null
    }
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    
    setDraggedClip(null)
    draggedClipRef.current = null
    setDragOffset(0)
    setLiveTransform(null)
    setLiveTrim(null)
    setTrimState(null)
    lastUpdateTimeRef.current = 0
  }, [updateClip])

  // Close context menu on click anywhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    const handleScroll = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      document.addEventListener('scroll', handleScroll, true)
      return () => {
        document.removeEventListener('click', handleClick)
        document.removeEventListener('scroll', handleScroll, true)
      }
    }
  }, [contextMenu])

  useEffect(() => {
    if (draggedClip || trimState) {
      // Use capture phase to ensure we always get the mouseup event
      const handleMouseUpCapture = (e: MouseEvent) => {
        handleMouseUp()
      }
      
      // Handle Escape key to cancel drag/trim
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          handleMouseUp()
        }
      }
      
      // Listen on both window and document to catch all mouseup events
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUpCapture, true) // Capture phase
      document.addEventListener("mouseup", handleMouseUpCapture, true) // Also on document
      
      // Also clear drag state if mouse leaves the window
      window.addEventListener("mouseleave", handleMouseUp)
      
      // Allow Escape key to cancel drag/trim
      window.addEventListener("keydown", handleEscape)
      
      return () => {
        window.removeEventListener("mousemove", handleMouseMove)
        window.removeEventListener("mouseup", handleMouseUpCapture, true)
        document.removeEventListener("mouseup", handleMouseUpCapture, true)
        window.removeEventListener("mouseleave", handleMouseUp)
        window.removeEventListener("keydown", handleEscape)
      }
    }
  }, [draggedClip, trimState, handleMouseMove, handleMouseUp])

  // Handle drops from media panel
  const handleTrackDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetTrack(trackId)

    // Get media info for preview
    const mediaId = e.dataTransfer.getData("application/x-media-id")
    if (!mediaId || !timelineRef.current) return

    const media = mediaFiles.find((m) => m.id === mediaId)
    if (!media) return

    // Calculate position relative to timeline
    const timelineRect = timelineRef.current.getBoundingClientRect()
    const relativeX = e.clientX - timelineRect.left - 96 // Subtract track label width

    // Check for NLP search result time range to get duration
    const clipStartStr = e.dataTransfer.getData("application/x-clip-start")
    const clipEndStr = e.dataTransfer.getData("application/x-clip-end")
    
    let clipDuration: number
    
    if (clipStartStr && clipEndStr) {
      const clipStart = parseFloat(clipStartStr)
      const clipEnd = parseFloat(clipEndStr)
      clipDuration = (clipEnd - clipStart) * pixelsPerSecond
    } else {
      clipDuration = Math.max(80, media.durationSeconds * pixelsPerSecond)
    }

    // Snap to grid based on zoom level (visual pixels)
    const gridSize = pixelsPerSecond // 1 second grid
    let snappedX = Math.max(0, Math.round(relativeX / gridSize) * gridSize)

    // Snap to other clips on this track (higher priority than grid)
    const snapThreshold = 15 // Pixels
    const clipsOnTrack = timelineClips.filter(c => c.trackId === trackId)
    let isSnapped = false
    
    for (const clip of clipsOnTrack) {
      const clipVisualStart = (clip.startTime / PIXELS_PER_SECOND) * pixelsPerSecond
      const clipVisualEnd = clipVisualStart + (clip.duration / PIXELS_PER_SECOND) * pixelsPerSecond
      
      // Snap to the end of existing clip (place new clip right after)
      if (Math.abs(relativeX - clipVisualEnd) < snapThreshold) {
        snappedX = clipVisualEnd
        isSnapped = true
        break
      }
      
      // Snap to the start of existing clip (place new clip right before)
      const newClipEnd = relativeX + clipDuration
      if (Math.abs(newClipEnd - clipVisualStart) < snapThreshold) {
        snappedX = clipVisualStart - clipDuration
        isSnapped = true
        break
      }
      
      // Snap start to start
      if (Math.abs(relativeX - clipVisualStart) < snapThreshold) {
        snappedX = clipVisualStart
        isSnapped = true
        break
      }
      
      // Snap end to end
      if (Math.abs(newClipEnd - clipVisualEnd) < snapThreshold) {
        snappedX = clipVisualEnd - clipDuration
        isSnapped = true
        break
      }
    }

    // Format label for preview
    let clipLabel = media.name
    if (clipStartStr && clipEndStr) {
      const clipStart = parseFloat(clipStartStr)
      const clipEnd = parseFloat(clipEndStr)
      const formatTime = (s: number) => {
        const mins = Math.floor(s / 60)
        const secs = Math.floor(s % 60)
        return `${mins}:${secs.toString().padStart(2, "0")}`
      }
      clipLabel = `${media.name} (${formatTime(clipStart)} - ${formatTime(clipEnd)})`
    }

    setDragPreview({
      x: snappedX,
      trackId,
      duration: clipDuration,
      label: clipLabel,
      isSnapped,
    })
  }, [mediaFiles, pixelsPerSecond, timelineClips])

  const handleTrackDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    // Only clear if actually leaving the timeline area
    if (e.currentTarget === e.target) {
      setDropTargetTrack(null)
      setDragPreview(null)
    }
  }, [])

  const handleTrackDrop = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault()
      e.stopPropagation()
      
      // Use the preview position if available (which includes snapping)
      const previewPosition = dragPreview?.x
      
      setDropTargetTrack(null)
      setDragPreview(null)

      const mediaId = e.dataTransfer.getData("application/x-media-id")
      if (!mediaId) return

      const media = mediaFiles.find((m) => m.id === mediaId)
      if (!media) return

      // Check for NLP search result time range (from AI search)
      const clipStartStr = e.dataTransfer.getData("application/x-clip-start")
      const clipEndStr = e.dataTransfer.getData("application/x-clip-end")
      
      let mediaOffset = 0 // Start from beginning of source media by default
      let clipDuration: number
      let clipLabel = media.name
      
      if (clipStartStr && clipEndStr) {
        // NLP search result with specific time range
        const clipStart = parseFloat(clipStartStr)
        const clipEnd = parseFloat(clipEndStr)
        mediaOffset = clipStart * PIXELS_PER_SECOND // Convert seconds to base pixels
        clipDuration = Math.max(80, (clipEnd - clipStart) * PIXELS_PER_SECOND)
        
        // Format time for label
        const formatTime = (s: number) => {
          const mins = Math.floor(s / 60)
          const secs = Math.floor(s % 60)
          return `${mins}:${secs.toString().padStart(2, "0")}`
        }
        clipLabel = `${media.name} (${formatTime(clipStart)} - ${formatTime(clipEnd)})`
      } else {
        // Full media clip
        clipDuration = Math.max(80, media.durationSeconds * PIXELS_PER_SECOND)
      }

      // Use preview position if available (includes snapping), otherwise calculate position
      let startPosition: number
      if (previewPosition !== undefined) {
        // Convert visual pixels from preview to base pixels
        startPosition = (previewPosition / pixelsPerSecond) * PIXELS_PER_SECOND
      } else {
        // Fallback: Find clips on this track and get the end position of the last one
        const clipsOnTrack = timelineClips.filter((clip) => clip.trackId === trackId)
        
        if (clipsOnTrack.length === 0) {
          // No clips on track - place at the beginning
          startPosition = 0
        } else {
          // Find the rightmost clip end position
          const lastClipEnd = clipsOnTrack.reduce((max, clip) => {
            const clipEnd = clip.startTime + clip.duration
            return Math.max(max, clipEnd)
          }, 0)
          startPosition = lastClipEnd
        }
      }

      const newClip: TimelineClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        mediaId: media.id,
        trackId,
        startTime: startPosition,
        duration: clipDuration,
        mediaOffset: mediaOffset,
        label: clipLabel,
        type: trackId.startsWith("V") ? "video" : "audio",
        transform: DEFAULT_CLIP_TRANSFORM,
        effects: DEFAULT_CLIP_EFFECTS,
      }

      addClipToTimeline(newClip)
    },
    [mediaFiles, timelineClips, addClipToTimeline, dragPreview, pixelsPerSecond]
  )

  // Calculate time from mouse position
  const getTimeFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!timelineRef.current) return null
    const timelineRect = timelineRef.current.getBoundingClientRect()
    const relativeX = e.clientX - timelineRect.left
    if (relativeX >= 0) {
      return Math.max(0, relativeX / pixelsPerSecond)
    }
    return null
  }, [pixelsPerSecond])

  // Handle scrubbing (drag to move playhead)
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!timelineRef.current) return
      
      // Prevent text selection during drag
      e.preventDefault()
      e.stopPropagation()
      
      // Check if we clicked on a clip
      const target = e.target as HTMLElement
      if (target.closest("[data-clip-id]")) return

      const newTime = getTimeFromMouseEvent(e)
      if (newTime !== null) {
        // Pause playback if playing
        if (isPlaying) {
          setIsPlaying(false)
        }
        // Allow dragging past the timeline end
        const clampedTime = Math.max(0, newTime)
        setCurrentTime(clampedTime)
        setSelectedClipId(null)
        setIsScrubbing(true)
      }
    },
    [setCurrentTime, setSelectedClipId, getTimeFromMouseEvent, setIsScrubbing, isPlaying, setIsPlaying]
  )

  // Handle scrubbing mousemove
  const handleScrubMove = useCallback(
    (e: MouseEvent) => {
      if (!isScrubbing) return
      // Prevent text selection and default behaviors during drag
      e.preventDefault()
      e.stopPropagation()
      const newTime = getTimeFromMouseEvent(e)
      if (newTime !== null) {
        // Allow dragging past the timeline end
        const clampedTime = Math.max(0, newTime)
        setCurrentTime(clampedTime)
      }
    },
    [isScrubbing, setCurrentTime, getTimeFromMouseEvent]
  )

  // Handle scrubbing mouseup
  const handleScrubEnd = useCallback(() => {
    setIsScrubbing(false)
  }, [])

  // Add/remove scrubbing event listeners
  useEffect(() => {
    if (isScrubbing) {
      // Prevent text selection globally during scrubbing
      const originalUserSelect = document.body.style.userSelect
      const originalCursor = document.body.style.cursor
      const originalWebkitUserSelect = (document.body.style as any).webkitUserSelect
      
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ew-resize'
      ;(document.body.style as any).webkitUserSelect = 'none'
      
      // Also prevent selection on the document
      const preventSelect = (e: Event) => e.preventDefault()
      document.addEventListener('selectstart', preventSelect)
      document.addEventListener('dragstart', preventSelect)
      
      window.addEventListener("mousemove", handleScrubMove)
      window.addEventListener("mouseup", handleScrubEnd)
      return () => {
        document.body.style.userSelect = originalUserSelect
        document.body.style.cursor = originalCursor
        ;(document.body.style as any).webkitUserSelect = originalWebkitUserSelect
        document.removeEventListener('selectstart', preventSelect)
        document.removeEventListener('dragstart', preventSelect)
        window.removeEventListener("mousemove", handleScrubMove)
        window.removeEventListener("mouseup", handleScrubEnd)
      }
    }
  }, [isScrubbing, handleScrubMove, handleScrubEnd])

  // Handle scroll wheel zoom on timeline
  useEffect(() => {
    const timelineElement = timelineRef.current
    if (!timelineElement) return

    const handleWheel = (e: WheelEvent) => {
      // Check if Ctrl or Cmd is pressed (standard zoom gesture)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        
        // Determine zoom direction (negative deltaY = zoom in, positive = zoom out)
        if (e.deltaY < 0) {
          // Zoom in
          if (zoomLevel < 500) {
            zoomIn()
          }
        } else {
          // Zoom out
          if (zoomLevel > 25) {
            zoomOut()
          }
        }
      }
    }

    timelineElement.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      timelineElement.removeEventListener('wheel', handleWheel)
    }
  }, [zoomLevel, zoomIn, zoomOut])

  const handleDeleteClip = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation()
      removeClip(clipId)
    },
    [removeClip]
  )

  // Format time for ruler (MM:SS)
  const formatRulerTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  const formatDragTime = (seconds: number): string => {
    // For durations under 1 minute, show seconds with 1 decimal
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`
    }
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Timeline Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="text-xs font-medium text-foreground">Timeline</div>
          {/* Editing Toolbar */}
          <div className="flex items-center gap-1 border-l border-border pl-3 ml-3">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant={activeClip ? "default" : "ghost"}
                size="sm"
                className={`h-7 w-7 p-0 transition-colors ${
                  activeClip ? "bg-primary text-primary-foreground shadow-md" : ""
                }`}
                onClick={handleCut}
                disabled={!activeClip}
                title="Split clip at playhead (S)"
              >
                <Scissors className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleDelete}
                disabled={!selectedClipId && !activeClip}
                title="Delete clip (Delete)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
            <div className="w-px h-3 bg-border mx-0.5" />
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z / Cmd+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z / Cmd+Shift+Z)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
            <div className="w-px h-3 bg-border mx-0.5" />
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleCopy}
                disabled={!selectedClipId && !activeClip}
                title="Copy clip (Ctrl+C / Cmd+C)"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={pasteClip}
                disabled={!canPaste}
                title="Paste clip (Ctrl+V / Cmd+V)"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
          </div>
          <div className="font-mono text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
            {formatRulerTime(currentTime)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.button 
            onClick={zoomToFit}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Zoom to fit all clips"
          >
            Fit
          </motion.button>
          <div className="flex items-center gap-1">
            <motion.button 
              onClick={zoomOut}
              disabled={zoomLevel <= 25}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              whileHover={{ scale: zoomLevel > 25 ? 1.05 : 1 }}
              whileTap={{ scale: zoomLevel > 25 ? 0.95 : 1 }}
              title="Zoom out (max 10 minutes)"
            >
              −
            </motion.button>
            <div className="px-2 text-xs text-muted-foreground font-mono min-w-[48px] text-center">
              {zoomLevel}%
            </div>
            <motion.button 
              onClick={zoomIn}
              disabled={zoomLevel >= 500}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              whileHover={{ scale: zoomLevel < 500 ? 1.05 : 1 }}
              whileTap={{ scale: zoomLevel < 500 ? 0.95 : 1 }}
              title="Zoom in (max detail)"
            >
              +
            </motion.button>
          </div>
        </div>
      </div>

      {/* Timeline Tracks */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track Labels */}
        <div className="w-24 border-r border-border bg-secondary">
          {tracks.map((track) => (
            <div key={track} className="flex h-12 items-center gap-2 border-b border-border px-2">
              <div className="flex items-center gap-1">
                {track.startsWith("V") ? (
                  <Video className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <Volume2 className="h-3 w-3 text-muted-foreground" />
                )}
                <Lock className="h-2.5 w-2.5 text-muted-foreground/50" />
                <Eye className="h-2.5 w-2.5 text-muted-foreground/50" />
              </div>
              <div className="text-xs font-medium text-foreground">{track}</div>
            </div>
          ))}
        </div>

        {/* Timeline Grid */}
        <div
          ref={timelineRef}
          className={`relative flex-1 overflow-x-auto scrollbar-thin select-none ${
            isScrubbing ? "cursor-ew-resize" : trimState ? "cursor-ew-resize" : draggedClip ? "cursor-grabbing" : dropTargetTrack ? "cursor-copy" : ""
          }`}
          onMouseDown={handleTimelineMouseDown}
          style={{ 
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          } as React.CSSProperties}
        >
          {/* Time Ruler - Dynamic based on zoom level */}
          <div className="sticky top-0 z-10 flex h-6 border-b border-border bg-card">
            {(() => {
              // Calculate ruler segments based on zoom
              // At 100% zoom: 10px/sec, show every 8 seconds (80px segments)
              // At 25% zoom (10 min view): 2.5px/sec, show every 30 seconds
              // At 500% zoom: 50px/sec, show every 2 seconds
              const secondsPerSegment = zoomLevel <= 50 ? 30 : zoomLevel <= 100 ? 8 : zoomLevel <= 200 ? 4 : 2
              const segmentWidth = secondsPerSegment * pixelsPerSecond
              
              // Always show at least up to 10 minutes (600 seconds) so timeline is usable
              // Users can zoom out to see full 10 minutes, or zoom in to see detail
              const maxTimelineSeconds = 600 // 10 minutes max
              const numSegments = Math.ceil(maxTimelineSeconds / secondsPerSegment)
              
              return Array.from({ length: numSegments }).map((_, i) => (
                <div key={i} className="shrink-0 border-r border-border" style={{ width: `${segmentWidth}px` }}>
                  <div className="px-2 text-[10px] text-muted-foreground">
                    {formatRulerTime(i * secondsPerSegment)}
                  </div>
                </div>
              ))
            })()}
          </div>

          {/* Tracks Content */}
          <div className="relative">
            {tracks.map((track, index) => (
              <div
                key={track}
                className={`flex h-12 border-b transition-all relative ${
                  dropTargetTrack === track 
                    ? "bg-blue-500/20 border-blue-400 shadow-inner ring-1 ring-blue-400/50 ring-inset" 
                    : "border-border"
                }`}
                style={{
                  background: dropTargetTrack === track 
                    ? undefined 
                    : index < 2 ? "oklch(0.10 0 0)" : "oklch(0.12 0 0)",
                }}
                onDragOver={(e) => handleTrackDragOver(e, track)}
                onDragLeave={handleTrackDragLeave}
                onDrop={(e) => handleTrackDrop(e, track)}
              >
                {/* Drop zone indicator */}
                {dropTargetTrack === track && (
                  <div className="absolute inset-0 border-2 border-dashed border-blue-400 rounded-sm pointer-events-none animate-pulse" />
                )}
                {/* Grid lines - sync with ruler */}
                <div className="absolute inset-0 flex pointer-events-none">
                  {(() => {
                    const secondsPerSegment = zoomLevel <= 50 ? 30 : zoomLevel <= 100 ? 8 : zoomLevel <= 200 ? 4 : 2
                    const segmentWidth = secondsPerSegment * pixelsPerSecond
                    const maxTimelineSeconds = 600 // Match ruler
                    const numSegments = Math.ceil(maxTimelineSeconds / secondsPerSegment)
                    
                    return Array.from({ length: numSegments }).map((_, i) => (
                      <div key={i} className="shrink-0 border-r border-border/30" style={{ width: `${segmentWidth}px` }} />
                    ))
                  })()}
                </div>

                {/* Drag preview - shows where clip will be placed */}
                {dragPreview && dragPreview.trackId === track && (
                  <div
                    className={`absolute z-30 mx-1 my-1.5 h-9 rounded-lg border-2 pointer-events-none transition-all shadow-2xl ${
                      dragPreview.isSnapped 
                        ? "border-solid border-green-400 bg-green-400/40 ring-2 ring-green-400/50 ring-offset-1 ring-offset-background" 
                        : "border-dashed border-blue-400 bg-blue-400/30 ring-2 ring-blue-400/40 ring-offset-1 ring-offset-background animate-pulse"
                    }`}
                    style={{ left: `${dragPreview.x}px`, width: `${dragPreview.duration}px` }}
                  >
                    {/* Clip info overlay */}
                    <div className="flex h-full items-center justify-center px-2">
                      <div className={`text-xs font-bold px-3 py-1 rounded-md shadow-lg backdrop-blur-sm whitespace-nowrap ${
                        dragPreview.isSnapped 
                          ? "bg-green-500 text-white" 
                          : "bg-blue-500 text-white"
                      }`}>
                        {dragPreview.isSnapped && "🧲 "}
                        {dragPreview.label}
                      </div>
                    </div>
                    
                    {/* Duration and position indicator at top */}
                    <div className={`absolute -top-7 left-0 right-0 flex items-center justify-center`}>
                      <div className={`text-[10px] font-semibold px-2 py-1 rounded shadow-md whitespace-nowrap ${
                        dragPreview.isSnapped 
                          ? "bg-green-500 text-white" 
                          : "bg-blue-500 text-white"
                      }`}>
                        ⏱ {formatDragTime(dragPreview.duration / pixelsPerSecond)} • 📍 {formatRulerTime(dragPreview.x / pixelsPerSecond)}
                      </div>
                    </div>
                    
                    {/* Vertical start indicator with arrow */}
                    <div className={`absolute -left-1 top-0 bottom-0 w-1 rounded-l ${
                      dragPreview.isSnapped ? "bg-green-400" : "bg-blue-400"
                    }`}>
                      <div className={`absolute top-1/2 -translate-y-1/2 -left-2 ${
                        dragPreview.isSnapped ? "text-green-400" : "text-blue-400"
                      }`}>▶</div>
                    </div>
                    
                    {/* Vertical end indicator with arrow */}
                    <div className={`absolute -right-1 top-0 bottom-0 w-1 rounded-r ${
                      dragPreview.isSnapped ? "bg-green-400" : "bg-blue-400"
                    }`}>
                      <div className={`absolute top-1/2 -translate-y-1/2 -right-2 ${
                        dragPreview.isSnapped ? "text-green-400" : "text-blue-400"
                      }`}>◀</div>
                    </div>
                    
                    {/* Full-height position line */}
                    <div className={`absolute left-0 -top-2 bottom-0 w-0.5 ${
                      dragPreview.isSnapped ? "bg-green-400" : "bg-blue-400"
                    }`} style={{ height: 'calc(100% + 8px)' }}></div>
                  </div>
                )}

                {timelineClips
                  .filter((clip) => {
                    // Check if clip should be shown on this track
                    const isOnThisTrack = clip.trackId === track
                    const isBeingDraggedToThisTrack = liveTransform?.clipId === clip.id && liveTransform?.trackId === track
                    const isDraggedAwayFromThisTrack = liveTransform?.clipId === clip.id && liveTransform?.trackId && liveTransform.trackId !== track && clip.trackId === track
                    
                    return (isOnThisTrack && !isDraggedAwayFromThisTrack) || isBeingDraggedToThisTrack
                  })
                  .map((clip) => {
                    const media = mediaFiles.find((m) => m.id === clip.mediaId)
                    // Convert stored base pixels to visual pixels based on zoom
                    let visualStartTime = (clip.startTime / PIXELS_PER_SECOND) * pixelsPerSecond
                    let visualDuration = (clip.duration / PIXELS_PER_SECOND) * pixelsPerSecond
                    
                    // Apply live transform for instant feedback
                    if (liveTransform && liveTransform.clipId === clip.id) {
                      visualStartTime = liveTransform.x
                    }
                    
                    // Apply live trim for instant feedback
                    if (liveTrim && liveTrim.clipId === clip.id) {
                      if (liveTrim.edge === 'left') {
                        visualStartTime += liveTrim.deltaX
                        visualDuration -= liveTrim.deltaX
                      } else {
                        visualDuration += liveTrim.deltaX
                      }
                    }
                    
                    return (
                    <div
                      key={clip.id}
                        data-clip-id={clip.id}
                      onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
                      onContextMenu={(e) => handleClipContextMenu(e, clip.id)}
                        className={`absolute z-10 mx-1 my-1.5 h-9 rounded border overflow-hidden group ${
                        clip.type === "video" ? "bg-primary/80 border-primary" : "bg-chart-2/80 border-chart-2"
                        } ${draggedClip === clip.id ? "opacity-70 cursor-grabbing z-50" : trimState?.clipId === clip.id ? "cursor-ew-resize z-50" : "cursor-grab"} ${
                          selectedClipId === clip.id ? "ring-2 ring-white" : ""
                        } ${activeClip?.id === clip.id ? "ring-2 ring-red-500/50" : ""}`}
                      style={{ left: `${visualStartTime}px`, width: `${Math.max(20, visualDuration)}px` }}
                    >
                      {clip.type === "video" ? (
                          <div className="flex h-full items-center gap-1.5 px-2">
                            {media?.thumbnail ? (
                              <img 
                                src={media.thumbnail} 
                                alt="" 
                                className="h-6 w-10 object-cover rounded-sm shrink-0"
                              />
                            ) : (
                              <Film className="h-3 w-3 text-primary-foreground/80 shrink-0" />
                            )}
                            <div className="text-[10px] font-medium text-primary-foreground truncate">
                              {clip.label}
                            </div>
                        </div>
                      ) : (
                        <div className="h-full">
                          <div className="flex h-full items-center gap-1.5 px-2">
                              <Volume2 className="h-3 w-3 shrink-0 text-foreground/60" />
                            {/* Simple waveform visualization */}
                            <div className="flex h-full flex-1 items-center gap-px">
                                {Array.from({ length: Math.min(40, Math.floor(clip.duration / 8)) }).map((_, i) => (
                                <div
                                  key={i}
                                  className="flex-1 bg-foreground/60"
                                  style={{ height: `${30 + Math.random() * 70}%` }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                        
                        {/* Trim handles - always visible */}
                        <div
                          data-trim-handle="true"
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-linear-to-r from-white/40 to-transparent hover:from-white/70 hover:to-white/20 transition-all z-20 border-r-2 border-white/60 hover:border-white/90 shadow-lg"
                          onMouseDown={(e) => handleTrimStart(e, clip.id, 'left')}
                          title="Drag to trim start"
                        >
                          {/* Grip lines */}
                          <div className="absolute inset-y-0 left-0.5 flex flex-col items-center justify-center gap-0.5">
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                          </div>
                        </div>
                        <div
                          data-trim-handle="true"
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-linear-to-l from-white/40 to-transparent hover:from-white/70 hover:to-white/20 transition-all z-20 border-l-2 border-white/60 hover:border-white/90 shadow-lg"
                          onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
                          title="Drag to trim end"
                        >
                          {/* Grip lines */}
                          <div className="absolute inset-y-0 right-0.5 flex flex-col items-center justify-center gap-0.5">
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                            <div className="w-0.5 h-1 bg-white/80 rounded-full"></div>
                          </div>
                        </div>
                        
                        {/* Delete button on hover - moved away from trim handle */}
                        <button
                          onClick={(e) => handleDeleteClip(e, clip.id)}
                          className="absolute top-0.5 right-3 rounded bg-black/70 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 cursor-pointer z-30 shadow-lg"
                        >
                          <Trash2 className="h-3 w-3 text-white" />
                        </button>
                    </div>
                    )
                  })}
              </div>
            ))}

            {/* Playhead - synced with video */}
            <div
              className="absolute top-0 z-20 h-full w-0.5 bg-red-500"
              style={{ left: `${playheadPosition}px` }}
            >
              {/* Draggable playhead handle */}
              <div 
                className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-red-500 ring-2 ring-background shadow-lg cursor-ew-resize hover:scale-125 transition-transform select-none"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault() // Prevent text selection
                  // Pause playback if playing
                  if (isPlaying) {
                    setIsPlaying(false)
                  }
                  const newTime = getTimeFromMouseEvent(e)
                  if (newTime !== null) {
                    // Allow dragging past the timeline end
                    const clampedTime = Math.max(0, newTime)
                    setCurrentTime(clampedTime)
                  }
                  setIsScrubbing(true)
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Empty state hint */}
      {timelineClips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-muted-foreground/50">
            <Film className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">Drag media here to start editing</p>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
            onClick={() => {
              const clip = timelineClips.find(c => c.id === contextMenu.clipId)
              if (clip) {
                splitClip(contextMenu.clipId, currentTime)
              }
              setContextMenu(null)
            }}
            disabled={!activeClip || activeClip.id !== contextMenu.clipId}
          >
            <Scissors className="h-3.5 w-3.5" />
            Split at Playhead
            <span className="ml-auto text-xs text-muted-foreground">S</span>
          </button>
          <button
            className="w-full px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 cursor-pointer"
            onClick={() => {
              copyClip(contextMenu.clipId)
              setContextMenu(null)
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
          </button>
          <div className="h-px bg-border my-1" />
          <button
            className="w-full px-3 py-2 text-sm text-left hover:bg-destructive hover:text-destructive-foreground flex items-center gap-2 cursor-pointer"
            onClick={() => {
              removeClip(contextMenu.clipId)
              setContextMenu(null)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
            <span className="ml-auto text-xs text-muted-foreground">Del</span>
          </button>
        </div>
      )}
    </div>
  )
}
