// src/screens/AuthScreen.test.jsx — Item 10 Checkpoint 4, Step 10: the sign-in
// screen against a stubbed network. Every request goes through
// src/test/fetch-stub.mjs; the real js/auth-client.js runs on top of it.
// No Supabase, Anthropic or email call can happen from here.
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthScreen from './AuthScreen.jsx';
import { installFetchStub, uninstallFetchStub, reply } from '../test/fetch-stub.mjs';

const EMAIL = 'ali@example.com';
const TERMS_TEXT = 'Please accept the Terms and Privacy Notice to continue.';
const OUTAGE_TEXT = 'Sign-in is temporarily unavailable. Please try again shortly.';
const WRONG_CODE_TEXT = 'That code is not valid or has expired. Request a new one.';

test.afterEach(() => {
  cleanup();
  uninstallFetchStub();
});

test('page variant: email first, then the six-digit code step with a visible resend cooldown', async () => {
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} />);

  assert.ok(screen.getByRole('heading', { name: 'Sign in to Bilang' }));
  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));

  await screen.findByLabelText('Six-digit code');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { email: EMAIL });
  assert.equal(calls[0].options.credentials, 'same-origin');

  const resend = screen.getByRole('button', { name: 'Resend code in 60s' });
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
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, OUTAGE_TEXT);
  assert.equal(screen.queryByLabelText('Six-digit code'), null, 'stays on the email step');
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
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '000000');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, WRONG_CODE_TEXT);
  assert.equal(signedIn, false);
});

test('a correct code signs in; a returning user sends no terms fields; spaces in the code are removed', async () => {
  let signedIn = false;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-1' });
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => (signedIn = true)} termsVersion="test-terms-v1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '123 456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.equal(signedIn, true));
  const verify = calls.find((c) => c.url === '/api/v1/auth/verify-code');
  assert.deepEqual(verify.body, { email: EMAIL, code: '123456' });
});

test('first-time sign-in: a terms refusal returns to the email step; the send button stays blocked until ticked; then the terms fields are sent', async () => {
  let verifyCount = 0;
  let signedIn = false;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') {
      verifyCount += 1;
      if (verifyCount === 1) return reply(400, { error: TERMS_TEXT, code: 'terms_not_accepted' });
      return reply(200, { accountId: 'acct-new' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => (signedIn = true)} termsVersion="test-terms-v1" />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '111111');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  // Back on the email step with the refusal text and the terms box.
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, TERMS_TEXT);
  assert.equal(screen.queryByLabelText('Six-digit code'), null);
  const terms = screen.getByRole('checkbox');
  const send = screen.getByRole('button', { name: 'Send me a code' });
  assert.equal(send.disabled, true, 'cannot request a new code until the terms box is ticked');

  await user.click(terms);
  assert.equal(screen.getByRole('button', { name: 'Send me a code' }).disabled, false);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '222222');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.equal(signedIn, true));
  const verifies = calls.filter((c) => c.url === '/api/v1/auth/verify-code');
  assert.equal(verifies.length, 2);
  assert.deepEqual(verifies[1].body, {
    email: EMAIL,
    code: '222222',
    termsAccepted: true,
    termsVersion: 'test-terms-v1',
  });
});

test('no terms version configured: the screen invents none and sends only termsAccepted', async () => {
  let verifyCount = 0;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') {
      verifyCount += 1;
      if (verifyCount === 1) return reply(400, { error: TERMS_TEXT, code: 'terms_not_accepted' });
      return reply(400, { error: TERMS_TEXT, code: 'terms_not_accepted' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} termsVersion={undefined} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '111111');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('checkbox');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '222222');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.equal(verifyCount, 2));
  const second = calls.filter((c) => c.url === '/api/v1/auth/verify-code')[1];
  assert.equal(second.body.termsAccepted, true);
  assert.equal('termsVersion' in second.body, false);
});

test('resend becomes available after the cooldown and sends a fresh code request', async () => {
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    return undefined;
  });
  const user = userEvent.setup();
  render(<AuthScreen onSignedIn={() => {}} cooldownSeconds={1} />);

  await user.type(screen.getByLabelText('Email address'), EMAIL);
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await screen.findByRole('button', { name: 'Resend code in 1s' });

  const resend = await screen.findByRole('button', { name: 'Resend code' }, { timeout: 3000 });
  await user.click(resend);
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[1].body, { email: EMAIL });
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
