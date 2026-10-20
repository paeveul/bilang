//
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthScreen from './AuthScreen.jsx';
import { PHOTO_DISCLOSURE_LINE, MOCK_PRIVACY_NOTICE } from '../legal/mock-legal-content.js';
import { installFetchStub, uninstallFetchStub, reply } from '../test/fetch-stub.mjs';

const EMAIL = 'ali@example.com';
const TERMS_TEXT = 'Please accept the Terms and Privacy Notice to continue.';
const OUTAGE_TEXT = 'Sign-in is temporarily unavailable. Please try again shortly.';
const WRONG_CODE_TEXT = 'That code is not valid or has expired. Request a new one.';

test.afterEach(() => {
  cleanup();
  uninstallFetchStub();
});

async function tickTerms(user) {
  await user.click(screen.getByRole('checkbox'));
}

test('the terms tick is visible on the email step with visible links, and blocks sending until ticked', async () => {
  installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  assert.ok(screen.getByRole('heading', { name: 'Sign in to Bilang' }));
  assert.ok(screen.getByRole('checkbox'), 'terms tick is shown on the email step for every user');
  assert.ok(screen.getByRole('button', { name: 'Terms of Service' }), 'visible link, not footer-only');
  assert.ok(screen.getByRole('button', { name: 'Privacy Notice' }), 'visible link, not footer-only');

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  assert.equal(screen.getByRole('button', { name: 'Send me a code' }).disabled, true, 'blocked until ticked');

  await tickTerms(user);
  assert.equal(screen.getByRole('button', { name: 'Send me a code' }).disabled, false);
});

test('clicking the visible links reveals the mock Terms/Privacy content inline, each closeable', async () => {
  installFetchStub(() => undefined);
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  await user.click(screen.getByRole('button', { name: 'Terms of Service' }));
  assert.ok(screen.getByText(/PLACEHOLDER/).textContent.includes('[PLACEHOLDER'));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  assert.equal(screen.queryByText(/PLACEHOLDER/), null);

  await user.click(screen.getByRole('button', { name: 'Privacy Notice' }));
  assert.ok(screen.getByText(/PLACEHOLDER/));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  assert.equal(screen.queryByText(/PLACEHOLDER/), null);
});

test('sending a code includes termsAccepted and termsVersion, and the code is only sent after the tick', async () => {
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} termsVersion="draft-0.1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));

  await screen.findByLabelText('Six-digit code');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { email: EMAIL, termsAccepted: true, termsVersion: 'draft-0.1' });
  assert.equal(calls[0].options.credentials, 'same-origin');

  const resend = screen.getByRole('button', { name: 'Resend in 60s' });
  assert.equal(resend.disabled, true, 'resend is locked during the cooldown');
});

test('server error text is shown exactly as the server wrote it (outage 503)', async () => {
  installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') {
      return reply(503, { error: OUTAGE_TEXT, code: 'auth_unavailable' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, OUTAGE_TEXT);
  assert.equal(screen.queryByLabelText('Six-digit code'), null, 'stays on the email step');
});

test('request-code refusing terms_not_accepted (e.g. a direct API caller bypassing the UI) is shown verbatim and never reaches the code step', async () => {
  installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') {
      return reply(400, { error: TERMS_TEXT, code: 'terms_not_accepted' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, TERMS_TEXT);
  assert.equal(screen.queryByLabelText('Six-digit code'), null);
});

test('a wrong code shows the server message verbatim and does not sign in', async () => {
  let signedIn = false;
  installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') {
      return reply(401, { error: WRONG_CODE_TEXT, code: 'invalid_code' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => (signedIn = true)} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '000000');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, WRONG_CODE_TEXT);
  assert.equal(signedIn, false);
});

test('a correct code signs in; verify-code carries the same termsAccepted/termsVersion as request-code; spaces in the code are removed', async () => {
  let signedIn = false;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-1' });
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => (signedIn = true)} termsVersion="test-terms-v1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '123 456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.equal(signedIn, true));
  const request = calls.find((c) => c.url === '/api/v1/auth/request-code');
  const verify = calls.find((c) => c.url === '/api/v1/auth/verify-code');
  assert.deepEqual(request.body, { email: EMAIL, termsAccepted: true, termsVersion: 'test-terms-v1' });
  assert.deepEqual(verify.body, {
    email: EMAIL,
    code: '123456',
    termsAccepted: true,
    termsVersion: 'test-terms-v1',
  });
});

