import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm" onCancel={onCancel}>
      <p>{message}</p>
      <div className="actions">
        <button className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button className="btn btn-brand" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </dialog>
  );
}
