import { AuthShell } from "../components/auth-shell";
import { isWebAuthConfigured } from "../lib/auth-config";

export default function HomePage() {
  const authConfigured = isWebAuthConfigured();

  return (
    <AuthShell
      eyebrow="Cross-platform auth"
      title="One identity flow for web and mobile."
      description={
        authConfigured
          ? "Use this starter to separate public user sign-up from admin sign-in, then plug the forms into Cognito."
          : "Authentication is paused for now, so you can work directly on the user and admin experiences."
      }
    >
      <div className="form-stack">
        <div>
          <h2>What is already wired</h2>
          <p className="muted-text">
            Web and mobile share role definitions, route separation, and a Cognito-ready environment contract.
          </p>
        </div>
        {authConfigured ? (
          <>
            <a className="button" href="/sign-up">
              Start user sign-up
            </a>
            <a className="button-secondary" href="/sign-in">
              Continue to sign-in
            </a>
          </>
        ) : (
          <>
            <a className="button" href="/user">
              Open user workspace
            </a>
            <a className="button-secondary" href="/admin">
              Open admin workspace
            </a>
          </>
        )}
      </div>
    </AuthShell>
  );
}