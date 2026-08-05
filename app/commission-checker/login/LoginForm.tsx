'use client';

import { FormEvent, useState } from 'react';

export default function CommissionCheckerLoginForm() {
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || passcode.length !== 6) return;

    try {
      setBusy(true);
      setError('');
      const response = await fetch('/api/commission-checker/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, passcode }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Unable to sign in');
      window.location.assign('/commission-checker');
    } catch (err: any) {
      setError(err?.message || 'The username or passcode is invalid or has expired');
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
          Enter the username and six-digit passcode provided by your superuser.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <form onSubmit={signIn} className="form">
          <div className="field">
            <label htmlFor="commission-email">Username</label>
            <input
              id="commission-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="branch@hotelhallmark.com"
              autoComplete="username"
              inputMode="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="commission-passcode">6-digit passcode</label>
            <input
              id="commission-passcode"
              className="passcode-input"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </div>
          <button type="submit" disabled={busy || !email.trim() || passcode.length !== 6}>
            {busy ? 'Checking access...' : 'Open Commission Checker'}
          </button>
        </form>

        <div className="validity">
          <strong>Access lasts for 7 days</strong>
          <span>When the code expires, request a new one from your superuser.</span>
        </div>
      </section>

      <style jsx>{`
        .login-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at top, #e8f0ff 0, #f5f7fb 42%, #eef2f7 100%); color: #0f172a; }
        .login-card { width: min(100%, 460px); box-sizing: border-box; border: 1px solid #dbe4f0; border-radius: 28px; padding: 30px; background: rgba(255,255,255,.97); box-shadow: 0 28px 70px rgba(15,23,42,.14); }
        .brand-mark { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 17px; background: #16366d; color: #fff; font-weight: 900; letter-spacing: -.5px; margin-bottom: 22px; }
        .eyebrow { color: #2563eb; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        h1 { margin: 8px 0 10px; font-size: clamp(30px, 8vw, 42px); line-height: 1.02; letter-spacing: -.04em; }
        .intro { color: #64748b; font-size: 15px; line-height: 1.6; margin: 0 0 22px; }
        .form { display: grid; gap: 15px; }
        .field { display: grid; gap: 7px; }
        label { font-size: 13px; font-weight: 850; color: #334155; }
        input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 15px; background: #fff; color: #0f172a; padding: 14px 15px; font-size: 16px; outline: none; }
        input:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.12); }
        .passcode-input { text-align: center; font-size: 28px; font-weight: 900; letter-spacing: .3em; padding-left: calc(15px + .3em); }
        button { border: 0; border-radius: 15px; padding: 14px 16px; background: #16366d; color: #fff; font-size: 15px; font-weight: 850; cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: .55; }
        .alert { border-radius: 14px; padding: 11px 13px; margin: 0 0 16px; font-size: 13px; line-height: 1.5; font-weight: 750; }
        .error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
        .validity { display: grid; gap: 4px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 12px; }
        .validity strong { color: #334155; font-size: 13px; }
        @media (max-width: 520px) { .login-page { padding: 12px; align-items: stretch; } .login-card { margin: auto 0; padding: 22px 18px; border-radius: 23px; } }
      `}</style>
    </main>
  );
}

