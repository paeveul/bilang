// api/_lib/bad-request.js — the generic 400 used only when a gated POST
// endpoint (api/parse.js and the POST path of api/split.js) refuses a request
// whose Content-Type is not application/json.
//
// That refusal gets this exact body. It does not name the check, so a caller
// probing the endpoint learns nothing about what is checked. Other 400s on
// these endpoints (body validation) keep their specific messages. Do not add
// detail to this body.

const BAD_REQUEST_BODY = Object.freeze({ error: 'Bad Request' });

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
