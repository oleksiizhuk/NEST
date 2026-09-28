// Shared by the contract specs: every value that looks like a date must
// parse, and nothing may be NaN
export const assertSaneDates = (value: unknown, path = 'details'): void => {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) throw new Error(`${path} is NaN`);
    return;
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && Number.isNaN(Date.parse(value)))
      throw new Error(`${path} is not a date: ${value}`);
    if (/Invalid Date|NaN/.test(value))
      throw new Error(`${path} holds ${value}`);
    return;
  }
  if (Array.isArray(value))
    value.forEach((v, i) => assertSaneDates(v, `${path}[${i}]`));
  else if (value && typeof value === 'object')
    Object.entries(value).forEach(([k, v]) =>
      assertSaneDates(v, `${path}.${k}`),
    );
};

export const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  });

// A request the test did not expect fails loudly instead of getting []
export const unexpected = (url: string) =>
  Promise.reject(new Error(`unexpected request in contract test: ${url}`));
