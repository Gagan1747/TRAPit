import "server-only";

import {
  getNormalUserCategoryDefinition,
  getNextNormalUserCategory,
  normalUserCategoryLabels,
  type NormalUserCategory,
} from "@trapit/auth";

import { getUpgradeTargetCategory } from "./user-category-store";

function formatLimitMessage(featureName: string, category: NormalUserCategory, nextCategory: NormalUserCategory | null) {
  if (!nextCategory) {
    return `You have utilized all allowable limits of ${featureName}.`;
  }

  return `You have utilized all allowable limits of ${featureName} - upgrade to ${normalUserCategoryLabels[nextCategory]} to extend your limits`;
}

function throwLimitExceeded(featureName: string, category: NormalUserCategory, nextCategory: NormalUserCategory | null) {
  throw new Error(formatLimitMessage(featureName, category, nextCategory));
}

export function assertCanCreateQuestionPool(category: NormalUserCategory, existingPoolCount: number) {
  void category;
  void existingPoolCount;
}

export function assertCanAddQuestionsToPools(
  category: NormalUserCategory,
  poolQuestionCountsAfterSave: number[],
) {
  void category;
  void poolQuestionCountsAfterSave;
}

export function assertCanCreateGroup(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.group.create) {
    throwLimitExceeded(
      "Group - Create",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.group.create) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanManageGroup(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.group.manage) {
    throwLimitExceeded(
      "Group - Manage",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.group.manage) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanCreatePollQuestions(category: NormalUserCategory) {
  void category;
}

export function assertCanSchedulePoll(
  category: NormalUserCategory,
  participantType: "open" | "registered",
  openPollsThisMonth = 0,
) {
  const definition = getNormalUserCategoryDefinition(category);

  if (participantType === "open") {
    if (!definition.poll.shareOpenToAll || openPollsThisMonth >= definition.poll.maxOpenPollsPerMonth) {
      throwLimitExceeded(
        "Poll - Schedule Poll",
        category,
        getUpgradeTargetCategory(category, (candidateDefinition) =>
          candidateDefinition.poll.shareOpenToAll && candidateDefinition.poll.maxOpenPollsPerMonth > definition.poll.maxOpenPollsPerMonth,
        ) ?? getNextNormalUserCategory(category),
      );
    }
  }
}

export function assertCanScheduleTest(category: NormalUserCategory, scheduledTestsThisMonth: number) {
  const definition = getNormalUserCategoryDefinition(category);

  if (scheduledTestsThisMonth >= definition.test.maxScheduledTestsPerMonth) {
    throwLimitExceeded(
      "Test - Schedule Test",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) =>
        candidateDefinition.test.maxScheduledTestsPerMonth > definition.test.maxScheduledTestsPerMonth,
      ) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanScheduleSelfTest(category: NormalUserCategory, selfTestsThisMonth: number) {
  void category;
  void selfTestsThisMonth;
}
