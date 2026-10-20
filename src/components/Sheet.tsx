import { useEffect, useRef, type ReactNode } from 'react';

/** A modal on desktop, a bottom sheet on phones. Built on <dialog> for focus trapping and Esc. */
export function Sheet({ open, onClose, title, children, aside }: { open: boolean; onClose: () => void; title: string; children: ReactNode; aside?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2>{title}</h2>
            <div className="actions">{aside}<button className="link muted" onClick={onClose} aria-label="Close">Close</button></div>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
