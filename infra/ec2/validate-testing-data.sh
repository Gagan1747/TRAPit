#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 /absolute/path/to/testing-workspace.json [/absolute/path/to/current-live-file.json]" >&2
  exit 1
fi

CANDIDATE_FILE="$1"
BASELINE_FILE="${2:-}"

node - "${CANDIDATE_FILE}" "${BASELINE_FILE}" <<'NODE'
const fs = require('fs');

const candidateFile = process.argv[2];
const baselineFile = process.argv[3] || '';
const allowEmpty = process.env.TRAPIT_ALLOW_EMPTY_DATA_FILE === '1';
const allowDangerousRestore = process.env.TRAPIT_ALLOW_DANGEROUS_RESTORE === '1';

function readState(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file does not exist: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  const rawValue = fs.readFileSync(filePath, 'utf8');
  let parsed;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }

  const summary = {
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts.length : 0,
    groups: Array.isArray(parsed.participantGroups) ? parsed.participantGroups.length : 0,
    participants: Array.isArray(parsed.participants) ? parsed.participants.length : 0,
    pollAttempts: Array.isArray(parsed.pollAttempts) ? parsed.pollAttempts.length : 0,
    pollQuestions: Array.isArray(parsed.pollQuestions) ? parsed.pollQuestions.length : 0,
    polls: Array.isArray(parsed.scheduledPolls) ? parsed.scheduledPolls.length : 0,
    pools: Array.isArray(parsed.pools) ? parsed.pools.length : 0,
    questions: Array.isArray(parsed.questions) ? parsed.questions.length : 0,
    tests: Array.isArray(parsed.scheduledTests) ? parsed.scheduledTests.length : 0,
  };

  return { filePath, parsed, size: stat.size, summary };
}

function total(summary) {
  return Object.values(summary).reduce((sum, count) => sum + count, 0);
}

function coreTotal(summary) {
  return (
    summary.groups
    + summary.pools
    + summary.tests
    + summary.attempts
    + summary.questions
    + summary.polls
    + summary.pollQuestions
    + summary.pollAttempts
  );
}

function format(summary) {
  return Object.entries(summary).map(([key, value]) => `${key}=${value}`).join(', ');
}

function isDangerousReduction(currentSummary, candidateSummary) {
  const currentTotal = total(currentSummary);
  const candidateTotal = total(candidateSummary);
  const currentCoreTotal = coreTotal(currentSummary);
  const candidateCoreTotal = coreTotal(candidateSummary);

  if (currentTotal < 10 && currentCoreTotal < 5) {
    return false;
  }

  const importantCollections = ['groups', 'pools', 'tests', 'attempts', 'questions'];
  const wipedImportantCollections = importantCollections.filter((key) => currentSummary[key] > 0 && candidateSummary[key] === 0).length;

  return candidateCoreTotal === 0 || candidateTotal === 0 || wipedImportantCollections >= 2 || candidateCoreTotal < currentCoreTotal * 0.1;
}

try {
  const candidate = readState(candidateFile, 'Candidate');
  const candidateTotal = total(candidate.summary);
  const candidateCoreCount = coreTotal(candidate.summary);

  console.log(`Candidate: ${candidate.filePath}`);
  console.log(`Size: ${candidate.size} bytes`);
  console.log(`Counts: ${format(candidate.summary)}`);

  if (!allowEmpty && candidateTotal === 0) {
    throw new Error('Candidate contains no recoverable TRAPit workspace data. Refusing to treat it as valid production data. Set TRAPIT_ALLOW_EMPTY_DATA_FILE=1 only for a brand-new empty deployment.');
  }

  if (!allowEmpty && candidateCoreCount === 0) {
    throw new Error('Candidate has no core workspace data (groups, pools, tests, attempts, questions, polls). Refusing to treat it as valid production data. Set TRAPIT_ALLOW_EMPTY_DATA_FILE=1 only for a brand-new empty deployment.');
  }

  if (baselineFile) {
    const baseline = readState(baselineFile, 'Baseline');
    console.log(`Baseline: ${baseline.filePath}`);
    console.log(`Baseline counts: ${format(baseline.summary)}`);

    if (!allowDangerousRestore && isDangerousReduction(baseline.summary, candidate.summary)) {
      throw new Error('Candidate is a destructive reduction compared with the current live file. Refusing restore. Set TRAPIT_ALLOW_DANGEROUS_RESTORE=1 only after manually confirming this reset is intentional.');
    }
  }
} catch (error) {
  console.error(`Data validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
NODE
