import * as RadixDialog from '@radix-ui/react-dialog';

export default function Dialog({ open, onOpenChange, title, description, children, trigger }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(28, 28, 26, 0.25)' }} />
        <RadixDialog.Content style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="modal-card">
            <div className="dialog-header">
              <div>
                <RadixDialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</RadixDialog.Title>
                {description ? <RadixDialog.Description style={{ marginTop: 4, color: '#5C5A55' }}>{description}</RadixDialog.Description> : null}
              </div>
              <RadixDialog.Close asChild>
                <button type="button" aria-label="Close dialog">Close</button>
              </RadixDialog.Close>
            </div>
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
