/**
 * CutOS AI 剪辑模块 - 从 CutOS 项目迁移
 * 在成片与导出阶段提供视频剪辑、效果调整、导出功能
 */
import React from 'react';
import type { ProjectState } from '../../types';
import { projectToCutOSTimeline } from './projectAdapter';
import { EditorShell } from './editor-shell';
import { STYLES } from '../constants';

interface CutOSEditorProps {
  project: ProjectState;
  open: boolean;
  onClose: () => void;
}

const CutOSEditor: React.FC<CutOSEditorProps> = ({ project, open, onClose }) => {
  if (!open) return null;

  const { media, clips } = projectToCutOSTimeline(project);

  if (media.length === 0 || clips.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 shadow-xl max-w-md">
          <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">AI Edit</h3>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            No completed video shots yet. Please generate video clips in the Director stage first.
          </p>
          <button onClick={onClose} className={STYLES.button.secondary}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg-primary)] h-screen w-screen">
      <EditorShell
        initialData={{ media, clips }}
        projectTitle={project.title}
        onClose={onClose}
      />
    </div>
  );
};

export default CutOSEditor;
