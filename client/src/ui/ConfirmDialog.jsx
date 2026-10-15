import * as AlertDialog from '@radix-ui/react-alert-dialog';

export default function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel', children }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(28, 28, 26, 0.25)' }} />
        <AlertDialog.Content style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="modal-card">
            <AlertDialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</AlertDialog.Title>
            {description ? <AlertDialog.Description style={{ marginTop: 8, color: '#5C5A55' }}>{description}</AlertDialog.Description> : null}
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
