'use client';

import { FormEvent, useState } from 'react';

const MIN_OTP_LENGTH = 6;
const MAX_OTP_LENGTH = 10;

export default function CommissionCheckerLoginForm() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function postJson(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || 'Unable to continue');
    return json;
  }

  async function sendOtp() {
    if (!email.trim()) return;

    try {
      setBusy(true);
      setError('');
      await postJson('/api/commission-checker/auth/request-otp', { email });
      setCodeSent(true);
      setMessage('If this email is approved, an access code has been sent.');
    } catch (err: any) {
      setError(err?.message || 'Unable to send access code');
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    await sendOtp();
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (otp.length < MIN_OTP_LENGTH || otp.length > MAX_OTP_LENGTH) return;

    try {
      setBusy(true);
      setError('');
      await postJson('/api/commission-checker/auth/verify-otp', { email, token: otp });
      window.location.assign('/commission-checker');
    } catch (err: any) {
      setError(err?.message || 'The code is invalid or has expired');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">HH</div>
        <div className="eyebrow">Hallmark Hotel Group</div>
        <h1>Commission Checker</h1>
        <p className="intro">
          Secure access for approved branches. Your Booking.com and ABS files remain on this device.
        </p>

        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {!codeSent ? (
          <form onSubmit={requestOtp} className="form">
            <label htmlFor="commission-email">Approved email address</label>
            <input
              id="commission-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="branch@hotelhallmark.com"
              autoComplete="email"
              inputMode="email"
              required
            />
            <button type="submit" disabled={busy}>{busy ? 'Sending codeâ€¦' : 'Send access code'}</button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="form">
            <div className="email-row">
              <span>{email}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => { setCodeSent(false); setOtp(''); setMessage(''); setError(''); }}
              >
                Change
              </button>
            </div>
            <label htmlFor="commission-otp">Access code</label>
            <input
              id="commission-otp"
              className="otp-input"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, MAX_OTP_LENGTH))}
              placeholder="Enter the code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6,10}"
              maxLength={MAX_OTP_LENGTH}
              autoFocus
              required
            />
            <button type="submit" disabled={busy || otp.length < MIN_OTP_LENGTH || otp.length > MAX_OTP_LENGTH}>{busy ? 'Verifyingâ€¦' : 'Open Commission Checker'}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void sendOtp()}>
              Send a new code
            </button>
          </form>
        )}

        <div className="session-note">This device will remain signed in for 7 days.</div>
      </section>

      <style jsx>{`
        .login-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at top, #e8f0ff 0, #f5f7fb 42%, #eef2f7 100%); color: #0f172a; }
        .login-card { width: min(100%, 460px); border: 1px solid #dbe4f0; border-radius: 28px; padding: 30px; background: rgba(255,255,255,.96); box-shadow: 0 28px 70px rgba(15,23,42,.14); }
        .brand-mark { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 17px; background: #16366d; color: #fff; font-weight: 900; letter-spacing: -.5px; margin-bottom: 22px; }
        .eyebrow { color: #2563eb; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        h1 { margin: 8px 0 10px; font-size: clamp(30px, 8vw, 42px); line-height: 1.02; letter-spacing: -.04em; }
        .intro { color: #64748b; font-size: 15px; line-height: 1.6; margin: 0 0 22px; }
        .form { display: grid; gap: 11px; }
        label { font-size: 13px; font-weight: 850; color: #334155; }
        input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 15px; background: #fff; color: #0f172a; padding: 14px 15px; font-size: 16px; outline: none; }
        input:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.12); }
        .otp-input { text-align: center; font-size: clamp(22px, 7vw, 28px); font-weight: 900; letter-spacing: .2em; padding-left: calc(15px + .2em); }
        button { border: 0; border-radius: 15px; padding: 14px 16px; background: #16366d; color: #fff; font-size: 15px; font-weight: 850; cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: .55; }
        button.secondary { border: 1px solid #cbd5e1; background: #fff; color: #16366d; }
        .email-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid #e2e8f0; border-radius: 14px; padding: 10px 12px; color: #475569; font-size: 13px; font-weight: 750; word-break: break-all; }
        .text-button { padding: 4px; background: transparent; color: #2563eb; font-size: 13px; }
        .alert { border-radius: 14px; padding: 11px 13px; margin: 0 0 16px; font-size: 13px; line-height: 1.5; font-weight: 750; }
        .error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
        .success { border: 1px solid #bbf7d0; background: #ecfdf5; color: #166534; }
        .session-note { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 12px; font-weight: 750; }
        @media (max-width: 520px) { .login-page { padding: 12px; align-items: stretch; } .login-card { margin: auto 0; padding: 22px 18px; border-radius: 23px; } }
      `}</style>
    </main>
  );
}

