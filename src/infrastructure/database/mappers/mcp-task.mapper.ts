import { McpTask } from '@domain/mcp-task/mcp-task.entity';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';

type McpTaskRow = Pick<
  McpTaskDocument,
  | 'taskId'
  | 'goal'
  | 'checklist'
  | 'status'
  | 'rounds'
  | 'history'
  | 'createdAt'
  | 'updatedAt'
>;

export class McpTaskMapper {
  static toDomain(doc: McpTaskRow): McpTask {
    return new McpTask(
      doc.taskId,
      doc.goal,
      [...(doc.checklist ?? [])],
      doc.status,
      doc.rounds ?? 0,
      (doc.history ?? []).map((e) => ({
        at: new Date(e.at),
        kind: e.kind,
        note: e.note,
        ...(e.outcome ? { outcome: e.outcome } : {}),
      })),
      new Date(doc.createdAt),
      new Date(doc.updatedAt),
    );
  }
}
