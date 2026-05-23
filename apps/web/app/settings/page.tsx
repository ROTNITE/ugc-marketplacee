"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "../auth-context";
import { useI18n } from "../i18n";

export default function SettingsPage() {
  const auth = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  async function switchRole(role: "creator" | "brand") {
    setError(null);

    try {
      await auth.switchRole(role);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ROLE_SWITCH_FAILED");
    }
  }

  if (auth.loading) {
    return <main className="auth-shell">{t("home.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <main className="auth-shell">
        <section className="panel">
          <h1>{t("settings.expired")}</h1>
          <p>{t("settings.loginAgain")}</p>
          <Link className="button" href="/login">
            {t("nav.login")}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="panel">
        <p className="eyebrow">{t("settings.title")}</p>
        <h1>{auth.user.email}</h1>
        <p>{t("settings.currentRole", { role: t(`role.${auth.user.role}`) })}</p>
        <div className="role-toggle" aria-label={t("settings.roleSelector")}>
          <button
            aria-pressed={auth.user.role === "creator"}
            onClick={() => switchRole("creator")}
            type="button"
          >
            {t("role.creator")}
          </button>
          <button
            aria-pressed={auth.user.role === "brand"}
            onClick={() => switchRole("brand")}
            type="button"
          >
            {t("role.brand")}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <Link href="/">{t("nav.backHome")}</Link>
      </section>
    </main>
  );
}
