"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, PageHeader, PageShell } from "../ui";

type Campaign = {
  id: string;
  title: string;
  description: string;
  categories: string[];
  budgetCents: number;
};

type Profile = {
  userId: string;
  displayName: string;
  bio: string;
};

export default function FavoritesPage() {
  const auth = useAuth();
  const { formatMoney, t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.accessToken) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiRequest<{ campaigns: Campaign[]; profiles: Profile[] }>(
      "/favorites",
      { method: "GET" },
      auth.accessToken
    )
      .then((payload) => {
        setCampaigns(payload.campaigns);
        setProfiles(payload.profiles);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "LOAD_FAILED")
      )
      .finally(() => setLoading(false));
  }, [auth.accessToken]);

  if (auth.loading || loading) {
    return <main className="auth-shell">{t("favorites.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("favorites.unauthorized")}
      />
    );
  }

  const empty = campaigns.length === 0 && profiles.length === 0;

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("favorites.saved")}
        title={t("nav.favorites")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      {empty ? <p>{t("favorites.empty")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <section className="feed-list">
        {campaigns.map((campaign) => (
          <article className="role-card" key={campaign.id}>
            <strong>{campaign.title}</strong>
            <span>{campaign.description}</span>
            <span>{campaign.categories.join(", ")}</span>
            <span>{formatMoney(campaign.budgetCents)}</span>
          </article>
        ))}
        {profiles.map((profile) => (
          <article className="role-card" key={profile.userId}>
            <strong>{profile.displayName}</strong>
            <span>{profile.bio || t("profile.noBio")}</span>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
