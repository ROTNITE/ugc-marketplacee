export type ModerationTargetType = "campaign" | "profile" | "chat_message";
export type ModerationReportStatus = "open" | "reviewed" | "dismissed" | "actioned";

export type ModerationReport = {
  id: string;
  reporterUserId: string;
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  details: string;
  status: ModerationReportStatus;
  resolvedByUserId: string | null;
  adminNote: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ModerationAction = {
  id: string;
  adminUserId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reportId: string | null;
  note: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};
