import type { ReactNode } from "react";

export type AssessmentLogRow = {
  groups: string;
  id: string;
  marksOrPoints: ReactNode;
  participantName: string;
  questionPool: string;
  rank: string;
  scheduled: string;
  sortTime: number;
  status: ReactNode;
  test: string;
  time: string;
};

type AssessmentLogTableProps = {
  emptyMessage?: string;
  rows: AssessmentLogRow[];
};

export function AssessmentLogTable({ emptyMessage = "No tests or games match this view yet.", rows }: AssessmentLogTableProps) {
  if (!rows.length) {
    return <p className="muted-text">{emptyMessage}</p>;
  }

  const sortedRows = [...rows].sort((left, right) => right.sortTime - left.sortTime);

  return (
    <div className="leaderboard-table-wrap workspace-result-table-wrap assessment-log-table-wrap">
      <table className="leaderboard-table assessment-log-table">
        <thead>
          <tr>
            <th>Test</th>
            <th>Scheduled</th>
            <th>Time</th>
            <th>Participant Name</th>
            <th>Rank</th>
            <th>Marks/Points</th>
            <th>Question Pool</th>
            <th>Groups</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.id}>
              <td>{row.test}</td>
              <td>{row.scheduled}</td>
              <td>{row.time}</td>
              <td>{row.participantName}</td>
              <td>{row.rank}</td>
              <td>{row.marksOrPoints}</td>
              <td>{row.questionPool}</td>
              <td>{row.groups}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}