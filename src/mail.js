/**
 * Outbound email for Capoccia–Miotto tribute.
 * Prefers SMTP when configured; falls back to FormSubmit auto-response so PIN requests still work.
 */

const FAMILY_PIN = process.env.FAMILY_PIN || "29765240";
const MAIL_FROM = process.env.MAIL_FROM || "info@capocciamiotto.com";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Capoccia–Miotto Family Tribute";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "info@capocciamiotto.com";

let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (_) {
  nodemailer = null;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  if (!nodemailer || !smtpConfigured()) return null;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function pinEmailBodies(toEmail, requesterName) {
  const name = requesterName || "Family member";
  const subject = "Your Capoccia–Miotto Family PIN";
  const text =
    `Hello ${name},\n\n` +
    `Thank you for joining the Capoccia–Miotto Family Reunion Tribute.\n\n` +
    `Your family contribution PIN is:\n\n` +
    `    ${FAMILY_PIN}\n\n` +
    `Enter this PIN at https://capocciamiotto.com/contribute/pin to:\n` +
    `• Contribute photographs\n` +
    `• Add your name to Family Members and the living family tree\n` +
    `• Share stories and voice recordings\n\n` +
    `Please keep this PIN within the family.\n\n` +
    `With love,\n` +
    `The Capoccia–Miotto Family Tribute\n` +
    `${CONTACT_EMAIL}\n` +
    `https://capocciamiotto.com\n`;

  const html =
    `<div style="font-family:Georgia,serif;color:#2b211c;line-height:1.6;max-width:560px">` +
    `<p>Hello ${escapeHtml(name)},</p>` +
    `<p>Thank you for joining the <strong>Capoccia–Miotto Family Reunion Tribute</strong>.</p>` +
    `<p>Your family contribution PIN is:</p>` +
    `<p style="font-size:28px;letter-spacing:0.2em;font-weight:700;color:#6b1f2a;background:#faf6f0;padding:16px 20px;border-radius:12px;text-align:center;border:1px solid #e0c98a">${FAMILY_PIN}</p>` +
    `<p>Enter this PIN at <a href="https://capocciamiotto.com/contribute/pin">capocciamiotto.com/contribute/pin</a> to contribute photographs, add your name to the family tree, and share stories or voice recordings.</p>` +
    `<p>Please keep this PIN within the family.</p>` +
    `<p>With love,<br/>The Capoccia–Miotto Family Tribute<br/>` +
    `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br/>` +
    `<a href="https://capocciamiotto.com">capocciamiotto.com</a></p>` +
    `</div>`;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendViaSmtp(toEmail, requesterName) {
  const transport = createTransport();
  if (!transport) return { ok: false, method: "smtp", error: "SMTP not configured" };
  const { subject, text, html } = pinEmailBodies(toEmail, requesterName);
  const info = await transport.sendMail({
    from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`,
    to: toEmail,
    replyTo: CONTACT_EMAIL,
    subject,
    text,
    html,
  });
  return { ok: true, method: "smtp", id: info.messageId || null };
}

/**
 * FormSubmit fallback: notifies info@capocciamiotto.com and auto-responds to the requester with the PIN.
 * First use may require one-time activation of the inbox.
 */
async function sendViaFormSubmit(toEmail, requesterName) {
  const { subject, text } = pinEmailBodies(toEmail, requesterName);
  const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(CONTACT_EMAIL)}`;
  const payload = {
    name: requesterName || "Family member",
    email: toEmail,
    _replyto: toEmail,
    _subject: `Family PIN request — ${toEmail}`,
    message:
      `A family member requested the contribution PIN.\n\n` +
      `Name: ${requesterName || "(not provided)"}\n` +
      `Email: ${toEmail}\n\n` +
      `An auto-response with the family PIN was sent to their email.`,
    _autoresponse: text,
    _template: "table",
    _captcha: "false",
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let data = null;
  try {
    data = JSON.parse(bodyText);
  } catch (_) {
    data = { raw: bodyText };
  }

  if (!res.ok) {
    return {
      ok: false,
      method: "formsubmit",
      error: (data && (data.message || data.error)) || `HTTP ${res.status}`,
      data,
    };
  }
  return { ok: true, method: "formsubmit", data };
}

async function sendFamilyPinEmail({ toEmail, requesterName }) {
  const email = String(toEmail || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Invalid email address." };
  }

  // Prefer real SMTP when secrets are present
  if (smtpConfigured()) {
    try {
      return await sendViaSmtp(email, requesterName);
    } catch (err) {
      console.error("SMTP pin email failed:", err.message);
      // fall through to FormSubmit
    }
  }

  try {
    return await sendViaFormSubmit(email, requesterName);
  } catch (err) {
    console.error("FormSubmit pin email failed:", err.message);
    return { ok: false, error: err.message || "Could not send email." };
  }
}

module.exports = {
  FAMILY_PIN,
  MAIL_FROM,
  CONTACT_EMAIL,
  sendFamilyPinEmail,
  smtpConfigured,
};
