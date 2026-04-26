import type { ReactNode } from "react";

type CollapsibleWorkspaceSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  isOpen: boolean;
  onToggle: () => void;
  sectionId: string;
  title: string;
};

export function CollapsibleWorkspaceSection({
  action,
  children,
  description,
  eyebrow,
  isOpen,
  onToggle,
  sectionId,
  title,
}: CollapsibleWorkspaceSectionProps) {
  return (
    <section className={`panel workspace-card collapsible-section${isOpen ? " is-open" : ""}`}>
      <div className="collapsible-header">
        <button
          aria-controls={sectionId}
          aria-expanded={isOpen}
          className="collapsible-copy collapsible-copy-button"
          type="button"
          onClick={onToggle}
        >
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="section-title">{title}</h2>
          {description ? <p className="muted-text collapsible-description">{description}</p> : null}
        </button>
        <div className="collapsible-actions">
          {action}
        </div>
      </div>

      {isOpen ? (
        <div className="collapsible-body" id={sectionId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}