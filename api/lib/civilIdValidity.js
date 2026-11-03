// Expiry is a calendar date, valid through that date in Kuwait time.
// Never let JavaScript roll an invalid date (e.g. 31 February) forward.
function civilIdValidity(expiryDate, confidence, now = new Date()) {
  if (confidence !== 'high' || typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return 'unreadable';
  }
  const date = new Date(`${expiryDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiryDate) return 'unreadable';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  return expiryDate < today ? 'expired' : 'valid';
}

module.exports = { civilIdValidity };
