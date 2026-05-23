"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, MetricCard, PageHeader, PageShell, StatusPill } from "../ui";

type Balance = {
  balanceCents: number;
  pendingCents: number;
  totalEarnedCents: number;
  totalWithdrawnCents: number;
};

type Transaction = {
  id: string;
  type: string;
  amountCents: number;
  currency: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type GamificationSummary = {
  creditBalance: number;
  progress: {
    currentStreak: number;
    level: number;
    reputationScore: number;
    xp: number;
  };
};

export default function WalletPage() {
  const auth = useAuth();
  const { formatDate, formatMoney, formatNumber, t } = useI18n();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadWallet = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const [balancePayload, transactionsPayload, gamificationPayload] =
        await Promise.all([
          apiRequest<{ balance: Balance }>(
            "/payments/balance",
            { method: "GET" },
            auth.accessToken
          ),
          apiRequest<{ transactions: Transaction[] }>(
            "/payments/transactions?limit=25",
            { method: "GET" },
            auth.accessToken
          ),
          apiRequest<GamificationSummary>(
            "/gamification/me",
            { method: "GET" },
            auth.accessToken
          )
        ]);
      setBalance(balancePayload.balance);
      setTransactions(transactionsPayload.transactions);
      setCreditBalance(gamificationPayload.creditBalance);
      setGamification(gamificationPayload);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.loading && auth.accessToken) {
      void Promise.resolve().then(() => loadWallet());
    }
  }, [auth.accessToken, auth.loading, loadWallet]);

  async function requestPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth.accessToken) {
      return;
    }

    setStatus(null);

    try {
      await apiRequest(
        "/payments/payout",
        {
          body: JSON.stringify({ amountCents: Math.round(Number(amount) * 100) }),
          method: "POST"
        },
        auth.accessToken
      );
      setAmount("");
      setStatus("wallet.payoutCompleted");
      await loadWallet();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "PAYOUT_FAILED");
    }
  }

  if (auth.loading || loading) {
    return <main className="auth-shell">{t("wallet.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("wallet.unauthorized")}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("nav.wallet")}
        title={t("wallet.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      <section className="wallet-grid">
        <MetricCard
          label={t("wallet.available")}
          value={formatMoney(balance?.balanceCents ?? 0)}
        />
        <MetricCard
          label={t("wallet.pending")}
          value={formatMoney(balance?.pendingCents ?? 0)}
        />
        <MetricCard
          label={t("wallet.earned")}
          value={formatMoney(balance?.totalEarnedCents ?? 0)}
        />
        <MetricCard
          label={t("wallet.withdrawn")}
          value={formatMoney(balance?.totalWithdrawnCents ?? 0)}
        />
        <MetricCard
          label={t("wallet.rewardCredits")}
          value={formatNumber(creditBalance)}
        />
        <MetricCard
          label={t("gamification.level")}
          value={formatNumber(gamification?.progress.level ?? 1)}
        />
        <MetricCard
          label={t("gamification.reputation")}
          value={formatNumber(gamification?.progress.reputationScore ?? 0)}
        />
      </section>
      {auth.user.role === "creator" ? (
        <form className="panel form compact" onSubmit={requestPayout}>
          <p className="eyebrow">{t("wallet.creatorPayout")}</p>
          <label>
            {t("wallet.amount")}
            <input
              min="1"
              onChange={(event) => setAmount(event.target.value)}
              step="0.01"
              type="number"
              value={amount}
            />
          </label>
          <button type="submit">{t("wallet.requestPayout")}</button>
        </form>
      ) : null}
      {status ? (
        <p className={status.includes("_") ? "error" : undefined}>{t(status)}</p>
      ) : null}
      <section className="feed-list">
        {transactions.length === 0 ? <p>{t("wallet.noTransactions")}</p> : null}
        {transactions.map((transaction) => (
          <article className="role-card" key={transaction.id}>
            <strong>{transaction.type}</strong>
            <span>
              {formatMoney(transaction.amountCents)} {transaction.currency}
            </span>
            <StatusPill>{t(`status.${transaction.status}`)}</StatusPill>
            {typeof transaction.metadata?.creditsApplied === "number" ? (
              <span>
                {t("wallet.creditsApplied", {
                  credits: formatNumber(transaction.metadata.creditsApplied)
                })}
              </span>
            ) : null}
            <span>{formatDate(transaction.createdAt)}</span>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
