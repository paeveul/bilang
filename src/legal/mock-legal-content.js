// src/legal/mock-legal-content.js — Alex, 2026-10-10 (logged in
// bilang/pm/bilang-pm-tracker.md v2.78 change-log): use placeholder/mock
// Terms of Service and Privacy Notice content for now. Real legal wording
// is deferred to just before MVP1 completion — this file must never read as
// the real thing.
//
// Scope: this is the SINGLE sign-in consent (2026-10-19, Alex's request relayed
// via the orchestrator): one tick on the sign-in screen now covers the Terms of
// Service, the Privacy Notice (email collection, OTP, session cookies, account
// storage) AND the receipt-photo disclosure (the photo is sent to Anthropic to
// be read and is not stored afterwards). The Landing screen no longer has its
// own tick or legal panels; its wording was moved here.
//
// PHOTO_DISCLOSURE_LINE is the sentence shown as its own visible line beside
// the tick. It deliberately does NOT contain the placeholder marker (it is the
// tick text, not a notice paragraph); the same disclosure is stated in full in
// MOCK_PRIVACY_NOTICE so the tick and the Notice say the same thing.
//
// Same explicit-placeholder convention LandingScreen already uses: every
// paragraph opens with "[PLACEHOLDER — Javier to draft final copy]" so this
// can never be mistaken for the final text, however it is skimmed.
//
// Contact line added 2026-10-10 (Alex: "just have anything... there's not
// much thinking needed, this is purely a mock" — relayed via coordinator,
// bilang-pm-tracker.md v2.80 change-log). An email-shaped placeholder in the
// same bracketed register as the rest of this file — not a real mailbox.

export const PHOTO_DISCLOSURE_LINE =
  'I understand my receipt photo is sent to Anthropic (the maker of the Claude AI model) to be read, and is never stored afterwards.';

export const MOCK_PRIVACY_NOTICE = `[PLACEHOLDER — Javier to draft final copy] To sign you in, Bilang asks for your email address so it can send a one-time six-digit code and confirm it is really you. Bilang's own records never store that email address — only our authentication provider holds it, and only to verify the code. Once you are signed in, a small number of cookies keep you signed in across visits; they identify your session, not you personally, and expire on their own. When you photograph a receipt, the photo is sent to Anthropic's Claude AI model (processed in the United States) to read the items on it; the photo itself is never saved and is discarded once it has been read. What IS saved: the item names and amounts you confirm, the names of people you assign items to, the totals, and the bill owner's payment details (DuitNow ID / bank account / QR) — all shown on the shareable link, kept for a limited time and then deleted. Questions about this notice can be sent to [privacy@bilang-placeholder.example — placeholder contact, not a real mailbox]. This notice is a placeholder — it does not yet reflect final legal wording.`;

export const MOCK_TERMS_OF_SERVICE = `[PLACEHOLDER — Javier to draft final copy] By signing in, you agree to use Bilang only to split bills among people you know, and not to misuse the sign-in process — for example, requesting a code for an email address that is not yours. Paeveul never collects, holds, or moves any money through this sign-in. These terms are a placeholder — they do not yet reflect final legal wording.`;
