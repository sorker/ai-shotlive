import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type AlertType = 'info' | 'success' | 'error' | 'warning';

interface AlertOptions {
  title?: string;
  type?: AlertType;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  autoDismiss?: boolean;
  autoDismissMs?: number;
}

interface AlertContextType {
  showAlert: (message: string, options?: AlertOptions) => void;
  closeAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

interface AlertState {
  isOpen: boolean;
  message: string;
  title?: string;
  type: AlertType;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  autoDismiss?: boolean;
  autoDismissMs?: number;
}

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    message: '',
    type: 'info'
  });

  const callbacksRef = useRef<{ onConfirm?: () => void; onCancel?: () => void }>({});
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const clearAutoDismissTimer = useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = undefined;
    }
  }, []);

  const showAlert = useCallback((message: string, options?: AlertOptions) => {
    clearAutoDismissTimer();
    const onConfirm = options?.onConfirm;
    const onCancel = options?.onCancel;
    callbacksRef.current = { onConfirm, onCancel };

    const isSuccess = (options?.type || 'info') === 'success';
    const autoDismiss = options?.autoDismiss ?? isSuccess;
    const autoDismissMs = options?.autoDismissMs ?? 2000;

    setAlertState({
      isOpen: true,
      message,
      title: options?.title,
      type: options?.type || 'info',
      onConfirm,
      onCancel,
      confirmText: options?.confirmText || '确定',
      cancelText: options?.cancelText || '取消',
      showCancel: options?.showCancel || false,
      autoDismiss,
      autoDismissMs,
    });
  }, [clearAutoDismissTimer]);

  const handleConfirm = useCallback(() => {
    clearAutoDismissTimer();
    const cb = callbacksRef.current.onConfirm;
    callbacksRef.current = {};
    setAlertState(prev => ({ ...prev, isOpen: false, onConfirm: undefined, onCancel: undefined }));
    if (cb) {
      cb();
    }
  }, [clearAutoDismissTimer]);

  const handleCancel = useCallback(() => {
    clearAutoDismissTimer();
    const cb = callbacksRef.current.onCancel;
    callbacksRef.current = {};
    setAlertState(prev => ({ ...prev, isOpen: false, onConfirm: undefined, onCancel: undefined }));
    if (cb) {
      cb();
    }
  }, [clearAutoDismissTimer]);

  const handleDismiss = useCallback(() => {
    clearAutoDismissTimer();
    callbacksRef.current = {};
    setAlertState(prev => ({ ...prev, isOpen: false, onConfirm: undefined, onCancel: undefined }));
  }, [clearAutoDismissTimer]);

  // Auto-dismiss timer for success alerts
  useEffect(() => {
    if (alertState.isOpen && alertState.autoDismiss) {
      clearAutoDismissTimer();
      autoDismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, alertState.autoDismissMs || 2000);
    }
    return () => clearAutoDismissTimer();
  }, [alertState.isOpen, alertState.autoDismiss, alertState.autoDismissMs, handleDismiss, clearAutoDismissTimer]);

  const getIcon = () => {
    switch (alertState.type) {
      case 'success': return <CheckCircle className="w-6 h-6 text-[var(--success)]" />;
      case 'error': return <AlertCircle className="w-6 h-6 text-[var(--error)]" />;
      case 'warning': return <AlertCircle className="w-6 h-6 text-[var(--warning)]" />;
      default: return <Info className="w-6 h-6 text-[var(--info)]" />;
    }
  };

  const getTitle = () => {
    if (alertState.title) return alertState.title;
    switch (alertState.type) {
      case 'success': return '成功';
      case 'error': return '错误';
      case 'warning': return '警告';
      default: return '提示';
    }
  };

  const isToastStyle = alertState.autoDismiss && !alertState.showCancel;

  return (
    <AlertContext.Provider value={{ showAlert, closeAlert: handleDismiss }}>
      {children}
      {alertState.isOpen && (
        isToastStyle ? (
          /* Toast-style notification for auto-dismiss alerts */
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border-secondary)] rounded-xl px-5 py-3 shadow-2xl min-w-[280px]">
              {getIcon()}
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{getTitle()}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">{alertState.message}</div>
              </div>
              <button
                onClick={handleDismiss}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Full modal dialog for confirmations/errors */
          <div 
            className="fixed inset-0 z-[9999] bg-[var(--bg-base)]/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={alertState.showCancel ? handleCancel : handleDismiss}
          >
            <div 
              className="bg-[var(--bg-elevated)] border border-[var(--border-secondary)] rounded-xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {getIcon()}
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">{getTitle()}</h3>
                </div>
                <button 
                  onClick={alertState.showCancel ? handleCancel : handleDismiss}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="text-[var(--text-secondary)] text-sm leading-relaxed">
                {alertState.message}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {alertState.showCancel && (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg text-sm font-medium transition-colors"
                  >
                    {alertState.cancelText}
                  </button>
                )}
                <button
                  onClick={handleConfirm}
                  className="px-4 py-2 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] rounded-lg text-sm font-medium transition-colors"
                >
                  {alertState.confirmText}
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </AlertContext.Provider>
  );
};
