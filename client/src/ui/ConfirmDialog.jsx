import * as AlertDialog from '@radix-ui/react-alert-dialog';

export default function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel', children }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content">
          <div className="modal-card">
            <AlertDialog.Title className="dialog-title">{title}</AlertDialog.Title>
            {description ? <AlertDialog.Description className="dialog-description">{description}</AlertDialog.Description> : null}
            {children ? <div className="confirm-dialog-content">{children}</div> : null}
            <div className="dialog-actions">
              <AlertDialog.Cancel asChild>
                <button type="button">{cancelLabel}</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="button-primary"
                  onClick={(event) => {
                    if (onConfirm?.() === false) event.preventDefault();
                  }}
                >
                  {confirmLabel}
                </button>
              </AlertDialog.Action>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
