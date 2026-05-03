import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { AdminQuestionWorkspace } from "../../components/admin-question-workspace";
import { LocalDateTimeText } from "../../components/local-date-time-text";
import { SignOutButton } from "../../components/sign-out-button";
import { isWebAuthConfigured } from "../../lib/auth-config";
import { getPreviousWebSignIn, requireWebSession } from "../../lib/session";

export default async function AdminPage() {
  const session = await requireWebSession("admin");
  const authConfigured = isWebAuthConfigured();
  const sessionIdentifier = getSessionIdentifier(session);
  const displayName = getSessionDisplayName(session) ?? "Admin";
  const previousSignInAt = authConfigured ? await getPreviousWebSignIn(session) : null;

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
            <p className="hero-text">
              Last signed in: <LocalDateTimeText fallback="First recorded sign in" value={previousSignInAt} />
            </p>
          </div>
          <div className="inline-actions">
            {authConfigured ? <SignOutButton /> : null}
          </div>
        </div>
        <AdminQuestionWorkspace currentAdminIdentifier={sessionIdentifier} previousSignInAt={previousSignInAt} />
      </section>
    </main>
  );
}