import { Check, X } from "lucide-react";

type AnswerStatusIndicatorProps = {
  isCorrect: boolean;
  isSelected: boolean;
};

export function AnswerStatusIndicator({ isCorrect, isSelected }: AnswerStatusIndicatorProps) {
  if (!isCorrect && !isSelected) {
    return null;
  }

  const label = isCorrect
    ? isSelected ? "Correct option and selected answer" : "Correct option"
    : "Incorrect selected answer";

  return (
    <span aria-label={label} className="answer-status-indicator" title={label}>
      {isCorrect ? <Check aria-hidden="true" className="answer-status-icon is-correct" /> : null}
      {isCorrect && isSelected ? <Check aria-hidden="true" className="answer-status-icon is-selected-correct" /> : null}
      {!isCorrect && isSelected ? <X aria-hidden="true" className="answer-status-icon is-incorrect" /> : null}
    </span>
  );
}