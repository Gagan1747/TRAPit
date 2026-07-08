import { getSessionDisplayName, getSessionIdentifier, normalUserCategoryLabels } from "@trapit/auth";

import { AdminQuestionWorkspace } from "../../components/admin-question-workspace";
import { LocalDateTimeText } from "../../components/local-date-time-text";
import { SignOutButton } from "../../components/sign-out-button";
import { UserTestWorkspace } from "../../components/user-test-workspace";
import { isWebAuthConfigured } from "../../lib/auth-config";
import { formatPhoneNumberForDisplay } from "../../lib/privacy";
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
  const categoryLabel = session.userCategory ? normalUserCategoryLabels[session.userCategory].replace(/ users$/i, " user") : null;
  const isSuperAdmin = isSuperAdminIdentifier(session.phoneNumber ?? sessionIdentifier);
  const previousSignInAt = authConfigured ? await getPreviousWebSignIn(session) : null;
  const openTestsView = searchParams?.view === "tests";

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">
              <a className="dashboard-title-link" href="/user?home=both">
                {displayName} TRAPit dashboard
              </a>
            </h1>
            <p className="hero-text">
              {authConfigured
                ? `Signed in with ${formatPhoneNumberForDisplay(sessionIdentifier ?? "user", { showFullPhoneNumber: isSuperAdmin })}${categoryLabel ? ` as ${categoryLabel}` : ""}`
                : "Auth setup pending. User area is open for feature work."}
            </p>
            <p className="hero-text">
              Last signed in: <LocalDateTimeText fallback="First recorded sign in" value={previousSignInAt} />
            </p>
          </div>
          {authConfigured ? <SignOutButton /> : null}
        </div>
        {session.role === "user" && !openTestsView ? (
          <AdminQuestionWorkspace
            currentActorRole="user"
            currentAdminIdentifier={sessionIdentifier}
            currentUserCategory={session.userCategory}
            initialOpenSection={searchParams?.tab === "apportion" ? "apportion" : undefined}
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