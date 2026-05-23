"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, MetricCard, PageHeader, PageShell } from "../ui";

type ReferralSummary = {
  code: string;
  inviteCount: number;
  rewardedCount: number;
  creditBalance: number;
};

type LedgerEntry = {
  id: string;
  type: string;
  amountCredits: number;
  createdAt: string;
};

export default function ReferralsPage() {
  const auth = useAuth();
  const { formatDate, formatNumber, t } = useI18n();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const loadReferrals = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    setStatus(null);

    try {
      const [referralsPayload, ledgerPayload] = await Promise.all([
        apiRequest<{ referrals: ReferralSummary }>(
          "/referrals/me",
          { method: "GET" },
          auth.accessToken
        ),
        apiRequest<{ entries: LedgerEntry[] }>(
          "/rewards/ledger?limit=10",
          { method: "GET" },
          auth.accessToken
        )
      ]);
      setSummary(referralsPayload.referrals);
      setEntries(ledgerPayload.entries);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "LOAD_FAILED");
    }
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.loading && auth.accessToken) {
      void Promise.resolve().then(() => loadReferrals());
    }
  }, [auth.accessToken, auth.loading, loadReferrals]);

  if (auth.loading) {
    return <main className="auth-shell">{t("referrals.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("referrals.unauthorized")}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("nav.referrals")}
        title={t("referrals.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      {status ? <p className="error">{status}</p> : null}
      <section className="wallet-grid">
        <MetricCard label={t("referrals.code")} value={summary?.code ?? "..."} />
        <MetricCard
          label={t("referrals.invites")}
          value={formatNumber(summary?.inviteCount ?? 0)}
        />
        <MetricCard
          label={t("referrals.rewarded")}
          value={formatNumber(summary?.rewardedCount ?? 0)}
        />
        <MetricCard
          label={t("referrals.credits")}
          value={formatNumber(summary?.creditBalance ?? 0)}
        />
      </section>
      <label className="role-card">
        <span>{t("referrals.shareCode")}</span>
        <input readOnly value={summary?.code ?? ""} />
      </label>
      <section className="feed-list">
        {entries.length === 0 ? <p>{t("referrals.noRewards")}</p> : null}
        {entries.map((entry) => (
          <article className="role-card" key={entry.id}>
            <strong>{entry.type}</strong>
            <span>
              {entry.amountCredits > 0 ? "+" : ""}
              {t("referrals.creditAmount", {
                credits: formatNumber(entry.amountCredits)
              })}
            </span>
            <span>{formatDate(entry.createdAt)}</span>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
