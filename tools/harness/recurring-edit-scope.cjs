const assert = require("node:assert/strict")
const path = require("node:path")

const {
  resolveRecurringEditScope,
  resolveFutureRecurringRepeatDays
} = require(path.resolve(__dirname, "../../utils/recurringEditScope"))

const cases = [
  {
    name: "keeps single edits untouched",
    input: { requestedScope: "single", originalDate: "2026-04-10", nextDate: "2026-04-08" },
    expected: "single"
  },
  {
    name: "keeps future edits when moving later",
    input: { requestedScope: "future", originalDate: "2026-04-10", nextDate: "2026-04-12" },
    expected: "future"
  },
  {
    name: "promotes future edits when moving earlier",
    input: { requestedScope: "future", originalDate: "2026-04-10", nextDate: "2026-04-08" },
    expected: "all"
  },
  {
    name: "keeps all edits as all",
    input: { requestedScope: "all", originalDate: "2026-04-10", nextDate: "2026-04-08" },
    expected: "all"
  }
]

const repeatDayCases = [
  {
    name: "keeps single-scope weekly days untouched",
    input: {
      editScope: "single",
      originalDate: "2025-01-23",
      nextDate: "2025-01-24",
      sourceRepeatType: "weekly",
      nextRepeatType: "weekly",
      sourceRepeatDays: [4],
      nextRepeatDays: [4]
    },
    expected: [4]
  },
  {
    name: "includes shifted future weekly occurrence on the moved date",
    input: {
      editScope: "future",
      originalDate: "2025-01-23",
      nextDate: "2025-01-24",
      sourceRepeatType: "weekly",
      nextRepeatType: "weekly",
      sourceRepeatDays: [4],
      nextRepeatDays: [4]
    },
    expected: [5]
  },
  {
    name: "respects explicitly changed weekly day",
    input: {
      editScope: "future",
      originalDate: "2025-01-23",
      nextDate: "2025-01-24",
      sourceRepeatType: "weekly",
      nextRepeatType: "weekly",
      sourceRepeatDays: [4],
      nextRepeatDays: [5]
    },
    expected: [5]
  },
  {
    name: "leaves multi-day weekly patterns untouched",
    input: {
      editScope: "future",
      originalDate: "2025-01-23",
      nextDate: "2025-01-24",
      sourceRepeatType: "weekly",
      nextRepeatType: "weekly",
      sourceRepeatDays: [2, 4],
      nextRepeatDays: [2, 4]
    },
    expected: [2, 4]
  }
]

for (const testCase of cases) {
  const actual = resolveRecurringEditScope(testCase.input)
  assert.equal(actual, testCase.expected, `${testCase.name}: expected ${testCase.expected}, received ${actual}`)
}

for (const testCase of repeatDayCases) {
  const actual = resolveFutureRecurringRepeatDays(testCase.input)
  assert.deepEqual(actual, testCase.expected, `${testCase.name}: expected ${JSON.stringify(testCase.expected)}, received ${JSON.stringify(actual)}`)
}

console.log(`recurring-edit-scope harness passed (${cases.length + repeatDayCases.length} cases)`)
