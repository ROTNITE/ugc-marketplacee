import { randomUUID } from "node:crypto";
import { AuthError, authErrors } from "../auth/errors.js";
import type { AccessTokenClaims } from "../auth/security.js";
import type { AuthStore } from "../auth/store.js";
import type { MarketplaceStore, UpdateCampaignInput } from "../marketplace/store.js";
import type { ChatStore } from "../chat/store.js";
import type {
  ModerationAction,
  ModerationReport,
  ModerationReportStatus,
  ModerationTargetType
} from "./types.js";
import type { ModerationStore } from "./store.js";

export class ModerationService {
  constructor(
    private readonly store: ModerationStore,
    private readonly authStore: AuthStore,
    private readonly marketplaceStore: MarketplaceStore,
    private readonly chatStore?: ChatStore
  ) {}

  async createReport(
    auth: AccessTokenClaims,
    body: unknown
  ): Promise<{ report: ModerationReport }> {
    const input = parseReportInput(body);

    await this.validateReportTarget(auth, input.targetType, input.targetId);

    return {
      report: await this.store.createReport({
        id: randomUUID(),
        reporterUserId: auth.sub,
        ...input
      })
    };
  }

  async listReports(
    auth: AccessTokenClaims,
    query: { [key: string]: unknown }
  ): Promise<{ reports: ModerationReport[] }> {
    requireAdmin(auth);
    return {
      reports: await this.store.listReports({
        status: parseOptionalReportStatus(query.status),
        targetType: parseOptionalTargetType(query.targetType),
        limit: parseInteger(query.limit, 50, 1, 100),
        offset: parseInteger(query.offset, 0, 0, 10000)
      })
    };
  }

  async resolveReport(
    auth: AccessTokenClaims,
    reportId: string,
    body: unknown
  ): Promise<{ report: ModerationReport; action: ModerationAction }> {
    requireAdmin(auth);
    const input = parseResolveInput(body);
    const report = await this.store.getReport(reportId);

    if (!report) {
      throw moderationErrors.notFound();
    }

    const updated = await this.store.updateReport({
      id: report.id,
      status: input.status,
      resolvedByUserId: auth.sub,
      adminNote: input.adminNote
    });
    const action = await this.store.createAction({
      id: randomUUID(),
      adminUserId: auth.sub,
      actionType: `report_${input.status}`,
      targetType: report.targetType,
      targetId: report.targetId,
      reportId: report.id,
      note: input.adminNote
    });

    return { report: updated, action };
  }

  async listUsers(
    auth: AccessTokenClaims,
    query: { [key: string]: unknown }
  ): Promise<{ users: unknown[] }> {
    requireAdmin(auth);
    const users = await this.authStore.listUsers({
      query: parseOptionalString(query.query, 120),
      status: parseOptionalUserStatus(query.status),
      limit: parseInteger(query.limit, 50, 1, 100),
      offset: parseInteger(query.offset, 0, 0, 10000)
    });

    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    };
  }

  async setUserStatus(
    auth: AccessTokenClaims,
    userId: string,
    status: "active" | "banned"
  ): Promise<{ user: unknown; action: ModerationAction }> {
    requireAdmin(auth);

    if (userId === auth.sub && status === "banned") {
      throw new AuthError("FORBIDDEN", "Admins cannot ban themselves.", 403);
    }

    const user = await this.authStore.updateUserStatus(userId, status);
    const action = await this.store.createAction({
      id: randomUUID(),
      adminUserId: auth.sub,
      actionType: status === "banned" ? "user_ban" : "user_unban",
      targetType: "user",
      targetId: userId,
      note: status
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      action
    };
  }

  async listCampaigns(
    auth: AccessTokenClaims,
    query: { [key: string]: unknown }
  ): Promise<{ campaigns: unknown[] }> {
    requireAdmin(auth);

    return {
      campaigns: await this.marketplaceStore.listCampaignsForAdmin({
        query: parseOptionalString(query.query, 120),
        status: parseOptionalCampaignStatus(query.status),
        limit: parseInteger(query.limit, 50, 1, 100),
        offset: parseInteger(query.offset, 0, 0, 10000)
      })
    };
  }

  async updateCampaign(
    auth: AccessTokenClaims,
    campaignId: string,
    body: unknown
  ): Promise<{ campaign: unknown; action: ModerationAction }> {
    requireAdmin(auth);
    const input = parseAdminCampaignInput(body);
    const campaign = await this.marketplaceStore.updateCampaign(campaignId, input);
    const action = await this.store.createAction({
      id: randomUUID(),
      adminUserId: auth.sub,
      actionType: "campaign_update",
      targetType: "campaign",
      targetId: campaignId,
      note: input.moderationReason ?? "",
      metadata: input
    });

    return { campaign, action };
  }

  async listActions(
    auth: AccessTokenClaims,
    query: { [key: string]: unknown }
  ): Promise<{ actions: ModerationAction[] }> {
    requireAdmin(auth);
    return {
      actions: await this.store.listActions({
        limit: parseInteger(query.limit, 50, 1, 100),
        offset: parseInteger(query.offset, 0, 0, 10000)
      })
    };
  }

  private async validateReportTarget(
    auth: AccessTokenClaims,
    targetType: ModerationTargetType,
    targetId: string
  ): Promise<void> {
    if (targetType === "campaign") {
      const campaign = await this.marketplaceStore.getCampaignById(targetId);

      if (!campaign) {
        throw moderationErrors.notFound();
      }

      return;
    }

    if (targetType === "profile") {
      const profile = await this.marketplaceStore.getProfile(targetId);

      if (!profile) {
        throw moderationErrors.notFound();
      }

      return;
    }

    if (targetType === "chat_message") {
      if (!this.chatStore) {
        throw moderationErrors.notFound();
      }

      const message = await this.chatStore.getMessageById(targetId);

      if (!message) {
        throw moderationErrors.notFound();
      }

      const thread = await this.chatStore.getThreadById(message.threadId);

      if (
        !thread ||
        (thread.creatorUserId !== auth.sub && thread.brandUserId !== auth.sub)
      ) {
        throw moderationErrors.notFound();
      }
    }
  }
}

