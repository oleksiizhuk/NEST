import { UnauthorizedException } from '@nestjs/common';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { AnthropicProjectManagerService } from '@infrastructure/anthropic/anthropic-project-manager.service';

const ctx = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as any);
const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);

describe('CronSecretGuard', () => {
  it('opens only for the exact bearer secret', () => {
    const guard = new CronSecretGuard(env({ CRON_SECRET: 'abc' }));
    expect(guard.canActivate(ctx('Bearer abc'))).toBe(true);
    expect(() => guard.canActivate(ctx('Bearer abd'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('stays closed when no secret is configured', () => {
    expect(() =>
      new CronSecretGuard(env({})).canActivate(ctx('Bearer ')),
    ).toThrow(UnauthorizedException);
  });
});

describe('AnthropicProjectManagerService request', () => {
  it('uses Opus 5.5 with adaptive thinking, explicit effort and a cached snapshot block', () => {
    const service = new AnthropicProjectManagerService(
      env({ ANTHROPIC_KEY: 'k' }),
    );
    const params = service.buildParams(
      {
        brief: 'Team brief',
        snapshot: '<snapshot generated_at="x">…</snapshot>',
        history: [{ userText: 'A: q1', botResponse: 'a1' }],
        question: 'Today is Wednesday 2026-09-23.\n\nA: q2',
      },
      'high',
      12000,
    );

    expect(params.model).toBe('claude-opus-5-5');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'high' });
    expect(params).not.toHaveProperty('tool_choice');
    const system = params.system as any[];
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(system[1].text).toContain('<brief>\nTeam brief\n</brief>');
    // The date lives in the last user turn so the cached prefix survives the day change
    expect(system.map((b) => b.text).join('')).not.toContain('2026-09-23');
    expect(params.messages).toEqual([
      { role: 'user', content: 'A: q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'Today is Wednesday 2026-09-23.\n\nA: q2' },
    ]);
  });
});
