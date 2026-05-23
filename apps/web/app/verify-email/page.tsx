"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useAuth } from "../auth-context";
import { useI18n } from "../i18n";

type VerifyState = "idle" | "success" | "failure";

export default function VerifyEmailPage() {
  const { t } = useI18n();

  return (
    <Suspense fallback={<main className="auth-shell">{t("verify.checking")}</main>}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const auth = useAuth();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<VerifyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("failure");
      setError("INVALID_TOKEN");
      return;
    }

    auth
      .verifyEmail(token)
      .then(() => setState("success"))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "VERIFY_FAILED");
        setState("failure");
      });
  }, [auth, token]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    await auth.resendVerification(email);
    setResent(true);
  }

  return (
    <main className="auth-shell">
      <section className="panel">
        <p className="eyebrow">{t("verify.eyebrow")}</p>
        {state === "idle" ? <h1>{t("verify.checking")}</h1> : null}
        {state === "success" ? (
          <>
            <h1>{t("verify.verified")}</h1>
            <p>{t("verify.canLogin")}</p>
            <Link className="button" href="/login">
              {t("nav.login")}
            </Link>
          </>
        ) : null}
        {state === "failure" ? (
          <>
            <h1>{t("verify.failed")}</h1>
            <p className="error">{error}</p>
            <form className="form compact" onSubmit={resend}>
              <label>
                {t("form.email")}
                <input
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <button type="submit">{t("verify.resend")}</button>
            </form>
            {resent ? <p>{t("verify.queued")}</p> : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
