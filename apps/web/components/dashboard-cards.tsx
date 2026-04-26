type DashboardCardsProps = {
  role: "admin" | "user";
};

const cardContent = {
  admin: [
    {
      title: "Admin approvals",
      body: "Review access requests and provision elevated permissions through your internal workflow.",
    },
    {
      title: "Security review",
      body: "Inspect Cognito group membership, failed sign-in attempts, and session anomalies.",
    },
    {
      title: "Operations",
      body: "Monitor the web and mobile funnels separately after wiring your analytics layer.",
    },
  ],
  user: [
    {
      title: "Profile setup",
      body: "Collect the data you need after first sign-in and persist it to your backend.",
    },
    {
      title: "Notifications",
      body: "Add mobile push preferences and SMS notification settings in one place.",
    },
    {
      title: "Activity",
      body: "Show recent account actions and user-facing workflow progress here.",
    },
  ],
} as const;

export function DashboardCards({ role }: DashboardCardsProps) {
  return (
    <div className="dashboard-grid">
      {cardContent[role].map((card) => (
        <article className="panel dashboard-card" key={card.title}>
          <h3>{card.title}</h3>
          <p className="muted-text">{card.body}</p>
        </article>
      ))}
    </div>
  );
}