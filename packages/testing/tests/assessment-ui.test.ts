import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { AssessmentLogTable, type AssessmentLogRow } from "../../../apps/web/components/assessment-log-table";

function row(index: number): AssessmentLogRow {
  return {
    id: `test-${index}`, test: `Assessment ${index}`, groups: "Class A, Class B", questionPool: "Algebra",
    scheduled: "21 Oct 2026, 10:00 AM", time: "20 min", sortTime: index,
    creatorName: "Teacher", creatorIdentifier: "+919111111111", participantName: "Student",
    rank: "2 / 4", marksOrPoints: "45", status: "Results", participation: "Rank: 2 / 4 · Marks: 45",
  };
}

describe("assessment log UI", () => {
  it("renders four stacked columns with creator, groups, pool and participant result", () => {
    const html = renderToStaticMarkup(createElement(AssessmentLogTable, { rows: [row(1)] }));
    expect(html.match(/<th>/g)).toHaveLength(4);
    for (const text of ["SNo", "Class A, Class B", "Algebra", "Teacher", "+919111111111", "Rank: 2 / 4", "Marks: 45"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Participant Name</th>");
  });

  it("sorts newest first and renders only six rows with appointment-style pagination", () => {
    const html = renderToStaticMarkup(createElement(AssessmentLogTable, { rows: Array.from({ length: 8 }, (_, index) => row(index)) }));
    expect(html.match(/<tr>/g)).toHaveLength(7);
    expect(html.indexOf("Assessment 7")).toBeLessThan(html.indexOf("Assessment 6"));
    expect(html).not.toContain("Assessment 1");
    expect(html).toContain('aria-label="Assessment log pages"');
    expect(html).toContain('class="apportion-log-pagination"');
    expect(html).toContain('aria-label="Previous assessments"');
    expect(html).toContain("disabled");
  });

  it("supports creator counts and absent state without invented marks", () => {
    const html = renderToStaticMarkup(createElement(AssessmentLogTable, { rows: [
      { ...row(2), participation: "4 joined / 8 shared", status: "Upcoming" },
      { ...row(1), participation: "Absent", status: "Results", marksOrPoints: "—" },
    ] }));
    expect(html).toContain("4 joined / 8 shared");
    expect(html).toContain("Absent");
    expect(html).not.toContain("Marks: 45");
  });

  it("renders an empty state and never installs dynamic log timers", () => {
    expect(renderToStaticMarkup(createElement(AssessmentLogTable, { rows: [] }))).toContain("No tests or games match this view yet.");
    const source = readFileSync(new URL("../../../apps/web/components/assessment-log-table.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/setInterval|setTimeout|Date\.now/);
  });
});

describe("assessment scheduling contracts", () => {
  const source = readFileSync(new URL("../../../apps/web/components/admin-question-workspace.tsx", import.meta.url), "utf8");
  it("provides owner-style three modes and constrained question and duration choices", () => {
    expect(source).toContain('["instant", "rapid", "standard"]');
    expect(source).toContain('[20, 40, 60, 100, 200].map');
    expect(source).toContain('[5, 10, 20, 30, 60].map');
    expect(source).toContain('"Start Games"');
    expect(source).toContain('aria-label="Repeat assessment"');
    expect(source).toContain('setScheduleRepeats(false)');
    expect(source).toContain('setScheduleRepeats(true)');
  });
  it("uses owned multi-groups and their distinct union, while preserving legacy edits and links", () => {
    expect(source).toContain('id="schedule-groups"');
    expect(source).toContain('group.ownerIdentifier, currentAdminIdentifier');
    expect(source).toContain('const selectedScheduleMemberIds = new Set');
    expect(source).toContain('participantGroupIds: selectedScheduleGroupIds');
    expect(source).toContain('generateInviteLink: editingScheduledTest ? Boolean(editingScheduledTest.shareCode) : false');
    expect(source).toContain('(existing)');
    expect(source).toContain('const eligibleSchedulePools = pools.filter');
  });
  it("keeps participant results behind completion and links Instant and eligible creators to the shared runner", () => {
    const participantSource = readFileSync(new URL("../../../apps/web/components/restricted-user-dashboard-workspace.tsx", import.meta.url), "utf8");
    expect(participantSource).toContain('const hasCompletedResult = test.status === "completed"');
    expect(participantSource).toContain('test.assessmentKind === "instant"');
    expect(participantSource).toContain('href={`/user/test/${encodeURIComponent(test.id)}`}');
    expect(participantSource).toContain('participant?.submitted');
    expect(source).toContain('useParticipantScope || canParticipate || isInstant');
    expect(/test\.status === "completed"\s*&& participantHistory\?\.status !== "missed"/.test(source)).toBe(true);
    expect(source).toContain('`${joinedCount} joined / ${scheduledTest?.resolvedParticipantIdentifiers.length');
  });
});
