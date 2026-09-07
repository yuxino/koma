export interface WorkspaceRequestContext {
  navigationRevision: number;
  accountId: string | null;
}

/** A request can update only the workspace page and account that started it. */
export function createWorkspaceRequestGuard(readContext: () => WorkspaceRequestContext): () => boolean {
  const expected = readContext();
  return () => {
    const current = readContext();
    return current.navigationRevision === expected.navigationRevision && current.accountId === expected.accountId;
  };
}

export interface AccessSession {
  authenticated: boolean;
  user?: { id: string | number } | null;
}

/** Private job endpoints deliberately use 404 for both deletion and lost access. */
export function classifyMissingJobAccess(session: AccessSession, expectedAccountId: string | null): "missing" | "expired" | "account-changed" {
  const currentAccountId = session.authenticated && session.user ? String(session.user.id) : null;
  if (currentAccountId === expectedAccountId) return "missing";
  return currentAccountId === null ? "expired" : "account-changed";
}
