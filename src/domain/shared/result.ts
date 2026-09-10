export type Ok<T> = Readonly<{ tag: "Ok"; value: T }>;
export type Err<E> = Readonly<{ tag: "Err"; error: E }>;
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ tag: "Ok", value });
export const err = <E>(error: E): Err<E> => ({ tag: "Err", error });
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.tag === "Ok";
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => result.tag === "Err";

export const bind = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => (isOk(result) ? fn(result.value) : result);
