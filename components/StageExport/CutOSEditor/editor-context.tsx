/**
 * CutOS 编辑器 Context - 本地状态，无 Supabase
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import type {
  TimelineData,
  TimelineClipData,
  MediaFileData,
  ClipTransform,
  ClipEffects,
  Caption,
} from './types';

export const PIXELS_PER_SECOND = 10;

export interface MediaFile {
  id: string;
  file?: File;
  name: string;
  duration: string;
  durationSeconds: number;
  thumbnail: string | null;
  type: string;
  objectUrl: string;
  storagePath?: string;
  storageUrl?: string;
  isUploading?: boolean;
  captions?: Caption[];
  captionsGenerating?: boolean;
}

export interface TimelineClip {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  mediaOffset: number;
  label: string;
  type: 'video' | 'audio';
  transform: ClipTransform;
  effects: ClipEffects;
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  positionX: 0,
  positionY: 0,
  scale: 100,
  opacity: 100,
};

export const DEFAULT_CLIP_EFFECTS: ClipEffects = {
  preset: 'none',
  blur: 0,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hueRotate: 0,
  chromakey: {
    enabled: false,
    keyColor: '#00FF00',
    similarity: 0.4,
    smoothness: 0.1,
    spill: 0.3,
  },
};

interface EditorContextType {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  projectResolution: string | null;
  setProjectResolution: (r: string | null) => void;
  mediaFiles: MediaFile[];
  addMediaFiles: (files: MediaFile[]) => void;
  removeMediaFile: (id: string) => void;
  timelineClips: TimelineClip[];
  addClipToTimeline: (clip: TimelineClip) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  removeClip: (id: string) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  pixelsPerSecond: number;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  copyClip: (clipId: string) => void;
  pasteClip: () => void;
  canPaste: boolean;
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  isScrubbing: boolean;
  setIsScrubbing: (scrubbing: boolean) => void;
  getMediaForClip: (clipId: string) => MediaFile | undefined;
  previewMedia: MediaFile | null;
  activeClip: TimelineClip | null;
  backgroundClip: TimelineClip | null;
  clipTimeOffset: number;
  backgroundClipTimeOffset: number;
  timelineEndTime: number;
  sortedVideoClips: TimelineClip[];
  loadTimelineData: (data: TimelineData | null) => void;
  saveProject: () => Promise<void>;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  setProjectThumbnail: (thumbnail: string) => void;
  isEyedropperActive: boolean;
  setIsEyedropperActive: (active: boolean) => void;
  onColorSampled?: (r: number, g: number, b: number) => void;
  setColorSampledCallback: (cb: ((r: number, g: number, b: number) => void) | undefined) => void;
  generateCaptions: (mediaId: string, options?: { language?: string; prompt?: string }) => Promise<void>;
  updateMediaCaptions: (mediaId: string, captions: Caption[]) => void;
  getCaptionsForClip: (clipId: string) => Caption[];
  showCaptions: boolean;
  setShowCaptions: (show: boolean) => void;
  captionStyle: 'classic' | 'tiktok';
  setCaptionStyle: (style: 'classic' | 'tiktok') => void;
  reindexMedia: (mediaId: string) => Promise<void>;
  trackMuted: Record<string, boolean>;
  trackLocked: Record<string, boolean>;
  trackVisible: Record<string, boolean>;
  setTrackMuted: (trackId: string, muted: boolean) => void;
  setTrackLocked: (trackId: string, locked: boolean) => void;
  setTrackVisible: (trackId: string, visible: boolean) => void;
}

const EditorContext = createContext<EditorContextType | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectResolution, setProjectResolution] = useState<string | null>('1920x1080');
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [projectThumbnail, setProjectThumbnail] = useState<string | null>(null);
  const [isEyedropperActive, setIsEyedropperActive] = useState(false);
  const [colorSampledCallback, setColorSampledCallback] = useState<
    ((r: number, g: number, b: number) => void) | undefined
  >(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<'classic' | 'tiktok'>('tiktok');
  const [zoomLevel, setZoomLevel] = useState(100);
  const pixelsPerSecond = (PIXELS_PER_SECOND * zoomLevel) / 100;
  const [trackMuted, setTrackMutedState] = useState<Record<string, boolean>>({});
  const [trackLocked, setTrackLockedState] = useState<Record<string, boolean>>({});
  const [trackVisible, setTrackVisibleState] = useState<Record<string, boolean>>({});

  const historyRef = useRef<TimelineClip[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const copiedClipRef = useRef<TimelineClip | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [canPasteState, setCanPasteState] = useState(false);

  const updateHistoryState = useCallback(() => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    setHistoryState({
      canUndo: history.length > 0 && index > 0,
      canRedo: index < history.length - 1,
    });
  }, []);

  const saveToHistory = useCallback(() => {
    const currentState = [...timelineClips];
    const history = historyRef.current;
    const index = historyIndexRef.current;
    if (index < history.length - 1) history.splice(index + 1);
    history.push(JSON.parse(JSON.stringify(currentState)));
    historyIndexRef.current = history.length - 1;
    if (history.length > 50) {
      history.shift();
      historyIndexRef.current = history.length - 1;
    }
    updateHistoryState();
  }, [timelineClips, updateHistoryState]);

  const undo = useCallback(() => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    if (index > 0) {
      historyIndexRef.current = index - 1;
      setTimelineClips(JSON.parse(JSON.stringify(history[index - 1])));
      setHasUnsavedChanges(true);
      updateHistoryState();
    }
  }, [updateHistoryState]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    if (index < history.length - 1) {
      historyIndexRef.current = index + 1;
      setTimelineClips(JSON.parse(JSON.stringify(history[index + 1])));
      setHasUnsavedChanges(true);
      updateHistoryState();
    }
  }, [updateHistoryState]);

  const zoomIn = useCallback(() => setZoomLevel((p) => Math.min(500, p + 25)), []);
  const zoomOut = useCallback(() => setZoomLevel((p) => Math.max(25, p - 25)), []);
  const setTrackMuted = useCallback((trackId: string, muted: boolean) => {
    setTrackMutedState((prev) => ({ ...prev, [trackId]: muted }));
  }, []);
  const setTrackLocked = useCallback((trackId: string, locked: boolean) => {
    setTrackLockedState((prev) => ({ ...prev, [trackId]: locked }));
  }, []);
  const setTrackVisible = useCallback((trackId: string, visible: boolean) => {
    setTrackVisibleState((prev) => ({ ...prev, [trackId]: visible }));
  }, []);

  const zoomToFit = useCallback(() => {
    if (timelineClips.length === 0) {
      setZoomLevel(100);
      return;
    }
    const maxTime = Math.max(
      ...timelineClips.map((c) => (c.startTime + c.duration) / PIXELS_PER_SECOND)
    );
    const targetViewportWidth = 1000;
    const requiredZoom = Math.max(
      25,
      Math.min(500, (targetViewportWidth / (maxTime * PIXELS_PER_SECOND)) * 100)
    );
    setZoomLevel(Math.round(requiredZoom / 25) * 25);
  }, [timelineClips]);

  const copyClip = useCallback((clipId: string) => {
    const clip = timelineClips.find((c) => c.id === clipId);
    if (clip) {
      copiedClipRef.current = JSON.parse(JSON.stringify(clip));
      setCanPasteState(true);
    }
  }, [timelineClips]);

  const pasteClip = useCallback(() => {
    const copied = copiedClipRef.current;
    if (!copied) return;
    saveToHistory();
    const newClip: TimelineClip = {
      ...JSON.parse(JSON.stringify(copied)),
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      startTime: currentTime * PIXELS_PER_SECOND,
    };
    setTimelineClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    setHasUnsavedChanges(true);
  }, [currentTime, saveToHistory]);

  useEffect(() => {
    setCanPasteState(copiedClipRef.current !== null);
  }, [timelineClips]);

  const addMediaFiles = useCallback((files: MediaFile[]) => {
    setMediaFiles((prev) => [...prev, ...files.map((f) => ({ ...f, isUploading: false }))]);
    setHasUnsavedChanges(true);
  }, []);

  const reindexMedia = useCallback(async (_mediaId: string) => {
    // 本地模式：无 TwelveLabs，跳过
  }, []);

  const removeMediaFile = useCallback(
    (id: string) => {
      saveToHistory();
      setMediaFiles((prev) => prev.filter((f) => f.id !== id));
      setTimelineClips((prev) => {
        if (prev.some((c) => c.id === selectedClipId && c.mediaId === id)) setSelectedClipId(null);
        return prev.filter((c) => c.mediaId !== id);
      });
      setHasUnsavedChanges(true);
    },
    [saveToHistory, selectedClipId]
  );

  const addClipToTimeline = useCallback(
    (clip: TimelineClip) => {
      saveToHistory();
      setTimelineClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      setHasUnsavedChanges(true);
    },
    [saveToHistory]
  );

  const updateClip = useCallback(
    (id: string, updates: Partial<TimelineClip>) => {
      saveToHistory();
      setTimelineClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
      setHasUnsavedChanges(true);
    },
    [saveToHistory]
  );

  const removeClip = useCallback(
    (id: string) => {
      saveToHistory();
      setTimelineClips((prev) => prev.filter((c) => c.id !== id));
      if (selectedClipId === id) setSelectedClipId(null);
      setHasUnsavedChanges(true);
    },
    [selectedClipId, saveToHistory]
  );

  const splitClip = useCallback(
    (clipId: string, splitTime: number) => {
      const clip = timelineClips.find((c) => c.id === clipId);
      if (!clip) return;
      const splitPositionPixels = splitTime * PIXELS_PER_SECOND;
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (splitPositionPixels <= clipStart || splitPositionPixels >= clipEnd) return;
      saveToHistory();
      const firstClipDuration = splitPositionPixels - clipStart;
      const secondClipDuration = clipEnd - splitPositionPixels;
      const updatedFirst: TimelineClip = { ...clip, duration: firstClipDuration };
      const secondClip: TimelineClip = {
        ...clip,
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        startTime: splitPositionPixels,
        duration: secondClipDuration,
        mediaOffset: clip.mediaOffset + firstClipDuration,
      };
      setTimelineClips((prev) =>
        prev.map((c) => (c.id === clipId ? updatedFirst : c)).concat(secondClip)
      );
      setSelectedClipId(secondClip.id);
      setHasUnsavedChanges(true);
    },
    [timelineClips, saveToHistory]
  );

  const getMediaForClip = useCallback(
    (clipId: string) => {
      const clip = timelineClips.find((c) => c.id === clipId);
      if (!clip) return undefined;
      return mediaFiles.find((m) => m.id === clip.mediaId);
    },
    [timelineClips, mediaFiles]
  );

  const loadTimelineData = useCallback((data: TimelineData | null) => {
    if (!data) return;
    const restoredClips: TimelineClip[] = data.clips.map((c: TimelineClipData) => ({
      id: c.id,
      mediaId: c.mediaId,
      trackId: c.trackId,
      startTime: c.startTime,
      duration: c.duration,
      mediaOffset: c.mediaOffset ?? 0,
      label: c.label,
      type: c.type,
      transform: c.transform ?? DEFAULT_CLIP_TRANSFORM,
      effects: c.effects ?? DEFAULT_CLIP_EFFECTS,
    }));
    const restoredMedia: MediaFile[] = data.media.map((m: MediaFileData) => ({
      id: m.id,
      name: m.name,
      duration: m.duration,
      durationSeconds: m.durationSeconds,
      type: m.type,
      thumbnail: m.thumbnail,
      storagePath: m.storagePath,
      storageUrl: m.storageUrl,
      objectUrl: m.objectUrl ?? m.storageUrl ?? '',
      isUploading: false,
      captions: m.captions,
      captionsGenerating: false,
    }));
    setMediaFiles(restoredMedia);
    setTimelineClips(restoredClips);
    setHasUnsavedChanges(false);
  }, []);

  const saveProject = useCallback(async () => {
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 300));
    setHasUnsavedChanges(false);
    setIsSaving(false);
  }, []);

  const generateCaptions = useCallback(async (mediaId: string, options?: { language?: string; prompt?: string; apiKey?: string }) => {
    const media = mediaFiles.find((m) => m.id === mediaId);
    if (!media?.storageUrl && !media?.objectUrl) return;
    setMediaFiles((prev) =>
      prev.map((m) => (m.id === mediaId ? { ...m, captionsGenerating: true } : m))
    );
    try {
      const url = media.storageUrl || media.objectUrl;
      const res = await fetch('/api/cutos/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId, storageUrl: url, language: options?.language, apiKey: options?.apiKey }),
      });
      if (res.ok) {
        const { captions } = await res.json();
        setMediaFiles((prev) =>
          prev.map((m) =>
            m.id === mediaId ? { ...m, captions, captionsGenerating: false } : m
          )
        );
        setHasUnsavedChanges(true);
      } else {
        setMediaFiles((prev) =>
          prev.map((m) => (m.id === mediaId ? { ...m, captionsGenerating: false } : m))
        );
      }
    } catch {
      setMediaFiles((prev) =>
        prev.map((m) => (m.id === mediaId ? { ...m, captionsGenerating: false } : m))
      );
    }
  }, [mediaFiles]);

  const updateMediaCaptions = useCallback((mediaId: string, captions: Caption[]) => {
    setMediaFiles((prev) =>
      prev.map((m) => (m.id === mediaId ? { ...m, captions } : m))
    );
    setHasUnsavedChanges(true);
  }, []);

  const getCaptionsForClip = useCallback(
    (clipId: string): Caption[] => {
      const clip = timelineClips.find((c) => c.id === clipId);
      if (!clip) return [];
      const media = mediaFiles.find((m) => m.id === clip.mediaId);
      if (!media?.captions) return [];
      const clipStartInMedia = clip.mediaOffset / PIXELS_PER_SECOND;
      const clipEndInMedia = clipStartInMedia + clip.duration / PIXELS_PER_SECOND;
      return media.captions.filter((c) => c.start >= clipStartInMedia && c.end <= clipEndInMedia);
    },
    [timelineClips, mediaFiles]
  );

  const sortedVideoClips = timelineClips
    .filter((c) => c.type === 'video')
    .sort((a, b) => a.startTime - b.startTime);

  const timelineEndTime = sortedVideoClips.reduce((max, c) => {
    const end = (c.startTime + c.duration) / PIXELS_PER_SECOND;
    return Math.max(max, end);
  }, 0);

  useEffect(() => {
    if (isScrubbing || !isPlaying) return;
    if (timelineEndTime > 0 && currentTime > timelineEndTime) {
      setCurrentTime(timelineEndTime);
      setIsPlaying(false);
    } else if (timelineEndTime === 0 && currentTime > 0) {
      setCurrentTime(0);
    }
  }, [timelineEndTime, currentTime, isScrubbing, isPlaying]);

  const tracks = ['V2', 'V1', 'A2', 'A1'];
  const playheadBasePixels = currentTime * PIXELS_PER_SECOND;
  const clipsAtPlayhead = sortedVideoClips.filter(
    (c) =>
      playheadBasePixels >= c.startTime &&
      playheadBasePixels < c.startTime + c.duration
  );
  // 过滤掉隐藏轨道上的片段，仅显示可见轨道的片段
  const visibleClipsAtPlayhead = clipsAtPlayhead.filter(
    (c) => trackVisible[c.trackId] !== false
  );
  const sortedClipsAtPlayhead = [...visibleClipsAtPlayhead].sort(
    (a, b) => tracks.indexOf(a.trackId) - tracks.indexOf(b.trackId)
  );
  const activeClip = sortedClipsAtPlayhead[0] ?? null;
  const backgroundClip = sortedClipsAtPlayhead[1] ?? null;

  const clipTimeOffset = activeClip
    ? (playheadBasePixels - activeClip.startTime + activeClip.mediaOffset) / PIXELS_PER_SECOND
    : 0;
  const backgroundClipTimeOffset = backgroundClip
    ? (playheadBasePixels - backgroundClip.startTime + backgroundClip.mediaOffset) /
      PIXELS_PER_SECOND
    : 0;

  const previewMedia = (() => {
    if (selectedClipId && !isPlaying) {
      return getMediaForClip(selectedClipId) ?? null;
    }
    if (activeClip) return mediaFiles.find((m) => m.id === activeClip.mediaId) ?? null;
    return null;
  })();

  const value: EditorContextType = {
    projectId,
    setProjectId,
    projectResolution,
    setProjectResolution,
    mediaFiles,
    addMediaFiles,
    removeMediaFile,
    timelineClips,
    addClipToTimeline,
    updateClip,
    removeClip,
    splitClip,
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    zoomToFit,
    pixelsPerSecond,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    copyClip,
    pasteClip,
    canPaste: canPasteState,
    selectedClipId,
    setSelectedClipId,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    isScrubbing,
    setIsScrubbing,
    getMediaForClip,
    previewMedia,
    activeClip,
    backgroundClip,
    clipTimeOffset,
    backgroundClipTimeOffset,
    timelineEndTime,
    sortedVideoClips,
    loadTimelineData,
    saveProject,
    isSaving,
    hasUnsavedChanges,
    setProjectThumbnail,
    isEyedropperActive,
    setIsEyedropperActive,
    onColorSampled: colorSampledCallback,
    setColorSampledCallback,
    generateCaptions,
    updateMediaCaptions,
    getCaptionsForClip,
    showCaptions,
    setShowCaptions,
    captionStyle,
    setCaptionStyle,
    reindexMedia,
    trackMuted,
    trackLocked,
    trackVisible,
    setTrackMuted,
    setTrackLocked,
    setTrackVisible,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
