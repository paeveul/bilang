// src/components/StatusBadge.jsx — Item 24 Step 7. Design spec §3
// "genuinely new": "Needed as text, not colour-only. Tiny; reuses tokens."
// Used for the payer claim row's "Yours" pin (§2.3).
export default function StatusBadge({ children, className = '' }) {
  return (
    <span
      className={`inline-block text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 ${className}`}
    >
      {children}
    </span>
  );
}
