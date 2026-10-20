export default function LiveAnnouncer({ message }) {
  return (
    <div aria-live="polite" role="status" className="sr-only" data-testid="live-announcer">
      {message}
    </div>
  );
}
