"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, MetricCard, PageHeader, PageShell, StatusPill } from "../ui";

type Badge = {
  id: string;
  badgeKey: string;
  earnedAt: string;
};

type GamificationSummary = {
  badges: Badge[];
  creditBalance: number;
  nextLevelXp: number | null;
  progress: {
    currentStreak: number;
    level: number;
    longestStreak: number;
    reputationScore: number;
    xp: number;
  };
};

const badges = [
  ["first_campaign_posted", "First campaign posted"],
  ["first_match_funded", "First match funded"],
  ["first_completed_campaign", "First completed campaign"],
  ["profile_completed", "Profile completed"],
  ["first_swipe", "First swipe"],
  ["first_match", "First match"],
  ["streak_3", "3-day streak"],
  ["streak_7", "7-day streak"],
  ["level_5", "Level 5"],
  ["level_10", "Level 10"]
] as const;

export default function AchievementsPage() {
  const auth = useAuth();
  const { formatDate, formatNumber, t } = useI18n();
  const [earned, setEarned] = useState<Badge[]>([]);
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBadges = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      const payload = await apiRequest<GamificationSummary>(
        "/gamification/me",
        { method: "GET" },
        auth.accessToken
      );
      setSummary(payload);
      setEarned(payload.badges);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LOAD_FAILED");
    }
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.loading && auth.accessToken) {
      void Promise.resolve().then(() => loadBadges());
    }
  }, [auth.accessToken, auth.loading, loadBadges]);

  if (auth.loading) {
    return <main className="auth-shell">{t("achievements.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("achievements.unauthorized")}
      />
    );
  }

  return (
    <PageShell wide>
      <PageHeader
        eyebrow={t("nav.achievements")}
        title={t("achievements.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      {summary ? (
        <>
          <section className="wallet-grid">
            <MetricCard
              label={t("gamification.level")}
              value={formatNumber(summary.progress.level)}
            />
            <MetricCard
              label={t("gamification.xp")}
              value={formatNumber(summary.progress.xp)}
            />
            <MetricCard
              label={t("gamification.streak")}
              value={formatNumber(summary.progress.currentStreak)}
            />
            <MetricCard
              label={t("gamification.reputation")}
              value={formatNumber(summary.progress.reputationScore)}
            />
          </section>
          <section className="role-card">
            <strong>{t("achievements.levelProgress")}</strong>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${summary.nextLevelXp ? Math.min(100, (summary.progress.xp / summary.nextLevelXp) * 100) : 100}%`
                }}
              />
            </div>
            <span>
              {summary.nextLevelXp
                ? t("achievements.nextLevel", {
                    xp: formatNumber(summary.nextLevelXp - summary.progress.xp)
                  })
                : t("achievements.maxLevel")}
            </span>
          </section>
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <section className="wallet-grid">
        {badges.map(([key, label]) => {
          const badge = earned.find((item) => item.badgeKey === key);

          return (
            <article className="role-card" key={key}>
              <strong>{t(`badge.${key}`) || label}</strong>
              <StatusPill>
                {badge ? t("achievements.earned") : t("status.locked")}
              </StatusPill>
              {badge ? <span>{formatDate(badge.earnedAt)}</span> : null}
            </article>
          );
        })}
      </section>
    </PageShell>
  );
}
