// api/_lib/bad-request.js — the one generic 400 used by the gated POST
// endpoints (api/parse.js and the POST path of api/split.js).
//
// Every malformed request on those endpoints gets this exact body, whatever
// was wrong with it. That is deliberate: a specific error would tell someone
// probing the endpoint what is checked and what triggers each check. Do not
// add detail to this body, and do not name the individual checks in any
// comment that could end up in a response. Specific reasons go to the server
// log only.
//
// The body is serialised by the same helper every time, so a request refused
// for a wrong or missing Content-Type and a request refused for a malformed
// body produce byte-identical responses.

const BAD_REQUEST_BODY = Object.freeze({ error: 'Bad request.', code: 'bad_request' });

function sendBadRequest(res) {
  res.status(400).json({ ...BAD_REQUEST_BODY });
}

// True only when the request declares application/json. Any parameters after
// the media type (such as charset) are ignored. A missing or non-string header
// is treated as not JSON.
function hasJsonContentType(req) {
  const raw = req && req.headers ? req.headers['content-type'] : undefined;
  if (typeof raw !== 'string') return false;
  const mediaType = raw.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

module.exports = { BAD_REQUEST_BODY, sendBadRequest, hasJsonContentType };