test('no terms version configured: the screen invents none and sends only termsAccepted on both calls', async () => {
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-1' });
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} termsVersion={undefined} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '111111');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.equal(calls.length, 2));
  for (const call of calls) {
    assert.equal(call.body.termsAccepted, true);
    assert.equal('termsVersion' in call.body, false);
  }
});

test('defense-in-depth: a terms_not_accepted refusal at verify-code (should not normally happen, tick already gated the send) returns to the email step with the tick still checked', async () => {
  let signedIn = false;
  installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') {
      return reply(400, { error: TERMS_TEXT, code: 'terms_not_accepted' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => (signedIn = true)} termsVersion="draft-0.1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '111111');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, TERMS_TEXT);
  assert.equal(screen.queryByLabelText('Six-digit code'), null, 'back on the email step');
  assert.equal(screen.getByRole('checkbox').checked, true, 'the tick is not reset — it was already ticked');
  assert.equal(screen.getByRole('button', { name: 'Send me a code' }).disabled, false);
  assert.equal(signedIn, false);
});

test('resend becomes available after the cooldown and sends a fresh code request carrying the same terms fields', async () => {
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} cooldownSeconds={1} termsVersion="draft-0.1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await tickTerms(user);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await screen.findByRole('button', { name: 'Resend in 1s' });

  const resend = await screen.findByRole('button', { name: 'Resend code' }, { timeout: 3000 });
  await user.click(resend);
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[1].body, { email: EMAIL, termsAccepted: true, termsVersion: 'draft-0.1' });
});

test('overlay variant keeps the user on the same flow with continuity copy', () => {
  installFetchStub(() => undefined);
  render(<AuthScreen variant="overlay" onSignedIn={() => {}} />);
  assert.ok(screen.getByRole('heading', { name: 'Sign in to keep going' }));
  assert.ok(screen.getByText('Your split is still here. Sign in and carry on where you left off.'));
});

test('a startup error from the session check is shown with the server text', () => {
  installFetchStub(() => undefined);
  render(<AuthScreen onSignedIn={() => {}} startupError={OUTAGE_TEXT} />);
  assert.equal(screen.getByRole('alert').textContent, OUTAGE_TEXT);
});

test('the one tick names Terms + Privacy and states, as its own visible line beside it, that the receipt photo goes to Anthropic and is not stored afterwards', () => {
  installFetchStub(() => undefined);
  render(<AuthScreen onSignedIn={() => {}} />);

  const tick = screen.getByRole('checkbox');
  const label = tick.closest('label');
  assert.ok(label, 'the disclosure sits inside the same label as the single tick');
  assert.ok(label.textContent.includes('Terms of Service'));
  assert.ok(label.textContent.includes('Privacy Notice'));

  const line = screen.getByTestId('photo-disclosure');
  assert.equal(line.textContent, PHOTO_DISCLOSURE_LINE);
  assert.match(line.textContent, /Anthropic/);
  assert.match(line.textContent, /never stored afterwards/);
  assert.equal(line.querySelector('button'), null, 'its own line, not folded into the Terms/Privacy links');
  assert.equal(screen.getAllByRole('checkbox').length, 1, 'exactly one tick on the screen');
});

test('unticked: pressing Send does nothing and no code request reaches the network', async () => {
  const calls = installFetchStub(() => reply(204));
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  assert.equal(calls.length, 0, 'no request-code (and nothing else) before the tick');
  assert.equal(screen.queryByLabelText('Six-digit code'), null);
});

test('the Privacy Notice states the same photo disclosure the tick does (Anthropic, not stored)', async () => {
  installFetchStub(() => undefined);
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  assert.match(MOCK_PRIVACY_NOTICE, /Anthropic/);
  assert.match(MOCK_PRIVACY_NOTICE, /never saved/);
  await user.click(screen.getByRole('button', { name: 'Privacy Notice' }));
  assert.match(screen.getByRole('heading', { name: 'Privacy Notice' }).parentElement.textContent, /Anthropic/);
});
