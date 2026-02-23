import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2, Palette, Save, ChevronDown, ChevronRight, Edit3, ArrowLeft, AlertTriangle } from 'lucide-react';
import { VisualStyle, fetchVisualStyles, createVisualStyle, updateVisualStyle, deleteVisualStyle } from '../services/visualStyleService';
import { useAlert } from './GlobalAlert';

interface Props {
  onClose: () => void;
}

const EMPTY_FORM: Omit<VisualStyle, 'id' | 'isDefault'> = {
  value: '',
  label: '',
  desc: '',
  prompt: '',
  promptCn: '',
  negativePrompt: '',
  sceneNegativePrompt: '',
  sortOrder: 99,
};

const VisualStyleManager: React.FC<Props> = ({ onClose }) => {
  const { showAlert } = useAlert();
  const [styles, setStyles] = useState<VisualStyle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [editingStyle, setEditingStyle] = useState<VisualStyle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const loadStyles = async () => {
    setIsLoading(true);
    try {
      const data = await fetchVisualStyles();
      setStyles(data);
    } catch (err) {
      console.error('加载视觉风格失败:', err);
      showAlert('加载视觉风格失败', { type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStyles();
  }, []);

  const handleStartCreate = () => {
    setEditingStyle(null);
    setForm(EMPTY_FORM);
    setIsCreating(true);
  };

  const handleStartEdit = (style: VisualStyle) => {
    setIsCreating(false);
    setEditingStyle(style);
    setForm({
      value: style.value,
      label: style.label,
      desc: style.desc,
      prompt: style.prompt,
      promptCn: style.promptCn,
      negativePrompt: style.negativePrompt,
      sceneNegativePrompt: style.sceneNegativePrompt,
      sortOrder: style.sortOrder,
    });
  };

  const handleCancelEdit = () => {
    setEditingStyle(null);
    setIsCreating(false);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.value.trim() || !form.label.trim()) {
      showAlert('风格键值和标签为必填项', { type: 'warning' });
      return;
    }

    setIsSaving(true);
    try {
      if (isCreating) {
        await createVisualStyle(form);
        showAlert('视觉风格创建成功', { type: 'success' });
      } else if (editingStyle) {
        await updateVisualStyle(editingStyle.id, form);
        showAlert('视觉风格更新成功', { type: 'success' });
      }
      await loadStyles();
      handleCancelEdit();
    } catch (err: any) {
      showAlert(err.message || '保存失败', { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteVisualStyle(id);
      setStyles(prev => prev.filter(s => s.id !== id));
      setDeleteConfirmId(null);
      if (editingStyle?.id === id) handleCancelEdit();
      showAlert('视觉风格已删除', { type: 'success' });
    } catch (err: any) {
      showAlert(err.message || '删除失败', { type: 'error' });
    }
  };

  const updateField = (field: string, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const isEditing = isCreating || editingStyle !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 p-6" onClick={onClose}>
      <div
        className="relative w-full max-w-5xl max-h-[90vh] bg-[var(--bg-primary)] border border-[var(--border-primary)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-3">
            {isEditing && (
              <button
                onClick={handleCancelEdit}
                className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-lg text-[var(--text-primary)] flex items-center gap-2">
                <Palette className="w-4 h-4 text-[var(--accent-text)]" />
                {isEditing
                  ? (isCreating ? '新建视觉风格' : `编辑: ${editingStyle?.label}`)
                  : '视觉风格管理'}
                {!isEditing && (
                  <span className="text-[var(--text-muted)] text-xs font-mono uppercase tracking-widest">Visual Styles</span>
                )}
              </h2>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                {isEditing
                  ? '编辑视觉风格的提示词和配置'
                  : '管理可用的视觉风格，在项目配置中选择使用'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                onClick={handleStartCreate}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] text-xs font-bold uppercase tracking-widest transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                新增风格
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
            </div>
          ) : isEditing ? (
            /* Edit / Create Form */
            <div className="p-6 space-y-5 max-w-3xl mx-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    风格键值 <span className="text-[var(--error-text)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.value}
                    onChange={(e) => updateField('value', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)] font-mono"
                    placeholder="如: watercolor, pixel-art"
                    disabled={!!editingStyle?.isDefault}
                  />
                  <p className="text-[9px] text-[var(--text-muted)]">唯一标识，仅支持小写字母、数字和连字符</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    显示标签 <span className="text-[var(--error-text)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(e) => updateField('label', e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)]"
                    placeholder="如: 🎨 水彩风格"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">简短描述</label>
                  <input
                    type="text"
                    value={form.desc}
                    onChange={(e) => updateField('desc', e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)]"
                    placeholder="如: 柔和水彩画面质感"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">排序</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => updateField('sortOrder', parseInt(e.target.value) || 0)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all"
                    min={0}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                  英文视觉提示词 <span className="text-[var(--text-muted)]">(AI 图像生成)</span>
                </label>
                <textarea
                  value={form.prompt}
                  onChange={(e) => updateField('prompt', e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)] resize-none font-mono"
                  rows={4}
                  placeholder="English prompt for image generation, e.g.: watercolor painting style, soft edges, transparent washes..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                  中文视觉描述
                </label>
                <textarea
                  value={form.promptCn}
                  onChange={(e) => updateField('promptCn', e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)] resize-none"
                  rows={2}
                  placeholder="中文提示词描述..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                  角色负面提示词 <span className="text-[var(--text-muted)]">(排除不需要的元素)</span>
                </label>
                <textarea
                  value={form.negativePrompt}
                  onChange={(e) => updateField('negativePrompt', e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)] resize-none font-mono"
                  rows={3}
                  placeholder="Negative prompts for character generation..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                  场景负面提示词 <span className="text-[var(--text-muted)]">(额外排除人物元素)</span>
                </label>
                <textarea
                  value={form.sceneNegativePrompt}
                  onChange={(e) => updateField('sceneNegativePrompt', e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)] resize-none font-mono"
                  rows={3}
                  placeholder="Negative prompts for scene generation (includes person exclusion)..."
                />
              </div>

              {/* Save Button */}
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  onClick={handleCancelEdit}
                  className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !form.value.trim() || !form.label.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-widest bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {isCreating ? '创建' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            /* Style List */
            <div className="divide-y divide-[var(--border-subtle)]">
              {styles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Palette className="w-12 h-12 text-[var(--text-muted)] mb-4 opacity-30" />
                  <p className="text-sm text-[var(--text-tertiary)]">暂无视觉风格</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">点击"新增风格"添加自定义视觉风格</p>
                </div>
              ) : (
                styles.map((style) => {
                  const isExpanded = expandedId === style.id;
                  const isConfirmingDelete = deleteConfirmId === style.id;

                  return (
                    <div key={style.id} className="group">
                      <div
                        className="flex items-center gap-4 px-6 py-4 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : style.id)}
                      >
                        <div className="flex-shrink-0 text-[var(--text-muted)]">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-[var(--text-primary)] font-medium">{style.label}</span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded">
                              {style.value}
                            </span>
                            {style.isDefault && (
                              <span className="text-[9px] text-[var(--accent-text)] font-mono uppercase tracking-widest">预置</span>
                            )}
                          </div>
                          {style.desc && (
                            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{style.desc}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStartEdit(style); }}
                            className="opacity-0 group-hover:opacity-100 p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-all rounded"
                            title="编辑"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(style.id); }}
                            className="opacity-0 group-hover:opacity-100 p-2 text-[var(--text-muted)] hover:text-[var(--error-text)] hover:bg-[var(--error-bg)] transition-all rounded"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Delete Confirm */}
                      {isConfirmingDelete && (
                        <div className="px-6 py-3 bg-[var(--error-bg)] border-y border-[var(--error-border)] flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-[var(--error-text)]">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            确定要删除"{style.label}"吗？此操作无法撤销。
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleDelete(style.id)}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--error-text)] bg-[var(--error-hover-bg)] border border-[var(--error-border)] hover:bg-[var(--error-hover-bg-strong)] transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-6 pb-4 pl-14 space-y-3">
                          {style.prompt && (
                            <div>
                              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">英文提示词</div>
                              <div className="text-xs text-[var(--text-tertiary)] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md p-3 leading-relaxed whitespace-pre-wrap">
                                {style.prompt}
                              </div>
                            </div>
                          )}
                          {style.promptCn && (
                            <div>
                              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">中文描述</div>
                              <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md p-3 leading-relaxed">
                                {style.promptCn}
                              </div>
                            </div>
                          )}
                          {style.negativePrompt && (
                            <div>
                              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">角色负面提示词</div>
                              <div className="text-xs text-[var(--text-tertiary)] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md p-3 leading-relaxed whitespace-pre-wrap">
                                {style.negativePrompt}
                              </div>
                            </div>
                          )}
                          {style.sceneNegativePrompt && (
                            <div>
                              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">场景负面提示词</div>
                              <div className="text-xs text-[var(--text-tertiary)] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md p-3 leading-relaxed whitespace-pre-wrap">
                                {style.sceneNegativePrompt}
                              </div>
                            </div>
                          )}
                          <div className="pt-2">
                            <button
                              onClick={() => handleStartEdit(style)}
                              className="text-[10px] text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] transition-colors font-medium"
                            >
                              编辑此风格 →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VisualStyleManager;
