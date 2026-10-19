// src/App.capture.confirm.test.jsx — 2026-10-20: two-control capture screen
// ("Take photo" / "Choose from gallery") and the plan-W18 confirm step.
//
// Rule under test: choosing a photo only shows a preview. /api/v1/parse is
// called ONLY from the click handler of the single "Use this photo" control.
// Retake and Back send nothing. Plans test cases 13 (retake twice, confirm
// once) and 20 (single unambiguous confirm control).
//
// Network: fully stubbed (src/test/fetch-stub.mjs).
import { window as jsdomWindow } from './test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { installFetchStub, uninstallFetchStub, reply } from './test/fetch-stub.mjs';
import { pickPhoto } from './test/capture-helpers.mjs';

globalThis.FileReader = jsdomWindow.FileReader;

const PARSED_RECEIPT = {
  items: [{ name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 8, line_total: 8 }],
  subtotal: 8,
  service_charge: 0.8,
  tax: 0.48,
  grand_total: 9.28,
};

function fakeFile(name = 'receipt.jpg') {
  return new jsdomWindow.File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], name, {
    type: 'image/jpeg',
  });
}

test.afterEach(() => {
  cleanup();
  uninstallFetchStub();
  window.history.pushState(null, '', '/');
});

function stubNetwork(onParse) {
  return installFetchStub((call) => {
    if (call.url === '/api/v1/auth/session') return reply(200, { signedIn: true, accountId: 'acct-1' });
    if (call.url === '/api/v1/parse') return onParse ? onParse(call) : reply(200, PARSED_RECEIPT);
    return undefined;
  });
}

const parseCalls = (calls) => calls.filter((c) => c.url === '/api/v1/parse');

async function openCapture(user) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Start a new split' }));
  await screen.findByRole('button', { name: 'Take photo' });
}

test('pick state: Take photo is primary, Choose from gallery is secondary, and only the camera input forces the camera', async () => {
  stubNetwork();
  await openCapture(userEvent.setup());

  const take = screen.getByRole('button', { name: 'Take photo' });
  const gallery = screen.getByRole('button', { name: 'Choose from gallery' });
  assert.match(take.className, /bg-amber-500/, 'Take photo is the primary (amber) control');
  assert.doesNotMatch(gallery.className, /bg-amber-500/, 'gallery is visually secondary');

  const camera = screen.getByLabelText('Camera photo input', { selector: 'input' });
  const picker = screen.getByLabelText('Gallery photo input', { selector: 'input' });
  assert.equal(camera.getAttribute('capture'), 'environment');
  assert.equal(camera.getAttribute('accept'), 'image/*');
  assert.equal(picker.getAttribute('accept'), 'image/*');
  assert.equal(picker.hasAttribute('capture'), false, 'gallery picker must not force the camera');
  assert.equal(camera.getAttribute('aria-hidden'), 'true');
  assert.equal(picker.getAttribute('aria-hidden'), 'true');
  assert.equal(camera.tabIndex, -1);
  assert.equal(picker.tabIndex, -1);
});

test('each button opens its own picker', async () => {
  stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  const camera = screen.getByLabelText('Camera photo input', { selector: 'input' });
  const picker = screen.getByLabelText('Gallery photo input', { selector: 'input' });
  const clicked = [];
  camera.addEventListener('click', () => clicked.push('camera'));
  picker.addEventListener('click', () => clicked.push('gallery'));

  await user.click(screen.getByRole('button', { name: 'Take photo' }));
  await user.click(screen.getByRole('button', { name: 'Choose from gallery' }));
  assert.deepEqual(clicked, ['camera', 'gallery']);
});

for (const via of ['camera', 'gallery']) {
  test(`${via} pick: preview shows with Retake and one confirm, and ZERO parse requests`, async () => {
    const calls = stubNetwork();
    const user = userEvent.setup();
    await openCapture(user);

    await pickPhoto(user, fakeFile(), { via });

    assert.ok(screen.getByRole('heading', { name: 'Check the photo' }));
    assert.ok(screen.getByRole('button', { name: 'Use this photo' }));
    assert.ok(screen.getByRole('button', { name: 'Retake' }));
    assert.equal(screen.queryByRole('button', { name: 'Take photo' }), null, 'pick controls are replaced');
    assert.equal(screen.queryByRole('button', { name: /back/i }), null, 'Back is hidden in the check state');
    assert.equal(parseCalls(calls).length, 0, 'choosing a photo must not call /api/parse');
  });
}

test('entering the check state focuses the heading, not the confirm button; Retake focuses Take photo', async () => {
  stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  await pickPhoto(user, fakeFile());

  await waitFor(() => assert.equal(document.activeElement, screen.getByRole('heading', { name: 'Check the photo' })));
  assert.notEqual(document.activeElement, screen.getByRole('button', { name: 'Use this photo' }));

  await user.click(screen.getByRole('button', { name: 'Retake' }));
  const take = await screen.findByRole('button', { name: 'Take photo' });
  await waitFor(() => assert.equal(document.activeElement, take));
});

