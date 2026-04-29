const XML_ESCAPES = {
  '&' : '&amp;',
  '<' : '&lt;',
  '>' : '&gt;',
  '"' : '&quot;',
  "'" : '&apos;',
};

const escapeXml = (str) =>
  String(str == null ? '' : str).replace(/[&<>"']/g, c => XML_ESCAPES[c]);

const safeNum = (val, decimals = 4) => {
  const n = parseFloat(val);
  return isNaN(n) ? 'N/A' : n.toFixed(decimals);
};

const safeDate = (val, locale = 'en-GB') => {
  if (!val) return 'N/A';
  try {
    return new Date(val).toLocaleDateString(locale, {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch {
    return 'N/A';
  }
};

const safeStr = (val, fallback = 'N/A') =>
  (val == null || String(val).trim() === '') ? fallback : String(val);

const safePct = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? 'N/A' : `${(n * 100).toFixed(1)}%`;
};

module.exports = { escapeXml, safeNum, safeDate, safeStr, safePct };