import { describe, expect, it, vi } from "vitest";
import { classifyMissingJobAccess, createWorkspaceRequestGuard } from "./workspace-access.js";

describe("workspace request ownership", () => {
  it.each(["retry", "delete", "unauthorized"])("ignores a delayed %s response after leaving the page", async () => {
    let context = { navigationRevision: 4, accountId: "17" as string | null };
    const isCurrent = createWorkspaceRequestGuard(() => context);
    let complete!: () => void;
    const response = new Promise<void>((resolve) => { complete = resolve; });
    const apply = vi.fn();
    const pending = response.then(() => { if (isCurrent()) apply(); });
    context = { ...context, navigationRevision: 5 };
    complete();
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it("invalidates a request immediately when the account changes, even before route effects run", () => {
    let context = { navigationRevision: 4, accountId: "17" as string | null };
    const isCurrent = createWorkspaceRequestGuard(() => context);
    expect(isCurrent()).toBe(true);
    context = { ...context, accountId: "23" };
    expect(isCurrent()).toBe(false);
    context = { ...context, accountId: null };
    expect(isCurrent()).toBe(false);
  });

  it("distinguishes hidden private access from a deleted job", () => {
    expect(classifyMissingJobAccess({ authenticated: false }, "17")).toBe("expired");
    expect(classifyMissingJobAccess({ authenticated: true, user: { id: 17 } }, "17")).toBe("missing");
    expect(classifyMissingJobAccess({ authenticated: true, user: { id: 23 } }, "17")).toBe("account-changed");
    expect(classifyMissingJobAccess({ authenticated: false }, null)).toBe("missing");
    expect(classifyMissingJobAccess({ authenticated: true, user: { id: 17 } }, null)).toBe("account-changed");
  });
});
