import * as RadixDialog from '@radix-ui/react-dialog';

export default function Dialog({ open, onOpenChange, title, description, children, trigger }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog-content">
          <div className="modal-card">
            <div className="dialog-header">
              <div>
                <RadixDialog.Title className="dialog-title">{title}</RadixDialog.Title>
                {description ? <RadixDialog.Description className="dialog-description">{description}</RadixDialog.Description> : null}
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
