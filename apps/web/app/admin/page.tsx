import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { AdminQuestionWorkspace } from "../../components/admin-question-workspace";
import { SignOutButton } from "../../components/sign-out-button";
import { isWebAuthConfigured } from "../../lib/auth-config";
import { requireWebSession } from "../../lib/session";

export default async function AdminPage() {
  const session = await requireWebSession("admin");
  const authConfigured = isWebAuthConfigured();
  const sessionIdentifier = getSessionIdentifier(session);
  const displayName = getSessionDisplayName(session) ?? "Admin";

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">{displayName} dashboard</h1>
            <p className="hero-text">
              {authConfigured
                ? `Signed in with ${sessionIdentifier ?? "admin"}`
                : "Auth setup pending. Admin area is open for feature work."}
            </p>
          </div>
          {authConfigured ? <SignOutButton /> : null}
        </div>
        <AdminQuestionWorkspace />
      </section>
    </main>
  );
}