import type { Pool } from "pg";
import type {
  ModerationAction,
  ModerationReport,
  ModerationReportStatus,
  ModerationTargetType
} from "./types.js";

export type ModerationStore = {
  createReport(input: {
    id: string;
    reporterUserId: string;
    targetType: ModerationTargetType;
    targetId: string;
    reason: string;
    details: string;
  }): Promise<ModerationReport>;
  listReports(input: {
    status: ModerationReportStatus | null;
    targetType: ModerationTargetType | null;
    limit: number;
    offset: number;
  }): Promise<ModerationReport[]>;
  getReport(id: string): Promise<ModerationReport | null>;
  updateReport(input: {
    id: string;
    status: ModerationReportStatus;
    resolvedByUserId: string;
    adminNote: string;
  }): Promise<ModerationReport>;
  createAction(input: {
    id: string;
    adminUserId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    reportId?: string | null;
    note?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModerationAction>;
  listActions(input: { limit: number; offset: number }): Promise<ModerationAction[]>;
};

export class PostgresModerationStore implements ModerationStore {
  constructor(private readonly pool: Pool) {}

  async createReport(input: {
    id: string;
    reporterUserId: string;
    targetType: ModerationTargetType;
    targetId: string;
    reason: string;
    details: string;
  }): Promise<ModerationReport> {
    const result = await this.pool.query<ReportRow>(
      `INSERT INTO moderation_reports (
         id, reporter_user_id, target_type, target_id, reason, details, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'open')
       RETURNING *`,
      [
        input.id,
        input.reporterUserId,
        input.targetType,
        input.targetId,
        input.reason,
        input.details
      ]
    );
    return mapReport(result.rows[0]);
  }

  async listReports(input: {
    status: ModerationReportStatus | null;
    targetType: ModerationTargetType | null;
    limit: number;
    offset: number;
  }): Promise<ModerationReport[]> {
    const result = await this.pool.query<ReportRow>(
      `SELECT * FROM moderation_reports
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR target_type = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [input.status, input.targetType, input.limit, input.offset]
    );
    return result.rows.map(mapReport);
  }

  async getReport(id: string): Promise<ModerationReport | null> {
    const result = await this.pool.query<ReportRow>(
      "SELECT * FROM moderation_reports WHERE id = $1",
      [id]
    );
    return result.rows[0] ? mapReport(result.rows[0]) : null;
  }

  async updateReport(input: {
    id: string;
    status: ModerationReportStatus;
    resolvedByUserId: string;
    adminNote: string;
  }): Promise<ModerationReport> {
    const result = await this.pool.query<ReportRow>(
      `UPDATE moderation_reports
       SET status = $2,
           resolved_by_user_id = $3,
           admin_note = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [input.id, input.status, input.resolvedByUserId, input.adminNote]
    );
    return mapReport(result.rows[0]);
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
    const result = await this.pool.query<ActionRow>(
      `INSERT INTO moderation_actions (
         id, admin_user_id, action_type, target_type, target_id, report_id, note, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.id,
        input.adminUserId,
        input.actionType,
        input.targetType,
        input.targetId,
        input.reportId ?? null,
        input.note ?? "",
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapAction(result.rows[0]);
  }

  async listActions(input: {
    limit: number;
    offset: number;
  }): Promise<ModerationAction[]> {
    const result = await this.pool.query<ActionRow>(
      `SELECT * FROM moderation_actions
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [input.limit, input.offset]
    );
    return result.rows.map(mapAction);
  }
}

type ReportRow = {
  id: string;
  reporter_user_id: string;
  target_type: ModerationTargetType;
  target_id: string;
  reason: string;
  details: string;
  status: ModerationReportStatus;
  resolved_by_user_id: string | null;
  admin_note: string;
  created_at: Date;
  updated_at: Date;
};

type ActionRow = {
  id: string;
  admin_user_id: string;
  action_type: string;
  target_type: string;
  target_id: string;
  report_id: string | null;
  note: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};

function mapReport(row: ReportRow | undefined): ModerationReport {
  if (!row) {
    throw new Error("Expected moderation report row.");
  }
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolvedByUserId: row.resolved_by_user_id,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAction(row: ActionRow | undefined): ModerationAction {
  if (!row) {
    throw new Error("Expected moderation action row.");
  }
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id,
    reportId: row.report_id,
    note: row.note,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}
