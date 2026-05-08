export class IServAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IServAuthError";
  }
}

export class IServApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "IServApiError";
  }
}
