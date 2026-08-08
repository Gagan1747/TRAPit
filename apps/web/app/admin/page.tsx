import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { AdminQuestionWorkspace } from "../../components/admin-question-workspace";
import { getPreviousWebSignIn, requireWebSession } from "../../lib/session";
import { isSuperAdminIdentifier } from "../../lib/workspace-actor";

export default async function AdminPage() {
  const session = await requireWebSession("admin");
  const sessionIdentifier = getSessionIdentifier(session);
  const displayName = getSessionDisplayName(session) ?? "Admin";
  const isSuperAdmin = isSuperAdminIdentifier(session.phoneNumber ?? sessionIdentifier);
  const previousSignInAt = await getPreviousWebSignIn(session);

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">
              <a className="dashboard-title-link" href="/admin?home=both">
                Welcome, {displayName}!
              </a>
            </h1>
            <p className="hero-kicker">TRAPit admin workspace</p>
          </div>
        </div>
        <AdminQuestionWorkspace
          currentActorRole="admin"
          currentAdminIdentifier={sessionIdentifier}
          currentUserCategory={null}
          isSuperAdmin={isSuperAdmin}
          previousSignInAt={previousSignInAt}
        />
      </section>
    </main>
  );
}