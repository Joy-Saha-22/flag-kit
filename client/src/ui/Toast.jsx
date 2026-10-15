import * as RadixToast from '@radix-ui/react-toast';

export default function Toast({ open, setOpen, title, description }) {
  return (
    <RadixToast.Provider swipeDirection="right">
      <RadixToast.Root
        open={open}
        onOpenChange={setOpen}
        style={{ background: '#EAE8E1', border: '1px solid #D3D0C6', padding: '0.75rem 1rem', maxWidth: 360 }}
      >
        <RadixToast.Title style={{ fontWeight: 600 }}>{title}</RadixToast.Title>
        {description ? <RadixToast.Description style={{ color: '#5C5A55' }}>{description}</RadixToast.Description> : null}
      </RadixToast.Root>
      <RadixToast.Viewport style={{ position: 'fixed', right: 16, bottom: 16, display: 'grid', gap: 8 }} />
    </RadixToast.Provider>
  );
}
