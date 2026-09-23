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
    recent: jest.fn(),
    finish: jest.fn(),
    cancel: jest.fn(),
  };
  const staging = {
    isConfigured: () => true,
    describeTarget: () => 'staging',
    whoAmI: jest.fn(),
    findMalls: jest.fn(),
    findCategories: jest.fn(),
    findBrands: jest.fn().mockResolvedValue([]),
    createBrand: jest.fn(),
    getBrand: jest.fn(),
    publishStores: jest.fn(),
    unpublishStores: jest.fn(),
    deleteBrand: jest.fn(),
    updateStore: jest.fn(),
    createProperty: jest.fn(),
    publishProperties: jest.fn(),
    unpublishProperties: jest.fn(),
  };
  const targets = {
    tiers: () => ['staging'],
    roles: () => ['client', 'admin'],
    target: jest.fn((): typeof staging => staging),
  };
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
    expect(targets.target).toHaveBeenCalledWith('staging', 'client');
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
    expect(targets.target).toHaveBeenCalledWith('dev', 'client');
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

  it('edits the store on confirmation', async () => {
    const changes = { floor: 'L2' };
    actions.claim.mockResolvedValue({
      ...action,
      kind: 'update_store',
      payload: {
        tier: 'dev',
        brandId: 'b1',
        brandName: 'Test Brand',
        storeId: 's1',
        storeLabel: 's1 в "Galleria"',
        changes,
      },
    });
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toBe(
      'Готово на dev: магазин s1 в "Galleria" бренда "Test Brand" обновлён.',
    );
    expect(staging.updateStore).toHaveBeenCalledWith('b1', 's1', changes);
  });

  it('creates and publishes a property on confirmation', async () => {
    actions.claim.mockResolvedValueOnce({
      ...action,
      kind: 'create_property',
      payload: {
        tier: 'dev',
        type: 'mall',
        nameEn: 'QA Mall',
        nameAr: 'م',
        city: 'Riyadh',
        district: null,
        street: null,
        latitude: null,
        longitude: null,
      },
    });
    staging.createProperty.mockResolvedValue({
      id: 'p1',
      name: 'QA Mall',
      note: 'создан черновиком',
    });
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toMatch(
      /на dev создан mall "QA Mall" \(id p1\)/,
    );

    actions.claim.mockResolvedValueOnce({
      ...action,
      kind: 'publish_property',
      payload: { tier: 'dev', propertyId: 'p1', propertyName: 'QA Mall' },
    });
    staging.publishProperties.mockResolvedValue({
      done: [],
      failed: [{ id: 'p1', missingFields: ['logo'] }],
    });
    await expect(useCase.confirm('K7Q2A', -100, 1, true)).resolves.toBe(
      'Не получилось опубликовать "QA Mall" на dev: не хватает logo.',
    );
  });

  it('runs the action with the account role it was proposed for', async () => {
    actions.claim.mockResolvedValue({
      ...action,
      kind: 'delete_brand',
      payload: {
        tier: 'dev',
        role: 'admin',
        brandId: 'b1',
        brandName: 'Test Brand',
      },
    });
    await useCase.confirm('K7Q2A', -100, 1, true);
    expect(targets.target).toHaveBeenLastCalledWith('dev', 'admin');
  });
});
