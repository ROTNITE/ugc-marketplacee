"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../../auth-context";
import { useI18n } from "../../i18n";

type Campaign = {
  id: string;
  title: string;
  description: string;
  categories: string[];
  budgetCents: number;
  deadline: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  status: "draft" | "active" | "paused" | "archived";
  language: "ru" | "en" | "both";
  contentFormat: "short_video" | "long_video" | "review" | "demo";
  targetRegions: string[];
  targetPlatforms: string[];
  targetInterests: string[];
  targetAudienceAgeMin: number | null;
  targetAudienceAgeMax: number | null;
  minAudienceSize: number | null;
  maxAudienceSize: number | null;
};

type CampaignForm = {
  id: string | null;
  title: string;
  description: string;
  categories: string;
  budget: string;
  deadline: string;
  mediaUrl: string;
  status: Campaign["status"];
  language: Campaign["language"];
  contentFormat: Campaign["contentFormat"];
  targetRegions: string;
  targetPlatforms: string;
  targetInterests: string;
  targetAudienceAgeMin: string;
  targetAudienceAgeMax: string;
  minAudienceSize: string;
  maxAudienceSize: string;
};

const emptyForm: CampaignForm = {
  id: null,
  title: "",
  description: "",
  categories: "",
  budget: "",
  deadline: "",
  mediaUrl: "",
  status: "draft",
  language: "both",
  contentFormat: "short_video",
  targetRegions: "",
  targetPlatforms: "",
  targetInterests: "",
  targetAudienceAgeMin: "",
  targetAudienceAgeMax: "",
  minAudienceSize: "",
  maxAudienceSize: ""
};

