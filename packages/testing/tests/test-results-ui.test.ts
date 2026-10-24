import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { TestResultsContent } from "../../../apps/web/components/test-results-workspace";
import { buildGroupInvitePath, matchesGroupShareCode } from "../../../apps/web/lib/group-invite-path";
import { formatGroupTimestamp } from "../../../apps/web/lib/date-format";

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
    expect(html).toMatch(/is-current-participant" aria-current="true"><div class="test-results-leaderboard-left"><strong>#12 Me \(You\)/);
    expect(html).toContain('<div class="test-results-leaderboard-right"><strong>2 marks</strong><span class="test-results-leaderboard-meta">(+1 / -2)</span></div>');
    expect(html).not.toContain("Your result");
  });

  it("formats group invite URLs with the group name slug and group timestamps as DD/MM/YYYY; HH:MM", () => {
    expect(buildGroupInvitePath("TRAPIT-GROUP-123", "Physics Batch A")).toBe("/group/physics-batch-a-TRAPIT-GROUP-123");
    expect(matchesGroupShareCode("TRAPIT-GROUP-123", "physics-batch-a-TRAPIT-GROUP-123", "Physics Batch A")).toBe(true);
    expect(matchesGroupShareCode("TRAPIT-GROUP-123", "renamed-group-TRAPIT-GROUP-123", "Physics Batch A")).toBe(true);
    expect(matchesGroupShareCode("TRAPIT-GROUP-123", "TRAPIT-GROUP-123", "Physics Batch A")).toBe(true);
    expect(formatGroupTimestamp("2026-10-23T06:00:00.000Z")).toBe("23/10/2026; 11:30");
  });

  it("enforces the updated pricing matrix, Contact Us details, Super Admin Manage Upgrades table, and 3-section Groups Management UI", () => {
    const source = readFileSync(new URL("../../../apps/web/components/admin-question-workspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("Pro (10,000 / 12 months)");
    expect(source).toContain("Pro Max (20,000 / 12 months)");
    expect(source).toContain("Test: Schedule test / month");
    expect(source).toContain("Apportion: Business Panel (services per address)");
    expect(source).toContain("Poll: Schedule Polls (open to all polls)");
    expect(source).toContain("Flat-1144, ATS Marigold, Sector 89A, Gurugram, Haryana (122505)");
    expect(source).toContain("gagan_cvrmech@yahoo.co.in");
    expect(source).toContain("+91-8800797123");
    expect(source).toContain("<th>Request Received</th>");
    expect(source).toContain("<th>Days Remaining</th>");
    expect(source).toContain("Download Group QR Code");
    expect(source).toContain("Copy Group Link");
    expect(source).not.toContain("merged-test-");
  });
});
