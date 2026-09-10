export type DomainEvent = Readonly<{
  type: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export const event = (type: string, payload: Readonly<Record<string, unknown>> = {}): DomainEvent => ({
  type,
  payload
});
