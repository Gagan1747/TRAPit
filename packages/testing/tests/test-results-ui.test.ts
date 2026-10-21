import { describe, expect, it } from "vitest";
import { createElement } from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { TestResultsContent } from "../../../apps/web/components/test-results-workspace";

type Payload = Parameters<typeof TestResultsContent>[0]["payload"];

describe("completed results presentation", () => {
  it("shows question counts, final audience counts, masked contacts and exact own rank without a redundant summary", () => {
    const payload: Payload = {
      branding: null, groupNames: [], hasCreatorScope: false, hasParticipantScope: true,
      participantResult: { correctCount: 1, elapsedMs: 30000, incorrectCount: 1, marks: 2, participantName: "Me", rank: 12, rankedParticipantCount: 12, totalCount: 3 },
      participants: [
        { correctCount: 2, elapsedMs: 20000, incorrectCount: 1, isCurrentParticipant: false, marks: 7, manualName: "First", maskedIdentifier: "+********1234", rank: 1, totalCount: 3, unansweredCount: 0 },
        { correctCount: 1, elapsedMs: 30000, incorrectCount: 1, isCurrentParticipant: true, marks: 2, manualName: "Me", maskedIdentifier: "+********5678", rank: 12, totalCount: 3, unansweredCount: 1 },
      ],
      poolName: "Pool",
      questions: [{ correctOptionIndex: 0, optionSelectionCounts: [1, 0, 0, 0], options: ["A", "B", "C", "D"], prompt: "Question", questionId: "q1", selectedOptionIndex: 0 }],
      summary: { creatorName: "Creator", durationMinutes: 10, participantName: "Me", poolName: "Pool", startsAt: "2026-01-01T00:00:00.000Z", submittedCount: 12, sharedCount: 14, testId: "test-1", title: "Test" },
    };
    const html = renderToStaticMarkup(createElement(TestResultsContent, { payload }));
    expect(html).toContain("Questions (1)");
    expect(html).toContain("Responses 1");
    expect(html).toContain("Final standings (12/14)");
    expect(html).toContain("+********1234");
    expect(html).toContain("(+2 / -1)");
    expect(html).toContain("(+1 / -2)");
    expect(html).toContain("(10 min)");
    expect(html).toMatch(/is-current-participant" aria-current="true"><strong>#12 Me \(You\)/);
    expect(html).not.toContain("Your result");
  });
});