export default function BrandCampaignsPage() {
  const auth = useAuth();
  const { t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCampaigns = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    const payload = await apiRequest<{ campaigns: Campaign[] }>(
      "/campaigns/mine",
      { method: "GET" },
      auth.accessToken
    );
    setCampaigns(payload.campaigns);
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.accessToken || auth.user?.role !== "brand") {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    loadCampaigns().finally(() => setLoading(false));
  }, [auth.accessToken, auth.user?.role, loadCampaigns]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    try {
      const body = {
        title: form.title,
        description: form.description,
        categories: form.categories.split(","),
        budget: Number(form.budget),
        deadline: new Date(form.deadline).toISOString(),
        mediaUrl: form.mediaUrl,
        status: form.status,
        language: form.language,
        contentFormat: form.contentFormat,
        targetRegions: fromCsv(form.targetRegions),
        targetPlatforms: fromCsv(form.targetPlatforms),
        targetInterests: fromCsv(form.targetInterests),
        targetAudienceAgeMin: toOptionalNumber(form.targetAudienceAgeMin),
        targetAudienceAgeMax: toOptionalNumber(form.targetAudienceAgeMax),
        minAudienceSize: toOptionalNumber(form.minAudienceSize),
        maxAudienceSize: toOptionalNumber(form.maxAudienceSize)
      };
      const path = form.id ? `/campaigns/${form.id}` : "/campaigns";
      await apiRequest(
        path,
        {
          body: JSON.stringify(body),
          method: form.id ? "PATCH" : "POST"
        },
        auth.accessToken
      );
      setForm(emptyForm);
      setStatus("campaigns.saved");
      await loadCampaigns();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "SAVE_FAILED");
    }
  }

  function edit(campaign: Campaign) {
    setForm({
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      categories: campaign.categories.join(", "),
      budget: String(campaign.budgetCents / 100),
      deadline: campaign.deadline.slice(0, 16),
      mediaUrl: campaign.mediaUrl,
      status: campaign.status,
      language: campaign.language,
      contentFormat: campaign.contentFormat,
      targetRegions: campaign.targetRegions.join(", "),
      targetPlatforms: campaign.targetPlatforms.join(", "),
      targetInterests: campaign.targetInterests.join(", "),
      targetAudienceAgeMin: String(campaign.targetAudienceAgeMin ?? ""),
      targetAudienceAgeMax: String(campaign.targetAudienceAgeMax ?? ""),
      minAudienceSize: String(campaign.minAudienceSize ?? ""),
      maxAudienceSize: String(campaign.maxAudienceSize ?? "")
    });
  }

  if (auth.loading || loading) {
    return <main className="auth-shell">{t("campaigns.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("campaigns.unauthorized")}
      />
    );
  }

  if (auth.user.role !== "brand") {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.WRONG_ROLE")}
        message={t("campaigns.wrongRole")}
      />
    );
  }

  return (
    <main className="workspace-shell">
      <section className="workspace-grid">
        <form className="panel form" onSubmit={submit}>
          <p className="eyebrow">{t("campaigns.dashboard")}</p>
          <h1>{form.id ? t("campaigns.edit") : t("campaigns.create")}</h1>
          <label>
            {t("campaigns.titleField")}
            <input
              maxLength={140}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              required
              value={form.title}
            />
          </label>
          <label>
            {t("campaigns.description")}
            <textarea
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              required
              rows={5}
              value={form.description}
            />
          </label>
          <label>
            {t("campaigns.categories")}
            <input
              onChange={(event) =>
                setForm((current) => ({ ...current, categories: event.target.value }))
              }
              placeholder="gaming, app"
              required
              value={form.categories}
            />
          </label>
          <label>
            {t("campaigns.budget")}
            <input
              min="0.01"
              onChange={(event) =>
                setForm((current) => ({ ...current, budget: event.target.value }))
              }
              required
              step="0.01"
              type="number"
              value={form.budget}
            />
          </label>
          <label>
            {t("campaigns.deadline")}
            <input
              onChange={(event) =>
                setForm((current) => ({ ...current, deadline: event.target.value }))
              }
              required
              type="datetime-local"
              value={form.deadline}
            />
          </label>
          <label>
            {t("campaigns.mediaUrl")}
            <input
              onChange={(event) =>
                setForm((current) => ({ ...current, mediaUrl: event.target.value }))
              }
              placeholder="https://example.com/brief.mp4"
              required
              type="url"
              value={form.mediaUrl}
            />
          </label>
          <label>
            {t("campaigns.status")}
            <select
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as Campaign["status"]
                }))
              }
              value={form.status}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <div className="field-row">
            <label>
              {t("filter.language")}
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    language: event.target.value as Campaign["language"]
                  }))
                }
                value={form.language}
              >
                <option value="both">Both</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </label>
            <label>
              {t("filter.format")}
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contentFormat: event.target.value as Campaign["contentFormat"]
                  }))
                }
                value={form.contentFormat}
              >
                <option value="short_video">Short video</option>
                <option value="long_video">Long video</option>
                <option value="review">Review</option>
                <option value="demo">Demo</option>
              </select>
            </label>
          </div>
          <label>
            {t("campaigns.targetRegions")}
            <input
              onChange={(event) =>
                setForm((current) => ({ ...current, targetRegions: event.target.value }))
              }
              placeholder="cis, moscow"
              value={form.targetRegions}
            />
          </label>
          <label>
            {t("campaigns.targetPlatforms")}
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  targetPlatforms: event.target.value
                }))
              }
              placeholder="tiktok, vk"
              value={form.targetPlatforms}
            />
          </label>
          <label>
            {t("campaigns.targetInterests")}
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  targetInterests: event.target.value
                }))
              }
              placeholder="gaming, apps"
              value={form.targetInterests}
            />
          </label>
          <div className="field-row">
            <label>
              {t("campaigns.targetAgeMin")}
              <input
                min="1"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetAudienceAgeMin: event.target.value
                  }))
                }
                type="number"
                value={form.targetAudienceAgeMin}
              />
            </label>
            <label>
              {t("campaigns.targetAgeMax")}
              <input
                min="1"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetAudienceAgeMax: event.target.value
                  }))
                }
                type="number"
                value={form.targetAudienceAgeMax}
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              {t("campaigns.minAudience")}
              <input
                min="0"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    minAudienceSize: event.target.value
                  }))
                }
                type="number"
                value={form.minAudienceSize}
              />
            </label>
            <label>
              {t("campaigns.maxAudience")}
              <input
                min="0"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maxAudienceSize: event.target.value
                  }))
                }
                type="number"
                value={form.maxAudienceSize}
              />
            </label>
          </div>
          {status ? (
            <p className={status === "campaigns.saved" ? undefined : "error"}>
              {t(status)}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit">
              {form.id ? t("campaigns.saveChanges") : t("campaigns.create")}
            </button>
            {form.id ? (
              <button
                className="secondary"
                onClick={() => setForm(emptyForm)}
                type="button"
              >
                {t("campaigns.cancelEdit")}
              </button>
            ) : null}
          </div>
        </form>
        <section className="panel">
          <p className="eyebrow">{t("campaigns.yours")}</p>
          <h1>{t("campaigns.list")}</h1>
          {campaigns.length === 0 ? <p>{t("campaigns.empty")}</p> : null}
          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <article className="role-card" key={campaign.id}>
                <strong>{campaign.title}</strong>
                <span>{t(`status.${campaign.status}`)}</span>
                <span>{campaign.categories.join(", ")}</span>
                <span>
                  {campaign.language} · {campaign.contentFormat}
                </span>
                <button onClick={() => edit(campaign)} type="button">
                  {t("campaigns.editButton")}
                </button>
              </article>
            ))}
          </div>
          <Link href="/">{t("nav.backHome")}</Link>
        </section>
      </section>
    </main>
  );
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function toOptionalNumber(value: string): number | null {
  return value ? Number(value) : null;
}

function Gate({
  buttonLabel = "Back home",
  message,
  title
}: {
  buttonLabel?: string;
  message: string;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="panel">
        <h1>{title}</h1>
        <p>{message}</p>
        <Link className="button" href="/">
          {buttonLabel}
        </Link>
      </section>
    </main>
  );
}
