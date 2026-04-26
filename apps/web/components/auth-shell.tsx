type AuthShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  children: React.ReactNode;
};

export function AuthShell({
  title,
  eyebrow,
  description,
  children,
}: AuthShellProps) {
  return (
    <main className="page-shell">
      <div className="hero-grid">
        <section className="panel hero-copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="hero-title">{title}</h1>
          {description ? <p className="hero-text">{description}</p> : null}
          <div className="hero-links">
            <a className="button" href="/sign-in">
              Sign in
            </a>
            <a className="button-secondary" href="/sign-up">
              Sign up
            </a>
          </div>
        </section>
        <section className="panel form-panel">{children}</section>
      </div>
    </main>
  );
}