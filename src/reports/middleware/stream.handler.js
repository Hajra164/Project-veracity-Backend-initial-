/**
 * Safe PDF stream handler
 * Prevents crash if client disconnects mid-stream
 * Prevents headers-already-sent errors
 */
function safePdfStream(doc, res, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_')}"`
  );

  // If client disconnects, destroy the doc stream cleanly
  res.on('close', () => {
    try { doc.end(); } catch (_) {}
  });

  // Surface PDF generation errors without crashing
  doc.on('error', (err) => {
    console.error('[PDF_STREAM_ERROR]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF generation failed mid-stream.' });
    }
  });

  doc.pipe(res);
}

/**
 * Safe JSON response — prevents double-send
 */
function safeJson(res, data, filename) {
  if (res.headersSent) return;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_')}"`
  );
  res.json(data);
}

/**
 * Safe XML response — prevents double-send
 */
function safeXml(res, xmlString, filename) {
  if (res.headersSent) return;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_')}"`
  );
  res.send(xmlString);
}

module.exports = { safePdfStream, safeJson, safeXml };