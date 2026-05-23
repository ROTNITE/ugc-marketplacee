"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, useAuth } from "./auth-context";
import { useI18n } from "./i18n";
import { MetricCard } from "./ui";

type GamificationSummary = {
  progress: {
    currentStreak: number;
    level: number;
    reputationScore: number;
    xp: number;
  };
};

export default function Home() {
  const auth = useAuth();
  const { formatNumber, t } = useI18n();
  const [unreadCount, setUnreadCount] = useState(0);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);

  useEffect(() => {
    if (!auth.accessToken) {
      void Promise.resolve().then(() => setUnreadCount(0));
      return;
    }

    apiRequest<{ threads: Array<{ unreadCount: number }> }>(
      "/chat/threads",
      { method: "GET" },
      auth.accessToken
    )
      .then((payload) =>
        setUnreadCount(
          payload.threads.reduce((sum, thread) => sum + thread.unreadCount, 0)
        )
      )
      .catch(() => setUnreadCount(0));
    apiRequest<GamificationSummary>(
      "/gamification/me",
      { method: "GET" },
      auth.accessToken
    )
      .then(setGamification)
      .catch(() => setGamification(null));
  }, [auth.accessToken]);

  if (auth.loading) {
    return <main className="auth-shell">{t("home.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <main className="auth-shell">
        <section className="panel">
          <p className="eyebrow">UGC Marketplace</p>
          <h1>{t("home.startTitle")}</h1>
          <p>{t("home.startCopy")}</p>
          <div className="actions">
            <Link className="button" href="/signup">
              {t("nav.signup")}
            </Link>
            <Link className="button secondary" href="/login">
              {t("nav.login")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="panel">
        <p className="eyebrow">{t("home.authenticated")}</p>
        <h1>
          {auth.user.role === "creator"
            ? t("home.creatorWorkspace")
            : auth.user.role === "admin"
              ? t("home.adminWorkspace")
              : t("home.brandWorkspace")}
        </h1>
        <p>{auth.user.email}</p>
        {gamification ? (
          <div className="wallet-grid">
            <MetricCard
              label={t("gamification.level")}
              value={formatNumber(gamification.progress.level)}
            />
            <MetricCard
              label={t("gamification.xp")}
              value={formatNumber(gamification.progress.xp)}
            />
            <MetricCard
              label={t("gamification.streak")}
              value={formatNumber(gamification.progress.currentStreak)}
            />
            <MetricCard
              label={t("gamification.reputation")}
              value={formatNumber(gamification.progress.reputationScore)}
            />
          </div>
        ) : null}
        {auth.user.role === "creator" ? (
          <div className="role-card">
            <strong>{t("home.creatorActions")}</strong>
            <span>{t("home.creatorCopy")}</span>
          </div>
        ) : auth.user.role === "admin" ? (
          <div className="role-card">
            <strong>{t("home.adminActions")}</strong>
            <span>{t("home.adminCopy")}</span>
          </div>
        ) : (
          <div className="role-card">
            <strong>{t("home.brandActions")}</strong>
            <span>{t("home.brandCopy")}</span>
          </div>
        )}
        <div className="actions">
          <Link className="button" href="/profile">
            {t("nav.profile")}
          </Link>
          {auth.user.role === "admin" ? (
            <Link className="button" href="/admin">
              {t("nav.admin")}
            </Link>
          ) : auth.user.role === "creator" ? (
            <Link className="button" href="/feed">
              {t("nav.feed")}
            </Link>
          ) : (
            <>
              <Link className="button" href="/brand/campaigns">
                {t("nav.campaigns")}
              </Link>
              <Link className="button" href="/brand/creators">
                {t("nav.creatorSwipe")}
              </Link>
            </>
          )}
          <Link className="button" href="/favorites">
            {t("nav.favorites")}
          </Link>
          <Link className="button" href="/matches">
            {t("nav.matches")}
          </Link>
          <Link className="button" href="/chat">
            {t("nav.chat")}
            {unreadCount ? ` (${unreadCount})` : ""}
          </Link>
          <Link className="button" href="/wallet">
            {t("nav.wallet")}
          </Link>
          <Link className="button" href="/referrals">
            {t("nav.referrals")}
          </Link>
          <Link className="button" href="/achievements">
            {t("nav.achievements")}
          </Link>
          <Link className="button" href="/settings">
            {t("nav.settings")}
          </Link>
          <button className="secondary" onClick={() => auth.logout()} type="button">
            {t("nav.logout")}
          </button>
        </div>
      </section>
    </main>
  );
}
