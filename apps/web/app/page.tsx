import { AuthShell } from "../components/auth-shell";
import { isWebAuthConfigured } from "../lib/auth-config";

export default function HomePage() {
  const authConfigured = isWebAuthConfigured();

  return (
    <AuthShell
      eyebrow="Welcome to TRAPit"
      title="Tests made easier"
      description={
        authConfigured
          ? "Sign in or create an account to continue. TRAPit will route you based on your Cognito access."
          : "Authentication is paused for now, so you can work directly on the user and admin experiences."
      }
      showHeroLinks={false}
    >
      <div className="form-stack">
        <div>
          <h2>Welcome to TRAPit</h2>
          <p className="muted-text">
            Tests made easier.
          </p>
        </div>
        {authConfigured ? (
          <>
            <a className="button" href="/sign-in">
              Sign in
            </a>
            <a className="button-secondary" href="/sign-up">
              Sign up
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