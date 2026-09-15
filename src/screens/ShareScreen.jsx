// src/screens/ShareScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported from index.html's data-screen="share" + js/app.js's
// renderShareScreen()/bindShare(). Uses the same vendored MIT QR encoder
// (js/vendor/qrcode.js, Kazuhiko Arase) via its global `window.qrcode`
// factory — not re-implemented, not swapped for an npm package (F2/B1:
// no new runtime dependency for something already solved and already
// small). The vendor script must be loaded as a classic <script> before
// this component mounts, same as index.html does today; react-shell.dev.html
// gained the same <script> tag in this pass so local dev/preview matches.
import { useEffect, useRef, useState } from 'react';
import { useBillActions, useBillState } from '../state/BillContext.jsx';

export default function ShareScreen() {
  const { shareUrl } = useBillState();
  const { goToScreen, reset } = useBillActions();
  const qrContainerRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!shareUrl || !qrContainerRef.current) return;
    qrContainerRef.current.innerHTML = '';
    try {
      if (typeof window.qrcode !== 'function') {
        throw new Error('QR encoder not loaded');
      }
      // Type 0 = auto-detect smallest version for the data length.
      const qr = window.qrcode(0, 'M');
      qr.addData(shareUrl);
      qr.make();
      qrContainerRef.current.innerHTML = qr.createSvgTag(4);
    } catch (err) {
      console.error('QR render failed:', err);
      qrContainerRef.current.textContent = '(QR code unavailable — use the link above)';
    }
  }, [shareUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Clipboard API can fail on non-HTTPS/insecure contexts — the read-only
      // field below stays selectable so the user can copy manually.
      console.warn('Clipboard write failed, select the field to copy manually:', err);
    }
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`Here's the bill split: ${shareUrl}`)}`;

  return (
    <section data-screen="share" className="app-screen py-8 space-y-4 text-center">
      <h2 className="text-xl font-bold">Your split is ready 🎉</h2>
      <p className="text-slate-600 text-sm">
        Share this link (or the QR code) with everyone on the bill — it shows each person exactly
        what they owe and how to pay you.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div ref={qrContainerRef} className="flex justify-center" />
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="flex-1 rounded-md border-slate-300 text-sm bg-slate-50"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md bg-slate-800 text-white text-sm px-4 shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener"
          className="block w-full rounded-lg bg-green-600 text-white font-semibold py-3"
        >
          Share via WhatsApp
        </a>
      </div>

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
        ⚠️ <strong>Don't share this link with strangers.</strong> Anyone who opens it can see your
        payment details (DuitNow ID / bank account / QR) — only send it to the people actually
        splitting this bill.
      </p>

      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={() => {
          reset();
          goToScreen('landing');
        }}
      >
        Start another split
      </button>
    </section>
  );
}
