"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "../auth-context";
import { useI18n } from "../i18n";

export default function LoginPage() {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await auth.login(email, password);
      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LOGIN_FAILED");
    }
  }

  return (
    <main className="auth-shell">
      <form className="panel form" onSubmit={submit}>
        <p className="eyebrow">{t("login.eyebrow")}</p>
        <h1>{t("nav.login")}</h1>
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
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error === "EMAIL_NOT_VERIFIED" ? (
          <p className="error">{t("login.verifyFirst")}</p>
        ) : null}
        {error && error !== "EMAIL_NOT_VERIFIED" ? (
          <p className="error">{error}</p>
        ) : null}
        <button type="submit">{t("nav.login")}</button>
        <Link href="/signup">{t("login.createAccount")}</Link>
      </form>
    </main>
  );
}
