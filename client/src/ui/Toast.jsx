import * as RadixToast from '@radix-ui/react-toast';

export default function Toast({ open, setOpen, title, description }) {
  return (
    <RadixToast.Provider swipeDirection="right">
      <RadixToast.Root
        open={open}
        onOpenChange={setOpen}
        className="toast"
      >
        <RadixToast.Title className="toast-title">{title}</RadixToast.Title>
        {description ? <RadixToast.Description className="toast-description">{description}</RadixToast.Description> : null}
      </RadixToast.Root>
      <RadixToast.Viewport className="toast-viewport" />
    </RadixToast.Provider>
  );
}
