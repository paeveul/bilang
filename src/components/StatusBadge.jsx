export default function StatusBadge({ children, className = '' }) {
  return (
    <span
      className={`inline-block text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 ${className}`}
    >
      {children}
    </span>
  );
}
