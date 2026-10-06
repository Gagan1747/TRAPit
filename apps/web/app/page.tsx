import { AuthShell } from "../components/auth-shell";
import { HeroFeatureAssets } from "../components/hero-feature-assets";
import { isWebAuthConfigured } from "../lib/auth-config";
import { getSafeAuthReturnPath } from "../lib/auth-return-path";

export default function HomePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const authConfigured = isWebAuthConfigured();
  const redirectPath = typeof searchParams?.redirect === "string" ? getSafeAuthReturnPath(searchParams.redirect) : "";
  const redirectQuery = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : "";

  return (
    <AuthShell
      eyebrow="Welcome to TRAPit"
      title="Welcome to TRAPit"
      description={
        authConfigured
          ? "Tests, Apportions and Polls Simplified, Smart, and Precise"
          : "Authentication is paused for now, so you can work directly on the user and admin experiences."
      }
      heroVisual={authConfigured ? <HeroFeatureAssets /> : null}
      showHeroLinks={false}
    >
      <div className="form-stack">
        <div>
          <h2>Welcome to TRAPit</h2>
          <p className="muted-text">
            Tests, Apportions and Polls Simplified, Smart, and Precise.
          </p>
        </div>
        {authConfigured ? (
          <>
            <a className="button" href={`/sign-in${redirectQuery}`}>
              Sign in
            </a>
            <a className="button-secondary" href={`/sign-up${redirectQuery}`}>
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