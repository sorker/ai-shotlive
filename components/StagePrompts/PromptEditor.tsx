import React from 'react';
import { Save, X } from 'lucide-react';
import { STYLES } from './constants';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  size?: 'large' | 'small' | 'video';
  isVideo?: boolean;
}

const PromptEditor: React.FC<Props> = ({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder = '输入提示词...',
  size = 'large',
  isVideo = false
}) => {
  const textareaClass = `${STYLES.textarea.base} ${
    size === 'large' ? STYLES.textarea.large :
    size === 'video' ? STYLES.textarea.video :
    STYLES.textarea.small
  }`;

  const saveButtonClass = isVideo 
    ? STYLES.button.saveVideo 
    : size === 'small' 
      ? STYLES.button.saveSmall 
      : STYLES.button.save;

  const cancelButtonClass = size === 'small' 
    ? STYLES.button.cancelSmall 
    : STYLES.button.cancel;

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={textareaClass}
        placeholder={placeholder}
        autoFocus
      />
      <div className="flex gap-2">
        <button onClick={onSave} className={saveButtonClass}>
          <Save className="w-3 h-3" />
          保存
        </button>
        <button onClick={onCancel} className={cancelButtonClass}>
          <X className="w-3 h-3" />
          取消
        </button>
      </div>
    </div>
  );
};

export default PromptEditor;
