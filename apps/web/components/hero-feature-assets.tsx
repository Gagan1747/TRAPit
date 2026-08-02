type HeroFeatureAsset = {
  caption: string;
  icon: string;
  subtitle: string;
  title: string;
};

const HERO_FEATURES: HeroFeatureAsset[] = [
  {
    caption: "Educate, Quizzes",
    icon: "🎓",
    subtitle: "Test",
    title: "Test",
  },
  {
    caption: "Appointment, Meeting",
    icon: "📅",
    subtitle: "Apportion",
    title: "Apportion",
  },
  {
    caption: "Survey, Opinions",
    icon: "📊",
    subtitle: "Poll",
    title: "Poll",
  },
];

export function HeroFeatureAssets() {
  return (
    <div className="hero-feature-assets" aria-label="TRAPit feature highlights">
      {HERO_FEATURES.map((feature) => (
        <article className="hero-feature-card" key={feature.title}>
          <span aria-hidden="true" className="hero-feature-icon">{feature.icon}</span>
          <div className="hero-feature-copy">
            <strong>{feature.subtitle}</strong>
            <span>{feature.caption}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
