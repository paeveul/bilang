// src/screens/CaptureScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported from index.html's data-screen="capture" + js/app.js's bindCapture()
// / runParse(). Same behaviour: pick/take a photo, preview it, immediately
// call parseReceipt() (js/api-client.js, unchanged network module — F9),
// then hand off to the (still-stubbed, Step 8) review screen on success.
//
// parseReceipt() is called directly here, not wrapped in a new client
// module — js/api-client.js is already the one place allowed to call
// /api/*, and this screen calls it exactly once, matching js/app.js's
// existing pattern.
import { useRef, useState } from 'react';
import { parseReceipt } from '../../js/api-client.js';
import { useBillActions } from '../state/BillContext.jsx';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CaptureScreen() {
  const { goToScreen, setReceipt, clearReceiptImage, setParsed, setError } = useBillActions();
  const [previewSrc, setPreviewSrc] = useState(null);
  const inputRef = useRef(null);

  async function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    setPreviewSrc(dataUrl);

    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : file.type || 'image/jpeg';
    setReceipt(base64, mimeType);

    goToScreen('parsing');
    try {
      const parsed = await parseReceipt(base64, mimeType);
      setParsed(parsed);
      goToScreen('review');
    } catch (err) {
      setError(err.message || 'Could not read this receipt.');
    } finally {
      // The receipt image has done its one job — drop it from memory now,
      // matching js/app.js's runParse() finally block.
      clearReceiptImage();
    }
  }

  return (
    <section data-screen="capture" className="app-screen py-8 space-y-6">
      <h2 className="text-xl font-bold">Photo the receipt</h2>
      <p className="text-slate-600 text-sm">
        Camera or gallery — whichever is easier. Try to get it flat and well-lit.
      </p>

      <label className="block">
        <span className="sr-only">Upload receipt photo</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="block w-full text-sm text-slate-500 file:mr-4 file:py-3 file:px-5 file:rounded-lg file:border-0 file:font-semibold file:bg-amber-500 file:text-white hover:file:bg-amber-600 cursor-pointer"
        />
      </label>

      {previewSrc && (
        <div>
          <img
            src={previewSrc}
            alt="Receipt preview"
            className="rounded-xl border border-slate-200 max-h-96 w-full object-contain bg-white"
          />
        </div>
      )}

      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={() => goToScreen('landing')}
      >
        ← Back
      </button>
    </section>
  );
}
