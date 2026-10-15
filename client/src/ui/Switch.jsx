import * as RadixSwitch from '@radix-ui/react-switch';

export default function Switch({ checked, onCheckedChange, label, ...props }) {
  return (
    <div className="switch-row">
      {label ? <span className="field-label">{label}</span> : null}
      <RadixSwitch.Root aria-label={label || undefined} checked={checked} onCheckedChange={onCheckedChange} {...props} style={{ width: 36, height: 20, background: checked ? '#1F5F5B' : '#D3D0C6', border: '1px solid #D3D0C6', borderRadius: 2, position: 'relative' }}>
        <RadixSwitch.Thumb style={{ display: 'block', width: 14, height: 14, borderRadius: 2, background: '#F3F2EE', position: 'absolute', top: 2, left: checked ? 18 : 2 }} />
      </RadixSwitch.Root>
    </div>
  );
}
