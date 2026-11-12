import * as RadixSwitch from '@radix-ui/react-switch';

export default function Switch({ checked, onCheckedChange, label, ...props }) {
  return (
    <div className="switch-row">
      {label ? <span className="field-label">{label}</span> : null}
      <RadixSwitch.Root
        className="switch-control"
        aria-label={label || undefined}
        checked={checked}
        onCheckedChange={onCheckedChange}
        {...props}
      >
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
    </div>
  );
}
