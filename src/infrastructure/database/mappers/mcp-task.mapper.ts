import { DEFAULT_TASK_OWNER, McpTask } from '@domain/mcp-task/mcp-task.entity';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';

type McpTaskRow = Pick<
  McpTaskDocument,
  | 'taskId'
  | 'owner'
  | 'goal'
  | 'checklist'
  | 'status'
  | 'rounds'
  | 'history'
  | 'createdAt'
  | 'updatedAt'
  | 'inFlightSince'
  | 'failures'
>;

export class McpTaskMapper {
  static toDomain(doc: McpTaskRow): McpTask {
    return new McpTask(
      doc.taskId,
      doc.owner ?? DEFAULT_TASK_OWNER,
      doc.goal,
      [...(doc.checklist ?? [])],
      doc.status,
      doc.rounds ?? 0,
      (doc.history ?? []).map((e) => ({
        at: new Date(e.at),
        kind: e.kind,
        // Left out by the stats query, which reads kinds only
        note: e.note ?? '',
        ...(e.outcome ? { outcome: e.outcome } : {}),
      })),
      new Date(doc.createdAt),
      new Date(doc.updatedAt),
      doc.inFlightSince ? new Date(doc.inFlightSince) : null,
      doc.failures ?? 0,
    );
  }
}
