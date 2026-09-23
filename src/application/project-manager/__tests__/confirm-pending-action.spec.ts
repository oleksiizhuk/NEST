import {
  ConfirmPendingActionUseCase,
  StagingHttpError,
} from '@application/project-manager/use-cases/confirm-pending-action.use-case';

const action = {
  id: 'K7Q2A',
  kind: 'create_brand' as const,
  payload: {
    tier: 'staging',
    nameEn: 'Test Brand',
    nameAr: 'تست',
    mallId: 'm1',
    mallName: 'Galleria',
    categoryId: 'c1',
    categoryName: 'Fashion',
    floor: 'L1',
    wing: 'A',
    nearestGate: 'G1',
    open: '10:00',
    close: '22:00',
  },
  summary: 's',
  chatId: -100,
  requesterId: 7,
  status: 'executing' as const,
  expiresAt: new Date(),
  result: null,
};

describe('ConfirmPendingActionUseCase', () => {
  const actions = {
    create: jest.fn(),
    claim: jest.fn(),
    latestPending: jest.fn(),
    finish: jest.fn(),
    cancel: jest.fn(),
  };
  const staging = {
    isConfigured: () => true,
    describeTarget: () => 'staging',
    findMalls: jest.fn(),
    findCategories: jest.fn(),
    findBrands: jest.fn().mockResolvedValue([]),
    createBrand: jest.fn(),
    getBrand: jest.fn(),
    publishStores: jest.fn(),
    unpublishStores: jest.fn(),
    deleteBrand: jest.fn(),
  };
  const targets = { tiers: () => ['staging'], target: jest.fn(() => staging) };
  const useCase = new ConfirmPendingActionUseCase(actions as any, targets);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.findBrands.mockResolvedValue([]);
    actions.claim.mockResolvedValue(action);
  });

  it('refuses people who may not run actions, without touching anything', async () => {
    await expect(useCase.confirm('K7Q2A', -100, 8, false)).resolves.toMatch(
      /Нет прав/,
    );
    expect(actions.claim).not.toHaveBeenCalled();
    expect(staging.createBrand).not.toHaveBeenCalled();
  });

  it('creates the brand once the claim succeeds and records the result', async () => {
    staging.createBrand.mockResolvedValue({
      id: 'b1',
      name: 'Test Brand',
      note: 'магазин в черновике',
    });
    const reply = await useCase.confirm('k7q2a', -100, 1, true);
    expect(actions.claim).toHaveBeenCalledWith(
      'K7Q2A',
      -100,
      1,
      expect.any(Date),
    );
    expect(reply).toMatch(
      /на staging создан бренд "Test Brand" \(id b1\).*черновике/,
    );
    expect(targets.target).toHaveBeenCalledWith('staging');
    expect(actions.finish).toHaveBeenCalledWith(
      'K7Q2A',
      'done',
      expect.stringContaining('b1'),
    );
  });

  it('runs nothing when the action is gone, expired or already claimed', async () => {
    actions.claim.mockResolvedValue(null);
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toMatch(
      /не найдено, уже выполнено или истекло/,
    );
    expect(staging.createBrand).not.toHaveBeenCalled();
  });

  it('confirms the newest pending action on a bare "да"', async () => {
    actions.latestPending.mockResolvedValue(action);
    staging.createBrand.mockResolvedValue({ id: 'b1', name: 'Test Brand' });
    await useCase.confirm(null, -100, 1, true);
    expect(actions.claim).toHaveBeenCalledWith(
      'K7Q2A',
      -100,
      1,
      expect.any(Date),
    );
  });

  it('does not create a duplicate if the brand appeared meanwhile', async () => {
    staging.findBrands.mockResolvedValue([{ id: 'b0', name: 'TEST BRAND' }]);
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toMatch(
      /уже есть/,
    );
    expect(staging.createBrand).not.toHaveBeenCalled();
  });

  it('marks a 4xx as failed and a timeout as unknown, never retrying', async () => {
    staging.createBrand.mockRejectedValueOnce(
      new StagingHttpError(400, 'duplicate_brand_name'),
    );
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toMatch(
      /staging ответил 400/,
    );
    expect(actions.finish).toHaveBeenLastCalledWith(
      'K7Q2A',
      'failed',
      expect.any(String),
    );

    staging.createBrand.mockRejectedValueOnce(new Error('timed out'));
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toMatch(
      /Результат неизвестен/,
    );
    expect(actions.finish).toHaveBeenLastCalledWith(
      'K7Q2A',
      'unknown',
      expect.any(String),
    );
    expect(staging.createBrand).toHaveBeenCalledTimes(2);
  });

  it('publishes every store of the brand and reports what failed', async () => {
    actions.claim.mockResolvedValue({
      ...action,
      kind: 'publish_brand',
      payload: { tier: 'dev', brandId: 'b1', brandName: 'Test Brand' },
    });
    staging.getBrand.mockResolvedValue({
      id: 'b1',
      name: 'Test Brand',
      stores: [{ id: 's1' }, { id: 's2' }],
    });
    staging.publishStores.mockResolvedValue({
      done: ['s1'],
      failed: [{ id: 's2', missingFields: ['image'] }],
    });
    const reply = await useCase.confirm('K7Q2A', -100, 1, true);
    expect(staging.publishStores).toHaveBeenCalledWith(['s1', 's2']);
    expect(targets.target).toHaveBeenCalledWith('dev');
    expect(reply).toBe(
      'Готово на dev: у бренда "Test Brand" опубликовано магазинов: 1 из 2. Не получилось для 1: s2 (не хватает: image).',
    );
  });

  it('deletes the brand on confirmation', async () => {
    actions.claim.mockResolvedValue({
      ...action,
      kind: 'delete_brand',
      payload: { tier: 'dev', brandId: 'b1', brandName: 'Test Brand' },
    });
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toBe(
      'Готово: бренд "Test Brand" удалён на dev.',
    );
    expect(staging.deleteBrand).toHaveBeenCalledWith('b1');
  });

  it('knows whether anything waits for confirmation', async () => {
    actions.latestPending.mockResolvedValueOnce(null);
    await expect(useCase.hasPending(-100)).resolves.toBe(false);
    actions.latestPending.mockResolvedValueOnce(action);
    await expect(useCase.hasPending(-100)).resolves.toBe(true);
  });
});
