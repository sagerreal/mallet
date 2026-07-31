import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      {/* Brand panel — hidden on mobile */}
      <div className="auth-brand">
        <div className="auth-brand-logo">Elas</div>
        <div className="auth-brand-body">
          <p className="auth-brand-tag">
            The field service OS for trades businesses.
          </p>
          <ul className="auth-brand-list">
            <li>Capture leads from calls, texts, and web</li>
            <li>Quote, dispatch, and invoice in one place</li>
            <li>AI front desk answers after hours</li>
          </ul>
        </div>
        <div className="auth-brand-foot">
          trymallet.com
        </div>
      </div>

      {/* Form panel */}
      <div className="auth-panel">
        <div className="auth-box">
          <div className="auth-mob-logo">Elas</div>
          {children}
        </div>
      </div>
    </div>
  );
}
