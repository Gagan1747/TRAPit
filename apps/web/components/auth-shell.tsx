type AuthShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  showHeroLinks?: boolean;
  children: React.ReactNode;
};

export function AuthShell({
  title,
  eyebrow,
  description,
  showHeroLinks = true,
  children,
}: AuthShellProps) {
  return (
    <main className="page-shell">
      <div className="hero-grid">
        <section className="panel hero-copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="hero-title">{title}</h1>
          {description ? <p className="hero-text">{description}</p> : null}
          {showHeroLinks ? (
            <div className="hero-links">
              <a className="button" href="/sign-in">
                Sign in
              </a>
              <a className="button-secondary" href="/sign-up">
                Sign up
              </a>
            </div>
          ) : null}
        </section>
        <section className="panel form-panel">{children}</section>
      </div>
    </main>
  );
}