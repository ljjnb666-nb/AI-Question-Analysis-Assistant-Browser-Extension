import nodemailer from "nodemailer";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`missing ${name} environment variable`);
  }
  return value;
}

function buildTransport() {
  const host = requireEnv("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const auth = user && pass ? { user, pass } : undefined;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });
}

export function isMailerConfigured() {
  return ["SMTP_HOST", "SMTP_FROM"].every((key) => String(process.env[key] || "").trim());
}

export async function sendVerificationCodeEmail(email, code) {
  const transporter = buildTransport();
  const from = requireEnv("SMTP_FROM");
  await transporter.sendMail({
    from,
    to: email,
    subject: "Quiz Solver verification code",
    text: `Your verification code is ${code}. It will expire in 10 minutes.`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#111827"><h2>Quiz Solver verification code</h2><p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p></div>`,
  });
}
