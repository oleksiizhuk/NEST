import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICreatedTask,
  IMovedTask,
  ITaskChanges,
  ITaskTrackerService,
} from '@application/telegram/task-tracker.service.interface';

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

// Jira REST API v3 wants rich text as an Atlassian Document Format tree
const toAdf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

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

  async createTask(
    summary: string,
    description?: string,
  ): Promise<ICreatedTask> {
    if (!this.baseUrl) {
      throw new Error('JIRA_BASE_URL is not configured');
    }

    const body = {
      fields: {
        project: { key: this.projectKey },
        issuetype: { name: 'Task' },
        summary,
        ...(description ? { description: toAdf(description) } : {}),
      },
    };

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(`Jira ${response.status}: ${errorText}`);
      throw new Error(`Jira responded with ${response.status}`);
    }

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

    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ fields }),
      },
    );

    // A successful edit answers 204 with no body, so there is nothing to parse
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(`Jira ${response.status}: ${errorText}`);
      throw new Error(`Jira responded with ${response.status}`);
    }

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
