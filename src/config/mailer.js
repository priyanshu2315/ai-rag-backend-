import "dotenv/config";
import nodemailer from "nodemailer";

const port = Number(process.env.SMTP_PORT || 465);

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port,
  secure: port === 465,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
});

export const MAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
export const APP_URL = process.env.APP_URL.replace(/\/$/, "");
