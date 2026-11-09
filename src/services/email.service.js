import { mailer, MAIL_FROM, APP_URL } from "../config/mailer.js";

// Names and passwords go into HTML, so escape them
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Never throws: returns true/false so a mail problem doesn't break the request
const send = async ({ to, subject, text, html }) => {
  try {
    await mailer.sendMail({ from: MAIL_FROM, to, subject, text, html });
    return true;
  } catch (error) {
    console.error(`[Email] Sending "${subject}" failed:`, error.message);
    return false;
  }
};

const credentialsEmail = ({ to, name, temporaryPassword, subject, intro }) =>
  send({
    to,
    subject,
    text:
      `Hi ${name},\n\n${intro}\n\n` +
      `Platform: ${APP_URL}\nEmail: ${to}\nTemporary password: ${temporaryPassword}\n\n` +
      `You will be asked to set a new password when you log in.`,
    html:
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(intro)}</p>` +
      `<p><a href="${APP_URL}">Open the platform</a><br>` +
      `Email: ${escapeHtml(to)}<br>` +
      `Temporary password: <code>${escapeHtml(temporaryPassword)}</code></p>` +
      `<p>You will be asked to set a new password when you log in.</p>`,
  });

export const sendWelcomeEmail = ({ to, name, temporaryPassword }) =>
  credentialsEmail({
    to,
    name,
    temporaryPassword,
    subject: "Your account has been created",
    intro: "An account has been created for you.",
  });

export const sendTemporaryPasswordEmail = ({ to, name, temporaryPassword }) =>
  credentialsEmail({
    to,
    name,
    temporaryPassword,
    subject: "Your password has been reset",
    intro: "Your administrator has set a new temporary password for you.",
  });

export const sendPasswordResetCode = ({ to, otp }) =>
  send({
    to,
    subject: "Your password reset code",
    text: `Your password reset code is ${otp}. It is valid for 10 minutes.\n\nIf you did not ask for this, ignore this email.`,
    html: `<p>Your password reset code is <b>${escapeHtml(otp)}</b>. It is valid for 10 minutes.</p><p>If you did not ask for this, ignore this email.</p>`,
  });
