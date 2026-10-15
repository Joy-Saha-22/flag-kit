export default function Button({ children, variant = 'secondary', type = 'button', ...props }) {
  const className = ['button', variant === 'primary' ? 'button-primary' : variant === 'ghost' ? 'button-ghost' : 'button-secondary']
    .join(' ');

  return (
    <button type={type} {...props} className={[className, props.className].filter(Boolean).join(' ')}>
      {children}
    </button>
  );
}
