import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { RestrictedUserDashboardWorkspace } from "../../components/restricted-user-dashboard-workspace";
import { SignOutButton } from "../../components/sign-out-button";
import { UserTestWorkspace } from "../../components/user-test-workspace";
import { isWebAuthConfigured } from "../../lib/auth-config";
import { requireWebSession } from "../../lib/session";

export default async function UserPage() {
  const session = await requireWebSession(["user", "admin"]);
  const authConfigured = isWebAuthConfigured();
  const sessionIdentifier = getSessionIdentifier(session);
  const displayName = getSessionDisplayName(session) ?? "User";

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">{displayName} dashboard</h1>
            <p className="hero-text">
              {authConfigured
                ? `Signed in with ${sessionIdentifier ?? "user"}`
                : "Auth setup pending. User area is open for feature work."}
            </p>
          </div>
          {authConfigured ? <SignOutButton /> : null}
        </div>
        {session.role === "user" ? (
          <RestrictedUserDashboardWorkspace
            authConfigured={authConfigured}
            defaultParticipantIdentifier={sessionIdentifier}
          />
        ) : (
          <UserTestWorkspace
            authConfigured={authConfigured}
            defaultParticipantIdentifier={sessionIdentifier}
          />
        )}
      </section>
    </main>
  );
}