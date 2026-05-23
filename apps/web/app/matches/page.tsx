"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, PageHeader, PageShell, StatusPill } from "../ui";

type MatchSummary = {
  match: {
    id: string;
    createdAt: string;
  };
  campaign: {
    title: string;
    budgetCents?: number;
  } | null;
  creatorProfile: {
    displayName: string;
  } | null;
};

type EscrowHold = {
  id: string;
  amountCents: number;
  commissionCents: number;
  status: "held" | "released" | "refunded";
};

type Deliverable = {
  url: string;
  note: string;
  status: "submitted" | "approved" | "rejected";
};

type MatchPaymentState = {
  escrowHold: EscrowHold | null;
  deliverable: Deliverable | null;
};

export default function MatchesPage() {
  const auth = useAuth();
  const { formatDate, formatMoney, t } = useI18n();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [paymentState, setPaymentState] = useState<Record<string, MatchPaymentState>>({});
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [deliverableUrls, setDeliverableUrls] = useState<Record<string, string>>({});
  const [deliverableNotes, setDeliverableNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPaymentState = useCallback(
    async (items: MatchSummary[]) => {
      const token = auth.accessToken;

      if (!token) {
        return;
      }

      const entries = await Promise.all(
        items.map(async (summary) => {
          const [escrowPayload, deliverablePayload] = await Promise.all([
            optionalRequest<{ escrowHold: EscrowHold }>(
              `/payments/escrow/match/${summary.match.id}`,
              token
            ),
            optionalRequest<{ deliverable: Deliverable }>(
              `/deliverables/match/${summary.match.id}`,
              token
            )
          ]);

          return [
            summary.match.id,
            {
              escrowHold: escrowPayload?.escrowHold ?? null,
              deliverable: deliverablePayload?.deliverable ?? null
            }
          ] as const;
        })
      );

      setPaymentState(Object.fromEntries(entries));
    },
    [auth.accessToken]
  );

  const loadMatches = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await apiRequest<{ matches: MatchSummary[] }>(
        "/matches",
        { method: "GET" },
        auth.accessToken
      );
      setMatches(payload.matches);
      setFundAmounts((current) => ({
        ...Object.fromEntries(
          payload.matches.map((summary) => [
            summary.match.id,
            String((summary.campaign?.budgetCents ?? 50000) / 100)
          ])
        ),
        ...current
      }));
      await loadPaymentState(payload.matches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [auth.accessToken, loadPaymentState]);

  useEffect(() => {
    if (auth.accessToken) {
      void Promise.resolve().then(() => loadMatches());
    }
  }, [auth.accessToken, loadMatches]);

  async function openChat(matchId: string) {
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      const payload = await apiRequest<{
        thread: {
          thread: {
            id: string;
          };
        };
      }>(
        "/chat/threads",
        {
          body: JSON.stringify({ matchId }),
          method: "POST"
        },
        auth.accessToken
      );
      router.push(`/chat?thread=${encodeURIComponent(payload.thread.thread.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CHAT_FAILED");
    }
  }

  async function fundEscrow(event: FormEvent<HTMLFormElement>, matchId: string) {
    event.preventDefault();
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      await apiRequest(
        "/payments/escrow/fund",
        {
          body: JSON.stringify({
            matchId,
            amountCents: Math.round(Number(fundAmounts[matchId] ?? 0) * 100)
          }),
          method: "POST"
        },
        auth.accessToken
      );
      await loadPaymentState(matches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "FUND_FAILED");
    }
  }

  async function submitDeliverable(event: FormEvent<HTMLFormElement>, matchId: string) {
    event.preventDefault();
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      await apiRequest(
        "/deliverables",
        {
          body: JSON.stringify({
            matchId,
            url: deliverableUrls[matchId] ?? "",
            note: deliverableNotes[matchId] ?? ""
          }),
          method: "POST"
        },
        auth.accessToken
      );
      setDeliverableUrls((current) => ({ ...current, [matchId]: "" }));
      setDeliverableNotes((current) => ({ ...current, [matchId]: "" }));
      await loadPaymentState(matches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DELIVERABLE_FAILED");
    }
  }

  async function releaseEscrow(escrowHoldId: string) {
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      await apiRequest(
        "/payments/escrow/release",
        {
          body: JSON.stringify({ escrowHoldId }),
          method: "POST"
        },
        auth.accessToken
      );
      await loadPaymentState(matches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "RELEASE_FAILED");
    }
  }

  async function refundEscrow(escrowHoldId: string) {
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      await apiRequest(
        "/payments/escrow/refund",
        {
          body: JSON.stringify({ escrowHoldId, reason: "Sandbox refund" }),
          method: "POST"
        },
        auth.accessToken
      );
      await loadPaymentState(matches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "REFUND_FAILED");
    }
  }

  if (auth.loading || loading) {
    return <main className="auth-shell">{t("matches.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("matches.unauthorized")}
      />
    );
  }

  if (auth.user.role === "admin") {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.WRONG_ROLE")}
        message={t("matches.wrongRole")}
      />
    );
  }

  const role = auth.user.role;

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("nav.matches")}
        title={t("matches.title")}
        action={<Link href="/">{t("nav.home")}</Link>}
      />
      {matches.length === 0 ? <p>{t("matches.empty")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <section className="feed-list">
        {matches.map((summary) => (
          <article className="role-card" key={summary.match.id}>
            <strong>{summary.campaign?.title ?? t("matches.campaign")}</strong>
            <span>
              {t("matches.matchedWith", {
                name: summary.creatorProfile?.displayName ?? t("matches.creatorProfile")
              })}
            </span>
            <span>{formatDate(summary.match.createdAt)}</span>
            <button onClick={() => openChat(summary.match.id)} type="button">
              {t("matches.openChat")}
            </button>
            <MatchPaymentControls
              deliverableNote={deliverableNotes[summary.match.id] ?? ""}
              deliverableUrl={deliverableUrls[summary.match.id] ?? ""}
              fundAmount={fundAmounts[summary.match.id] ?? ""}
              matchId={summary.match.id}
              onDeliverableNoteChange={(value) =>
                setDeliverableNotes((current) => ({
                  ...current,
                  [summary.match.id]: value
                }))
              }
              onDeliverableSubmit={submitDeliverable}
              onDeliverableUrlChange={(value) =>
                setDeliverableUrls((current) => ({
                  ...current,
                  [summary.match.id]: value
                }))
              }
              onFundAmountChange={(value) =>
                setFundAmounts((current) => ({
                  ...current,
                  [summary.match.id]: value
                }))
              }
              onFundSubmit={fundEscrow}
              onRefund={refundEscrow}
              onRelease={releaseEscrow}
              role={role}
              state={paymentState[summary.match.id] ?? null}
              t={t}
              formatMoney={formatMoney}
            />
          </article>
        ))}
      </section>
    </PageShell>
  );
}

function MatchPaymentControls({
  deliverableNote,
  deliverableUrl,
  fundAmount,
  matchId,
  onDeliverableNoteChange,
  onDeliverableSubmit,
  onDeliverableUrlChange,
  onFundAmountChange,
  onFundSubmit,
  onRefund,
  onRelease,
  role,
  state,
  t,
  formatMoney
}: {
  deliverableNote: string;
  deliverableUrl: string;
  fundAmount: string;
  matchId: string;
  onDeliverableNoteChange(value: string): void;
  onDeliverableSubmit(event: FormEvent<HTMLFormElement>, matchId: string): void;
  onDeliverableUrlChange(value: string): void;
  onFundAmountChange(value: string): void;
  onFundSubmit(event: FormEvent<HTMLFormElement>, matchId: string): void;
  onRefund(escrowHoldId: string): void;
  onRelease(escrowHoldId: string): void;
  role: "creator" | "brand";
  state: MatchPaymentState | null;
  t(key: string, values?: Record<string, string | number>): string;
  formatMoney(cents: number): string;
}) {
  const escrow = state?.escrowHold ?? null;
  const deliverable = state?.deliverable ?? null;
  const canBrandReview =
    role === "brand" && escrow?.status === "held" && deliverable?.status === "submitted";

  return (
    <div className="payment-box">
      <span>
        {t("matches.escrow")}:{" "}
        {escrow ? (
          <>
            {t(`status.${escrow.status}`)} · {formatMoney(escrow.amountCents)}
          </>
        ) : (
          t("matches.none")
        )}
      </span>
      <span>
        {t("matches.deliverable")}:{" "}
        <StatusPill>
          {deliverable ? t(`status.${deliverable.status}`) : t("matches.none")}
        </StatusPill>
      </span>
      {deliverable ? (
        <a href={deliverable.url} rel="noreferrer" target="_blank">
          {t("matches.openDeliverable")}
        </a>
      ) : null}
      {role === "brand" && !escrow ? (
        <form className="inline-form" onSubmit={(event) => onFundSubmit(event, matchId)}>
          <input
            min="1"
            onChange={(event) => onFundAmountChange(event.target.value)}
            step="0.01"
            type="number"
            value={fundAmount}
          />
          <button type="submit">{t("matches.fundEscrow")}</button>
        </form>
      ) : null}
      {role === "creator" && escrow?.status === "held" ? (
        <form
          className="inline-form"
          onSubmit={(event) => onDeliverableSubmit(event, matchId)}
        >
          <input
            onChange={(event) => onDeliverableUrlChange(event.target.value)}
            placeholder="https://..."
            type="url"
            value={deliverableUrl}
          />
          <input
            onChange={(event) => onDeliverableNoteChange(event.target.value)}
            placeholder={t("matches.note")}
            value={deliverableNote}
          />
          <button type="submit">{t("matches.submitDeliverable")}</button>
        </form>
      ) : null}
      {canBrandReview ? (
        <div className="actions">
          <button onClick={() => onRelease(escrow.id)} type="button">
            {t("matches.release")}
          </button>
          <button className="secondary" onClick={() => onRefund(escrow.id)} type="button">
            {t("matches.refund")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function optionalRequest<T>(path: string, accessToken: string): Promise<T | null> {
  try {
    return await apiRequest<T>(path, { method: "GET" }, accessToken);
  } catch (caught) {
    if (caught instanceof Error && caught.message === "NOT_FOUND") {
      return null;
    }

    throw caught;
  }
}
