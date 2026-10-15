import * as RadixTabs from '@radix-ui/react-tabs';

export default function Tabs({ tabs, value, onValueChange }) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List style={{ display: 'flex', gap: 8, borderBottom: '1px solid #D3D0C6' }}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} style={{ border: '1px solid transparent', background: 'transparent', padding: '0.5rem 0.8rem', color: '#1C1C1A' }}>
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
