function resolveRecurringEditScope({ requestedScope = "single", originalDate = "", nextDate = "" } = {}) {
  const normalizedScope = String(requestedScope ?? "single").trim() || "single"
  const normalizedOriginalDate = String(originalDate ?? "").trim()
  const normalizedNextDate = String(nextDate ?? "").trim()

  // Moving a "future" recurring occurrence earlier than its original anchor
  // creates overlapping past/future ranges. Promote to "all" to keep the
  // regenerated series stable instead of partially duplicating rows.
  if (
    normalizedScope === "future" &&
    normalizedOriginalDate &&
    normalizedNextDate &&
    normalizedNextDate < normalizedOriginalDate
  ) {
    return "all"
  }

  return normalizedScope
}

function parseDateKey(dateKey) {
  const raw = String(dateKey ?? "").trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const next = new Date(year, month - 1, day)
  if (next.getFullYear() !== year || next.getMonth() !== month - 1 || next.getDate() !== day) return null
  return next
}

function normalizeRepeatDays(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
  const set = new Set()
  for (const item of raw) {
    const next = Number(item)
    if (!Number.isFinite(next)) continue
    if (next < 0 || next > 6) continue
    set.add(Math.round(next))
  }
  return [...set].sort((a, b) => a - b)
}

function sameRepeatDays(a, b) {
  const left = normalizeRepeatDays(a)
  const right = normalizeRepeatDays(b)
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function resolveFutureRecurringRepeatDays({
  editScope = "single",
  originalDate = "",
  nextDate = "",
  sourceRepeatType = "none",
  nextRepeatType = "none",
  sourceRepeatDays = [],
  nextRepeatDays = []
} = {}) {
  const normalizedScope = String(editScope ?? "single").trim() || "single"
  const normalizedOriginalDate = String(originalDate ?? "").trim()
  const normalizedNextDate = String(nextDate ?? "").trim()
  const normalizedSourceRepeatType = String(sourceRepeatType ?? "none").trim() || "none"
  const normalizedNextRepeatType = String(nextRepeatType ?? "none").trim() || "none"
  const normalizedSourceRepeatDays = normalizeRepeatDays(sourceRepeatDays)
  const normalizedNextRepeatDays = normalizeRepeatDays(nextRepeatDays)

  if (normalizedScope !== "future" && normalizedScope !== "all") return normalizedNextRepeatDays
  if (normalizedSourceRepeatType !== "weekly" || normalizedNextRepeatType !== "weekly") return normalizedNextRepeatDays
  if (!normalizedOriginalDate || !normalizedNextDate || normalizedOriginalDate === normalizedNextDate) return normalizedNextRepeatDays
  if (!sameRepeatDays(normalizedNextRepeatDays, normalizedSourceRepeatDays)) return normalizedNextRepeatDays
  if (normalizedSourceRepeatDays.length !== 1) return normalizedNextRepeatDays

  const parsedNextDate = parseDateKey(normalizedNextDate)
  if (!parsedNextDate) return normalizedNextRepeatDays

  return [parsedNextDate.getDay()]
}

module.exports = { resolveRecurringEditScope, resolveFutureRecurringRepeatDays }
