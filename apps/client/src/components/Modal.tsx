import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  children: ReactNode;
  /** Omit to make the modal blocking (no Esc / backdrop close). */
  onClose?: () => void;
}

export function Modal({ title, children, onClose }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        {onClose && (
          <button type="button" className="ghost icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