test('"Use this photo" stays disabled until the image has rendered', async () => {
  stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  await user.upload(screen.getByLabelText('Camera photo input', { selector: 'input' }), fakeFile());
  await screen.findByAltText('Preview of the receipt photo you chose');
  assert.equal(screen.getByRole('button', { name: 'Use this photo' }).disabled, true);
  assert.equal(screen.getByRole('button', { name: 'Retake' }).disabled, false, 'Retake stays usable');
});

test('plan test 13: retake twice then confirm once = zero requests for the retakes, exactly one for the confirm', async () => {
  const calls = stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);

  await pickPhoto(user, fakeFile('a.jpg'));
  await user.click(screen.getByRole('button', { name: 'Retake' }));
  await screen.findByRole('button', { name: 'Take photo' });
  assert.equal(screen.queryByAltText('Preview of the receipt photo you chose'), null, 'retake discards the image');
  assert.equal(parseCalls(calls).length, 0);

  await pickPhoto(user, fakeFile('b.jpg'), { via: 'gallery' });
  await user.click(screen.getByRole('button', { name: 'Retake' }));
  await screen.findByRole('button', { name: 'Take photo' });
  assert.equal(parseCalls(calls).length, 0, 'two retakes send nothing');

  await pickPhoto(user, fakeFile('c.jpg'));
  assert.equal(parseCalls(calls).length, 0, 'still nothing before the confirm tap');
  await user.click(screen.getByRole('button', { name: 'Use this photo' }));

  await screen.findByText('Check the items');
  assert.equal(parseCalls(calls).length, 1, 'exactly one parse, from the confirm tap');
});

test('plan test 20: one unambiguous confirm control, no cost label, no second acknowledgement', async () => {
  stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  await pickPhoto(user, fakeFile());

  const buttons = screen.getAllByRole('button').map((b) => b.textContent.trim());
  assert.deepEqual(buttons, ['Use this photo', 'Retake']);
  assert.equal(screen.queryAllByRole('checkbox').length, 0, 'no acknowledgement tick');
  assert.equal(screen.queryByText(/credit|cost|scan|are you sure/i), null, 'no cost or second-confirm wording');
});

test('confirm moves to parsing and calls parseReceipt exactly once with the chosen image', async () => {
  const calls = stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  await pickPhoto(user, fakeFile());
  await user.click(screen.getByRole('button', { name: 'Use this photo' }));
  await screen.findByText('Check the items');

  const parses = parseCalls(calls);
  assert.equal(parses.length, 1);
  assert.equal(parses[0].body.image, 'R0lGODlh', 'the held image is what is sent');
});

test('double tap on confirm starts one parse, not two', async () => {
  let release;
  const calls = stubNetwork(
    () =>
      new Promise((resolve) => {
        release = () => resolve(reply(200, PARSED_RECEIPT));
      }),
  );
  const user = userEvent.setup();
  await openCapture(user);
  await pickPhoto(user, fakeFile());

  const confirm = screen.getByRole('button', { name: 'Use this photo' });
  // Two clicks inside one act(): both land before React can re-render and
  // disable the button, so only the handler's own guard can stop the second.
  act(() => {
    confirm.click();
    confirm.click();
  });
  await waitFor(() => assert.equal(parseCalls(calls).length, 1));
  release();
  await screen.findByText('Check the items');
  assert.equal(parseCalls(calls).length, 1, 'a double tap must never start two parses');
});

test('Back from the pick state, and leaving with a preview open, send no request', async () => {
  const calls = stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  await user.click(screen.getByRole('button', { name: /Back/ }));
  await screen.findByRole('button', { name: 'Start a new split' });

  await user.click(screen.getByRole('button', { name: 'Start a new split' }));
  await pickPhoto(user, fakeFile());
  cleanup(); // closing the app with the preview showing
  assert.equal(parseCalls(calls).length, 0);
});

test('choosing the same file twice still shows the preview both times (picker value is reset)', async () => {
  stubNetwork();
  const user = userEvent.setup();
  await openCapture(user);
  const file = fakeFile();

  const camera = screen.getByLabelText('Camera photo input', { selector: 'input' });
  await pickPhoto(user, file);
  assert.equal(camera.value, '', 'picker value is cleared after a pick');
  await user.click(screen.getByRole('button', { name: 'Retake' }));
  await screen.findByRole('button', { name: 'Take photo' });

  await pickPhoto(user, file);
  assert.ok(screen.getByRole('button', { name: 'Use this photo' }));
});
