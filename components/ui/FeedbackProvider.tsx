'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import ModalSheet from './ModalSheet';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface FeedbackContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const pushToast = useCallback((variant: ToastVariant, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev.slice(-3), { id, variant, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const confirmAction = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const handleConfirmClose = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  return (
    <FeedbackContext.Provider
      value={{
        toast: {
          success: msg => pushToast('success', msg),
          error: msg => pushToast('error', msg),
          info: msg => pushToast('info', msg)
        },
        confirmAction
      }}
    >
      {children}

      {/* Non-blocking Toasts */}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-lg border text-sm font-medium transition-all ${
              t.variant === 'success'
                ? 'bg-emerald-950 text-emerald-50 border-emerald-800'
                : t.variant === 'error'
                ? 'bg-rose-950 text-rose-50 border-rose-800'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            {t.variant === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            {t.variant === 'error' && (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            {t.variant === 'info' && (
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}
              aria-label="Dismiss notification"
              className="text-white/70 hover:text-white p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Accessible Confirm Dialog */}
      <ModalSheet
        open={Boolean(confirmState)}
        onClose={() => handleConfirmClose(false)}
        title={confirmState?.options.title || 'Confirm action'}
        maxWidthClass="sm:max-w-md"
        footer={
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => handleConfirmClose(false)}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {confirmState?.options.cancelLabel || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => handleConfirmClose(true)}
              className={`flex-1 min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${
                confirmState?.options.danger
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              {confirmState?.options.confirmLabel || 'Confirm'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700 leading-relaxed">{confirmState?.options.message}</p>
      </ModalSheet>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return ctx;
}