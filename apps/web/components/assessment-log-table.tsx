"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

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
  creatorName?: string;
  creatorIdentifier?: string;
  participation?: ReactNode;
};

type AssessmentLogTableProps = {
  emptyMessage?: string;
  rows: AssessmentLogRow[];
};

export function AssessmentLogTable({ emptyMessage = "No tests or games match this view yet.", rows }: AssessmentLogTableProps) {
  const [page, setPage] = useState(0);
  if (!rows.length) {
    return <p className="muted-text">{emptyMessage}</p>;
  }

  const sortedRows = [...rows].sort((left, right) => right.sortTime - left.sortTime);
  const pageCount = Math.ceil(sortedRows.length / 6);
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedRows.slice(currentPage * 6, (currentPage + 1) * 6);

  return (
    <div className="leaderboard-table-wrap workspace-result-table-wrap assessment-log-table-wrap">
      <table className="leaderboard-table assessment-log-table">
        <thead>
          <tr>
            <th>SNo</th>
            <th>Name / Groups / Pool</th>
            <th>Scheduled / Duration / Creator</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr key={row.id}>
              <td>{currentPage * 6 + index + 1}</td>
              <td><strong>{row.test}</strong><span className="assessment-log-detail">{row.groups}</span><span className="assessment-log-detail muted-text">{row.questionPool}</span></td>
              <td><span>{row.scheduled}</span><span className="assessment-log-detail">{row.time}</span>{row.creatorName ? <span className="assessment-log-detail">{row.creatorName}</span> : null}{row.creatorIdentifier ? <span className="assessment-log-detail muted-text">{row.creatorIdentifier}</span> : null}</td>
              <td>{row.status}{row.participation !== undefined ? <span className="assessment-log-detail">{row.participation}</span> : <><span className="assessment-log-detail">Rank: {row.rank}</span><span className="assessment-log-detail">Marks/Points: {row.marksOrPoints}</span></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 ? <nav aria-label="Assessment log pages" className="apportion-log-pagination">
        <button aria-label="Previous assessments" className="button-secondary small-button" disabled={currentPage === 0} type="button" onClick={() => setPage(currentPage - 1)}><ArrowLeft aria-hidden="true" size={16} /></button>
        <span>{currentPage + 1} / {pageCount}</span>
        <button aria-label="Next assessments" className="button-secondary small-button" disabled={currentPage + 1 >= pageCount} type="button" onClick={() => setPage(currentPage + 1)}><ArrowRight aria-hidden="true" size={16} /></button>
      </nav> : null}
    </div>
  );
}