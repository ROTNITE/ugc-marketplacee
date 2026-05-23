"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useAuth, type AuthUser } from "../auth-context";
import { useI18n } from "../i18n";

export default function SignupPage() {
  const auth = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"creator" | "brand">("creator");
  const [referralCode, setReferralCode] = useState("");
  const [createdUser, setCreatedUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      setCreatedUser(await auth.register(email, password, role, referralCode));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SIGNUP_FAILED");
    }
  }

  if (createdUser) {
    return (
      <main className="auth-shell">
        <section className="panel">
          <p className="eyebrow">{t("signup.pending")}</p>
          <h1>{t("signup.checkEmail")}</h1>
          <p>{t("signup.created", { email: createdUser.email })}</p>
          <Link className="button" href="/login">
            {t("signup.goLogin")}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <form className="panel form" onSubmit={submit}>
        <p className="eyebrow">{t("signup.create")}</p>
        <h1>{t("nav.signup")}</h1>
        <label>
          {t("form.email")}
          <input
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          {t("form.password")}
          <input
            autoComplete="new-password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label>
          {t("signup.referralCode")}
          <input
            onChange={(event) => setReferralCode(event.target.value)}
            placeholder={t("form.optional")}
            value={referralCode}
          />
        </label>
        <fieldset>
          <legend>{t("settings.role")}</legend>
          <label className="choice">
            <input
              checked={role === "creator"}
              onChange={() => setRole("creator")}
              type="radio"
            />
            {t("role.creator")}
          </label>
          <label className="choice">
            <input
              checked={role === "brand"}
              onChange={() => setRole("brand")}
              type="radio"
            />
            {t("role.brand")}
          </label>
        </fieldset>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">{t("signup.createAccount")}</button>
        <Link href="/login">{t("signup.already")}</Link>
      </form>
    </main>
  );
}
