"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastActionTone = "primary" | "secondary" | "danger";

export type ToastAction = {
  label: string;
  tone: ToastActionTone;
  onClick: () => void | Promise<void>;
};

export type ToastInput = {
  title: string;
  description?: string;
  tone: ToastTone;
  durationMs?: number | null;
  actions?: ToastAction[];
};

type ToastRecord = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  actions?: ToastAction[];
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => string;
  dismissToast: (toastId: string) => void;
};

type ToastProviderProps = {
  children: React.ReactNode;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const defaultToastDurationMs = 5000;
const errorToastDurationMs = 8000;
const maximumVisibleToastCount = 4;

function durationForToast(toast: ToastInput) {
  if (toast.durationMs !== undefined) {
    return toast.durationMs;
  }

  if (toast.tone === "error") {
    return errorToastDurationMs;
  }

  return defaultToastDurationMs;
}

function toastClasses(tone: ToastTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (tone === "error") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-slate-200 bg-white text-slate-950";
}

function toastAccentClasses(tone: ToastTone) {
  if (tone === "success") {
    return "bg-emerald-500";
  }

  if (tone === "error") {
    return "bg-rose-500";
  }

  if (tone === "warning") {
    return "bg-amber-500";
  }

  return "bg-teal-500";
}

function toastRole(tone: ToastTone) {
  if (tone === "error") {
    return "alert";
  }

  return "status";
}

function toastActionClasses(tone: ToastActionTone) {
  if (tone === "primary") {
    return "border-teal-700 bg-teal-700 text-white hover:bg-teal-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
  }

  return "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((currentToasts) => {
      const nextToasts = currentToasts.filter((toast) => {
        const toastShouldStay = toast.id !== toastId;
        return toastShouldStay;
      });
      return nextToasts;
    });
  }, []);

  const showToast = useCallback(
    (toast: ToastInput) => {
      const toastId = crypto.randomUUID();
      const durationMs = durationForToast(toast);
      const nextToast = {
        id: toastId,
        title: toast.title,
        description: toast.description,
        tone: toast.tone,
        actions: toast.actions,
      };

      setToasts((currentToasts) => {
        const allToasts = [...currentToasts, nextToast];
        const nextToasts = allToasts.slice(-maximumVisibleToastCount);
        return nextToasts;
      });

      if (durationMs !== null) {
        window.setTimeout(() => {
          dismissToast(toastId);
        }, durationMs);
      }

      return toastId;
    },
    [dismissToast],
  );

  function handleToastActionClick(toast: ToastRecord, action: ToastAction) {
    dismissToast(toast.id);

    const actionResult = action.onClick();
    const actionPromise = Promise.resolve(actionResult);
    actionPromise.catch(() => {
      return undefined;
    });
  }

  const contextValue = useMemo(() => {
    const value = {
      showToast,
      dismissToast,
    };
    return value;
  }, [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(calc(100vw-2rem),24rem)] flex-col gap-2 sm:bottom-6 sm:right-6">
        {toasts.map((toast) => {
          const messageClass = toastClasses(toast.tone);
          const accentClass = toastAccentClasses(toast.tone);
          const role = toastRole(toast.tone);

          return (
            <section
              key={toast.id}
              role={role}
              className={`pointer-events-auto overflow-hidden rounded-md border shadow-lg shadow-slate-950/10 ${messageClass}`}
            >
              <div className="flex">
                <div className={`w-1 shrink-0 ${accentClass}`} />
                <div className="min-w-0 flex-1 px-3 py-3">
                  <p className="text-sm font-semibold leading-5">{toast.title}</p>
                  {toast.description !== undefined ? (
                    <p className="mt-1 text-sm leading-5 opacity-80">
                      {toast.description}
                    </p>
                  ) : null}
                  {toast.actions !== undefined ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {toast.actions.map((action) => {
                        const actionClass = toastActionClasses(action.tone);

                        return (
                          <button
                            key={action.label}
                            type="button"
                            className={`inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold ${actionClass}`}
                            onClick={() => handleToastActionClick(toast, action)}
                          >
                            {action.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  className="flex h-9 w-9 shrink-0 items-center justify-center text-lg leading-none opacity-70 hover:opacity-100"
                  onClick={() => dismissToast(toast.id)}
                >
                  x
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const contextValue = useContext(ToastContext);

  if (contextValue === null) {
    throw new Error("useToast must be used inside ToastProvider.");
  }

  return contextValue;
}