export const moderationErrors = {
  forbidden: () => new AuthError("FORBIDDEN", "This action is not allowed.", 403),
  invalidPayload: () => authErrors.invalidPayload(),
  notFound: () => new AuthError("NOT_FOUND", "Resource was not found.", 404),
  wrongRole: () =>
    new AuthError("WRONG_ROLE", "This role cannot perform this action.", 403)
};

function requireAdmin(auth: AccessTokenClaims): void {
  if (auth.role !== "admin") {
    throw moderationErrors.wrongRole();
  }
}

function parseReportInput(body: unknown): {
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  details: string;
} {
  if (!isRecord(body)) {
    throw moderationErrors.invalidPayload();
  }

  return {
    targetType: parseTargetType(body.targetType),
    targetId: parseUuidish(body.targetId),
    reason: parseRequiredString(body.reason, 120),
    details: parseOptionalString(body.details, 1000) ?? ""
  };
}

function parseResolveInput(body: unknown): {
  status: ModerationReportStatus;
  adminNote: string;
} {
  if (!isRecord(body)) {
    throw moderationErrors.invalidPayload();
  }

  const status = parseReportStatus(body.status);

  if (status === "open") {
    throw moderationErrors.invalidPayload();
  }

  return {
    status,
    adminNote: parseOptionalString(body.adminNote, 1000) ?? ""
  };
}

function parseAdminCampaignInput(body: unknown): UpdateCampaignInput {
  if (!isRecord(body)) {
    throw moderationErrors.invalidPayload();
  }

  const input: UpdateCampaignInput = {};

  if (body.status !== undefined) {
    input.status = parseCampaignStatus(body.status);
  }
  if (body.moderationReason !== undefined) {
    input.moderationReason = parseOptionalString(body.moderationReason, 1000) ?? "";
  }

  if (Object.keys(input).length === 0) {
    throw moderationErrors.invalidPayload();
  }

  return input;
}

function parseTargetType(value: unknown): ModerationTargetType {
  if (value === "campaign" || value === "profile" || value === "chat_message") {
    return value;
  }

  throw moderationErrors.invalidPayload();
}

function parseOptionalTargetType(value: unknown): ModerationTargetType | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseTargetType(value);
}

function parseReportStatus(value: unknown): ModerationReportStatus {
  if (
    value === "open" ||
    value === "reviewed" ||
    value === "dismissed" ||
    value === "actioned"
  ) {
    return value;
  }

  throw moderationErrors.invalidPayload();
}

function parseOptionalReportStatus(value: unknown): ModerationReportStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseReportStatus(value);
}

function parseOptionalUserStatus(value: unknown): "active" | "banned" | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value === "active" || value === "banned") {
    return value;
  }

  throw moderationErrors.invalidPayload();
}

function parseCampaignStatus(value: unknown) {
  if (
    value === "draft" ||
    value === "active" ||
    value === "paused" ||
    value === "archived" ||
    value === "rejected"
  ) {
    return value;
  }

  throw moderationErrors.invalidPayload();
}

function parseOptionalCampaignStatus(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseCampaignStatus(value);
}

function parseRequiredString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    throw moderationErrors.invalidPayload();
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > maxLength) {
    throw moderationErrors.invalidPayload();
  }

  return trimmed;
}

function parseOptionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw moderationErrors.invalidPayload();
  }

  return value.trim();
}

function parseInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const number = Number(value ?? fallback);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw moderationErrors.invalidPayload();
  }

  return number;
}

function parseUuidish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw moderationErrors.invalidPayload();
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
