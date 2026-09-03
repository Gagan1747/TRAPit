import type { ReactNode } from "react";

type CollapsibleWorkspaceSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  hideToggle?: boolean;
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
  hideToggle = false,
  isOpen,
  onToggle,
  sectionId,
  title,
}: CollapsibleWorkspaceSectionProps) {
  if (hideToggle && !isOpen) {
    return null;
  }

  return (
    <section className={`panel workspace-card collapsible-section${isOpen ? " is-open" : ""}`}>
      {!hideToggle ? <div className="collapsible-header">
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
      </div> : null}

      {isOpen ? (
        <div className="collapsible-body" id={sectionId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}