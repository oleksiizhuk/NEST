export function LogMethodCallAndReturn(service?: string): MethodDecorator {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      console.log(
        `=> ${
          service ? service : ''
        } Method "${propertyName}" called with args: ${JSON.stringify(args)}`,
      );

      const result = originalMethod.apply(this, args);

      console.log(
        `<= Method "${propertyName}" returned: ${JSON.stringify(result)}`,
      );

      return result;
    };

    return descriptor;
  };
}
