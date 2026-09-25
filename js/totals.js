// js/totals.js
//
// Browser-side entry point for the money arithmetic. The implementation lives
// in api/_lib/totals.js (CommonJS, shared with the serverless handlers) so the
// client preview and the server's recomputation cannot drift apart.

export {
  toCents,
  fromCents,
  formatRM,
  formatRMLocked,
  percentToCents,
  centsToPercent,
  computeTotals,
  manualItemRemainingCents,
} from '../api/_lib/totals.js';
