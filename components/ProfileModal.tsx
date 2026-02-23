import React, { useState } from 'react';
import { X, User, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface ProfileModalProps {
  onClose: () => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ onClose }) => {
  const { user, updateProfile } = useAuth();
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const hasUsernameChange = newUsername.trim() !== '' && newUsername.trim() !== user?.username;
  const hasPasswordChange = newPassword.trim() !== '';
  const hasChanges = hasUsernameChange || hasPasswordChange;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('请输入当前密码以验证身份');
      return;
    }

    if (!hasChanges) {
      setError('未检测到任何修改');
      return;
    }

    if (hasUsernameChange) {
      const trimmed = newUsername.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        setError('用户名长度应在 2-50 个字符之间');
        return;
      }
    }

    if (hasPasswordChange) {
      if (newPassword.length < 6) {
        setError('新密码长度不能少于 6 个字符');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('两次输入的新密码不一致');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await updateProfile(
        currentPassword,
        hasUsernameChange ? newUsername.trim() : undefined,
        hasPasswordChange ? newPassword : undefined,
      );
      setSuccess('修改成功');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(onClose, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-primary)] p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="border-b border-[var(--border-subtle)] pb-4 mb-6">
          <h2 className="text-lg text-[var(--text-primary)] flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--accent-text)]" />
            账户设置
            <span className="text-[var(--text-muted)] text-xs font-mono uppercase tracking-widest">Profile</span>
          </h2>
          <p className="text-xs text-[var(--text-tertiary)] mt-2">修改用户名或密码</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              用户名
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] transition-colors"
                placeholder="新用户名"
              />
            </div>
          </div>

          {/* Current Password */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              当前密码 <span className="text-[var(--error-text)]">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full pl-9 pr-10 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] transition-colors"
                placeholder="输入当前密码验证身份"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              新密码 <span className="text-[var(--text-muted)]">(选填)</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full pl-9 pr-10 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] transition-colors"
                placeholder="不修改请留空"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm New Password */}
          {hasPasswordChange && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
                确认新密码
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] transition-colors"
                  placeholder="再次输入新密码"
                />
              </div>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="px-3 py-2.5 border border-[var(--error-border)] bg-[var(--error-hover-bg)] text-[var(--error-text)] text-xs">
              {error}
            </div>
          )}
          {success && (
            <div className="px-3 py-2.5 border border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)] text-xs">
              {success}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || !hasChanges}
            className="w-full py-3 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              '保存修改'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;
