import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { AdminQuestionWorkspace } from "../../components/admin-question-workspace";
import { UserTestWorkspace } from "../../components/user-test-workspace";
import { isWebAuthConfigured } from "../../lib/auth-config";
import { getPreviousWebSignIn, requireWebSession } from "../../lib/session";
import { isSuperAdminIdentifier } from "../../lib/workspace-actor";

export default async function UserPage({
  searchParams,
}: {
  searchParams?: { tab?: string; view?: string };
}) {
  const session = await requireWebSession(["user", "admin"]);
  const authConfigured = isWebAuthConfigured();
  const sessionIdentifier = getSessionIdentifier(session);
  const displayName = getSessionDisplayName(session) ?? "User";
  const isSuperAdmin = isSuperAdminIdentifier(session.phoneNumber ?? sessionIdentifier);
  const previousSignInAt = authConfigured ? await getPreviousWebSignIn(session) : null;
  const openTestsView = searchParams?.view === "tests";
  const openApportionView = searchParams?.tab === "apportion";
  const showWorkspace = !openTestsView && (session.role === "user" || (isSuperAdmin && openApportionView));

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">
              <a className="dashboard-title-link" href="/user?home=both">
                Welcome, {displayName}!
              </a>
            </h1>
            <p className="hero-kicker">TRAPit workspace</p>
          </div>
        </div>
        {showWorkspace ? (
          <AdminQuestionWorkspace
            currentActorRole={session.role === "admin" ? "admin" : "user"}
            currentAdminIdentifier={sessionIdentifier}
            currentUserCategory={session.userCategory}
            initialOpenSection={openApportionView ? "apportion" : undefined}
            isSuperAdmin={isSuperAdmin}
            previousSignInAt={previousSignInAt}
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