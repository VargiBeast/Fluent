import React, { createContext, useContext, useMemo, useState } from "react";

interface ToastItem {
  id: number;
  title: string;
  body?: string;
}

const ToastContext = createContext<{ notify: (toast: { title: string; body?: string }) => void }>({
  notify: () => undefined,
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const api = useMemo(
    () => ({
      notify(toast: { title: string; body?: string }) {
        const id = Date.now() + Math.random();
        setItems((current) => [...current, { id, ...toast }]);
        window.setTimeout(() => {
          setItems((current) => current.filter((item) => item.id !== id));
        }, 4200);
      },
    }),
    [],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <article className="toast" key={item.id} role="status">
            <strong>{item.title}</strong>
            {item.body ? <p>{item.body}</p> : null}
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
