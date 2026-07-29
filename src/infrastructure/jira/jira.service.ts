import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICreatedTask,
  IMovedTask,
  INewTask,
  ITaskChanges,
  ITaskTrackerService,
} from '@application/telegram/task-tracker.service.interface';

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

// Jira REST v3 wants an ADF tree, and a newline inside a text node is not
// rendered — the structure has to be built out of paragraphs and list items,
// otherwise a sectioned description arrives as one unreadable wall
const toAdf = (text: string) => {
  const content: unknown[] = [];
  let bullets: unknown[] = [];

  const flushBullets = () => {
    if (bullets.length) {
      content.push({ type: 'bulletList', content: bullets });
      bullets = [];
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      continue;
    }

    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      bullets.push({
        type: 'listItem',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: bullet[1] }] },
        ],
      });
      continue;
    }

    flushBullets();
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    });
  }
  flushBullets();

  return {
    type: 'doc',
    version: 1,
    content: content.length ? content : [{ type: 'paragraph' }],
  };
};

@Injectable()
export class JiraService implements ITaskTrackerService {
  private readonly logger = new Logger(JiraService.name);
  private readonly baseUrl: string;
  private readonly projectKey: string;
  private readonly authHeader: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (configService.get<string>('JIRA_BASE_URL') ?? '').replace(
      /\/$/,
      '',
    );
    this.projectKey = configService.get<string>('JIRA_PROJECT_KEY') ?? 'KAN';
    const email = configService.get<string>('JIRA_EMAIL') ?? '';
    const token = configService.get<string>('JIRA_API_TOKEN') ?? '';
    this.authHeader =
      'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  async createTask(task: INewTask): Promise<ICreatedTask> {
    if (!this.baseUrl) {
      throw new Error('JIRA_BASE_URL is not configured');
    }

    // Resolved by name — the numeric ids differ between Jira schemes
    const priorityId = task.priority
      ? await this.priorityId(task.priority)
      : undefined;

    const body = {
      fields: {
        project: { key: this.projectKey },
        issuetype: { name: task.type ?? 'Task' },
        summary: task.summary,
        ...(task.description ? { description: toAdf(task.description) } : {}),
        ...(priorityId ? { priority: { id: priorityId } } : {}),
      },
    };

    const response = await this.request(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as { key: string };
    return {
      key: data.key,
      url: `${this.baseUrl}/browse/${data.key}`,
    };
  }

  async updateTask(key: string, changes: ITaskChanges): Promise<ICreatedTask> {
    if (!this.baseUrl) {
      throw new Error('JIRA_BASE_URL is not configured');
    }
    if (!changes.summary && !changes.description) {
      throw new Error('Nothing to update');
    }

    const fields = {
      ...(changes.summary ? { summary: changes.summary } : {}),
      ...(changes.description
        ? { description: toAdf(changes.description) }
        : {}),
    };

    // A successful edit answers 204 with no body, so there is nothing to parse
    await this.request(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      },
    );

    return { key, url: `${this.baseUrl}/browse/${key}` };
  }

  // Jira moves issues by transition id, and the ids differ per project and per
  // current status — so the available ones have to be fetched first
  async transitionTask(key: string, status: string): Promise<IMovedTask> {
    if (!this.baseUrl) {
      throw new Error('JIRA_BASE_URL is not configured');
    }

    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(
      key,
    )}/transitions`;
    const list = await this.request(url, { method: 'GET' });
    const transitions = (
      (await list.json()) as { transitions: JiraTransition[] }
    ).transitions;

    const wanted = status.trim().toLowerCase();
    const match = transitions.find(
      (t) =>
        t.name.toLowerCase() === wanted || t.to?.name?.toLowerCase() === wanted,
    );

    if (!match) {
      const available = transitions.map((t) => t.to?.name ?? t.name).join(', ');
      throw new Error(
        `"${status}" is not available for ${key}. Available now: ${available}`,
      );
    }

    await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: match.id } }),
    });

    return {
      key,
      url: `${this.baseUrl}/browse/${key}`,
      status: match.to?.name ?? match.name,
    };
  }

  // Priority ids are per-instance: KAN uses Blocker 1 / High 2 / Normal 3 /
  // Low 4, a default Jira scheme uses Highest..Lowest. Resolving by name
  // survives both, and an unknown name simply leaves the field to Jira.
  private priorities: Map<string, string> | null = null;

  private async priorityId(name: string): Promise<string | undefined> {
    try {
      if (!this.priorities) {
        const response = await this.request(
          `${this.baseUrl}/rest/api/3/priority`,
          { method: 'GET' },
        );
        const list = (await response.json()) as { id: string; name: string }[];
        this.priorities = new Map(
          list.map((p) => [p.name.toLowerCase(), p.id]),
        );
      }
      return this.priorities.get(name.toLowerCase());
    } catch (error) {
      this.logger.warn(`Could not resolve priority "${name}": ${error}`);
      return undefined;
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(`Jira ${response.status}: ${errorText}`);
      throw new Error(`Jira responded with ${response.status}`);
    }
    return response;
  }
}
