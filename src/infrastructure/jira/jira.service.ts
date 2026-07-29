import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ICreatedTask,
  ITaskTrackerService,
} from '@application/telegram/task-tracker.service.interface';

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
        // Jira REST API v3 requires the description in ADF format
        ...(description
          ? {
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: description }],
                  },
                ],
              },
            }
          : {}),
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
}
