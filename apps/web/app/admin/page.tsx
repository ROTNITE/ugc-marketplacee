"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, StatusPill } from "../ui";

type Tab = "users" | "campaigns" | "reports" | "actions";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: "active" | "banned";
};

type AdminCampaign = {
  id: string;
  title: string;
  status: string;
  moderationReason: string | null;
};

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  adminNote: string;
};

type Action = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  note: string;
  createdAt: string;
};

export default function AdminPage() {
  const auth = useAuth();
  const { formatDate, t } = useI18n();
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    if (!auth.accessToken || auth.user?.role !== "admin") {
      return;
    }

    setStatus(null);

    try {
      const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";

      if (tab === "users") {
        const payload = await apiRequest<{ users: AdminUser[] }>(
          `/admin/users${params}`,
          { method: "GET" },
          auth.accessToken
        );
        setUsers(payload.users);
      }
      if (tab === "campaigns") {
        const payload = await apiRequest<{ campaigns: AdminCampaign[] }>(
          `/admin/campaigns${params}`,
          { method: "GET" },
          auth.accessToken
        );
        setCampaigns(payload.campaigns);
      }
      if (tab === "reports") {
        const payload = await apiRequest<{ reports: Report[] }>(
          "/admin/reports",
          { method: "GET" },
          auth.accessToken
        );
        setReports(payload.reports);
      }
      if (tab === "actions") {
        const payload = await apiRequest<{ actions: Action[] }>(
          "/admin/actions",
          { method: "GET" },
          auth.accessToken
        );
        setActions(payload.actions);
      }
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "LOAD_FAILED");
    }
  }, [auth.accessToken, auth.user?.role, query, tab]);

  useEffect(() => {
    if (!auth.loading) {
      void Promise.resolve().then(() => loadAdmin());
    }
  }, [auth.loading, loadAdmin]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadAdmin();
  }

  async function setUserStatus(userId: string, nextStatus: "ban" | "unban") {
    if (!auth.accessToken) {
      return;
    }

    await apiRequest(
      `/admin/users/${userId}/${nextStatus}`,
      { body: JSON.stringify({}), method: "POST" },
      auth.accessToken
    );
    await loadAdmin();
  }

  async function setCampaignStatus(campaignId: string, nextStatus: string) {
    if (!auth.accessToken) {
      return;
    }

    await apiRequest(
      `/admin/campaigns/${campaignId}`,
      {
        body: JSON.stringify({
          status: nextStatus,
          moderationReason: nextStatus === "rejected" ? "Manual moderation" : ""
        }),
        method: "PATCH"
      },
      auth.accessToken
    );
    await loadAdmin();
  }

  async function resolveReport(reportId: string, nextStatus: string) {
    if (!auth.accessToken) {
      return;
    }

    await apiRequest(
      `/admin/reports/${reportId}/resolve`,
      {
        body: JSON.stringify({ status: nextStatus, adminNote: "Reviewed in admin" }),
        method: "POST"
      },
      auth.accessToken
    );
    await loadAdmin();
  }

  if (auth.loading) {
    return <main className="auth-shell">{t("admin.loading")}</main>;
  }

  if (!auth.user || auth.user.role !== "admin") {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("admin.forbidden")}
        message={t("admin.required")}
      />
    );
  }

  return (
    <main className="feed-shell admin-shell">
      <header className="feed-header">
        <div>
          <p className="eyebrow">{t("nav.admin")}</p>
          <h1>{t("admin.moderation")}</h1>
        </div>
        <Link href="/">{t("nav.home")}</Link>
      </header>
      <div className="role-toggle">
        {(["users", "campaigns", "reports", "actions"] as const).map((item) => (
          <button
            aria-pressed={tab === item}
            key={item}
            onClick={() => setTab(item)}
            type="button"
          >
            {t(`admin.${item}`)}
          </button>
        ))}
      </div>
      <form className="filter-bar" onSubmit={search}>
        <input
          disabled={tab === "reports" || tab === "actions"}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin.search")}
          value={query}
        />
        <button type="submit">{t("admin.refresh")}</button>
      </form>
      {status ? <p className="error">{status}</p> : null}
      {tab === "users" ? (
        <section className="feed-list">
          {users.map((user) => (
            <article className="role-card" key={user.id}>
              <strong>{user.email}</strong>
              <span>
                {t(`role.${user.role}`)} · {t(`status.${user.status}`)}
              </span>
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() =>
                    setUserStatus(user.id, user.status === "banned" ? "unban" : "ban")
                  }
                  type="button"
                >
                  {user.status === "banned" ? t("admin.unban") : t("admin.ban")}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "campaigns" ? (
        <section className="feed-list">
          {campaigns.map((campaign) => (
            <article className="role-card" key={campaign.id}>
              <strong>{campaign.title}</strong>
              <StatusPill>{t(`status.${campaign.status}`)}</StatusPill>
              <span>{campaign.moderationReason ?? t("admin.noModerationNote")}</span>
              <div className="actions">
                {["active", "paused", "rejected", "archived"].map((nextStatus) => (
                  <button
                    className="secondary"
                    key={nextStatus}
                    onClick={() => setCampaignStatus(campaign.id, nextStatus)}
                    type="button"
                  >
                    {t(`status.${nextStatus}`)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "reports" ? (
        <section className="feed-list">
          {reports.map((report) => (
            <article className="role-card" key={report.id}>
              <strong>{report.reason}</strong>
              <span>
                {report.targetType} · {t(`status.${report.status}`)}
              </span>
              <span>{report.targetId}</span>
              <div className="actions">
                {["reviewed", "dismissed", "actioned"].map((nextStatus) => (
                  <button
                    className="secondary"
                    key={nextStatus}
                    onClick={() => resolveReport(report.id, nextStatus)}
                    type="button"
                  >
                    {t(`status.${nextStatus}`)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {tab === "actions" ? (
        <section className="feed-list">
          {actions.map((action) => (
            <article className="role-card" key={action.id}>
              <strong>{action.actionType}</strong>
              <span>
                {action.targetType} · {action.targetId}
              </span>
              <span>{action.note || t("admin.noNote")}</span>
              <span>{formatDate(action.createdAt)}</span>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
