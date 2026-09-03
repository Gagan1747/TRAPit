#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.error("Usage: node recover-question-pools.cjs --live LIVE.json --backup BACKUP.json [--ownership-map MAP.json] [--output STAGED.json] [--apply]");
  process.exit(1);
}

function parseArgs(values) {
  const options = { apply: false, backup: "", live: "", map: "", output: "" };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--apply") {
      options.apply = true;
    } else if (value === "--live") {
      options.live = values[++index] ?? "";
    } else if (value === "--backup") {
      options.backup = values[++index] ?? "";
    } else if (value === "--ownership-map") {
      options.map = values[++index] ?? "";
    } else if (value === "--output") {
      options.output = values[++index] ?? "";
    } else {
      usage();
    }
  }

  if (!options.live || !options.backup) {
    usage();
  }

  return options;
}

function readJson(filePath, label) {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.pools) || !Array.isArray(parsed.questions)) {
    throw new Error(`${label} must contain pools and questions arrays.`);
  }

  return parsed;
}

function readOwnershipMap(filePath) {
  if (!filePath) {
    return {};
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ownership map must be a JSON object of old Cognito sub to current Cognito sub.");
  }

  return Object.fromEntries(Object.entries(parsed).map(([oldId, newId]) => {
    if (typeof newId !== "string" || !oldId.trim() || !newId.trim()) {
      throw new Error("Ownership map keys and values must be non-empty strings.");
    }

    return [oldId.trim(), newId.trim()];
  }));
}

function remapOwner(record, ownershipMap) {
  const createdBy = typeof record.createdBy === "string" ? record.createdBy : null;
  return createdBy && ownershipMap[createdBy]
    ? { ...record, createdBy: ownershipMap[createdBy] }
    : record;
}

function summarizeByOwner(records) {
  return records.reduce((summary, record) => {
    const owner = record.createdBy || "(unowned)";
    summary[owner] = (summary[owner] ?? 0) + 1;
    return summary;
  }, {});
}

function writeAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const live = readJson(path.resolve(options.live), "Live workspace");
  const backup = readJson(path.resolve(options.backup), "Backup workspace");
  const ownershipMap = readOwnershipMap(options.map ? path.resolve(options.map) : "");
  const livePoolIds = new Set(live.pools.map((pool) => pool.id));
  const liveQuestionIds = new Set(live.questions.map((question) => question.id));
  const backupQuestionsById = new Map(backup.questions.map((question) => [question.id, question]));
  const missingPools = backup.pools
    .filter((pool) => pool?.id && !livePoolIds.has(pool.id))
    .map((pool) => remapOwner(pool, ownershipMap));
  const referencedQuestionIds = new Set(missingPools.flatMap((pool) => Array.isArray(pool.questionIds) ? pool.questionIds : []));
  const missingQuestions = Array.from(referencedQuestionIds)
    .filter((questionId) => !liveQuestionIds.has(questionId) && backupQuestionsById.has(questionId))
    .map((questionId) => remapOwner(backupQuestionsById.get(questionId), ownershipMap));
  const unresolvedQuestionIds = Array.from(referencedQuestionIds)
    .filter((questionId) => !liveQuestionIds.has(questionId) && !backupQuestionsById.has(questionId));
  const staged = {
    ...live,
    pools: [...live.pools, ...missingPools],
    questions: [...live.questions, ...missingQuestions],
  };
  const outputPath = path.resolve(options.output || `${options.live}.question-pool-recovery-preview.json`);
  const report = {
    mode: options.apply ? "apply" : "dry-run",
    backup: path.resolve(options.backup),
    live: path.resolve(options.live),
    stagedOutput: outputPath,
    existingLiveCounts: { pools: live.pools.length, questions: live.questions.length },
    restoredCounts: { pools: missingPools.length, questions: missingQuestions.length },
    stagedCounts: { pools: staged.pools.length, questions: staged.questions.length },
    restoredPoolsByOwner: summarizeByOwner(missingPools),
    restoredQuestionsByOwner: summarizeByOwner(missingQuestions),
    ownershipMappingsApplied: ownershipMap,
    unresolvedQuestionIds,
  };

  writeAtomic(outputPath, staged);
  console.log(JSON.stringify(report, null, 2));

  if (!options.apply) {
    console.log("Dry run only. Review the report and staged file, then validate them before using --apply.");
    return;
  }

  if (unresolvedQuestionIds.length) {
    throw new Error("Apply refused because restored pools reference questions missing from both live data and the selected backup.");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preMergeBackup = `${options.live}.pre-pool-recovery-${timestamp}.json`;
  fs.copyFileSync(options.live, preMergeBackup, fs.constants.COPYFILE_EXCL);
  writeAtomic(path.resolve(options.live), staged);
  console.log(`Applied selective recovery. Pre-merge backup: ${preMergeBackup}`);
}

try {
  main();
} catch (error) {
  console.error(`Question-pool recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
