"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../../auth-context";
import { useI18n } from "../../i18n";
import { SwipeDeck } from "../../swipe-deck";
import { Gate, PageHeader, PageShell } from "../../ui";

type CreatorProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  socialLinks: Record<string, string>;
  niches: string[];
  languages: string[];
  regions: string[];
  platforms: string[];
  audienceSize: number | null;
  recommendationScore?: number;
  recommendationReasons?: string[];
};

type CreatorFilters = {
  niche: string;
  language: string;
  region: string;
  platform: string;
  audienceMin: string;
  audienceMax: string;
};

const emptyFilters: CreatorFilters = {
  niche: "",
  language: "",
  region: "",
  platform: "",
  audienceMin: "",
  audienceMax: ""
};

export default function BrandCreatorsPage() {
  const auth = useAuth();
  const { formatNumber, t } = useI18n();
  const [profiles, setProfiles] = useState<CreatorProfile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<CreatorFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<CreatorFilters>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!auth.accessToken || loading || endReached || auth.user?.role !== "brand") {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "5" });

      if (cursor) {
        params.set("cursor", cursor);
      }
      for (const [key, value] of Object.entries(appliedFilters)) {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      }

      const payload = await apiRequest<{
        profiles: CreatorProfile[];
        nextCursor: string | null;
      }>(`/feed/creators?${params.toString()}`, { method: "GET" }, auth.accessToken);

      setProfiles((current) => [...current, ...payload.profiles]);
      setCursor(payload.nextCursor);
      setEndReached(payload.nextCursor === null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, auth.accessToken, auth.user?.role, cursor, endReached, loading]);

  useEffect(() => {
    if (!auth.loading && auth.user?.role === "brand" && profiles.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadMore();
    }
  }, [auth.loading, auth.user?.role, profiles.length, loadMore]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
    setProfiles([]);
    setCursor(null);
    setEndReached(false);
  }

  async function act(profile: CreatorProfile, action: "like" | "dislike" | "save") {
    if (!auth.accessToken) {
      return;
    }

    setError(null);
    setFeedback(null);

    try {
      const payload = await apiRequest<{ matchCreated: boolean }>(
        "/interactions",
        {
          body: JSON.stringify({
            targetType: "profile",
            targetId: profile.userId,
            action
          }),
          method: "POST"
        },
        auth.accessToken
      );

      if (action === "like" || action === "dislike") {
        setProfiles((current) =>
          current.filter((item) => item.userId !== profile.userId)
        );
      }
      setFeedback(
        payload.matchCreated
          ? t("feedback.matchCreated")
          : action === "save"
            ? t("feedback.saved")
            : action === "like"
              ? t("feedback.liked")
              : t("feedback.skipped")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ACTION_FAILED");
    }
  }

  async function reportProfile(profile: CreatorProfile) {
    if (!auth.accessToken) {
      return;
    }

    setError(null);
    setFeedback(null);

    try {
      await apiRequest(
        "/moderation/reports",
        {
          body: JSON.stringify({
            targetType: "profile",
            targetId: profile.userId,
            reason: "Profile report"
          }),
          method: "POST"
        },
        auth.accessToken
      );
      setFeedback(t("feedback.reportSubmitted"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "REPORT_FAILED");
    }
  }

  if (auth.loading) {
    return <main className="auth-shell">{t("creators.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("creators.unauthorized")}
      />
    );
  }

  if (auth.user.role !== "brand") {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.WRONG_ROLE")}
        message={t("creators.wrongRole")}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("nav.creatorSwipe")}
        title={t("creators.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      <form className="filter-bar" onSubmit={applyFilters}>
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, niche: event.target.value }))
          }
          placeholder={t("filter.niche")}
          value={filters.niche}
        />
        <select
          onChange={(event) =>
            setFilters((current) => ({ ...current, language: event.target.value }))
          }
          value={filters.language}
        >
          <option value="">{t("filter.language")}</option>
          <option value="ru">RU</option>
          <option value="en">EN</option>
          <option value="both">Both</option>
        </select>
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, region: event.target.value }))
          }
          placeholder={t("filter.region")}
          value={filters.region}
        />
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, platform: event.target.value }))
          }
          placeholder={t("filter.platform")}
          value={filters.platform}
        />
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, audienceMin: event.target.value }))
          }
          placeholder={t("filter.minAudience")}
          type="number"
          value={filters.audienceMin}
        />
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, audienceMax: event.target.value }))
          }
          placeholder={t("filter.maxAudience")}
          type="number"
          value={filters.audienceMax}
        />
        <button type="submit">{t("filter.apply")}</button>
      </form>
      <section className="feed-list">
        <SwipeDeck
          empty={profiles.length === 0 && !loading ? <p>{t("creators.empty")}</p> : null}
          item={profiles[0] ?? null}
          onSwipe={(action) => {
            const profile = profiles[0];
            if (profile) {
              void act(profile, action);
            }
          }}
        >
          {(profile) => (
            <>
              <div className="profile-preview">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={profile.avatarUrl} />
                ) : (
                  <span>{profile.displayName.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="feed-card-body">
                <p className="eyebrow">{t("profile.creator")}</p>
                <h2>{profile.displayName}</h2>
                <p>{profile.bio || t("profile.noBio")}</p>
                <span>{profile.niches?.join(", ") || t("profile.noNiches")}</span>
                <span>
                  {profile.platforms?.join(", ") || t("profile.noPlatforms")} ·{" "}
                  {formatNumber(profile.audienceSize ?? 0)}
                </span>
                <div className="swipe-actions">
                  <button onClick={() => act(profile, "like")} type="button">
                    {t("action.like")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => act(profile, "dislike")}
                    type="button"
                  >
                    {t("action.skip")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => act(profile, "save")}
                    type="button"
                  >
                    {t("action.save")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => reportProfile(profile)}
                    type="button"
                  >
                    {t("action.report")}
                  </button>
                </div>
              </div>
            </>
          )}
        </SwipeDeck>
      </section>
      {feedback ? <p>{feedback}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p>{t("creators.loadingMore")}</p> : null}
      {!endReached && profiles.length > 0 ? (
        <button className="secondary" onClick={() => loadMore()} type="button">
          {t("action.loadMore")}
        </button>
      ) : null}
      {endReached && profiles.length > 0 ? <p>{t("creators.end")}</p> : null}
    </PageShell>
  );
}
