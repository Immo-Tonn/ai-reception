/**
 * Repository-level failures, independent of the database vendor. Adapters map
 * their driver's error codes to these; services/actions map these to stable
 * codes for the UI. Messages are deliberately generic — never the raw
 * database text.
 */
export class RepositoryError extends Error {
  constructor(public context: string) {
    super(`${context} failed`);
    this.name = "RepositoryError";
  }
}

/** A uniqueness / time-collision rule refused the write (exclusion or unique violation). */
export class RepositoryConflictError extends RepositoryError {
  constructor(context: string) {
    super(context);
    this.name = "RepositoryConflictError";
  }
}

/** The database (RLS or a guard) refused: the caller may not do this. */
export class RepositoryForbiddenError extends RepositoryError {
  constructor(context: string) {
    super(context);
    this.name = "RepositoryForbiddenError";
  }
}

export class RepositoryNotFoundError extends RepositoryError {
  constructor(context: string) {
    super(context);
    this.name = "RepositoryNotFoundError";
  }
}

export interface DbErrorLike {
  message?: string;
  code?: string;
}

/** PostgreSQL SQLSTATE -> repository error. */
export function toRepositoryError(error: DbErrorLike | null | undefined, context: string): RepositoryError {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "23P01" || code === "23505") return new RepositoryConflictError(context);
  if (code === "42501" || code === "23514" || /row-level security|permission denied|cross_workspace_reference/i.test(message)) {
    return new RepositoryForbiddenError(context);
  }
  if (code === "P0002" || code === "PGRST116") return new RepositoryNotFoundError(context);
  return new RepositoryError(context);
}
