//
//
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { parseReceipt } from '../../js/api-client.js';
import { useBillActions } from '../state/BillContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const TAP_TRANSITION = { duration: 0.1 };
const TAP_SCALE = { scale: 0.97 };

const PRIMARY_BTN =
  'w-full rounded-lg bg-amber-500 text-white font-semibold py-3 min-h-[48px] transition disabled:bg-slate-300';
const SECONDARY_BTN =
  'w-full rounded-lg border border-slate-300 bg-white text-slate-700 text-sm py-3 min-h-[48px] disabled:opacity-50';

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
  const { runWithSession } = useAuth();
  // The chosen photo, held locally only until "Use this photo" is tapped.
  const [picked, setPicked] = useState(null); // { dataUrl, fileType }
  const [imageReady, setImageReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const headingRef = useRef(null);
  const takePhotoRef = useRef(null);
  // Synchronous guard: a fast double tap can beat a re-render, so the
  // disabled look alone is not enough.
  const confirmStartedRef = useRef(false);
  const wasPickedRef = useRef(false);

  // Focus: entering State 2 -> heading (not the confirm button, so a stray
  // Enter cannot confirm); returning to State 1 via Retake -> "Take photo".
  useEffect(() => {
    if (picked) {
      headingRef.current?.focus();
      wasPickedRef.current = true;
    } else if (wasPickedRef.current) {
      wasPickedRef.current = false;
      takePhotoRef.current?.focus();
    }
  }, [picked]);

  // Both pickers share this handler. It only reads the file and shows the
  // preview — it never touches the network.
  async function handleFileChange(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    // Reset so choosing the same file again still fires onChange.
    input.value = '';
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    confirmStartedRef.current = false;
    setConfirming(false);
    setImageReady(false);
    setPicked({ dataUrl, fileType: file.type });
  }

  function handleRetake() {
    if (confirmStartedRef.current) return;
    setPicked(null);
    setImageReady(false);
  }

  // The ONLY place parseReceipt() is called from.
  async function handleConfirm() {
    if (confirmStartedRef.current || !picked || !imageReady) return;
    confirmStartedRef.current = true;
    setConfirming(true);

    const [meta, base64] = picked.dataUrl.split(',');
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : picked.fileType || 'image/jpeg';
    setReceipt(base64, mimeType);

    goToScreen('parsing');
    try {
      const parsed = await runWithSession(() => parseReceipt(base64, mimeType));
      setParsed(parsed);
    } catch (err) {
      setError(err.message || 'Could not read this receipt.');
    } finally {
      // The receipt image has done its one job — drop it from memory now.
      clearReceiptImage();
    }
  }

  const hiddenInputProps = {
    type: 'file',
    accept: 'image/*',
    onChange: handleFileChange,
    className: 'hidden',
    tabIndex: -1,
    'aria-hidden': 'true',
  };

  if (picked) {
    const blocked = confirming || !imageReady;
    return (
      <section data-screen="capture" className="app-screen py-8 space-y-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold focus:outline-none">
          Check the photo
        </h2>
        <p className="text-slate-600 text-sm">
          Is the text sharp and nothing cut off? If not, retake it.
        </p>

        {/* Tall receipts scroll inside this box so every line stays readable. */}
        <div
          tabIndex={0}
          role="group"
          aria-label="Receipt photo, scrollable"
          className="max-h-[50dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <img
            src={picked.dataUrl}
            alt="Preview of the receipt photo you chose"
            onLoad={() => setImageReady(true)}
            onError={() => setImageReady(false)}
            className="block w-full h-auto object-contain"
          />
        </div>

        <div className="space-y-3">
          <motion.button
            type="button"
            onClick={handleConfirm}
            disabled={blocked}
            aria-disabled={blocked}
            whileTap={TAP_SCALE}
            transition={TAP_TRANSITION}
            className={PRIMARY_BTN}
          >
            Use this photo
          </motion.button>
          <motion.button
            type="button"
            onClick={handleRetake}
            disabled={confirming}
            whileTap={TAP_SCALE}
            transition={TAP_TRANSITION}
            className={SECONDARY_BTN}
          >
            Retake
          </motion.button>
        </div>
      </section>
    );
  }

  return (
    <section data-screen="capture" className="app-screen py-8 space-y-6">
      <h2 className="text-xl font-bold">Photo the receipt</h2>
      <p className="text-slate-600 text-sm">
        Camera or gallery — whichever is easier. Try to get it flat and well-lit.
      </p>

      {/* Two hidden pickers. The camera hint is only on the first; the second
          has none, so the gallery/file picker opens (desktop falls back to the
          normal file picker for both). */}
      <input
        ref={cameraInputRef}
        aria-label="Camera photo input"
        capture="environment"
        {...hiddenInputProps}
      />
      <input
        ref={galleryInputRef}
        aria-label="Gallery photo input"
        {...hiddenInputProps}
      />

      <div className="space-y-3">
        <motion.button
          ref={takePhotoRef}
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          whileTap={TAP_SCALE}
          transition={TAP_TRANSITION}
          className={PRIMARY_BTN}
        >
          Take photo
        </motion.button>
        <motion.button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          whileTap={TAP_SCALE}
          transition={TAP_TRANSITION}
          className={SECONDARY_BTN}
        >
          Choose from gallery
        </motion.button>
      </div>

      <button
        type="button"
        className="text-sm text-slate-500 underline min-h-[48px]"
        onClick={() => goToScreen('landing')}
      >
        ← Back
      </button>
    </section>
  );
}
