import { describe, expect, it } from "vitest";
import { describeSaveError } from "../describeSaveError";
import { RemoteRepositoryError } from "../createRemoteRepository";
import { getMessages } from "@/lib/i18n";

const m = getMessages("en").repositoryErrors;

describe("describeSaveError", () => {
  it("explains a duplicate client e-mail", () => {
    expect(describeSaveError(new RemoteRepositoryError("conflict"), m, { duplicateClient: true })).toBe(m.clientExists);
  });
  it("explains a generic conflict (e.g. time slot taken)", () => {
    expect(describeSaveError(new RemoteRepositoryError("conflict"), m)).toBe(m.conflict);
  });
  it("maps forbidden / unauthenticated / not_found", () => {
    expect(describeSaveError(new RemoteRepositoryError("forbidden"), m)).toBe(m.forbidden);
    expect(describeSaveError(new RemoteRepositoryError("unauthenticated"), m)).toBe(m.unauthenticated);
    expect(describeSaveError(new RemoteRepositoryError("not_found"), m)).toBe(m.notFound);
  });
  it("falls back to a generic message and never leaks error text", () => {
    expect(describeSaveError(new Error("duplicate key violates constraint x"), m)).toBe(m.generic);
  });
});
