import { X } from "lucide-react";

type FloatingWindowCloseButtonProps = {
  label: string;
  onClick: () => void;
};

export function FloatingWindowCloseButton({ label, onClick }: FloatingWindowCloseButtonProps) {
  return (
    <button
      aria-label={label}
      className="floating-window-close-button"
      type="button"
      onClick={onClick}
    >
      <X aria-hidden="true" size={22} />
    </button>
  );
}
