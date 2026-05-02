'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════
//  PAYFAST CONFIG
// ═══════════════════════════════════════════════════════════════

const PF = {
  merchantId  : process.env.PAYFAST_MERCHANT_ID,
  merchantKey : process.env.PAYFAST_MERCHANT_KEY,
  passphrase  : process.env.PAYFAST_PASSPHRASE,
  sandbox     : process.env.PAYFAST_SANDBOX === 'true',
  get host()  { return this.sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za'; },
  get url()   { return `https://${this.host}/eng/process`; },
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const BACKEND_URL  = process.env.BACKEND_URL  || 'http://localhost:5000';

// ═══════════════════════════════════════════════════════════════
//  HELPER — generate MD5 signature
// ═══════════════════════════════════════════════════════════════
function generateSignature(data, passphrase = null) {
  // Build query string in exact key order PayFast expects
  let str = Object.entries(data)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`)
    .join('&');

  if (passphrase) {
    str += `&passphrase=${encodeURIComponent(passphrase.trim())}`;
  }

  return crypto.createHash('md5').update(str).digest('hex');
}

// ═══════════════════════════════════════════════════════════════
//  HELPER — verify PayFast ITN (server notification)
// ═══════════════════════════════════════════════════════════════
async function verifyITN(pfData, pfParamString) {
  // Step 1 — Verify signature
  const signature = generateSignature(
    Object.fromEntries(
      Object.entries(pfData).filter(([k]) => k !== 'signature')
    ),
    PF.passphrase
  );
  if (signature !== pfData['signature']) return false;

  // Step 2 — Verify source IP is PayFast
  const validHosts = [
    'sandbox.payfast.co.za',
    'www.payfast.co.za',
    'w1w.payfast.co.za',
    'w2w.payfast.co.za',
  ];
  // (IP check is optional in sandbox — skipped here)

  // Step 3 — Verify data with PayFast server
  try {
    const response = await axios.post(
      `https://${PF.host}/eng/query/validate`,
      pfParamString,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
    return response.data === 'VALID';
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  POST /api/payment/create — create PayFast checkout
// ═══════════════════════════════════════════════════════════════
router.post('/create', verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;

    // Fetch user details
    const result = await pool.query(
      'SELECT email, full_name, tier FROM users WHERE user_id = $1',
      [userId]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });

    const user = result.rows[0];

    // Block if already pro
    if (user.tier === 'pro')
      return res.status(400).json({ error: 'You are already on the Pro plan.' });

    // Split name safely
    const nameParts  = (user.full_name || 'Veracity User').trim().split(' ');
    const firstName  = nameParts[0] || 'Veracity';
    const lastName   = nameParts.slice(1).join(' ') || 'User';

    // Build PayFast payment data — ORDER MATTERS for signature
    const paymentData = {
      merchant_id   : PF.merchantId,
      merchant_key  : PF.merchantKey,
      return_url    : `${FRONTEND_URL}/payment/success`,
      cancel_url    : `${FRONTEND_URL}/payment/cancel`,
      notify_url    : `${BACKEND_URL}/api/payment/notify`,
      name_first    : firstName,
      name_last     : lastName,
      email_address : user.email,
      m_payment_id  : `${userId}_${Date.now()}`,   // unique per payment
      amount        : '99.00',                      // your pro plan price
      item_name     : 'Veracity Pro Plan',
      item_description: 'Monthly subscription to Veracity Pro',
      custom_int1   : userId,                       // stored for ITN lookup
    };

    // Generate signature
    paymentData.signature = generateSignature(paymentData, PF.passphrase);

    // Build checkout URL with query params
    const params      = new URLSearchParams(paymentData).toString();
    const checkoutUrl = `${PF.url}?${params}`;

    // Log payment attempt
    await pool.query(
    `INSERT INTO audit_logs 
     (user_id, action, resource_type, resource_id, status, ip_address)
     VALUES ($1, 'PAYMENT_INITIATED', 'payment', NULL, 'SUCCESS', $2)`,
    [userId, req.ip]
 );

    res.json({
      checkout_url : checkoutUrl,
      payment_data : paymentData,
    });

  } catch (err) {
    console.error('Payment create error:', err.message);
    res.status(500).json({ error: 'Could not create payment.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/payment/notify — PayFast ITN webhook (no auth)
//  PayFast hits this URL directly after payment
// ═══════════════════════════════════════════════════════════════
  router.post('/notify', async (req, res) => {
  try {
    const pfData       = req.body;
    const pfParamString = new URLSearchParams(pfData).toString();

    // Verify the notification is genuine
    const isValid = await verifyITN(pfData, pfParamString);
    if (!isValid) {
      console.warn('PayFast ITN verification failed');
      return res.status(400).send('Invalid ITN');
    }

    const userId      = pfData.custom_int1;
    const paymentStatus = pfData.payment_status; // 'COMPLETE' or 'FAILED'
    const amount      = parseFloat(pfData.amount_gross);

    if (paymentStatus === 'COMPLETE') {
      // Upgrade user to pro
      await pool.query(
        `UPDATE users SET tier = 'pro', updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );

    await pool.query(
     `INSERT INTO audit_logs
      (user_id, action, resource_type, resource_id, status, ip_address)
      VALUES ($1, 'PAYMENT_COMPLETE', 'payment', NULL, 'SUCCESS', $2)`,
    [userId, req.ip]
);

      console.log(`User ${userId} upgraded to pro — R${amount}`);
    } else {
    await pool.query(
    `INSERT INTO audit_logs
      (user_id, action, resource_type, resource_id, status, ip_address, error_message)
     VALUES ($1, 'PAYMENT_FAILED', 'payment', NULL, 'FAILED', $2, $3)`,
   [userId, req.ip, paymentStatus]
 );


      console.warn(`Payment failed for user ${userId} — status: ${paymentStatus}`);
    }

    // PayFast expects 200 OK
    res.status(200).send('OK');

  } catch (err) {
    console.error('ITN error:', err.message);
    res.status(500).send('Server error');
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/payment/status — check current user tier
// ═══════════════════════════════════════════════════════════════
router.get('/status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;
    const result = await pool.query(
     'SELECT tier FROM users WHERE user_id = $1',
     [userId]
  );
    if (!result.rows.length)
      return res.status(404).json({ error: 'User not found.' });

    res.json({
      tier   : result.rows[0].tier,
      is_pro : result.rows[0].tier === 'pro',
    });
  } catch (err) {
    console.error('Payment status error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
