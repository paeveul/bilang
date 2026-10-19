// src/test/capture-helpers.mjs — shared steps for driving the capture screen
// (two controls + confirm step, 2026-10-20). jsdom never fires <img> load
// events, so the helper fires one by hand, as a real browser would.
import { screen, fireEvent } from '@testing-library/react';

// Choose a photo through the camera (default) or gallery input and wait for
// the preview. Does NOT confirm.
export async function pickPhoto(user, file, { via = 'camera' } = {}) {
  const label = via === 'gallery' ? 'Gallery photo input' : 'Camera photo input';
  await user.upload(screen.getByLabelText(label, { selector: 'input' }), file);
  const img = await screen.findByAltText('Preview of the receipt photo you chose');
  fireEvent.load(img);
  return img;
}

// Pick, then tap the single confirm control.
export async function pickAndConfirm(user, file, opts) {
  await pickPhoto(user, file, opts);
  await user.click(screen.getByRole('button', { name: 'Use this photo' }));
}
