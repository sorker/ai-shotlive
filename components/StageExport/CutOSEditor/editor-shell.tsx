/**
 * CutOS 编辑器外壳 - 本地状态，无 Supabase
 * 布局、文案、动效与 CutOS 原版保持一致
 */
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Download, Loader2, ArrowLeft, Save } from 'lucide-react';
import { Button } from './ui/button';
import { ExportModal } from './export-modal';
import { MediaPanel } from './media-panel';
import { VideoPreview } from './video-preview';
import { Timeline } from './timeline';
import { InspectorPanel } from './inspector-panel';
import { EditorProvider, useEditor } from './editor-context';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable';
import type { CutOSTimelineData } from './projectAdapter';

interface EditorShellProps {
  initialData: CutOSTimelineData;
  projectTitle?: string;
  onClose: () => void;
}

function EditorContent({
  onClose,
  projectTitle,
}: {
  onClose: () => void;
  projectTitle?: string;
}) {
  const [showExportModal, setShowExportModal] = useState(false);
  const {
    hasUnsavedChanges,
    saveProject,
    isSaving,
    sortedVideoClips,
    currentTime,
    timelineEndTime,
    activeClip,
    splitClip,
    selectedClipId,
    removeClip,
    undo,
    redo,
    canUndo,
    canRedo,
    copyClip,
    pasteClip,
    canPaste,
    isPlaying,
    setIsPlaying,
    setCurrentTime,
    projectResolution,
  } = useEditor();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (canRedo) redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const clipId = selectedClipId || activeClip?.id;
        if (clipId) copyClip(clipId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (canPaste) pasteClip();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const clipId = selectedClipId || activeClip?.id;
        if (clipId) {
          e.preventDefault();
          removeClip(clipId);
          return;
        }
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!sortedVideoClips.length) return;
        if (currentTime >= timelineEndTime) setCurrentTime(0);
        setIsPlaying(!isPlaying);
      }
      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const canCut = activeClip && (!selectedClipId || activeClip.id === selectedClipId);
        if (canCut) splitClip(activeClip.id, currentTime);
      }
      if (e.code === 'KeyD' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const clipId = selectedClipId || activeClip?.id;
        if (clipId) {
          copyClip(clipId);
          pasteClip();
        }
      }
    },
    [
      canUndo,
      canRedo,
      canPaste,
      selectedClipId,
      activeClip,
      currentTime,
      timelineEndTime,
      sortedVideoClips.length,
      isPlaying,
      undo,
      redo,
      copyClip,
      pasteClip,
      removeClip,
      splitClip,
      setIsPlaying,
      setCurrentTime,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const resolutionDisplay = projectResolution
    ? `${projectResolution.replace('x', '×')} • 24 fps`
    : '1920×1080 • 24 fps';

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* Top Bar - 与 CutOS 一致 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4">
        <div className="flex items-center gap-3">
          <motion.div whileHover="hover" whileTap={{ scale: 0.97 }}>
            <Button variant="ghost" size="sm" className="gap-2 cursor-pointer" onClick={onClose}>
              <motion.div
                variants={{
                  hover: { x: -3, transition: { type: 'spring', stiffness: 400, damping: 20 } },
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </motion.div>
              Back
            </Button>
          </motion.div>
          <div className="h-4 w-px bg-[var(--border-primary)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {projectTitle || 'AI Edit'}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{resolutionDisplay}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={saveProject}
            disabled={isSaving || !hasUnsavedChanges}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
          </Button>
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            <Button size="sm" className="gap-2" onClick={() => setShowExportModal(true)}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          </motion.div>
        </div>
      </div>

      <ExportModal open={showExportModal} onOpenChange={setShowExportModal} />

      {/* Main Content - 与 CutOS 相同：左媒体库 | 中预览 | 右 Inspector */}
      {/* v2 API: defaultSize 为数字 1-100 表示百分比 */}
      <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={65} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={20} minSize={15} maxSize={40}>
              <div className="h-full min-w-0 border-r border-[var(--border-primary)] bg-[var(--bg-elevated)] overflow-hidden flex flex-col">
                <MediaPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={55} minSize={30}>
              <div className="h-full min-w-0 overflow-hidden flex flex-col">
                <VideoPreview />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
              <div className="h-full min-w-0 border-l border-[var(--border-primary)] bg-[var(--bg-elevated)] overflow-hidden flex flex-col">
                <InspectorPanel />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle className="bg-transparent after:bg-transparent hover:bg-[var(--border-primary)]/50 transition-colors" />
        <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
          <div className="h-full border-t border-[var(--border-primary)] bg-[var(--bg-elevated)]">
            <Timeline />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export function EditorShell({ initialData, projectTitle, onClose }: EditorShellProps) {
  return (
    <EditorProvider>
      <EditorContentWithData
        initialData={initialData}
        projectTitle={projectTitle}
        onClose={onClose}
      />
    </EditorProvider>
  );
}

function EditorContentWithData({
  initialData,
  projectTitle,
  onClose,
}: {
  initialData: CutOSTimelineData;
  projectTitle?: string;
  onClose: () => void;
}) {
  const { loadTimelineData } = useEditor();

  useEffect(() => {
    const data = {
      media: initialData.media.map((m) => ({
        ...m,
        objectUrl: m.objectUrl,
        storageUrl: m.storageUrl,
      })),
      clips: initialData.clips,
    };
    loadTimelineData(data);
  }, [initialData, loadTimelineData]);

  return <EditorContent onClose={onClose} projectTitle={projectTitle} />;
}
