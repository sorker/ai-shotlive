import React, { useState } from 'react';
import { Loader2, Eye, EyeOff, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setError('密码长度不能少于 6 个字符');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
    } catch (err: any) {
      setError(err.message || '操作失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setConfirmPassword('');
  };

  const inputClass =
    'w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-text)] transition-colors';

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-light text-[var(--text-primary)] tracking-tight mb-2">
            BigBanana AI Director
          </h1>
          <p className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-[0.2em]">
            AI 漫剧生成平台
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest">
              {mode === 'login' ? '用户登录' : '注册账号'}
            </h2>
            <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              {mode === 'login' ? 'Sign In' : 'Sign Up'}
            </span>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 bg-[var(--error-hover-bg)] border border-[var(--error-border)] text-[var(--error-text)] text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className={inputClass}
                disabled={isSubmitting}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className={`${inputClass} pr-10`}
                  disabled={isSubmitting}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                  确认密码
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  className={inputClass}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-6"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'login' ? (
                <LogIn className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              <span className="font-bold text-xs tracking-widest uppercase">
                {isSubmitting
                  ? '处理中...'
                  : mode === 'login'
                  ? '登录'
                  : '注册'}
              </span>
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--border-subtle)] text-center">
            <button
              onClick={switchMode}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors"
              disabled={isSubmitting}
            >
              {mode === 'login' ? '没有账号？点击注册' : '已有账号？点击登录'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-[9px] text-[var(--text-muted)] font-mono uppercase tracking-widest">
          Powered by BigBanana AI
        </div>
      </div>
    </div>
  );
};

export default Login;
