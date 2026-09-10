export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export const brandString = <Name extends string>(value: string): Brand<string, Name> => value as Brand<string, Name>;
export const brandNumber = <Name extends string>(value: number): Brand<number, Name> => value as Brand<number, Name>;
