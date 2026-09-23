import { loadKnowledge } from '@application/project-manager/knowledge-loader';
import { PmToolbox } from '@application/project-manager/tools/pm-toolbox';

const at = new Date('2026-09-20T00:00:00Z');
const store = (docs: Array<[string, string]>) => ({
  all: jest
    .fn()
    .mockResolvedValue(
      docs.map(([key, text]) => ({ key, text, updatedAt: at })),
    ),
  upsert: jest.fn(),
  remove: jest.fn(),
});

describe('loadKnowledge', () => {
  it('keeps small docs inline and indexes the largest over budget', async () => {
    const loaded = await loadKnowledge(
      store([
        ['core:brief', 'Team: A'],
        ['map:big', `# Mobile map\n${'x'.repeat(80)}`],
        ['map:small', 'Backend map'],
        ['ref:api', '# API reference\nroutes'],
      ]) as any,
      50,
    );
    expect(loaded.brief).toBe('Team: A');
    expect(loaded.onDemand.map((d) => d.key)).toEqual(['map:big', 'ref:api']);
    expect(loaded.text).toBe(
      '<doc key="map:small" updated="2026-09-20">\nBackend map\n</doc>\n' +
        '<doc_index note="not loaded; read with read_knowledge">\n' +
        '- map:big (93 chars, updated 2026-09-20): Mobile map\n' +
        '- ref:api (22 chars, updated 2026-09-20): API reference\n' +
        '</doc_index>',
    );
  });

  it('survives a store failure with no knowledge and no brief', async () => {
    const loaded = await loadKnowledge({
      all: jest.fn().mockRejectedValue(new Error('down')),
    } as any);
    expect(loaded).toMatchObject({ text: '', brief: null, onDemand: [] });
    expect(loaded.doc('core:dod')).toBeNull();
  });

  it('lets the model read an indexed doc through read_knowledge', async () => {
    const toolbox = new PmToolbox(
      { repos: () => [], isConfigured: () => false } as any,
      { tiers: () => [], roles: () => [] } as any,
      {} as any,
      {
        knowledge: {
          keys: ['map:big'],
          read: async (key) => (key === 'map:big' ? 'the map' : null),
        },
      },
    );
    const spec = toolbox.specs().find((s) => s.name === 'read_knowledge');
    expect(spec?.input_schema.properties.key).toEqual({
      type: 'string',
      enum: ['map:big'],
    });
    const ctx = { chatId: 1, requesterId: 1, proposal: null };
    await expect(
      toolbox.run('read_knowledge', { key: 'map:big' }, ctx),
    ).resolves.toContain('the map');
    await expect(
      toolbox.run('read_knowledge', { key: 'map:none' }, ctx),
    ).rejects.toThrow('No reference doc');
  });
});
