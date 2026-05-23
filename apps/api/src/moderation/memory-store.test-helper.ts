import type { ModerationStore } from "./store.js";
import type {
  ModerationAction,
  ModerationReport,
  ModerationReportStatus,
  ModerationTargetType
} from "./types.js";

export class MemoryModerationStore implements ModerationStore {
  readonly reports = new Map<string, ModerationReport>();
  readonly actions = new Map<string, ModerationAction>();

  async createReport(input: {
    id: string;
    reporterUserId: string;
    targetType: ModerationTargetType;
    targetId: string;
    reason: string;
    details: string;
  }): Promise<ModerationReport> {
    const now = new Date();
    const report = {
      ...input,
      status: "open" as const,
      resolvedByUserId: null,
      adminNote: "",
      createdAt: now,
      updatedAt: now
    };
    this.reports.set(report.id, report);
    return report;
  }

  async listReports(input: {
    status: ModerationReportStatus | null;
    targetType: ModerationTargetType | null;
    limit: number;
    offset: number;
  }): Promise<ModerationReport[]> {
    return [...this.reports.values()]
      .filter((report) => {
        if (input.status && report.status !== input.status) {
          return false;
        }
        if (input.targetType && report.targetType !== input.targetType) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async getReport(id: string): Promise<ModerationReport | null> {
    return this.reports.get(id) ?? null;
  }

  async updateReport(input: {
    id: string;
    status: ModerationReportStatus;
    resolvedByUserId: string;
    adminNote: string;
  }): Promise<ModerationReport> {
    const report = this.reports.get(input.id);

    if (!report) {
      throw new Error("Missing report");
    }

    const next = {
      ...report,
      status: input.status,
      resolvedByUserId: input.resolvedByUserId,
      adminNote: input.adminNote,
      updatedAt: new Date()
    };
    this.reports.set(input.id, next);
    return next;
  }

  async createAction(input: {
    id: string;
    adminUserId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    reportId?: string | null;
    note?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModerationAction> {
    const action = {
      id: input.id,
      adminUserId: input.adminUserId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      reportId: input.reportId ?? null,
      note: input.note ?? "",
      metadata: input.metadata ?? {},
      createdAt: new Date()
    };
    this.actions.set(action.id, action);
    return action;
  }

  async listActions(input: {
    limit: number;
    offset: number;
  }): Promise<ModerationAction[]> {
    return [...this.actions.values()]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }
}
