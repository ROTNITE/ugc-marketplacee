"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { SwipeDeck } from "../swipe-deck";
import { Gate, PageHeader, PageShell } from "../ui";

type Campaign = {
  id: string;
  title: string;
  description: string;
  categories: string[];
  budgetCents: number;
  deadline: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  language: "ru" | "en" | "both";
  contentFormat: "short_video" | "long_video" | "review" | "demo";
  targetRegions: string[];
  targetPlatforms: string[];
  targetInterests: string[];
  recommendationScore?: number;
  recommendationReasons?: string[];
};

type FeedFilters = {
  category: string;
  budgetMin: string;
  budgetMax: string;
  language: string;
  format: string;
  region: string;
  platform: string;
};

const emptyFilters: FeedFilters = {
  category: "",
  budgetMin: "",
  budgetMax: "",
  language: "",
  format: "",
  region: "",
  platform: ""
};

export default function FeedPage() {
  const auth = useAuth();
  const { formatMoney, t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<FeedFilters>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadMore = useCallback(
    async (replace = false) => {
      if (!auth.accessToken || loading || endReached || auth.user?.role !== "creator") {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ limit: "5" });
        const nextCursor = replace ? null : cursor;

        if (nextCursor) {
          params.set("cursor", nextCursor);
        }
        for (const [key, value] of Object.entries(appliedFilters)) {
          if (value.trim()) {
            params.set(key, value.trim());
          }
        }

        const payload = await apiRequest<{
          campaigns: Campaign[];
          nextCursor: string | null;
        }>(`/feed/campaigns?${params.toString()}`, { method: "GET" }, auth.accessToken);

        setCampaigns((current) =>
          replace ? payload.campaigns : [...current, ...payload.campaigns]
        );
        setCursor(payload.nextCursor);
        setEndReached(payload.nextCursor === null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "LOAD_FAILED");
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters, auth.accessToken, auth.user?.role, cursor, endReached, loading]
  );

  async function act(campaign: Campaign, action: "like" | "dislike" | "save") {
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
            targetType: "campaign",
            targetId: campaign.id,
            action
          }),
          method: "POST"
        },
        auth.accessToken
      );

      if (action === "like" || action === "dislike") {
        setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
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

  async function reportCampaign(campaign: Campaign) {
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
            targetType: "campaign",
            targetId: campaign.id,
            reason: "Campaign report"
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

  useEffect(() => {
    if (!auth.loading && auth.user?.role === "creator" && campaigns.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadMore();
    }
  }, [auth.loading, auth.user?.role, campaigns.length, loadMore]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
    setCampaigns([]);
    setCursor(null);
    setEndReached(false);
  }

  if (auth.loading) {
    return <main className="auth-shell">{t("feed.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("feed.unauthorized")}
      />
    );
  }

  if (auth.user.role !== "creator") {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.WRONG_ROLE")}
        message={t("feed.wrongRole")}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("nav.feed")}
        title={t("feed.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      <form className="filter-bar" onSubmit={applyFilters}>
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, category: event.target.value }))
          }
          placeholder={t("filter.category")}
          value={filters.category}
        />
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, budgetMin: event.target.value }))
          }
          placeholder={t("filter.minRub")}
          type="number"
          value={filters.budgetMin}
        />
        <input
          onChange={(event) =>
            setFilters((current) => ({ ...current, budgetMax: event.target.value }))
          }
          placeholder={t("filter.maxRub")}
          type="number"
          value={filters.budgetMax}
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
        <select
          onChange={(event) =>
            setFilters((current) => ({ ...current, format: event.target.value }))
          }
          value={filters.format}
        >
          <option value="">{t("filter.format")}</option>
          <option value="short_video">Short video</option>
          <option value="long_video">Long video</option>
          <option value="review">Review</option>
          <option value="demo">Demo</option>
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
        <button type="submit">{t("filter.apply")}</button>
      </form>
      <section className="feed-list">
        <SwipeDeck
          empty={campaigns.length === 0 && !loading ? <p>{t("feed.empty")}</p> : null}
          item={campaigns[0] ?? null}
          onSwipe={(action) => {
            const campaign = campaigns[0];
            if (campaign) {
              void act(campaign, action);
            }
          }}
        >
          {(campaign) => (
            <>
              <MediaPreview campaign={campaign} />
              <div className="feed-card-body">
                <p className="eyebrow">{campaign.categories.join(", ")}</p>
                <h2>{campaign.title}</h2>
                <p>{campaign.description}</p>
                <strong>{formatMoney(campaign.budgetCents)}</strong>
                <span>
                  {campaign.language} · {campaign.contentFormat}
                </span>
                <div className="swipe-actions">
                  <button
                    aria-label={`Like ${campaign.title}`}
                    onClick={() => act(campaign, "like")}
                    type="button"
                  >
                    {t("action.like")}
                  </button>
                  <button
                    aria-label={`Skip ${campaign.title}`}
                    className="secondary"
                    onClick={() => act(campaign, "dislike")}
                    type="button"
                  >
                    {t("action.skip")}
                  </button>
                  <button
                    aria-label={`Save ${campaign.title}`}
                    className="secondary"
                    onClick={() => act(campaign, "save")}
                    type="button"
                  >
                    {t("action.save")}
                  </button>
                  <button
                    aria-label={`Report ${campaign.title}`}
                    className="secondary"
                    onClick={() => reportCampaign(campaign)}
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
      {loading ? <p>{t("feed.loadingMore")}</p> : null}
      {!endReached && campaigns.length > 0 ? (
        <button className="secondary" onClick={() => loadMore()} type="button">
          {t("action.loadMore")}
        </button>
      ) : null}
      {endReached && campaigns.length > 0 ? <p>{t("feed.end")}</p> : null}
    </PageShell>
  );
}

function MediaPreview({ campaign }: { campaign: Campaign }) {
  if (campaign.mediaType === "video") {
    return (
      <video
        autoPlay
        className="feed-media"
        loop
        muted
        playsInline
        src={campaign.mediaUrl}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" className="feed-media" src={campaign.mediaUrl} />;
}
