import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient } from "@supabase/supabase-js"
import DateTimePicker from "@react-native-community/datetimepicker"
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Image,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View
} from "react-native"
import { NavigationContainer, useFocusEffect } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"

const ACCENT_BLUE = "#2b67c7"
const ACCENT_RED = "#d04b4b"

// Dark theme palette (match web app feel: neutral dark surfaces + subtle borders)
const DARK_BG = "#141b26"
const DARK_SURFACE = "#1b1f26"
const DARK_SURFACE_2 = "#232a33"
const DARK_BORDER = "rgba(255, 255, 255, 0.10)"
const DARK_BORDER_SOFT = "rgba(255, 255, 255, 0.07)"
const DARK_TEXT = "#f1f5f9"
const DARK_MUTED = "#a9b4c2"
const DARK_MUTED_2 = "#7f8b9b"
const WINDOW_COLORS = [
  "#c40000",
  "#ff7a00",
  "#ff4a00",
  "#ffe94a",
  "#ffd21a",
  "#dff08a",
  "#86e000",
  "#0b7a0b",
  "#0a5a1f",
  "#7fe8d2",
  "#98ddff",
  "#cfe0ff",
  "#14a7d8",
  "#1f33d6",
  "#1b0f7d",
  "#6b2e8f",
  "#e1c2ff",
  "#ffd1e7"
]

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ""

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      })
    : null

const Tab = createBottomTabNavigator()
const plannerWidgetModule = Platform.OS === "android" ? NativeModules?.PlannerWidgetModule : null

const DEFAULT_WINDOWS = [{ id: "all", title: "통합", color: ACCENT_BLUE, fixed: true }]
const AUTH_STORAGE_KEY = "plannerMobile.auth.v1"
const CLIENT_ID_KEY = "plannerMobile.clientId.v1"
const UI_THEME_KEY = "plannerMobile.ui.theme.v1"
const UI_FONT_SCALE_KEY = "plannerMobile.ui.fontScale.v1"
const PLAN_ALARM_PREFS_KEY = "plannerMobile.planAlarmPrefs.v1"
const PLAN_ALARM_LEAD_PREFS_KEY = "plannerMobile.planAlarmLeadPrefs.v1"
const PLAN_NOTIFICATION_CHANNEL_ID = "planner-reminders"
const PLAN_NOTIFICATION_MAX_COUNT = 60
const PLAN_NOTIFICATION_LOOKAHEAD_DAYS = 180
const ENABLE_LEGACY_BROAD_DELETE_FALLBACK = false

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false
    })
  })
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function dateToKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function clamp(value, min, max) {
  const n = Number(value)
  const lo = Number(min)
  const hi = Number(max)
  if (!Number.isFinite(n)) return Number.isFinite(lo) ? lo : 0
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return n
  if (!Number.isFinite(lo)) return n > hi ? hi : n
  if (!Number.isFinite(hi)) return n < lo ? lo : n
  if (lo > hi) return n < hi ? hi : n > lo ? lo : n
  return n < lo ? lo : n > hi ? hi : n
}

function parseDateKey(dateKey) {
  const parts = String(dateKey ?? "").split("-").map((value) => Number(value))
  if (parts.length !== 3) return null
  const [year, month, day] = parts
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day)
}

function weekdayLabel(dateKey) {
  const dt = parseDateKey(dateKey)
  if (!dt) return ""
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"]
  return weekdays[dt.getDay()] ?? ""
}

function weekdayColor(dateKey, { isHoliday, isDark } = {}) {
  if (isHoliday) return ACCENT_RED
  const dt = parseDateKey(dateKey)
  if (!dt) return isDark ? DARK_TEXT : "#0f172a"
  const dow = dt.getDay()
  if (dow === 0) return ACCENT_RED
  if (dow === 6) return ACCENT_BLUE
  return isDark ? DARK_TEXT : "#0f172a"
}

function formatDateMD(dateKey) {
  const dt = parseDateKey(dateKey)
  if (!dt) return String(dateKey ?? "")
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

function genClientId() {
  const rand = Math.random().toString(16).slice(2)
  return `mobile-${Date.now().toString(16)}-${rand}`
}

function formatTimeHHMM(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return ""
  return `${pad2(dateValue.getHours())}:${pad2(dateValue.getMinutes())}`
}

function normalizeClockTime(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ""
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return ""
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return ""
  return `${pad2(hour)}:${pad2(minute)}`
}

function parseTimeSpanInput(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return { startTime: "", endTime: "", hasInput: false, isValid: true }
  const single = normalizeClockTime(raw)
  if (single) return { startTime: single, endTime: "", hasInput: true, isValid: true }
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*[~-]\s*(\d{1,2}):(\d{2})$/)
  if (!match) return { startTime: "", endTime: "", hasInput: true, isValid: false }
  const startTime = normalizeClockTime(`${match[1]}:${match[2]}`)
  const endTime = normalizeClockTime(`${match[3]}:${match[4]}`)
  if (!startTime) return { startTime: "", endTime: "", hasInput: true, isValid: false }
  if (!endTime || endTime === startTime) return { startTime, endTime: "", hasInput: true, isValid: false }
  return { startTime, endTime, hasInput: true, isValid: true }
}

function normalizePlanTimeRange(row) {
  const parsed = parseTimeSpanInput(row?.time)
  const explicitEnd = normalizeClockTime(row?.end_time ?? row?.endTime)
  const startTime = parsed.startTime
  if (!startTime) return { time: "", endTime: "" }
  let endTime = explicitEnd || parsed.endTime
  if (endTime && endTime === startTime) endTime = ""
  return { time: startTime, endTime }
}

function buildPlanTimeText(time, endTime = "") {
  const start = normalizeClockTime(time)
  if (!start) return ""
  const end = normalizeClockTime(endTime)
  if (end && end !== start) return `${start} ${end}`
  return start
}

function buildPlanTimeTextFromRow(row) {
  const { time, endTime } = normalizePlanTimeRange(row)
  return buildPlanTimeText(time, endTime)
}

function formatPlanTimeForDisplay(row) {
  const { time, endTime } = normalizePlanTimeRange(row)
  const startLabel = formatTimeForDisplay(time)
  if (!startLabel) return ""
  const endLabel = formatTimeForDisplay(endTime)
  if (endLabel) return `${startLabel} ${endLabel}`
  return startLabel
}

function formatTimeForDisplay(timeText) {
  const normalized = normalizeClockTime(timeText)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  if (!match) return ""
  const hour24 = Number(match[1])
  const minute = Number(match[2])
  const ampmLabel = hour24 >= 12 ? "오후" : "오전"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${ampmLabel} ${pad2(hour12)}:${pad2(minute)}`
}

function planDateTimeFromRow(row) {
  const date = parseDateKey(String(row?.date ?? ""))
  if (!date) return null
  const { time } = normalizePlanTimeRange(row)
  const match = String(time).match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const next = new Date(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

function normalizeAlarmLeadMinutes(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(120, Math.round(n)))
}

function useAndroidKeyboardLift(enabled, bottomInset = 0, extraOffset = 18) {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (!enabled || Platform.OS !== "android") return
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0)
    })
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub?.remove?.()
      hideSub?.remove?.()
      setKeyboardHeight(0)
    }
  }, [enabled])

  return useMemo(() => {
    if (Platform.OS !== "android" || keyboardHeight <= 0) return 0
    const inset = Math.max(0, Number(bottomInset) || 0)
    const extra = Math.max(0, Number(extraOffset) || 0)
    return Math.min(420, Math.max(0, keyboardHeight - inset + extra))
  }, [keyboardHeight, bottomInset, extraOffset])
}

const REPEAT_TYPES = ["none", "daily", "weekly", "monthly", "yearly"]
const REPEAT_MAX_OCCURRENCES = 500
const REPEAT_DEFAULT_SPAN_DAYS = 365

function normalizeRepeatType(value) {
  const key = String(value ?? "none").trim().toLowerCase()
  return REPEAT_TYPES.includes(key) ? key : "none"
}

function normalizeRepeatInterval(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(365, Math.round(n)))
}

function normalizeRepeatDays(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
  const set = new Set()
  for (const item of raw) {
    const n = Number(item)
    if (!Number.isFinite(n)) continue
    if (n < 0 || n > 6) continue
    set.add(Math.round(n))
  }
  return [...set].sort((a, b) => a - b)
}

function dateFromDate(dateValue) {
  return new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
}

function dateKeyFromDate(dateValue) {
  return dateToKey(dateValue.getFullYear(), dateValue.getMonth() + 1, dateValue.getDate())
}

function addDays(dateValue, amount) {
  const next = new Date(dateValue)
  next.setDate(next.getDate() + amount)
  return dateFromDate(next)
}

function addMonthsClamped(dateValue, amount) {
  const target = new Date(dateValue.getFullYear(), dateValue.getMonth(), 1)
  target.setMonth(target.getMonth() + amount)
  const y = target.getFullYear()
  const m = target.getMonth()
  const maxDay = new Date(y, m + 1, 0).getDate()
  const d = Math.min(dateValue.getDate(), maxDay)
  return new Date(y, m, d)
}

function addYearsClamped(dateValue, amount) {
  const y = dateValue.getFullYear() + amount
  const m = dateValue.getMonth()
  const maxDay = new Date(y, m + 1, 0).getDate()
  const d = Math.min(dateValue.getDate(), maxDay)
  return new Date(y, m, d)
}

function normalizeRepeatMeta(input) {
  const repeatType = normalizeRepeatType(input?.repeat_type ?? input?.repeatType)
  const repeatInterval = normalizeRepeatInterval(input?.repeat_interval ?? input?.repeatInterval)
  const rawUntil = String(input?.repeat_until ?? input?.repeatUntil ?? "").trim()
  const untilDate = parseDateKey(rawUntil)
  const repeatUntil = repeatType === "none" ? null : untilDate ? dateKeyFromDate(untilDate) : null

  let repeatDays = null
  if (repeatType === "weekly") {
    const parsedDays = normalizeRepeatDays(input?.repeat_days ?? input?.repeatDays)
    if (parsedDays.length > 0) {
      repeatDays = parsedDays
    } else {
      const start = parseDateKey(String(input?.date ?? ""))
      repeatDays = [start ? start.getDay() : 1]
    }
  }

  const seriesRaw = String(input?.series_id ?? input?.seriesId ?? "").trim()
  const seriesId = seriesRaw || null

  return {
    repeatType,
    repeatInterval,
    repeatDays,
    repeatUntil,
    seriesId
  }
}

function genSeriesId() {
  // Keep a UUID-looking key so it works even when series_id column is uuid type.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16)
    const v = ch === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function generateRecurringDateKeys({
  startDateKey,
  repeatType,
  repeatInterval = 1,
  repeatDays = [],
  repeatUntilKey = null,
  spanDays = REPEAT_DEFAULT_SPAN_DAYS,
  maxOccurrences = REPEAT_MAX_OCCURRENCES
}) {
  const start = parseDateKey(startDateKey)
  if (!start) return []

  const startDate = dateFromDate(start)
  const parsedUntil = repeatUntilKey ? parseDateKey(repeatUntilKey) : null
  const untilDate = parsedUntil ? dateFromDate(parsedUntil) : addDays(startDate, Math.max(1, spanDays))
  const endDate = untilDate < startDate ? startDate : untilDate

  const kind = normalizeRepeatType(repeatType)
  const step = normalizeRepeatInterval(repeatInterval)
  const seen = new Set()
  const out = []

  const pushDate = (dateValue) => {
    if (dateValue < startDate || dateValue > endDate) return
    const key = dateKeyFromDate(dateValue)
    if (seen.has(key)) return
    seen.add(key)
    out.push(key)
  }

  if (kind === "none") {
    pushDate(startDate)
    return out
  }

  if (kind === "daily") {
    for (let i = 0; i < maxOccurrences; i += 1) {
      const next = addDays(startDate, i * step)
      if (next > endDate) break
      pushDate(next)
    }
    return out
  }

  if (kind === "weekly") {
    const days = normalizeRepeatDays(repeatDays)
    const targets = days.length > 0 ? days : [startDate.getDay()]
    const startWeek = addDays(startDate, -startDate.getDay())
    for (let weekOffset = 0; weekOffset < maxOccurrences * 2; weekOffset += step) {
      const weekBase = addDays(startWeek, weekOffset * 7)
      if (weekBase > endDate) break
      for (const dayOfWeek of targets) {
        const next = addDays(weekBase, dayOfWeek)
        if (next > endDate) continue
        if (next < startDate) continue
        pushDate(next)
        if (out.length >= maxOccurrences) break
      }
      if (out.length >= maxOccurrences) break
    }
    out.sort()
    return out
  }

  if (kind === "monthly") {
    for (let i = 0; i < maxOccurrences; i += 1) {
      const next = addMonthsClamped(startDate, i * step)
      if (next > endDate) break
      pushDate(next)
    }
    return out
  }

  if (kind === "yearly") {
    for (let i = 0; i < maxOccurrences; i += 1) {
      const next = addYearsClamped(startDate, i * step)
      if (next > endDate) break
      pushDate(next)
    }
    return out
  }

  pushDate(startDate)
  return out
}

function buildCombinedMemoText(windows, rightMemos) {
  const items = (windows ?? []).filter((w) => w && w.id !== "all")
  const lines = []
  let prevHadBody = false
  for (const w of items) {
    const body = String(rightMemos?.[w.id] ?? "").trimEnd()
    if (prevHadBody) lines.push("")
    lines.push(`[${w.title}]`)
    if (body) {
      lines.push(body)
      prevHadBody = true
    } else {
      prevHadBody = false
    }
  }
  return lines.join("\n").trimEnd()
}

function splitCombinedMemoText(text, windows) {
  const items = (windows ?? []).filter((w) => w && w.id !== "all")
  const titleToId = new Map(items.map((w) => [String(w.title ?? ""), String(w.id ?? "")]))
  const windowLinesById = new Map(items.map((w) => [String(w.id ?? ""), []]))
  let currentSection = ""

  const lines = String(text ?? "").split("\n")
  for (const rawLine of lines) {
    const headerMatch = rawLine.match(/^\s*\[(.+)\](.*)$/)
    if (headerMatch) {
      const title = String(headerMatch[1] ?? "")
      const id = titleToId.get(title)
      if (id) {
        currentSection = id
        const rest = String(headerMatch[2] ?? "").replace(/^\s+/, "")
        if (rest) {
          const bucket = windowLinesById.get(id) ?? []
          bucket.push(rest)
          windowLinesById.set(id, bucket)
        }
        continue
      }
    }

    if (!currentSection) continue
    const bucket = windowLinesById.get(currentSection) ?? []
    bucket.push(rawLine)
    windowLinesById.set(currentSection, bucket)
  }

  const windowTexts = {}
  for (const w of items) {
    const id = String(w.id ?? "")
    if (!id) continue
    windowTexts[id] = (windowLinesById.get(id) ?? []).join("\n").trimEnd()
  }
  return { windowTexts }
}

function formatLine(item) {
  const time = buildPlanTimeTextFromRow(item)
  const text = String(item?.content ?? "").trim()
  return { time, text }
}

function splitTimeLabel(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return { start: "", end: "" }
  const rangeMatch = raw.match(/^(\d{1,2}:\d{2})\s*[~\-–—]\s*(\d{1,2}:\d{2})$/)
  if (rangeMatch) {
    const start = normalizeClockTime(rangeMatch[1])
    const end = normalizeClockTime(rangeMatch[2])
    if (start && end && start !== end) return { start, end }
    return { start: start || raw, end: "" }
  }
  const spaceMatch = raw.match(/^(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})$/)
  if (spaceMatch) {
    const start = normalizeClockTime(spaceMatch[1])
    const end = normalizeClockTime(spaceMatch[2])
    if (start && end && start !== end) return { start, end }
    return { start: start || raw, end: "" }
  }
  return { start: raw, end: "" }
}

function buildWidgetLineText(row) {
  const content = String(row?.content ?? "").trim()
  if (!content) return ""
  const category = String(row?.category_id ?? "").trim()
  if (!category || category === "__general__") return content
  return `[${category}] ${content}`
}

function buildWidgetCalendarText(row) {
  const content = String(row?.content ?? "").trim()
  if (!content) return ""
  const time = buildPlanTimeTextFromRow(row)
  return [time, content].filter(Boolean).join(" ").trim()
}

function buildWidgetDayHeaderLabel(dateKey, todayKey) {
  const dt = parseDateKey(dateKey)
  if (!dt) return String(dateKey ?? "")
  const base = `${dt.getMonth() + 1}/${dt.getDate()} (${weekdayLabel(dateKey)})`
  if (dateKey === todayKey) return `오늘 ${base}`
  return base
}

function buildWeekWidgetPayload(allPlans, startDateKey) {
  const parsedStart = parseDateKey(startDateKey)
  const startDate = parsedStart ? dateFromDate(parsedStart) : dateFromDate(new Date())
  const todayKey = dateKeyFromDate(startDate)
  const rows = []

  for (let i = 0; i < 5; i += 1) {
    const day = addDays(startDate, i)
    const dateKey = dateKeyFromDate(day)
    rows.push({
      type: "header",
      text: buildWidgetDayHeaderLabel(dateKey, todayKey)
    })

    const items = sortItemsByTimeAndOrder(
      (allPlans ?? []).filter((row) => {
        if (!row || row?.deleted_at) return false
        if (String(row?.date ?? "").trim() !== dateKey) return false
        return Boolean(String(row?.content ?? "").trim())
      })
    )

    if (items.length === 0) continue
    for (const row of items) {
      const text = buildWidgetLineText(row)
      const time = buildPlanTimeTextFromRow(row)
      if (!time && !text) continue
      rows.push({ type: "item", time, text })
    }
  }

  return {
    rows,
    emptyText: "오늘 포함 5일 내 일정이 없습니다."
  }
}

function buildCalendarWidgetPayload(allPlans, anchorDateKey) {
  const parsedAnchor = parseDateKey(anchorDateKey)
  const anchor = parsedAnchor ? dateFromDate(parsedAnchor) : dateFromDate(new Date())
  const now = dateFromDate(new Date())
  const grouped = new Map()
  for (const row of allPlans ?? []) {
    if (!row || row?.deleted_at) continue
    const key = String(row?.date ?? "").trim()
    if (!parseDateKey(key)) continue
    if (!String(row?.content ?? "").trim()) continue
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  const itemsByDate = {}
  for (const [key, rows] of grouped.entries()) {
    const lines = sortItemsByTimeAndOrder(rows)
      .map((row) => buildWidgetCalendarText(row))
      .filter(Boolean)
    if (lines.length > 0) {
      itemsByDate[key] = lines
    }
  }

  return {
    title: `${anchor.getMonth() + 1}월`,
    anchorDateKey: dateKeyFromDate(anchor),
    todayKey: dateKeyFromDate(now),
    itemsByDate,
    emptyText: "표시할 일정이 없습니다."
  }
}

function buildWidgetsPayload(allPlans, todayKey) {
  return {
    list: buildWeekWidgetPayload(allPlans, todayKey),
    calendar: buildCalendarWidgetPayload(allPlans, todayKey),
    updatedAt: new Date().toISOString()
  }
}

async function syncAndroidWidgetPayload(payload) {
  if (Platform.OS !== "android") return
  if (!plannerWidgetModule || typeof plannerWidgetModule.setPayload !== "function") return
  try {
    await plannerWidgetModule.setPayload(JSON.stringify(payload ?? {}))
  } catch (_e) {
    // ignore
  }
}

function runSwapLayoutAnimation() {
  if (Platform.OS === "web") return
  LayoutAnimation.configureNext({
    duration: 90,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity
    }
  })
}

function isRenderablePlanRow(row) {
  if (!row || typeof row !== "object") return false
  const dateKey = String(row?.date ?? "").trim()
  const content = String(row?.content ?? "").trim()
  return Boolean(dateKey && content)
}

function normalizeWindowTitle(value) {
  return String(value ?? "").trim()
}

function parseMemoSections(text) {
  const lines = String(text ?? "").split(/\r?\n/)
  const sections = []
  let current = null
  for (const raw of lines) {
    const line = String(raw ?? "")
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (match) {
      if (current) sections.push(current)
      current = { title: match[1], body: [] }
      continue
    }
    if (!current) current = { title: "메모", body: [] }
    current.body.push(line)
  }
  if (current) sections.push(current)
  return sections
}

function parseSortOrderValue(value) {
  if (value == null) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseTimestampMs(value) {
  if (value == null) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value === "number" && Number.isFinite(value)) return value
  const ms = Date.parse(String(value))
  return Number.isNaN(ms) ? null : ms
}

function sortItemsByTimeAndOrder(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length <= 1) return list
  const meta = list.map((row, idx) => {
    const sortOrder = parseSortOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order)
    const createdAtMs = parseTimestampMs(row?.created_at ?? row?.createdAt)
    const updatedAtMs = parseTimestampMs(row?.updated_at ?? row?.updatedAt)
    const id = row?.id != null ? String(row.id) : ""
    return { row, sortOrder, createdAtMs, updatedAtMs, id, idx }
  })
  const hasSortOrder = meta.some((item) => item.sortOrder != null)
  const hasFallbackOrder = meta.some((item) => item.createdAtMs != null || item.updatedAtMs != null)
  if (hasSortOrder || hasFallbackOrder) {
    return [...meta]
      .sort((a, b) => {
      const oa = a.sortOrder
      const ob = b.sortOrder
      if (!(oa == null && ob == null)) {
        if (oa == null) return 1
        if (ob == null) return -1
        if (oa !== ob) return oa - ob
      }
      const ca = a.createdAtMs
      const cb = b.createdAtMs
      if (ca != null || cb != null) {
        if (ca == null) return 1
        if (cb == null) return -1
        if (ca !== cb) return ca - cb
      }
      const ua = a.updatedAtMs
      const ub = b.updatedAtMs
      if (ua != null || ub != null) {
        if (ua == null) return 1
        if (ub == null) return -1
        if (ua !== ub) return ua - ub
      }
      if (a.id && b.id && a.id !== b.id) return a.id.localeCompare(b.id, "en")
      if (a.id && !b.id) return -1
      if (!a.id && b.id) return 1
      return a.idx - b.idx
      })
      .map((entry) => entry.row)
  }
  return list
}

function diffDays(a, b) {
  const one = dateFromDate(a)
  const two = dateFromDate(b)
  return Math.round((two.getTime() - one.getTime()) / 86400000)
}

function monthDiff(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function inferLegacyRepeatMetaForItem(items, item) {
  const baseDate = parseDateKey(String(item?.date ?? ""))
  if (!baseDate) {
    return { repeatType: "none", repeatInterval: 1, repeatDays: null, repeatUntil: null, hasHint: false }
  }

  const baseCategory = String(item?.category_id ?? "__general__").trim() || "__general__"
  const baseContent = String(item?.content ?? "").trim()
  const baseTimeRange = normalizePlanTimeRange(item)
  const baseTime = baseTimeRange.time
  const baseEndTime = baseTimeRange.endTime
  const baseKey = dateKeyFromDate(baseDate)

  const matched = (items ?? []).filter((row) => {
    if (!row) return false
    const rowCategory = String(row?.category_id ?? "__general__").trim() || "__general__"
    const rowContent = String(row?.content ?? "").trim()
    const rowTimeRange = normalizePlanTimeRange(row)
    const rowTime = rowTimeRange.time
    const rowEndTime = rowTimeRange.endTime
    if (rowCategory !== baseCategory) return false
    if (rowContent !== baseContent) return false
    if (rowTime !== baseTime) return false
    if (rowEndTime !== baseEndTime) return false
    return Boolean(parseDateKey(String(row?.date ?? "")))
  })

  if (matched.length <= 1) {
    return { repeatType: "none", repeatInterval: 1, repeatDays: null, repeatUntil: null, hasHint: false }
  }

  const uniqueDates = [...new Set(matched.map((row) => String(row?.date ?? "").trim()).filter(Boolean))]
    .map((key) => parseDateKey(key))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())

  const futureDates = uniqueDates.filter((d) => dateKeyFromDate(d) >= baseKey)
  // If this is the last occurrence, infer from the whole legacy chain so repeat UI still shows.
  const targetDates = futureDates.length >= 2 ? futureDates : uniqueDates

  if (targetDates.length <= 1) {
    return {
      repeatType: "none",
      repeatInterval: 1,
      repeatDays: null,
      repeatUntil: null,
      hasHint: matched.length > 1
    }
  }

  const dayDiffs = []
  for (let i = 1; i < targetDates.length; i += 1) {
    dayDiffs.push(diffDays(targetDates[i - 1], targetDates[i]))
  }
  const allSameDayDiff = dayDiffs.length > 0 && dayDiffs.every((d) => d === dayDiffs[0] && d > 0)

  let repeatType = "none"
  let repeatInterval = 1
  let repeatDays = null

  if (allSameDayDiff) {
    const step = dayDiffs[0]
    if (step % 7 === 0) {
      repeatType = "weekly"
      repeatInterval = Math.max(1, Math.round(step / 7))
      repeatDays = [targetDates[0].getDay()]
    } else {
      repeatType = "daily"
      repeatInterval = Math.max(1, step)
    }
  } else {
    const sameDayOfMonth = targetDates.every((d) => d.getDate() === targetDates[0].getDate())
    const monthDiffs = []
    for (let i = 1; i < targetDates.length; i += 1) {
      monthDiffs.push(monthDiff(targetDates[i - 1], targetDates[i]))
    }
    const allSameMonthDiff = monthDiffs.length > 0 && monthDiffs.every((d) => d === monthDiffs[0] && d > 0)

    if (sameDayOfMonth && allSameMonthDiff) {
      const months = monthDiffs[0]
      if (months % 12 === 0) {
        repeatType = "yearly"
        repeatInterval = Math.max(1, Math.round(months / 12))
      } else {
        repeatType = "monthly"
        repeatInterval = months
      }
    } else {
      // ambiguous legacy series: keep it editable as a recurrence.
      repeatType = "daily"
      repeatInterval = 1
    }
  }

  return {
    repeatType,
    repeatInterval,
    repeatDays,
    repeatUntil: dateKeyFromDate(targetDates[targetDates.length - 1]),
    hasHint: true
  }
}

function buildPlanEditorSnapshot({
  date = "",
  time = "",
  endTime = "",
  content = "",
  category = "__general__",
  alarmEnabled = true,
  alarmLeadMinutes = 0,
  repeatType = "none",
  repeatInterval = 1,
  repeatDays = [],
  repeatUntil = ""
}) {
  const normalizedRepeatType = normalizeRepeatType(repeatType)
  const normalizedRepeatInterval =
    normalizedRepeatType === "none" ? 1 : normalizeRepeatInterval(repeatInterval)
  const normalizedTime = normalizeClockTime(time)
  let normalizedEndTime = normalizeClockTime(endTime)
  if (!normalizedTime || !normalizedEndTime || normalizedEndTime === normalizedTime) normalizedEndTime = ""
  const normalizedAlarmEnabled = Boolean(normalizedTime) ? Boolean(alarmEnabled) : false
  return {
    date: String(date ?? ""),
    time: normalizedTime,
    endTime: normalizedEndTime,
    content: String(content ?? "").trim(),
    category: String(category ?? "__general__") || "__general__",
    alarmEnabled: normalizedAlarmEnabled,
    alarmLeadMinutes: normalizedAlarmEnabled ? normalizeAlarmLeadMinutes(alarmLeadMinutes) : 0,
    repeatType: normalizedRepeatType,
    repeatInterval: normalizedRepeatInterval,
    repeatDays: normalizedRepeatType === "weekly" ? normalizeRepeatDays(repeatDays) : [],
    repeatUntil: normalizedRepeatType === "none" ? "" : String(repeatUntil ?? "").trim()
  }
}

function LogoMark({ tone = "light", size = 38 }) {
  const isDark = tone === "dark"
  const highlightSize = Math.max(10, Math.round(size * 0.32))
  const highlightInset = Math.max(5, Math.round(size * 0.16))
  const radius = Math.round(size * 0.37)
  const fontSize = Math.round(size * 0.42)
  return (
    <View style={[styles.headerLogo, { width: size, height: size, borderRadius: radius }, isDark ? styles.headerLogoDark : null]}>
      <View
        pointerEvents="none"
        style={[styles.headerLogoHighlight, { top: highlightInset, left: highlightInset, width: highlightSize, height: highlightSize }]}
      />
      <Text style={[styles.headerLogoText, { fontSize }]} accessibilityLabel="Planner">
        P
      </Text>
    </View>
  )
}

function Header({
  title,
  subtitle,
  loading,
  onSignOut,
  todayLabel,
  onToday,
  onFilter,
  filterActive = false,
  tone = "light",
  showLogo = true,
  titleStyle,
  buttonsStyle
}) {
  const isDark = tone === "dark"
  const hasSubtitle = String(subtitle ?? "").trim().length > 0
  return (
    <View style={[styles.header, isDark ? styles.headerDark : null]}>
      <View style={styles.headerLeft}>
        {hasSubtitle ? (
          <>
            {showLogo ? <LogoMark tone={tone} size={38} /> : null}
            <View style={!showLogo ? styles.headerTitleWrapNoLogo : null}>
              <Text
                style={[
                  styles.title,
                  isDark ? styles.titleDark : null,
                  titleStyle,
                  !showLogo ? styles.headerTitleTranslateDown : null
                ]}
              >
                {title}
              </Text>
              <Text style={[styles.subtitle, isDark ? styles.subtitleDark : null]}>{subtitle}</Text>
            </View>
          </>
        ) : (
          <View style={[!showLogo ? styles.headerBrandOnlyWrap : null, buttonsStyle]}>
            <View style={styles.headerBrandOnlyLogoBoost}>
              <LogoMark tone={tone} size={38} />
            </View>
          </View>
        )}
      </View>
      <View style={[styles.headerButtons, buttonsStyle]}>
        {onToday && todayLabel ? (
          <TouchableOpacity
            style={[styles.headerTodayButton, isDark ? styles.ghostButtonDark : null]}
            onPress={onToday}
            accessibilityRole="button"
            accessibilityLabel="Today"
          >
            <Text style={[styles.headerTodayText, isDark ? styles.headerTodayTextDark : null]}>{todayLabel}</Text>
          </TouchableOpacity>
        ) : null}
        {onFilter ? (
          <TouchableOpacity
            style={[styles.headerFilterButton, isDark ? styles.ghostButtonDark : null]}
            onPress={onFilter}
            accessibilityRole="button"
            accessibilityLabel="Filter"
          >
            <Image
              source={require("./assets/filter.png")}
              style={[styles.headerFilterIconImg, isDark ? styles.headerFilterIconImgDark : null]}
              resizeMode="contain"
            />
            {filterActive ? <View style={styles.headerFilterActiveDot} /> : null}
          </TouchableOpacity>
        ) : null}
        {onSignOut ? (
          <TouchableOpacity
            style={[styles.ghostButton, isDark ? styles.ghostButtonDark : null]}
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={[styles.ghostButtonText, isDark ? styles.ghostButtonTextDark : null]}>{"\u2699"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function SettingsSheet({ visible, themeMode, fontScale, onChangeTheme, onChangeFontScale, onRefresh, onLogout, onClose }) {
  const isDark = themeMode === "dark"
  const insets = useSafeAreaInsets()
  const sheetBottomInset = useMemo(
    () => (Platform.OS === "android" ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 22)),
    [insets.bottom]
  )
  const keyboardLift = useAndroidKeyboardLift(visible, sheetBottomInset, 24)
  const sheetCardStyle = useMemo(
    () => ({
      marginBottom: sheetBottomInset,
      transform: [{ translateY: -keyboardLift }]
    }),
    [sheetBottomInset, keyboardLift]
  )
  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetCard, isDark ? styles.sheetCardDark : null, sheetCardStyle]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>설정</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onClose} style={[styles.sheetBtnGhost, isDark ? styles.sheetBtnGhostDark : null]}>
                <Text style={[styles.sheetBtnGhostText, isDark ? styles.textDark : null]}>닫기</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.settingsList}>
            <View style={styles.settingsRow}>
              <Text style={[styles.settingsLabel, isDark ? styles.textDark : null]}>테마</Text>
              <View style={[styles.settingsSegment, isDark ? styles.settingsSegmentDark : null]}>
                <Pressable
                  onPress={() => onChangeTheme?.("light")}
                  style={[
                    styles.settingsSegBtn,
                    themeMode === "light"
                      ? isDark
                        ? styles.settingsSegBtnActiveDark
                        : styles.settingsSegBtnActive
                      : null
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsSegText,
                      isDark ? styles.settingsSegTextDark : null,
                      themeMode === "light"
                        ? isDark
                          ? styles.settingsSegTextActiveDark
                          : styles.settingsSegTextActive
                        : null
                    ]}
                  >
                    라이트
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onChangeTheme?.("dark")}
                  style={[
                    styles.settingsSegBtn,
                    themeMode === "dark"
                      ? isDark
                        ? styles.settingsSegBtnActiveDark
                        : styles.settingsSegBtnActive
                      : null
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsSegText,
                      isDark ? styles.settingsSegTextDark : null,
                      themeMode === "dark"
                        ? isDark
                          ? styles.settingsSegTextActiveDark
                          : styles.settingsSegTextActive
                        : null
                    ]}
                  >
                    다크
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.settingsRow}>
              <Text style={[styles.settingsLabel, isDark ? styles.textDark : null]}>글씨 크기</Text>
              <View style={[styles.settingsSegment, isDark ? styles.settingsSegmentDark : null]}>
                {[0.9, 1, 1.1].map((scale) => {
                  const active = Math.abs((fontScale ?? 1) - scale) < 0.001
                  const label = scale === 0.9 ? "작게" : scale === 1 ? "보통" : "크게"
                  return (
                    <Pressable
                      key={String(scale)}
                      onPress={() => onChangeFontScale?.(scale)}
                      style={[
                        styles.settingsSegBtn,
                        active ? (isDark ? styles.settingsSegBtnActiveDark : styles.settingsSegBtnActive) : null
                      ]}
                    >
                      <Text
                        style={[
                          styles.settingsSegText,
                          isDark ? styles.settingsSegTextDark : null,
                          active ? (isDark ? styles.settingsSegTextActiveDark : styles.settingsSegTextActive) : null
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            {onRefresh ? (
              <Pressable
                style={styles.settingsRefreshBtn}
                onPress={() => {
                  onRefresh?.()
                  onClose?.()
                }}
              >
                <Text style={styles.settingsRefreshText}>새로고침</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.settingsLogoutBtn} onPress={onLogout}>
              <Text style={styles.settingsLogoutText}>로그아웃</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function WindowTabs({
  windows,
  activeId,
  onSelect,
  onAddWindow,
  onRenameWindow,
  onDeleteWindow,
  onChangeWindowColor,
  onReorderWindows,
  tone = "light"
}) {
  const isDark = tone === "dark"
  const insets = useSafeAreaInsets()
  const [menuWindow, setMenuWindow] = useState(null)
  const [menuVisible, setMenuVisible] = useState(false)
  const [addVisible, setAddVisible] = useState(false)
  const [renameVisible, setRenameVisible] = useState(false)
  const [colorVisible, setColorVisible] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftColor, setDraftColor] = useState(ACCENT_BLUE)
  const sheetBottomInset = useMemo(
    () => (Platform.OS === "android" ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 22)),
    [insets.bottom]
  )
  const keyboardLift = useAndroidKeyboardLift(
    addVisible || renameVisible || colorVisible || menuVisible,
    sheetBottomInset,
    24
  )
  const sheetCardStyle = useMemo(
    () => ({
      marginBottom: sheetBottomInset,
      transform: [{ translateY: -keyboardLift }]
    }),
    [sheetBottomInset, keyboardLift]
  )

  const palette = useMemo(
    () => WINDOW_COLORS,
    []
  )

  const nextDefaultColor = useMemo(() => {
    const used = new Set((windows ?? []).map((w) => String(w?.color ?? "").toLowerCase()).filter(Boolean))
    const available = palette.find((c) => !used.has(String(c).toLowerCase()))
    return available ?? palette[(windows?.length ?? 1) % palette.length] ?? palette[0]
  }, [palette, windows])

  const tabs = useMemo(() => windows ?? [], [windows])
  const fixedTabs = useMemo(() => tabs.filter((w) => Boolean(w?.fixed)), [tabs])
  const movableTabs = useMemo(() => tabs.filter((w) => !w?.fixed), [tabs])
  const tabsScrollRef = useRef(null)
  const tabLayoutsRef = useRef({})
  const tabDragOrderRef = useRef(movableTabs)
  const dragStateRef = useRef({ activeId: null, startX: 0, width: 0, currentIndex: -1, lastSwapAt: 0 })
  const dragX = useRef(new Animated.Value(0)).current
  const [tabDragOrder, setTabDragOrder] = useState(movableTabs)
  const [draggingTabId, setDraggingTabId] = useState(null)

  useEffect(() => {
    if (Platform.OS !== "android") return
    if (typeof UIManager?.setLayoutAnimationEnabledExperimental !== "function") return
    UIManager.setLayoutAnimationEnabledExperimental(true)
  }, [])

  useEffect(() => {
    if (draggingTabId) return
    setTabDragOrder(movableTabs)
    tabDragOrderRef.current = movableTabs
  }, [movableTabs, draggingTabId])

  function closeAll() {
    setMenuVisible(false)
    setAddVisible(false)
    setRenameVisible(false)
    setColorVisible(false)
  }

  function openAdd() {
    setMenuWindow(null)
    setDraftTitle("")
    setDraftColor(nextDefaultColor)
    setAddVisible(true)
  }

  const isAddDraftDirty = useMemo(() => {
    const titleDirty = String(draftTitle ?? "").trim().length > 0
    const colorDirty = String(draftColor ?? "").toLowerCase() !== String(nextDefaultColor ?? "").toLowerCase()
    return titleDirty || colorDirty
  }, [draftTitle, draftColor, nextDefaultColor])

  function requestCloseAddSheet() {
    if (!isAddDraftDirty) {
      setAddVisible(false)
      return
    }
    Alert.alert("삭제하시겠습니까?", "작성 중인 새 탭 정보가 사라집니다.", [
      { text: "수정 계속", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          setDraftTitle("")
          setDraftColor(nextDefaultColor)
          setAddVisible(false)
        }
      }
    ])
  }

  function openMenu(windowItem) {
    if (!windowItem || windowItem.id === "all") return
    setMenuWindow(windowItem)
    setMenuVisible(true)
  }

  function openRename() {
    if (!menuWindow) return
    setDraftTitle(String(menuWindow.title ?? ""))
    setMenuVisible(false)
    setRenameVisible(true)
  }

  function openColors() {
    if (!menuWindow) return
    setMenuVisible(false)
    setColorVisible(true)
  }

  function requestDelete() {
    if (!menuWindow) return
    const title = String(menuWindow.title ?? "")
    setMenuVisible(false)
    Alert.alert("삭제", `"${title}" 탭을 삭제할까요?\n(해당 탭의 일정/메모는 모두 삭제됩니다)` , [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          await onDeleteWindow?.(menuWindow)
          closeAll()
        }
      }
    ])
  }

  function moveItem(list, fromIndex, toIndex) {
    const next = Array.isArray(list) ? [...list] : []
    if (fromIndex === toIndex) return next
    if (fromIndex < 0 || toIndex < 0) return next
    if (fromIndex >= next.length || toIndex >= next.length) return next
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  function idsEqual(a, b) {
    const left = Array.isArray(a) ? a : []
    const right = Array.isArray(b) ? b : []
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (String(left[i] ?? "") !== String(right[i] ?? "")) return false
    }
    return true
  }

  function getTabMidpoint(id) {
    const key = String(id ?? "")
    if (!key) return null
    const layout = tabLayoutsRef.current?.[key]
    if (!layout) return null
    const x = Number(layout.x ?? 0)
    const width = Number(layout.width ?? 0)
    if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return null
    return x + width / 2
  }

  function startTabDrag(windowItem) {
    if (!onReorderWindows) return
    if (!windowItem || windowItem?.fixed) return
    const id = String(windowItem?.id ?? "").trim()
    if (!id) return
    const layout = tabLayoutsRef.current?.[id]
    if (!layout) return
    const initial = movableTabs
    const initialIndex = initial.findIndex((w) => String(w?.id ?? "") === id)
    if (initialIndex < 0) return
    dragStateRef.current = {
      activeId: id,
      startX: Number(layout.x ?? 0),
      width: Math.max(1, Number(layout.width ?? 0)),
      currentIndex: initialIndex,
      lastSwapAt: 0
    }
    dragX.setValue(Number(layout.x ?? 0))
    setTabDragOrder(initial)
    tabDragOrderRef.current = initial
    setDraggingTabId(id)
  }

  function finishTabDrag() {
    const state = dragStateRef.current
    if (!state.activeId) return
    const activeId = String(state.activeId ?? "")
    const orderedMovable = Array.isArray(tabDragOrderRef.current) ? tabDragOrderRef.current : []
    const orderedIds = orderedMovable.map((w) => String(w?.id ?? "")).filter(Boolean)
    const prevIds = movableTabs.map((w) => String(w?.id ?? "")).filter(Boolean)
    const cleanup = () => {
      dragStateRef.current = { activeId: null, startX: 0, width: 0, currentIndex: -1, lastSwapAt: 0 }
      setDraggingTabId(null)
    }

    dragX.stopAnimation((currentX) => {
      const rawTarget = Number(tabLayoutsRef.current?.[activeId]?.x ?? Number.NaN)
      const fallback = Number.isFinite(currentX) ? currentX : Number(state.startX ?? 0)
      const targetX = Number.isFinite(rawTarget) ? rawTarget : fallback
      Animated.timing(dragX, {
        toValue: targetX,
        duration: 110,
        useNativeDriver: false
      }).start(() => {
        cleanup()
      })
    })

    if (onReorderWindows && orderedIds.length > 0 && !idsEqual(orderedIds, prevIds)) {
      onReorderWindows(orderedMovable)
    }
  }

  const tabPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(dragStateRef.current.activeId),
        onStartShouldSetPanResponderCapture: () => Boolean(dragStateRef.current.activeId),
        onMoveShouldSetPanResponder: () => Boolean(dragStateRef.current.activeId),
        onMoveShouldSetPanResponderCapture: () => Boolean(dragStateRef.current.activeId),
        onPanResponderMove: (_evt, gesture) => {
          const state = dragStateRef.current
          if (!state.activeId) return
          const nextX = Number(state.startX ?? 0) + Number(gesture?.dx ?? 0)
          dragX.setValue(nextX)
          const list = tabDragOrderRef.current
          if (!Array.isArray(list) || list.length === 0) return
          const now = Date.now()
          if (now - Number(state.lastSwapAt ?? 0) < 70) return
          const centerX = nextX + Number(state.width ?? 0) / 2
          const deadZone = Math.max(10, Math.min(22, Number(state.width ?? 0) * 0.15))
          let currentIndex = Number(state.currentIndex ?? -1)
          if (!Number.isFinite(currentIndex) || currentIndex < 0 || currentIndex >= list.length) {
            currentIndex = list.findIndex((w) => String(w?.id ?? "") === state.activeId)
          }
          if (currentIndex < 0) return
          let targetIndex = currentIndex

          while (targetIndex < list.length - 1) {
            const rightId = String(list[targetIndex + 1]?.id ?? "")
            const rightMid = getTabMidpoint(rightId)
            if (!Number.isFinite(rightMid)) break
            if (centerX > rightMid + deadZone) targetIndex += 1
            else break
          }

          while (targetIndex > 0) {
            const leftId = String(list[targetIndex - 1]?.id ?? "")
            const leftMid = getTabMidpoint(leftId)
            if (!Number.isFinite(leftMid)) break
            if (centerX < leftMid - deadZone) targetIndex -= 1
            else break
          }

          if (targetIndex === currentIndex) return
          if (typeof LayoutAnimation?.configureNext === "function") {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          }
          const nextOrder = moveItem(list, currentIndex, targetIndex)
          tabDragOrderRef.current = nextOrder
          dragStateRef.current = { ...state, currentIndex: targetIndex, lastSwapAt: now }
          setTabDragOrder(nextOrder)
        },
        onPanResponderRelease: () => finishTabDrag(),
        onPanResponderTerminate: () => finishTabDrag(),
        onPanResponderTerminationRequest: () => false
      }),
    [movableTabs, onReorderWindows]
  )

  function renderTabPill(windowItem, options = {}) {
    if (!windowItem) return null
    const { ghost = false, placeholder = false, onLayout, onLongPress } = options
    const active = windowItem.id === activeId
    const isAll = windowItem.id === "all"
    const label = String(windowItem.title ?? (isAll ? "통합" : ""))
    const pillStyle = [
      styles.tabPill,
      isAll ? styles.tabPillAll : null,
      isDark ? styles.tabPillDark : null,
      active ? (isDark ? styles.tabPillActiveDark : styles.tabPillActive) : null,
      ghost ? styles.tabPillGhost : null,
      ghost && isDark ? styles.tabPillGhostDark : null,
      placeholder ? styles.tabPillPlaceholder : null
    ]
    const labelStyle = [
      styles.tabText,
      isAll ? styles.tabTextAll : null,
      isDark ? styles.tabTextDark : null,
      active ? (isDark ? styles.tabTextActiveDark : styles.tabTextActive) : null
    ]
    const content = (
      <>
        {!isAll ? (
          <View style={[styles.tabDot, { backgroundColor: windowItem.color || "#3b82f6" }]} />
        ) : null}
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
        {!isAll ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.()
              openMenu(windowItem)
            }}
            onLongPress={(e) => {
              e?.stopPropagation?.()
            }}
            hitSlop={10}
            style={styles.tabMenuBtn}
          >
            <Text style={styles.tabMenuIcon}>{"\u22EE"}</Text>
          </Pressable>
        ) : null}
      </>
    )
    if (ghost) {
      return (
        <View style={pillStyle}>
          {content}
        </View>
      )
    }
    return (
      <TouchableOpacity
        key={windowItem.id}
        onLayout={onLayout}
        style={pillStyle}
        onPress={() => {
          if (draggingTabId) return
          onSelect(windowItem.id)
        }}
        onLongPress={!isAll ? onLongPress : undefined}
        delayLongPress={160}
        activeOpacity={0.9}
      >
        {content}
      </TouchableOpacity>
    )
  }

  const orderedMovableTabs = draggingTabId ? tabDragOrder : movableTabs
  const displayTabs = [...fixedTabs, ...orderedMovableTabs]
  const draggingTab =
    draggingTabId ? displayTabs.find((w) => String(w?.id ?? "") === String(draggingTabId ?? "")) ?? null : null

  return (
    <View style={[styles.tabBarWrap, isDark ? styles.tabBarWrapDark : null]}>
      <View style={styles.tabBarInner}>
        <ScrollView
          ref={tabsScrollRef}
          horizontal
          scrollEnabled={!draggingTabId}
          showsHorizontalScrollIndicator={false}
          style={[styles.tabScroll, isDark ? styles.tabScrollDark : null]}
          contentContainerStyle={{ paddingRight: 40 }}
        >
          <View style={[styles.tabRow, isDark ? styles.tabRowDark : null]} {...tabPanResponder.panHandlers}>
            {displayTabs.map((w) => {
              const id = String(w?.id ?? "")
              const placeholder = Boolean(draggingTabId && id === String(draggingTabId))
              return renderTabPill(w, {
                placeholder,
                onLayout: (e) => {
                  tabLayoutsRef.current[id] = e?.nativeEvent?.layout ?? null
                },
                onLongPress: !w?.fixed
                  ? () => {
                      startTabDrag(w)
                    }
                  : undefined
              })
            })}
            {draggingTab ? (
              <Animated.View pointerEvents="none" style={[styles.tabDragOverlay, { transform: [{ translateX: dragX }] }]}>
                {renderTabPill(draggingTab, { ghost: true })}
              </Animated.View>
            ) : null}
          </View>
        </ScrollView>

        <View pointerEvents="none" style={[styles.tabAddMask, isDark ? styles.tabAddMaskDark : null]} />
        <Pressable onPress={openAdd} style={[styles.tabAddBtn, isDark ? styles.tabAddBtnDark : null]} hitSlop={10}>
          <Text style={[styles.tabAddText, isDark ? styles.tabAddTextDark : null]}>＋</Text>
        </Pressable>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={addVisible}
        statusBarTranslucent
        onRequestClose={requestCloseAddSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={requestCloseAddSheet} />
          <View style={[styles.sheetCard, sheetCardStyle]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>새 탭</Text>
              <View style={styles.sheetHeaderRight}>
                <Pressable onPress={closeAll} style={styles.sheetBtnGhost}>
                  <Text style={styles.sheetBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const next = String(draftTitle ?? "").trim()
                    if (!next) return
                    await onAddWindow?.(next, draftColor)
                    closeAll()
                  }}
                  style={styles.sheetBtnPrimary}
                >
                  <Text style={styles.sheetBtnPrimaryText}>추가</Text>
                </Pressable>
              </View>
            </View>

            <TextInput
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="예: 금융"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.menuInput}
              maxLength={20}
            />

            <Text style={styles.menuHint}>색을 고르고 탭 이름을 입력하세요.</Text>
            <View style={styles.colorGrid}>
              {palette.map((color) => {
                const active = color === draftColor
                return (
                  <Pressable
                    key={color}
                    onPress={() => setDraftColor(color)}
                    style={[styles.colorSwatch, { backgroundColor: color }, active ? styles.colorSwatchActive : null]}
                  />
                )
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={menuVisible} statusBarTranslucent>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeAll} />
          <View style={[styles.sheetCard, sheetCardStyle]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{menuWindow?.title || "탭"}</Text>
              <View style={styles.sheetHeaderRight}>
                <Pressable onPress={closeAll} style={styles.sheetBtnGhost}>
                  <Text style={styles.sheetBtnGhostText}>닫기</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.menuList}>
              <Pressable style={styles.menuItem} onPress={openColors}>
                <Text style={styles.menuItemText}>색깔 변경</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={openRename}>
                <Text style={styles.menuItemText}>이름 수정</Text>
              </Pressable>
              <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={requestDelete}>
                <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={renameVisible} statusBarTranslucent>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeAll} />
          <View style={[styles.sheetCard, sheetCardStyle]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>탭 이름</Text>
              <View style={styles.sheetHeaderRight}>
                <Pressable onPress={closeAll} style={styles.sheetBtnGhost}>
                  <Text style={styles.sheetBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const next = String(draftTitle ?? "").trim()
                    if (!menuWindow) return
                    if (!next) return
                    await onRenameWindow?.(menuWindow, next)
                    closeAll()
                  }}
                  style={styles.sheetBtnPrimary}
                >
                  <Text style={styles.sheetBtnPrimaryText}>저장</Text>
                </Pressable>
              </View>
            </View>
            <TextInput
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="예: 금융"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.menuInput}
              maxLength={20}
            />
            <Text style={styles.menuHint}>통합 탭은 수정/삭제할 수 없어요.</Text>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={colorVisible} statusBarTranslucent>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeAll} />
          <View style={[styles.sheetCard, sheetCardStyle]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>색깔 변경</Text>
              <View style={styles.sheetHeaderRight}>
                <Pressable onPress={closeAll} style={styles.sheetBtnGhost}>
                  <Text style={styles.sheetBtnGhostText}>닫기</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.colorGrid}>
              {palette.map((color) => {
                const active = color === menuWindow?.color
                return (
                  <Pressable
                    key={color}
                    onPress={async () => {
                      if (!menuWindow) return
                      await onChangeWindowColor?.(menuWindow, color)
                      closeAll()
                    }}
                    style={[styles.colorSwatch, { backgroundColor: color }, active ? styles.colorSwatchActive : null]}
                  />
                )
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function ListScreen({
  sections,
  allItemsByDate,
  loading,
  onRefresh,
  onSignOut,
  tone = "light",
  fontScale = 1,
  windows,
  activeTabId,
  onSelectTab,
  onAddWindow,
  onRenameWindow,
  onDeleteWindow,
  onChangeWindowColor,
  onReorderWindows,
  holidaysByDate,
  ensureHolidayYear,
  onAddPlan,
  onEditPlan,
  onReorderNoTime,
  onQuickDeletePlan
}) {
  const scale = useMemo(() => {
    const n = Number(fontScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.85, Math.min(1.25, n))
  }, [fontScale])
  const memoFontSize = Math.round(14 * scale)
  const memoLineHeight = Math.round(20 * scale)
  const fs = useCallback((n) => Math.round(n * scale), [scale])
  const isDark = tone === "dark"
  const today = new Date()
  const todayYear = today.getFullYear()
  const todayMonth = today.getMonth() + 1
  const todayDate = today.getDate()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1)
  const monthLabel = `${viewYear}-${pad2(viewMonth)}`
  const todayKey = dateToKey(todayYear, todayMonth, todayDate)
  const todayLabel = `${todayMonth}/${todayDate}`
  const defaultAddDateKey = useMemo(() => {
    const isCurrentMonth = viewYear === todayYear && viewMonth === todayMonth
    return isCurrentMonth ? todayKey : dateToKey(viewYear, viewMonth, 1)
  }, [todayKey, todayMonth, todayYear, viewMonth, viewYear])
  const listRef = useRef(null)
  const pendingScrollRef = useRef(false)
  const [scrollToken, setScrollToken] = useState(0)
  const [listFilterVisible, setListFilterVisible] = useState(false)
  const [listFilterTitles, setListFilterTitles] = useState([])
  const listFilterInitRef = useRef(false)
  const [reorderState, setReorderState] = useState({ visible: false, dateKey: "" })
  const [reorderItems, setReorderItems] = useState([])
  const reorderItemsRef = useRef([])
  const reorderOriginalIdsRef = useRef([])
  const [reorderSaving, setReorderSaving] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const dragY = useRef(new Animated.Value(0)).current
  const noTimeLayoutsRef = useRef({})
  const dragStateRef = useRef({ activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 })
  const pendingAutoDragIdRef = useRef("")
  const suppressPressRef = useRef(false)

  const colorByTitle = useMemo(() => {
    const map = new Map()
    for (const w of windows ?? []) {
      if (!w?.title) continue
      map.set(String(w.title), w.color || "#94a3b8")
    }
    return map
  }, [windows])
  const filterOptions = useMemo(
    () =>
      (windows ?? [])
        .filter((w) => w && w.id !== "all" && String(w.title ?? "").trim())
        .map((w) => ({ title: String(w.title), color: w.color || "#94a3b8" })),
    [windows]
  )
  const allFilterTitles = useMemo(() => filterOptions.map((opt) => opt.title), [filterOptions])
  const isAllListFiltersSelected = allFilterTitles.length === 0 || listFilterTitles.length === allFilterTitles.length
  const applyListFilter = useCallback(
    (items) => {
      const list = (Array.isArray(items) ? items : []).filter((item) => isRenderablePlanRow(item))
      if (activeTabId !== "all") return list
      const selected = new Set(listFilterTitles)
      return list.filter((item) => {
        const category = String(item?.category_id ?? "").trim()
        if (!category || category === "__general__") return true
        if (!selected.size) return false
        return selected.has(category)
      })
    },
    [activeTabId, listFilterTitles]
  )

  useEffect(() => {
    reorderItemsRef.current = reorderItems
  }, [reorderItems])

  const getAllItemsForDate = useCallback(
    (dateKey) => {
      const key = String(dateKey ?? "").trim()
      if (!key) return []
      if (allItemsByDate && typeof allItemsByDate.get === "function") {
        return allItemsByDate.get(key) ?? []
      }
      const section = (sections ?? []).find((s) => String(s?.title ?? "") === key)
      return Array.isArray(section?.data) ? section.data : []
    },
    [allItemsByDate, sections]
  )

  function moveItem(list, fromIndex, toIndex) {
    const safe = Array.isArray(list) ? list : []
    const next = [...safe]
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return next
    if (fromIndex >= next.length || toIndex >= next.length) return next
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  function idsEqual(a, b) {
    const left = Array.isArray(a) ? a : []
    const right = Array.isArray(b) ? b : []
    if (left.length != right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] != right[i]) return false
    }
    return true
  }

  function openReorderModal(dateKey, sourceItems = null) {
    if (!onReorderNoTime) return
    const key = String(dateKey ?? "").trim()
    if (!key) return
    const rawItems = Array.isArray(sourceItems) ? sourceItems : getAllItemsForDate(key)
    const items = sortItemsByTimeAndOrder(rawItems)
    setReorderState({ visible: true, dateKey: key })
    setReorderItems(items)
    reorderItemsRef.current = items
    reorderOriginalIdsRef.current = items
      .map((item) => String(item?.id ?? "").trim())
      .filter(Boolean)
    noTimeLayoutsRef.current = {}
    dragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
    setDraggingId(null)
    setReorderSaving(false)
    dragY.setValue(0)
  }

  function closeReorderModal() {
    setReorderState({ visible: false, dateKey: "" })
    setReorderItems([])
    reorderItemsRef.current = []
    reorderOriginalIdsRef.current = []
    noTimeLayoutsRef.current = {}
    dragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
    pendingAutoDragIdRef.current = ""
    setDraggingId(null)
    setReorderSaving(false)
    suppressPressRef.current = false
    dragY.setValue(0)
  }

  function startDrag(item) {
    if (!item) return
    const id = String(item?.id ?? "").trim()
    if (!id) return
    const layout = noTimeLayoutsRef.current?.[id]
    if (!layout) return
    const list = reorderItemsRef.current
    const currentIndex = Array.isArray(list) ? list.findIndex((row) => String(row?.id ?? "").trim() === id) : -1
    if (currentIndex < 0) return
    const startY = Number(layout.y) || 0
    const height = Number(layout.height) || 48
    dragStateRef.current = { activeId: id, startY, height, startIndex: currentIndex, currentIndex, lastSwapAt: 0 }
    dragY.setValue(startY)
    requestAnimationFrame(() => {
      setDraggingId(id)
    })
  }

  function finishDrag() {
    const state = dragStateRef.current
    if (!state.activeId) return
    const activeId = String(state.activeId ?? "")
    const cleanup = () => {
      dragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
      setDraggingId(null)
    }

    dragY.stopAnimation((currentY) => {
      const rawTarget = Number(noTimeLayoutsRef.current?.[activeId]?.y ?? Number.NaN)
      const fallback = Number.isFinite(currentY) ? currentY : Number(state.startY ?? 0)
      const targetY = Number.isFinite(rawTarget) ? rawTarget : fallback
      Animated.spring(dragY, {
        toValue: targetY,
        tension: 220,
        friction: 22,
        useNativeDriver: true
      }).start(() => {
        cleanup()
      })
    })
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(dragStateRef.current.activeId),
        onStartShouldSetPanResponderCapture: () => Boolean(dragStateRef.current.activeId),
        onMoveShouldSetPanResponder: () => Boolean(dragStateRef.current.activeId),
        onMoveShouldSetPanResponderCapture: () => Boolean(dragStateRef.current.activeId),
        onPanResponderMove: (_evt, gesture) => {
          const state = dragStateRef.current
          if (!state.activeId) return
          const nextY = Number(state.startY ?? 0) + Number(gesture?.dy ?? 0)
          dragY.setValue(nextY)
          const list = reorderItemsRef.current
          if (!Array.isArray(list) || list.length === 0) return
          let currentIndex = Number(state.currentIndex ?? -1)
          if (!Number.isFinite(currentIndex) || currentIndex < 0 || currentIndex >= list.length) {
            currentIndex = list.findIndex((row) => String(row?.id ?? "") === String(state.activeId ?? ""))
          }
          if (currentIndex < 0) return
          const now = Date.now()
          if (now - Number(state.lastSwapAt ?? 0) < 16) return
          const startIndex = Number.isFinite(Number(state.startIndex))
            ? Number(state.startIndex)
            : currentIndex
          const rowHeight = Math.max(28, Number(state.height ?? 0) || 48)
          const stepOffset = Number(gesture?.dy ?? 0) / rowHeight
          const projected = Math.round(startIndex + stepOffset)
          const targetIndex = clamp(projected, 0, list.length - 1)
          if (targetIndex === currentIndex) return
          const nextItems = moveItem(list, currentIndex, targetIndex)
          runSwapLayoutAnimation()
          reorderItemsRef.current = nextItems
          dragStateRef.current = { ...state, currentIndex: targetIndex, lastSwapAt: now }
          setReorderItems(nextItems)
        },
        onPanResponderRelease: () => finishDrag(),
        onPanResponderTerminate: () => finishDrag(),
        onPanResponderTerminationRequest: () => false
      }),
    []
  )

  useEffect(() => {
    if (!reorderState.visible) return
    const pendingId = String(pendingAutoDragIdRef.current ?? "").trim()
    if (!pendingId) return
    const row = reorderItems.find((item) => String(item?.id ?? "").trim() === pendingId)
    if (!row) {
      pendingAutoDragIdRef.current = ""
      return
    }
    if (!noTimeLayoutsRef.current?.[pendingId]) return
    pendingAutoDragIdRef.current = ""
    startDrag(row)
  }, [reorderState.visible, reorderItems])

  async function commitReorder() {
    if (reorderSaving) return
    const dateKey = String(reorderState?.dateKey ?? "").trim()
    const list = Array.isArray(reorderItemsRef.current) ? reorderItemsRef.current : []
    const nextIds = list.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (!dateKey || nextIds.length === 0) return
    if (idsEqual(nextIds, reorderOriginalIdsRef.current)) return
    setReorderSaving(true)
    try {
      await onReorderNoTime?.(dateKey, list)
      reorderOriginalIdsRef.current = nextIds
    } finally {
      setReorderSaving(false)
    }
  }

  async function closeReorderModalWithSave() {
    if (reorderSaving) return
    await commitReorder()
    closeReorderModal()
  }

  function quickDeleteFromReorder(item) {
    if (!item || !onQuickDeletePlan) return
    Alert.alert("일정 삭제", "이 항목을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          await onQuickDeletePlan?.(item)
          const id = String(item?.id ?? "").trim()
          if (!id) return
          const next = (reorderItemsRef.current ?? []).filter((row) => String(row?.id ?? "").trim() !== id)
          reorderItemsRef.current = next
          reorderOriginalIdsRef.current = next.map((row) => String(row?.id ?? "").trim()).filter(Boolean)
          setReorderItems(next)
          if (draggingId && String(draggingId) === id) {
            dragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
            setDraggingId(null)
            dragY.setValue(0)
          }
          if (next.length === 0) closeReorderModal()
        }
      }
    ])
  }

  function scrollToToday() {
    const index = visibleSections.findIndex((s) => s.title === todayKey)
    if (index === -1) return false
    listRef.current?.scrollToLocation?.({
      sectionIndex: index,
      itemIndex: 0,
      viewPosition: 0,
      viewOffset: 6
    })
    return true
  }

  function goPrevMonth() {
    const nextMonth = viewMonth - 1
    if (nextMonth < 1) {
      setViewYear(viewYear - 1)
      setViewMonth(12)
    } else {
      setViewMonth(nextMonth)
    }
  }

  function goNextMonth() {
    const nextMonth = viewMonth + 1
    if (nextMonth > 12) {
      setViewYear(viewYear + 1)
      setViewMonth(1)
    } else {
      setViewMonth(nextMonth)
    }
  }

  const listPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => {
          if (draggingId) return false
          const { dx, dy } = gesture
          return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (draggingId) return
          const { dx, dy } = gesture
          if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
          if (dx > 0) {
            goPrevMonth()
          } else {
            goNextMonth()
          }
        }
      }),
    [viewMonth, viewYear, draggingId]
  )

  useEffect(() => {
    ensureHolidayYear?.(viewYear)
  }, [viewYear, ensureHolidayYear])

  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth() + 1)
    pendingScrollRef.current = true
    setScrollToken((prev) => prev + 1)
    setTimeout(() => {
      if (!scrollToToday()) return
    }, 80)
  }

  useEffect(() => {
    if (activeTabId === "all") return
    setListFilterVisible(false)
  }, [activeTabId])

  useEffect(() => {
    if (!allFilterTitles.length) {
      setListFilterTitles([])
      listFilterInitRef.current = false
      return
    }
    if (!listFilterInitRef.current) {
      setListFilterTitles(allFilterTitles)
      listFilterInitRef.current = true
      return
    }
    setListFilterTitles((prev) => prev.filter((t) => allFilterTitles.includes(t)))
  }, [allFilterTitles])

  function toggleListFilter(title) {
    const key = String(title ?? "").trim()
    if (!key) return
    setListFilterTitles((prev) => {
      const has = prev.includes(key)
      if (has) return prev.filter((v) => v !== key)
      return [...prev, key]
    })
  }

  const visibleSections = useMemo(() => {
    const prefix = `${viewYear}-${pad2(viewMonth)}-`
    const activeKey = reorderState?.visible ? String(reorderState?.dateKey ?? "") : ""
    return (sections ?? [])
      .filter((section) => String(section.title ?? "").startsWith(prefix))
      .map((section) => {
        const key = String(section?.title ?? "")
        const baseData = applyListFilter(section?.data ?? [])
        if (activeKey && key === activeKey) {
          return {
            ...section,
            data: [{ id: `__reorder__-${key}`, __reorder: true, date: key }]
          }
        }
        return {
          ...section,
          data: baseData
        }
      })
      .filter((section) => (section?.data?.length ?? 0) > 0)
  }, [sections, viewYear, viewMonth, applyListFilter, reorderState])

  const reorderDow = reorderState.dateKey ? weekdayLabel(reorderState.dateKey) : ""
  const reorderDateLabel = reorderState.dateKey
    ? `${formatDateMD(reorderState.dateKey)}${reorderDow ? ` (${reorderDow})` : ""}`
    : ""
  const draggingItem = reorderItems.find((item) => String(item?.id ?? "") === draggingId)

  function renderReorderRow(item, options = {}) {
    if (!item) return null
    const { draggable = false, ghost = false, placeholder = false, onLayout, onLongPress, onDelete, rowKey } = options
    const time = buildPlanTimeTextFromRow(item)
    const content = String(item?.content ?? "").trim()
    const category = String(item?.category_id ?? "").trim()
    const isGeneral = !category || category === "__general__"
    const categoryColor = colorByTitle.get(category) || "#94a3b8"
    const Container = draggable && !ghost ? Pressable : View
    return (
      <Container
        key={rowKey}
        onLayout={onLayout}
        onLongPress={draggable && !ghost ? onLongPress : undefined}
        delayLongPress={draggable && !ghost ? 110 : undefined}
        style={[
          styles.reorderItemRow,
          isDark ? styles.reorderItemRowDark : null,
          ghost ? styles.reorderDragGhost : null,
          ghost && isDark ? styles.reorderDragGhostDark : null,
          placeholder ? styles.reorderItemPlaceholder : null
        ]}
      >
        <View style={styles.itemLeftCol}>
          <Text
            style={
              time
                ? [styles.itemTimeText, { fontSize: fs(12) }, isDark ? styles.itemTimeTextDark : null]
                : [styles.itemTimeTextEmpty, { fontSize: fs(12) }]
            }
          >
            {time || " "}
          </Text>
        </View>
        <View style={styles.itemMainCol}>
          <View style={styles.itemTopRow}>
            <Text
              style={[styles.itemTitle, { fontSize: fs(14) }, isDark ? styles.textDark : null]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {content}
            </Text>
            {!isGeneral ? (
              <View style={[styles.itemCategoryBadge, isDark ? styles.badgeDark : null]}>
                <View style={[styles.itemCategoryDot, { backgroundColor: categoryColor }]} />
                <Text style={[styles.itemCategoryText, isDark ? styles.textMutedDark : null]} numberOfLines={1}>
                  {category}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {draggable && !ghost && !placeholder ? (
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            style={[styles.reorderDeleteBtn, isDark ? styles.reorderDeleteBtnDark : null]}
          >
            <Text style={styles.reorderDeleteBtnText}>X</Text>
          </Pressable>
        ) : null}
      </Container>
    )
  }

  useEffect(() => {
    if (!pendingScrollRef.current) return
    if (!scrollToToday()) {
      pendingScrollRef.current = false
      return
    }
    requestAnimationFrame(() => {
      scrollToToday()
      pendingScrollRef.current = false
    })
  }, [visibleSections, todayKey, scrollToken])

  return (
    <SafeAreaView style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        todayLabel={todayLabel}
        onToday={goToday}
        onFilter={activeTabId === "all" ? () => setListFilterVisible(true) : null}
        filterActive={!isAllListFiltersSelected}
        tone={tone}
        showLogo={false}
        titleStyle={styles.calendarTitleOffset}
        buttonsStyle={styles.calendarButtonsOffset}
      />
      <WindowTabs
        windows={windows}
        activeId={activeTabId}
        onSelect={onSelectTab}
        onAddWindow={onAddWindow}
        onRenameWindow={onRenameWindow}
        onDeleteWindow={onDeleteWindow}
        onChangeWindowColor={onChangeWindowColor}
        onReorderWindows={onReorderWindows}
        tone={tone}
      />
      <View style={[styles.listMonthBar, isDark ? styles.listMonthBarDark : null]}>
        <View style={styles.listMonthLeftGroup}>
          <TouchableOpacity style={styles.listMonthNavButton} onPress={goPrevMonth}>
            <Text style={[styles.listMonthNavText, isDark ? styles.textDark : null]}>{"<"}</Text>
          </TouchableOpacity>
          <Text style={[styles.listMonthText, isDark ? styles.textDark : null]}>{monthLabel}</Text>
          <TouchableOpacity style={styles.listMonthNavButton} onPress={goNextMonth}>
            <Text style={[styles.listMonthNavText, isDark ? styles.textDark : null]}>{">"}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.listMonthRightGroup}>
          <TouchableOpacity
            style={styles.listAddButton}
            onPress={() => onAddPlan?.(defaultAddDateKey)}
          >
            <Text style={[styles.listAddText, isDark ? styles.textDark : null]}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View
        style={[styles.card, styles.listCard, isDark ? styles.cardDark : null, isDark ? styles.listCardDark : null]}
        {...listPanResponder.panHandlers}
      >
        {loading ? <ActivityIndicator size="small" color="#3b82f6" /> : null}
        <SectionList
          ref={listRef}
          sections={visibleSections}
          keyExtractor={(item) => item.id ?? `${item.date}-${item.content}`}
          stickySectionHeadersEnabled={false}
          scrollEnabled={!draggingId}
          renderItem={({ item, section }) => {
            if (item?.__reorder) {
              return (
                <View style={[styles.reorderInlineCard, isDark ? styles.reorderInlineCardDark : null]}>
                  <View style={styles.reorderNoTimeList} {...panResponder.panHandlers}>
                    {reorderItems.length ? (
                      reorderItems.map((row) => {
                        const rowId = String(row?.id ?? "")
                        const rowKey = rowId || `${row?.date}-${row?.content}`
                        const isPlaceholder = rowId && rowId === draggingId
                        return renderReorderRow(row, {
                          rowKey,
                          draggable: true,
                          placeholder: isPlaceholder,
                          onLayout: (event) => {
                            if (!rowId) return
                            const layout = event?.nativeEvent?.layout
                            if (!layout) return
                            noTimeLayoutsRef.current[rowId] = { y: layout.y, height: layout.height }
                          },
                          onLongPress: () => startDrag(row),
                          onDelete: () => quickDeleteFromReorder(row)
                        })
                      })
                    ) : (
                      <View style={styles.reorderEmpty}>
                        <Text style={[styles.reorderEmptyText, isDark ? styles.textMutedDark : null]}>
                          항목이 없습니다.
                        </Text>
                      </View>
                    )}
                    {draggingItem ? (
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.reorderDragOverlay, { transform: [{ translateY: dragY }] }]}
                      >
                        {renderReorderRow(draggingItem, { ghost: true })}
                      </Animated.View>
                    ) : null}
                  </View>
                </View>
              )
            }
            const time = buildPlanTimeTextFromRow(item)
            const content = String(item?.content ?? "").trim()
            const category = String(item?.category_id ?? "").trim()
            const isGeneral = !category || category === "__general__"
            const categoryColor = colorByTitle.get(category) || "#94a3b8"
            const dateKey = String(section?.title ?? item?.date ?? "")
            const canReorder = Boolean(onReorderNoTime)
            const handlePress = () => {
              if (suppressPressRef.current) {
                suppressPressRef.current = false
                return
              }
              onEditPlan?.(item)
            }
            const handleLongPress = () => {
              if (!canReorder) return
              suppressPressRef.current = true
              pendingAutoDragIdRef.current = String(item?.id ?? "").trim()
              openReorderModal(dateKey, section?.data ?? [])
            }
            return (
              <Pressable
                style={[styles.itemRow, isDark ? styles.itemRowDark : null]}
                onPress={handlePress}
                onLongPress={canReorder ? handleLongPress : undefined}
                delayLongPress={120}
              >
                <View style={styles.itemLeftCol}>
                  <Text
                    style={
                      time
                        ? [styles.itemTimeText, { fontSize: fs(12) }, isDark ? styles.itemTimeTextDark : null]
                        : [styles.itemTimeTextEmpty, { fontSize: fs(12) }]
                    }
                  >
                    {time || " "}
                  </Text>
                </View>
                <View style={styles.itemMainCol}>
                  <View style={styles.itemTopRow}>
                    <Text
                      style={[styles.itemTitle, { fontSize: fs(14) }, isDark ? styles.textDark : null]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {content}
                    </Text>
                    {!isGeneral ? (
                      <View style={[styles.itemCategoryBadge, isDark ? styles.badgeDark : null]}>
                        <View style={[styles.itemCategoryDot, { backgroundColor: categoryColor }]} />
                        <Text style={[styles.itemCategoryText, isDark ? styles.textMutedDark : null]} numberOfLines={1}>
                          {category}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            )
          }}
          renderSectionHeader={({ section }) => {
	            const key = String(section.title ?? "")
              const isTodaySection = key === todayKey
              const isReorderSection = reorderState.visible && String(reorderState.dateKey ?? "") === key
	            const holidayName = holidaysByDate?.get?.(key) ?? ""
	            const isHoliday = Boolean(holidayName)
	            const color = weekdayColor(key, { isHoliday, isDark })
	            const dow = weekdayLabel(key)
	            return (
	              <Pressable
                style={[
                  styles.sectionHeader,
                  isDark ? styles.sectionHeaderDark : null,
                  isTodaySection ? (isDark ? styles.sectionHeaderTodayDark : styles.sectionHeaderToday) : null
                ]}
                onPress={() => {
                  if (isReorderSection) {
                    closeReorderModalWithSave()
                    return
                  }
                  onAddPlan?.(key)
                }}
              >
	                <View style={styles.sectionHeaderRow}>
	                  <View style={styles.sectionHeaderLeft}>
	                    <Text
	                      style={[
	                        styles.sectionHeaderDateText,
	                        { color, fontSize: fs(14) }
	                      ]}
	                    >
	                      {formatDateMD(key)}
                        {dow ? (
                          <Text style={[styles.sectionHeaderDateDowInline, { fontSize: fs(10) }]}> ({dow})</Text>
                        ) : null}
	                    </Text>
                      {isTodaySection ? (
                        <View style={[styles.sectionHeaderTodayPill, isDark ? styles.sectionHeaderTodayPillDark : null]}>
                          <Text style={[styles.sectionHeaderTodayPillText, isDark ? styles.sectionHeaderTodayPillTextDark : null]}>
                            TODAY
                          </Text>
                        </View>
                      ) : null}
                  </View>
                  <View style={styles.sectionHeaderRight}>
                    {holidayName ? (
                      <View style={[styles.sectionHeaderHolidayBadge, isDark ? styles.holidayBadgeDark : null]}>
                        <Text numberOfLines={1} style={[styles.sectionHeaderHolidayBadgeText, { fontSize: fs(11) }]}>
                          {holidayName}
                        </Text>
                      </View>
                    ) : null}
                    {isReorderSection ? (
                      <Pressable
                        onPress={(event) => {
                          event?.stopPropagation?.()
                          closeReorderModalWithSave()
                        }}
                        hitSlop={8}
                        style={[styles.sectionHeaderDoneBtn, isDark ? styles.sectionHeaderDoneBtnDark : null]}
                      >
                        <Text style={styles.sectionHeaderDoneBtnText}>완료</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            !loading ? (
              <Pressable style={styles.listEmptyWrap} onPress={() => onAddPlan?.(defaultAddDateKey)}>
                <View style={[styles.listEmptyCard, isDark ? styles.listEmptyCardDark : null]}>
                  <Text style={[styles.listEmptyTitle, isDark ? styles.textDark : null]}>일정이 비어 있어요</Text>
                  <Text style={[styles.listEmptySub, isDark ? styles.textMutedDark : null]}>
                    + Add 버튼을 누르거나 여기를 눌러 바로 추가하세요.
                  </Text>
                </View>
              </Pressable>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          onScrollToIndexFailed={({ sectionIndex }) => {
            setTimeout(() => {
              listRef.current?.scrollToLocation?.({
                sectionIndex,
                itemIndex: 0,
                viewPosition: 0,
                viewOffset: 6
              })
            }, 250)
          }}
        />
      </View>

      <Modal
        visible={listFilterVisible}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setListFilterVisible(false)}
      >
        <View style={styles.dayModalOverlay}>
          <Pressable style={styles.dayModalBackdrop} onPress={() => setListFilterVisible(false)} />
          <View style={[styles.calendarFilterCard, isDark ? styles.calendarFilterCardDark : null]}>
            <View style={styles.calendarFilterHeader}>
              <Text style={[styles.calendarFilterTitle, isDark ? styles.textDark : null]}>필터</Text>
              <View style={styles.calendarFilterActions}>
                <Pressable onPress={() => setListFilterTitles(allFilterTitles)} style={styles.calendarFilterResetBtn}>
                  <Text style={styles.calendarFilterResetText}>전체</Text>
                </Pressable>
                <Pressable onPress={() => setListFilterVisible(false)} style={styles.calendarFilterDoneBtn}>
                  <Text style={styles.calendarFilterDoneText}>닫기</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.calendarFilterList}>
              {filterOptions.map((opt) => {
                const active = listFilterTitles.includes(opt.title)
                return (
                  <Pressable
                    key={opt.title}
                    onPress={() => toggleListFilter(opt.title)}
                    style={[styles.calendarFilterItem, isDark ? styles.calendarFilterItemDark : null]}
                  >
                    <View style={styles.calendarFilterItemLeft}>
                      <View style={[styles.tabDot, { backgroundColor: opt.color }]} />
                      <Text style={[styles.calendarFilterItemText, isDark ? styles.textDark : null]}>{opt.title}</Text>
                    </View>
                    <View
                      style={[
                        styles.calendarFilterCheck,
                        active ? styles.calendarFilterCheckActive : null,
                        isDark ? styles.calendarFilterCheckDark : null
                      ]}
                    >
                      {active ? <Text style={styles.calendarFilterCheckMark}>✓</Text> : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
            <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
              선택한 탭만 리스트에 표시됩니다.
            </Text>
            <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
              (통합 탭에서만 적용)
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function MemoScreen({
  memoText,
  loading,
  onRefresh,
  onSignOut,
  tone = "light",
  fontScale = 1,
  windows,
  rightMemos,
  activeTabId,
  onSelectTab,
  onAddWindow,
  onRenameWindow,
  onDeleteWindow,
  onChangeWindowColor,
  onReorderWindows,
  onSaveMemo
}) {
  const isDark = tone === "dark"
  const scale = useMemo(() => {
    const n = Number(fontScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.85, Math.min(1.25, n))
  }, [fontScale])
  const memoFontSize = Math.round(14 * scale)
  const memoLineHeight = Math.round(20 * scale)
  const [draft, setDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [memoExpandedMap, setMemoExpandedMap] = useState({})
  const [memoEditingId, setMemoEditingId] = useState(null)
  const [memoEditDrafts, setMemoEditDrafts] = useState({})
  const [memoFilterVisible, setMemoFilterVisible] = useState(false)
  const [memoFilterTitles, setMemoFilterTitles] = useState([])
  const draftRef = useRef("")
  const dirtyRef = useRef(false)
  const inputRef = useRef(null)
  const memoInputRefs = useRef({})
  const memoAllScrollRef = useRef(null)
  const memoSaveQueueRef = useRef({})
  const memoEditDraftsRef = useRef(memoEditDrafts ?? {})
  const rightMemosRef = useRef(rightMemos ?? {})
  const activeTabIdRef = useRef(activeTabId)
  const memoEditingIdRef = useRef(memoEditingId)
  const isEditingRef = useRef(isEditing)
  const autoSaveMemoEditRef = useRef(null)
  const finishSingleEditRef = useRef(null)
  const memoFilterInitRef = useRef(false)
  const prevTabRef = useRef(activeTabId)
  const lastAppliedTabRef = useRef(activeTabId)
  const saveTimerRef = useRef(null)
  const saveSeqRef = useRef(0)

  useEffect(() => {
    const prevId = prevTabRef.current
    if (prevId && prevId !== activeTabId) {
      if (String(prevId) === "all") {
        const editingKey = String(memoEditingId ?? "")
        if (editingKey) {
          autoSaveMemoEditIfNeeded(editingKey)
        }
      } else if (dirtyRef.current || isEditing) {
        finishSingleEdit(prevId, false)
      }
      setMemoEditingId(null)
      setIsEditing(false)
      Keyboard.dismiss()
    }
  }, [activeTabId])

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      const nextHeight = Math.max(0, Number(e?.endCoordinates?.height ?? 0))
      setKeyboardHeight(nextHeight)
    })
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub?.remove?.()
      hideSub?.remove?.()
    }
  }, [])

  useEffect(() => {
    memoEditDraftsRef.current = memoEditDrafts ?? {}
  }, [memoEditDrafts])

  useEffect(() => {
    rightMemosRef.current = rightMemos ?? {}
  }, [rightMemos])


  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    memoEditingIdRef.current = memoEditingId
  }, [memoEditingId])

  useEffect(() => {
    isEditingRef.current = isEditing
  }, [isEditing])

  useFocusEffect(
    useCallback(() => {
      return () => {
        const prevId = String(activeTabIdRef.current ?? "")
        if (prevId === "all") {
          const editingKey = String(memoEditingIdRef.current ?? "")
          if (editingKey) autoSaveMemoEditRef.current?.(editingKey)
          setMemoEditingId(null)
        } else {
          if (dirtyRef.current || isEditingRef.current) {
            finishSingleEditRef.current?.(prevId, false)
          }
          setIsEditing(false)
        }
        Keyboard.dismiss()
      }
    }, [])
  )

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const currentTabId = String(activeTabIdRef.current ?? "")
      if (currentTabId === "all") {
        const editingKey = String(memoEditingIdRef.current ?? "")
        if (editingKey) {
          autoSaveMemoEditRef.current?.(editingKey)
          setMemoEditingId(null)
          Keyboard.dismiss()
          return true
        }
        return false
      }
      if (isEditingRef.current) {
        finishSingleEditRef.current?.(currentTabId, true)
        Keyboard.dismiss()
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [])

  function queueMemoSave(tabId, text) {
    const key = String(tabId ?? "").trim()
    if (!key || key === "all") return Promise.resolve()
    const payload = String(text ?? "")
    const prev = memoSaveQueueRef.current?.[key] ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => onSaveMemo?.(key, payload))
    memoSaveQueueRef.current[key] = next
    return next
  }

  async function saveForTab(tabId, text) {
    if (!tabId || tabId === "all") return
    await queueMemoSave(tabId, text)
  }

  async function saveForAll(text) {
    const { windowTexts } = splitCombinedMemoText(text, windows)
    const targets = (windows ?? []).filter((w) => w && w.id !== "all")
    for (const w of targets) {
      const id = String(w.id ?? "")
      if (!id) continue
      await saveForTab(id, windowTexts?.[id] ?? "")
    }
  }

  useEffect(() => {
    const prevId = prevTabRef.current
    prevTabRef.current = activeTabId
    const tabChanged = prevId !== activeTabId

    if (prevId && dirtyRef.current && tabChanged) {
      const contentToSave = draftRef.current
      saveSeqRef.current += 1
      const seq = saveSeqRef.current
      Promise.resolve(prevId === "all" ? saveForAll(contentToSave) : saveForTab(prevId, contentToSave)).catch((_e) => {
        // ignore (we surface errors inside onSaveMemo)
      }).finally(() => {
        if (saveSeqRef.current === seq) {
          dirtyRef.current = false
          setDirty(false)
        }
      })
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    const nextText = String(memoText ?? "")
    if (tabChanged || !dirtyRef.current || lastAppliedTabRef.current !== activeTabId) {
      lastAppliedTabRef.current = activeTabId
      draftRef.current = nextText
      dirtyRef.current = false
      setDraft(nextText)
      setDirty(false)
    }
  }, [activeTabId, memoText])

  useEffect(() => {
    if (activeTabId === "all") return
    setMemoFilterVisible(false)
  }, [activeTabId])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const prevId = prevTabRef.current
      if (prevId && dirtyRef.current) {
        Promise.resolve(prevId === "all" ? saveForAll(draftRef.current) : saveForTab(prevId, draftRef.current)).catch((_e) => {
          // ignore
        })
      }
    }
  }, [onSaveMemo])

  const placeholder = useMemo(() => {
    if (activeTabId === "all") return "[탭제목]\n내용을 입력하세요"
    return "메모를 입력하세요"
  }, [activeTabId])
  const activeWindow = useMemo(
    () => (windows ?? []).find((w) => String(w?.id ?? "") === String(activeTabId ?? "")) ?? null,
    [windows, activeTabId]
  )
  const memoFilterOptions = useMemo(
    () =>
      (windows ?? [])
        .filter((w) => w && w.id !== "all" && String(w.title ?? "").trim())
        .map((w) => ({ title: String(w.title), color: w.color || "#94a3b8" })),
    [windows]
  )
  const allMemoFilterTitles = useMemo(() => memoFilterOptions.map((opt) => opt.title), [memoFilterOptions])
  const isAllMemoFiltersSelected =
    allMemoFilterTitles.length === 0 || memoFilterTitles.length === allMemoFilterTitles.length

  useEffect(() => {
    if (!allMemoFilterTitles.length) {
      setMemoFilterTitles([])
      memoFilterInitRef.current = false
      return
    }
    if (!memoFilterInitRef.current) {
      setMemoFilterTitles(allMemoFilterTitles)
      memoFilterInitRef.current = true
      return
    }
    setMemoFilterTitles((prev) => prev.filter((t) => allMemoFilterTitles.includes(t)))
  }, [allMemoFilterTitles])

  function toggleMemoFilter(title) {
    const key = String(title ?? "").trim()
    if (!key) return
    setMemoFilterTitles((prev) => {
      const has = prev.includes(key)
      if (has) return prev.filter((v) => v !== key)
      return [...prev, key]
    })
  }

  const filteredMemoWindows = useMemo(() => {
    const list = (windows ?? []).filter((w) => w && w.id !== "all")
    if (activeTabId !== "all") return list
    const selected = new Set(memoFilterTitles)
    if (!selected.size) return []
    return list.filter((w) => selected.has(String(w?.title ?? "").trim()))
  }, [windows, activeTabId, memoFilterTitles])

  function scheduleSave(nextText) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const contentToSave = String(nextText ?? "")
      saveSeqRef.current += 1
      const seq = saveSeqRef.current
      Promise.resolve(activeTabId === "all" ? saveForAll(contentToSave) : saveForTab(activeTabId, contentToSave))
        .catch((_e) => {
          // ignore
        })
        .finally(() => {
          if (saveSeqRef.current !== seq) return
          dirtyRef.current = false
          setDirty(false)
        })
    }, 700)
  }

  function finishSingleEdit(tabId = activeTabId, closeEditor = true) {
    const key = String(tabId ?? "")
    if (!key || key === "all") {
      if (closeEditor) setIsEditing(false)
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const nextText = String(draftRef.current ?? "")
    const currentText = String(rightMemosRef.current?.[key] ?? "")
    if (nextText !== currentText) {
      Promise.resolve(saveForTab(key, nextText)).catch((_e) => {
        // ignore (onSaveMemo handles alerting)
      })
    }
    dirtyRef.current = false
    setDirty(false)
    if (closeEditor) setIsEditing(false)
  }

  const memoPaperBottomPadding = useMemo(() => {
    if (activeTabId === "all" || isEditing) return Math.max(48, keyboardHeight + 24)
    return 48
  }, [activeTabId, isEditing, keyboardHeight])

  function toggleMemoExpanded(id) {
    const key = String(id ?? "")
    if (!key) return
    setMemoExpandedMap((prev) => ({
      ...(prev ?? {}),
      [key]: !(prev?.[key] ?? true)
    }))
  }

  function autoSaveMemoEditIfNeeded(id) {
    const key = String(id ?? "")
    if (!key) return
    const nextText = String(memoEditDraftsRef.current?.[key] ?? "")
    const currentText = String(rightMemosRef.current?.[key] ?? "")
    if (nextText === currentText) return
    Promise.resolve(saveForTab(key, nextText)).catch((_e) => {
      // ignore (onSaveMemo handles alerting)
    })
  }

  useEffect(() => {
    autoSaveMemoEditRef.current = autoSaveMemoEditIfNeeded
  }, [autoSaveMemoEditIfNeeded])

  useEffect(() => {
    finishSingleEditRef.current = finishSingleEdit
  }, [finishSingleEdit])

  function beginMemoEdit(id) {
    const key = String(id ?? "")
    if (!key) return
    const prevKey = String(memoEditingId ?? "")
    if (prevKey && prevKey !== key) autoSaveMemoEditIfNeeded(prevKey)
    const current = String(rightMemosRef.current?.[key] ?? rightMemosRef.current?.[id] ?? "")
    setMemoEditingId(key)
    setMemoExpandedMap((prev) => ({ ...(prev ?? {}), [key]: true }))
    setMemoEditDrafts((prev) => {
      const next = { ...(prev ?? {}), [key]: current }
      memoEditDraftsRef.current = next
      return next
    })
    // Enter edit mode. Keep behavior simple and stable for editing.
  }

  function beginMemoEditFromTap(id) {
    beginMemoEdit(id)
  }

  function beginSingleMemoEdit() {
    if (activeTabId === "all") return
    setIsEditing(true)
    // Enter edit mode. Keep behavior simple and stable for editing.
  }

  function beginSingleMemoEditFromTap() {
    beginSingleMemoEdit()
  }

  async function commitMemoEdit(id) {
    const key = String(id ?? "")
    if (!key) return
    const text = String(memoEditDraftsRef.current?.[key] ?? "")
    await saveForTab(key, text)
    setMemoEditingId(null)
    Keyboard.dismiss()
  }

  function runOutsideContent(action, ...args) {
    const prevId = String(activeTabId ?? "")
    if (prevId === "all") {
      const editingKey = String(memoEditingId ?? "")
      if (editingKey) autoSaveMemoEditIfNeeded(editingKey)
      setMemoEditingId(null)
    } else {
      if (dirtyRef.current || isEditing) finishSingleEdit(prevId, false)
      setIsEditing(false)
    }
    Keyboard.dismiss()
    action?.(...args)
  }

  return (
    <SafeAreaView style={[styles.container, styles.listFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        loading={loading}
        onRefresh={() => runOutsideContent(onRefresh)}
        onSignOut={() => runOutsideContent(onSignOut)}
        onFilter={activeTabId === "all" ? () => setMemoFilterVisible(true) : null}
        filterActive={activeTabId === "all" ? !isAllMemoFiltersSelected : false}
        tone={tone}
        showLogo={false}
        titleStyle={styles.calendarTitleOffset}
        buttonsStyle={styles.calendarButtonsOffset}
      />
      <WindowTabs
        windows={windows}
        activeId={activeTabId}
        onSelect={(...args) => runOutsideContent(onSelectTab, ...args)}
        onAddWindow={(...args) => runOutsideContent(onAddWindow, ...args)}
        onRenameWindow={(...args) => runOutsideContent(onRenameWindow, ...args)}
        onDeleteWindow={(...args) => runOutsideContent(onDeleteWindow, ...args)}
        onChangeWindowColor={(...args) => runOutsideContent(onChangeWindowColor, ...args)}
        onReorderWindows={(...args) => runOutsideContent(onReorderWindows, ...args)}
        tone={tone}
      />
      <View style={[styles.card, styles.memoCard, isDark ? styles.cardDark : null, isDark ? styles.memoCardDark : null]}>
        {loading ? <ActivityIndicator size="small" color="#3b82f6" /> : null}
        <View style={styles.memoEditorWrap}>
          <ScrollView
            ref={memoAllScrollRef}
            style={[styles.memoPaper, isDark ? styles.paperDark : null]}
            contentContainerStyle={[styles.memoPaperContent, { paddingBottom: memoPaperBottomPadding }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            scrollEventThrottle={16}
          >
            {activeTabId === "all" ? (
              <View style={styles.memoAllList}>
                {filteredMemoWindows.map((w) => {
                    const key = String(w.id ?? "")
                    const body = String(rightMemos?.[key] ?? rightMemos?.[w.id] ?? "")
                    const isExpanded = memoExpandedMap?.[key] ?? true
                    const isEditingCard = memoEditingId === key
                    const draftValue = memoEditDrafts?.[key] ?? body
                    return (
                      <View key={w.id} style={[styles.memoAllCard, isDark ? styles.cardDark : null]}>
                        <View style={styles.memoAllHeader}>
                          <Pressable style={styles.memoAllHeaderLeft} onPress={() => beginMemoEditFromTap(w.id)}>
                            <View style={[styles.memoAllDot, { backgroundColor: w.color || "#94a3b8" }]} />
                            <Text style={[styles.memoAllTitle, isDark ? styles.textDark : null]}>{w.title}</Text>
                          </Pressable>
                          <View style={styles.memoAllHeaderRight}>
                            {isEditingCard ? (
                              <Pressable
                                onPress={() => commitMemoEdit(w.id)}
                                style={[styles.memoAllEditBtn, isDark ? styles.listPillDark : null]}
                              >
                                <Text style={[styles.memoAllEditBtnText, isDark ? styles.textDark : null]}>완료</Text>
                              </Pressable>
                            ) : null}
                            <Pressable onPress={() => toggleMemoExpanded(w.id)} style={styles.memoAllChevronBtn}>
                              <Text style={[styles.memoAllChevron, isDark ? styles.textMutedDark : null]}>
                                {isExpanded ? "▾" : "▸"}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                        {isExpanded ? (
                          isEditingCard ? (
                            <TextInput
                              ref={(ref) => {
                                if (ref) memoInputRefs.current[key] = ref
                              }}
                              value={draftValue}
                              autoFocus={false}
                              onBlur={() => {
                                autoSaveMemoEditIfNeeded(key)
                              }}
                              onChangeText={(t) =>
                                setMemoEditDrafts((prev) => {
                                  const next = { ...(prev ?? {}), [key]: String(t ?? "") }
                                  memoEditDraftsRef.current = next
                                  return next
                                })
                              }
                              placeholder="메모를 입력하세요"
                              multiline
                              scrollEnabled
                              underlineColorAndroid="transparent"
                              textAlignVertical="top"
                              style={[
                                styles.memoAllInput,
                                { fontSize: memoFontSize, lineHeight: memoLineHeight },
                                isDark ? styles.inputDark : null
                              ]}
                            />
                          ) : (
                            <Pressable onPress={() => beginMemoEditFromTap(w.id)}>
                              <Text style={[styles.memoAllBody, isDark ? styles.textMutedDark : null]}>
                                {body.trim() ? body : "내용 없음"}
                              </Text>
                            </Pressable>
                          )
                        ) : null}
                      </View>
                    )
                  })}
              </View>
            ) : (
              <View style={styles.memoAllList}>
                <View style={[styles.memoAllCard, isDark ? styles.cardDark : null]}>
                  <View style={styles.memoAllHeader}>
                    <Pressable
                      style={styles.memoAllHeaderLeft}
                      onPress={() => {
                        if (activeTabId === "all") return
                        beginSingleMemoEditFromTap()
                      }}
                    >
                      <View style={[styles.memoAllDot, { backgroundColor: activeWindow?.color || "#94a3b8" }]} />
                      <Text style={[styles.memoAllTitle, isDark ? styles.textDark : null]}>
                        {activeWindow?.title || "\uBA54\uBAA8"}
                      </Text>
                    </Pressable>
                    <View style={styles.memoAllHeaderRight}>
                      {isEditing ? (
                        <Pressable
                          onPress={() => {
                            finishSingleEdit(activeTabId, true)
                            Keyboard.dismiss()
                          }}
                          style={[styles.memoAllEditBtn, isDark ? styles.listPillDark : null]}
                        >
                          <Text style={[styles.memoAllEditBtnText, isDark ? styles.textDark : null]}>완료</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {isEditing ? (
                    <TextInput
                      ref={inputRef}
                      value={draft}
                      autoFocus={false}
                      onBlur={() => finishSingleEdit(activeTabId, false)}
                      onChangeText={(t) => {
                        const next = String(t ?? "")
                        draftRef.current = next
                        dirtyRef.current = true
                        setDraft(next)
                        if (!dirty) setDirty(true)
                        scheduleSave(next)
                      }}
                      placeholder={placeholder}
                      multiline
                      scrollEnabled
                      disableFullscreenUI
                      underlineColorAndroid="transparent"
                      textAlignVertical="top"
                      style={[
                        styles.memoAllInput,
                        {
                          fontSize: memoFontSize,
                          lineHeight: memoLineHeight
                        },
                        isDark ? styles.inputDark : null
                      ]}
                    />
                  ) : (
                    <Pressable onPress={() => beginSingleMemoEditFromTap()}>
                      <Text style={[styles.memoAllBody, isDark ? styles.textMutedDark : null]}>
                        {String(draft ?? "").trim() ? draft : "\uB0B4\uC6A9 \uC5C6\uC74C"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      <Modal
        visible={memoFilterVisible}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setMemoFilterVisible(false)}
      >
        <View style={styles.dayModalOverlay}>
          <Pressable style={styles.dayModalBackdrop} onPress={() => setMemoFilterVisible(false)} />
          <View style={[styles.calendarFilterCard, isDark ? styles.calendarFilterCardDark : null]}>
            <View style={styles.calendarFilterHeader}>
              <Text style={[styles.calendarFilterTitle, isDark ? styles.textDark : null]}>{"\uD544\uD130"}</Text>
              <View style={styles.calendarFilterActions}>
                <Pressable onPress={() => setMemoFilterTitles(allMemoFilterTitles)} style={styles.calendarFilterResetBtn}>
                  <Text style={styles.calendarFilterResetText}>{"\uC804\uCCB4"}</Text>
                </Pressable>
                <Pressable onPress={() => setMemoFilterVisible(false)} style={styles.calendarFilterDoneBtn}>
                  <Text style={styles.calendarFilterDoneText}>{"\uB2EB\uAE30"}</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.calendarFilterList}>
              {memoFilterOptions.map((opt) => {
                const active = memoFilterTitles.includes(opt.title)
                return (
                  <Pressable
                    key={opt.title}
                    onPress={() => toggleMemoFilter(opt.title)}
                    style={[styles.calendarFilterItem, isDark ? styles.calendarFilterItemDark : null]}
                  >
                    <View style={styles.calendarFilterItemLeft}>
                      <View style={[styles.tabDot, { backgroundColor: opt.color }]} />
                      <Text style={[styles.calendarFilterItemText, isDark ? styles.textDark : null]}>{opt.title}</Text>
                    </View>
                    <View
                      style={[
                        styles.calendarFilterCheck,
                        active ? styles.calendarFilterCheckActive : null,
                        isDark ? styles.calendarFilterCheckDark : null
                      ]}
                    >
                      {active ? <Text style={styles.calendarFilterCheckMark}>{"\u2713"}</Text> : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
            <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
              {"\uC120\uD0DD\uD55C \uD56D\uBAA9\uB9CC \uBA54\uBAA8\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4"}
            </Text>
            <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
              {"(\uD1B5\uD569 \uD0ED\uC5D0\uC11C\uB9CC \uC801\uC6A9)"}
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function PlanEditorModal({ visible, draft, windows, tone = "light", onClose, onSave, onDelete }) {
  const isDark = tone === "dark"
  const insets = useSafeAreaInsets()
  const [initialSnapshot, setInitialSnapshot] = useState(null)
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [content, setContent] = useState("")
  const [category, setCategory] = useState("__general__")
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [alarmLeadMinutes, setAlarmLeadMinutes] = useState(0)
  const [repeatType, setRepeatType] = useState("none")
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [repeatDays, setRepeatDays] = useState([])
  const [repeatUntil, setRepeatUntil] = useState("")
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [showEndTimePicker, setShowEndTimePicker] = useState(false)
  const [showRepeatUntilPicker, setShowRepeatUntilPicker] = useState(false)
  const [iosDateSheetVisible, setIosDateSheetVisible] = useState(false)
  const [iosTempDate, setIosTempDate] = useState(new Date())
  const [iosTimeSheetVisible, setIosTimeSheetVisible] = useState(false)
  const [iosTempTime, setIosTempTime] = useState(new Date())
  const [iosEndTimeSheetVisible, setIosEndTimeSheetVisible] = useState(false)
  const [iosTempEndTime, setIosTempEndTime] = useState(new Date())
  const [iosRepeatUntilSheetVisible, setIosRepeatUntilSheetVisible] = useState(false)
  const [iosTempRepeatUntil, setIosTempRepeatUntil] = useState(new Date())

  useEffect(() => {
    if (!visible) {
      setInitialSnapshot(null)
      return
    }
    const repeatMeta = normalizeRepeatMeta(draft ?? {})
    const draftTimeRange = normalizePlanTimeRange(draft ?? {})
    const initialState = buildPlanEditorSnapshot({
      date: String(draft?.date ?? ""),
      time: draftTimeRange.time,
      endTime: draftTimeRange.endTime,
      content: String(draft?.content ?? ""),
      category: String(draft?.category_id ?? "__general__") || "__general__",
      alarmEnabled: Boolean(draft?.alarm_enabled ?? true),
      alarmLeadMinutes: normalizeAlarmLeadMinutes(draft?.alarm_lead_minutes ?? 0),
      repeatType: repeatMeta.repeatType,
      repeatInterval: repeatMeta.repeatInterval,
      repeatDays: repeatMeta.repeatDays ?? [],
      repeatUntil: String(repeatMeta.repeatUntil ?? "")
    })
    setDate(initialState.date)
    setTime(initialState.time)
    setEndTime(initialState.endTime)
    setContent(initialState.content)
    setCategory(initialState.category)
    setAlarmEnabled(initialState.alarmEnabled)
    setAlarmLeadMinutes(initialState.alarmLeadMinutes)
    setRepeatType(initialState.repeatType)
    setRepeatInterval(initialState.repeatInterval)
    setRepeatDays(initialState.repeatDays)
    setRepeatUntil(initialState.repeatUntil)
    setInitialSnapshot(initialState)
    setShowDatePicker(false)
    setShowTimePicker(false)
    setShowEndTimePicker(false)
    setShowRepeatUntilPicker(false)
    setIosDateSheetVisible(false)
    setIosTimeSheetVisible(false)
    setIosEndTimeSheetVisible(false)
    setIosRepeatUntilSheetVisible(false)
    setIosTempRepeatUntil(parseDateKey(String(repeatMeta.repeatUntil ?? "")) ?? parseDateKey(String(draft?.date ?? "")) ?? new Date())
    const pickerSeed = normalizeClockTime(initialState.endTime || initialState.time)
    if (pickerSeed) {
      const [hText, mText] = pickerSeed.split(":")
      const next = new Date()
      next.setHours(Number(hText), Number(mText), 0, 0)
      setIosTempEndTime(next)
    } else {
      setIosTempEndTime(new Date())
    }
  }, [visible, draft])

  useEffect(() => {
    if (!visible) return
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0)
    })
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub?.remove?.()
      hideSub?.remove?.()
      setKeyboardHeight(0)
    }
  }, [visible])

  const title = draft?.id ? "일정 수정" : "일정 추가"
  const isKeyboardOpen = keyboardHeight > 0
  const safeBottomInset = useMemo(
    () => Math.max(insets.bottom, Platform.OS === "android" ? 34 : 12),
    [insets.bottom]
  )
  const keyboardLift = useMemo(() => {
    if (!isKeyboardOpen || Platform.OS !== "android") return 0
    return Math.min(360, Math.max(0, keyboardHeight - safeBottomInset + 10))
  }, [isKeyboardOpen, keyboardHeight, safeBottomInset])
  const dateValue = useMemo(() => parseDateKey(date) ?? new Date(), [date])
  const timeValue = useMemo(() => {
    const normalized = normalizeClockTime(time)
    if (!normalized) return new Date()
    const parts = String(normalized).split(":")
    const h = Number(parts[0] ?? 0)
    const m = Number(parts[1] ?? 0)
    const next = new Date()
    next.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
    return next
  }, [time])
  const endTimeValue = useMemo(() => {
    const normalized = normalizeClockTime(endTime)
    if (!normalized) return timeValue
    const parts = String(normalized).split(":")
    const h = Number(parts[0] ?? 0)
    const m = Number(parts[1] ?? 0)
    const next = new Date()
    next.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
    return next
  }, [endTime, timeValue])
  const timeDisplay = useMemo(() => (time ? formatTimeForDisplay(time) : ""), [time])
  const endTimeDisplay = useMemo(() => (endTime ? formatTimeForDisplay(endTime) : ""), [endTime])
  const alarmLeadOptions = useMemo(
    () => [
      { key: 0, label: "정시" },
      { key: 5, label: "5분 전" },
      { key: 10, label: "10분 전" },
      { key: 30, label: "30분 전" }
    ],
    []
  )

  const options = useMemo(() => {
    const items = [{ key: "__general__", label: "통합" }]
    for (const w of windows ?? []) {
      if (!w || w.id === "all") continue
      items.push({ key: String(w.title), label: String(w.title), color: w.color || "#94a3b8" })
    }
    return items
  }, [windows])

  const repeatTypeOptions = useMemo(
    () => [
      { key: "none", label: "반복 안 함" },
      { key: "daily", label: "매일" },
      { key: "weekly", label: "매주" },
      { key: "monthly", label: "매월" },
      { key: "yearly", label: "매년" }
    ],
    []
  )
  const repeatUnitLabel = useMemo(() => {
    if (repeatType === "daily") return "일"
    if (repeatType === "weekly") return "주"
    if (repeatType === "monthly") return "개월"
    if (repeatType === "yearly") return "년"
    return ""
  }, [repeatType])
  const repeatUntilValue = useMemo(() => parseDateKey(repeatUntil) ?? dateValue, [repeatUntil, dateValue])
  const isRecurring = repeatType !== "none"
  const repeatWeekLabels = useMemo(() => ["일", "월", "화", "수", "목", "금", "토"], [])
  const hasSeriesSource = useMemo(() => {
    const seriesId = String(draft?.series_id ?? "").trim()
    const sourceRepeat = normalizeRepeatType(draft?.repeat_type)
    const legacyHint = Boolean(draft?.has_recurrence_hint)
    return Boolean(seriesId) || sourceRepeat !== "none" || legacyHint
  }, [draft?.series_id, draft?.repeat_type, draft?.has_recurrence_hint])
  const currentSnapshot = useMemo(
    () =>
      buildPlanEditorSnapshot({
        date,
        time,
        endTime,
        content,
        category,
        alarmEnabled,
        alarmLeadMinutes,
        repeatType,
        repeatInterval,
        repeatDays,
        repeatUntil
      }),
    [date, time, endTime, content, category, alarmEnabled, alarmLeadMinutes, repeatType, repeatInterval, repeatDays, repeatUntil]
  )
  const hasChanges = useMemo(() => {
    if (!visible || !initialSnapshot) return false
    return JSON.stringify(currentSnapshot) !== JSON.stringify(initialSnapshot)
  }, [visible, currentSnapshot, initialSnapshot])

  useEffect(() => {
    if (repeatType !== "weekly") return
    if ((repeatDays?.length ?? 0) > 0) return
    const fallback = parseDateKey(date)
    setRepeatDays([fallback ? fallback.getDay() : 1])
  }, [repeatType, repeatDays, date])

  useEffect(() => {
    if (!isRecurring) return
    if (!repeatUntil) return
    const start = parseDateKey(date)
    const until = parseDateKey(repeatUntil)
    if (!start || !until) return
    if (until < start) setRepeatUntil(date)
  }, [isRecurring, date, repeatUntil])

  function toggleRepeatDay(dayIndex) {
    setRepeatDays((prev) => {
      const current = normalizeRepeatDays(prev)
      if (current.includes(dayIndex)) {
        const next = current.filter((v) => v !== dayIndex)
        return next.length > 0 ? next : current
      }
      return normalizeRepeatDays([...current, dayIndex])
    })
  }

  function handleSave() {
    if (!date) return
    if (!content.trim()) return
    const normalizedTime = normalizeClockTime(time)
    let normalizedEndTime = normalizeClockTime(endTime)
    if (normalizedEndTime && !normalizedTime) {
      Alert.alert("입력 확인", "종료시간을 쓰려면 시작시간을 먼저 선택해주세요.")
      return
    }
    if (normalizedTime && normalizedEndTime && normalizedTime === normalizedEndTime) {
      Alert.alert("입력 확인", "시작시간과 종료시간은 같을 수 없어요.")
      return
    }
    if (!normalizedTime) normalizedEndTime = ""
    const payload = {
      ...(draft ?? {}),
      date,
      time: normalizedTime,
      end_time: normalizedEndTime || null,
      content: String(content ?? "").trim(),
      category_id: category,
      alarm_enabled: Boolean(normalizedTime) ? Boolean(alarmEnabled) : false,
      alarm_lead_minutes: Boolean(normalizedTime) && Boolean(alarmEnabled) ? normalizeAlarmLeadMinutes(alarmLeadMinutes) : 0,
      repeat_type: repeatType,
      repeat_interval: repeatType === "none" ? 1 : normalizeRepeatInterval(repeatInterval),
      repeat_days: repeatType === "weekly" ? normalizeRepeatDays(repeatDays) : null,
      repeat_until: repeatType === "none" ? null : String(repeatUntil ?? "").trim() || null,
      original_repeat_type: String(draft?.repeat_type ?? "none"),
      original_series_id: String(draft?.series_id ?? "")
    }
    if (draft?.id && (hasSeriesSource || isRecurring)) {
      Alert.alert("반복 일정 수정", "어떤 범위에 적용할까요?", [
        { text: "취소", style: "cancel" },
        { text: "이번만", onPress: () => onSave?.({ ...payload, edit_scope: "single" }) },
        { text: "이후", onPress: () => onSave?.({ ...payload, edit_scope: "future" }) }
      ])
      return
    }
    onSave?.({ ...payload, edit_scope: "single" })
  }

  function requestClose() {
    if (!hasChanges) {
      onClose?.()
      return
    }
    Alert.alert("변경 사항이 있어요", "수정한 내용을 저장할까요?", [
      { text: "그냥 나가기", style: "destructive", onPress: () => onClose?.() },
      { text: "저장하기", onPress: () => handleSave() },
      { text: "취소", style: "cancel" }
    ])
  }

  function confirmDelete() {
    if (!draft?.id) return
    if (hasSeriesSource) {
      Alert.alert("반복 일정 삭제", "어떤 범위를 삭제할까요?", [
        { text: "취소", style: "cancel" },
        {
          text: "이번만",
          style: "destructive",
          onPress: () => onDelete?.({ ...(draft ?? {}), delete_scope: "single" })
        },
        {
          text: "이후",
          style: "destructive",
          onPress: () => onDelete?.({ ...(draft ?? {}), delete_scope: "future" })
        }
      ])
      return
    }
    Alert.alert("삭제", "이 일정을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => onDelete?.({ ...(draft ?? {}), delete_scope: "single" }) }
    ])
  }

  return (
    <Modal
      visible={visible}
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      animationType="fade"
      onRequestClose={requestClose}
    >
      <View style={[styles.dayModalOverlay, isKeyboardOpen ? styles.editorOverlayKeyboard : null]}>
        <Pressable style={styles.dayModalBackdrop} onPress={requestClose} />
        <View
          style={[
            styles.editorCard,
            isDark ? styles.editorCardDark : null,
            isKeyboardOpen ? styles.editorCardKeyboard : null,
            {
              marginBottom: safeBottomInset,
              // Keep transform shape stable to avoid Fabric diff null-transform crash on Android.
              transform: [{ translateY: -keyboardLift }]
            }
          ]}
        >
          <View style={styles.editorHeader}>
            <Text style={[styles.editorTitle, isDark ? styles.textDark : null]}>{title}</Text>
            <Pressable onPress={requestClose} style={[styles.editorCloseBtn, isDark ? styles.editorCloseBtnDark : null]}>
              <Text style={[styles.editorCloseText, isDark ? styles.textDark : null]}>닫기</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.editorBody}
            contentContainerStyle={styles.editorBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!isKeyboardOpen ? (
              <View style={styles.editorMetaRow}>
                <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>날짜</Text>
                <Pressable
                  style={[styles.editorPickerRow, isDark ? styles.editorPickerRowDark : null]}
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      setIosTempDate(dateValue)
                      setIosDateSheetVisible(true)
                      return
                    }
                    setShowDatePicker(true)
                  }}
                >
                  <View style={styles.editorPickerLeft}>
                    <Text style={[styles.editorPickerValue, isDark ? styles.textDark : null]}>
                      {date} {weekdayLabel(date)}
                    </Text>
                  </View>
                  <Text style={styles.editorPickerHint}>변경</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.editorMetaRow}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>카테고리</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorCategoryRow}>
                {options.map((opt) => {
                  const active = opt.key === category
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setCategory(opt.key)}
                      style={[
                        styles.editorCategoryPill,
                        isDark ? styles.editorCategoryPillDark : null,
                        active ? (isDark ? styles.editorCategoryPillActiveDark : styles.editorCategoryPillActive) : null
                      ]}
                    >
                      {opt.key !== "__general__" ? (
                        <View style={[styles.tabDot, { backgroundColor: opt.color || "#94a3b8" }]} />
                      ) : null}
                      <Text
                        style={[
                          styles.editorCategoryText,
                          isDark ? styles.textDark : null,
                          active ? styles.editorCategoryTextActive : null
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>

            <View style={styles.editorMetaRow}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>시간</Text>
              <Pressable
                style={[styles.editorPickerRow, isDark ? styles.editorPickerRowDark : null]}
                onPress={() => {
                  if (Platform.OS === "ios") {
                    setIosTempTime(timeValue)
                    setIosTimeSheetVisible(true)
                    return
                  }
                  setShowTimePicker(true)
                }}
              >
                <View style={styles.editorPickerLeft}>
                  <Text style={[styles.editorPickerValue, isDark ? styles.textDark : null]}>
                    {time ? timeDisplay : "시간 선택 안함"}
                  </Text>
                </View>
                <View style={styles.editorPickerRight}>
                  {time ? (
                    <Pressable
                      onPress={() => {
                        setTime("")
                        setEndTime("")
                        setAlarmEnabled(false)
                      }}
                      style={[styles.editorPickerClearPill, isDark ? styles.editorPickerClearPillDark : null]}
                      hitSlop={8}
                    >
                      <Text style={[styles.editorPickerClearText, isDark ? styles.textDark : null]}>없음</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.editorPickerHint}>선택</Text>
                </View>
              </Pressable>
              <Pressable
                style={[styles.editorPickerRow, isDark ? styles.editorPickerRowDark : null, styles.editorRangeRow]}
                onPress={() => {
                  if (!time) {
                    Alert.alert("입력 안내", "종료시간을 먼저 고르려면 시작시간을 선택해주세요.")
                    return
                  }
                  if (Platform.OS === "ios") {
                    setIosTempEndTime(endTime ? endTimeValue : timeValue)
                    setIosEndTimeSheetVisible(true)
                    return
                  }
                  setShowEndTimePicker(true)
                }}
              >
                <View style={styles.editorPickerLeft}>
                  <Text style={[styles.editorPickerValue, isDark ? styles.textDark : null]}>
                    {endTime ? endTimeDisplay : "종료시간 없음"}
                  </Text>
                </View>
                <View style={styles.editorPickerRight}>
                  {endTime ? (
                    <Pressable
                      onPress={() => setEndTime("")}
                      style={[styles.editorPickerClearPill, isDark ? styles.editorPickerClearPillDark : null]}
                      hitSlop={8}
                    >
                      <Text style={[styles.editorPickerClearText, isDark ? styles.textDark : null]}>없음</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.editorPickerHint}>종료</Text>
                </View>
              </Pressable>
              <View style={styles.editorAlarmRow}>
                <Text style={[styles.editorAlarmLabel, isDark ? styles.textMutedDark : null]}>알림</Text>
                <Pressable
                  onPress={() => {
                    if (!time) return
                    setAlarmEnabled((prev) => !prev)
                  }}
                  style={[
                    styles.editorAlarmToggle,
                    isDark ? styles.editorAlarmToggleDark : null,
                    time && alarmEnabled ? styles.editorAlarmToggleOn : null,
                    time && alarmEnabled && isDark ? styles.editorAlarmToggleOnDark : null,
                    !time ? styles.editorAlarmToggleDisabled : null
                  ]}
                >
                  <Text
                    style={[
                      styles.editorAlarmToggleText,
                      isDark ? styles.editorAlarmToggleTextDark : null,
                      time && alarmEnabled ? styles.editorAlarmToggleTextOn : null,
                      !time ? styles.editorAlarmToggleTextDisabled : null
                    ]}
                  >
                    {!time ? "시간 없음" : alarmEnabled ? "ON" : "OFF"}
                  </Text>
                </Pressable>
              </View>
              {time && alarmEnabled ? (
                <View style={styles.editorAlarmLeadRow}>
                  {alarmLeadOptions.map((opt) => {
                    const active = normalizeAlarmLeadMinutes(alarmLeadMinutes) === opt.key
                    return (
                      <Pressable
                        key={`lead-${opt.key}`}
                        onPress={() => setAlarmLeadMinutes(opt.key)}
                        style={[
                          styles.editorAlarmLeadPill,
                          isDark ? styles.editorAlarmLeadPillDark : null,
                          active ? (isDark ? styles.editorAlarmLeadPillActiveDark : styles.editorAlarmLeadPillActive) : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.editorAlarmLeadText,
                            isDark ? styles.textDark : null,
                            active ? styles.editorAlarmLeadTextActive : null
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
            </View>

            <View style={styles.editorMetaRow}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>반복</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorCategoryRow}>
                {repeatTypeOptions.map((opt) => {
                  const active = opt.key === repeatType
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setRepeatType(opt.key)}
                      style={[
                        styles.editorCategoryPill,
                        isDark ? styles.editorCategoryPillDark : null,
                        active ? (isDark ? styles.editorCategoryPillActiveDark : styles.editorCategoryPillActive) : null
                      ]}
                    >
                      <Text
                        style={[
                          styles.editorCategoryText,
                          isDark ? styles.textDark : null,
                          active ? styles.editorCategoryTextActive : null
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>

              {isRecurring ? (
                <View style={styles.editorRepeatBlock}>
                  <View style={[styles.editorRepeatStepRow, isDark ? styles.editorRepeatStepRowDark : null]}>
                    <Text style={[styles.editorRepeatStepLabel, isDark ? styles.textDark : null]}>매</Text>
                    <Pressable
                      style={[styles.editorRepeatStepBtn, isDark ? styles.editorRepeatStepBtnDark : null]}
                      onPress={() => setRepeatInterval((prev) => Math.max(1, normalizeRepeatInterval(prev) - 1))}
                    >
                      <Text style={[styles.editorRepeatStepBtnText, isDark ? styles.textDark : null]}>-</Text>
                    </Pressable>
                    <Text style={[styles.editorRepeatStepValue, isDark ? styles.textDark : null]}>
                      {normalizeRepeatInterval(repeatInterval)}
                    </Text>
                    <Pressable
                      style={[styles.editorRepeatStepBtn, isDark ? styles.editorRepeatStepBtnDark : null]}
                      onPress={() => setRepeatInterval((prev) => Math.min(365, normalizeRepeatInterval(prev) + 1))}
                    >
                      <Text style={[styles.editorRepeatStepBtnText, isDark ? styles.textDark : null]}>+</Text>
                    </Pressable>
                    <Text style={[styles.editorRepeatStepLabel, isDark ? styles.textDark : null]}>{repeatUnitLabel}</Text>
                  </View>

                  {repeatType === "weekly" ? (
                    <View style={styles.editorRepeatWeekRow}>
                      {repeatWeekLabels.map((label, dayIndex) => {
                        const active = normalizeRepeatDays(repeatDays).includes(dayIndex)
                        return (
                          <Pressable
                            key={`${label}-${dayIndex}`}
                            onPress={() => toggleRepeatDay(dayIndex)}
                            style={[
                              styles.editorRepeatDayPill,
                              isDark ? styles.editorRepeatDayPillDark : null,
                              active ? (isDark ? styles.editorRepeatDayPillActiveDark : styles.editorRepeatDayPillActive) : null
                            ]}
                          >
                            <Text
                              style={[
                                styles.editorRepeatDayText,
                                isDark ? styles.textDark : null,
                                active ? styles.editorRepeatDayTextActive : null
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}

                  <Pressable
                    style={[styles.editorPickerRow, isDark ? styles.editorPickerRowDark : null, styles.editorRepeatUntilRow]}
                    onPress={() => {
                      if (Platform.OS === "ios") {
                        setIosTempRepeatUntil(repeatUntilValue)
                        setIosRepeatUntilSheetVisible(true)
                        return
                      }
                      setShowRepeatUntilPicker(true)
                    }}
                  >
                    <View style={styles.editorPickerLeft}>
                      <Text style={[styles.editorPickerValue, isDark ? styles.textDark : null]}>
                        종료일 {repeatUntil || "1년 뒤 자동"}
                      </Text>
                    </View>
                    <View style={styles.editorPickerRight}>
                      {repeatUntil ? (
                        <Pressable
                          onPress={() => setRepeatUntil("")}
                          style={[styles.editorPickerClearPill, isDark ? styles.editorPickerClearPillDark : null]}
                          hitSlop={8}
                        >
                          <Text style={[styles.editorPickerClearText, isDark ? styles.textDark : null]}>없음</Text>
                        </Pressable>
                      ) : null}
                      <Text style={styles.editorPickerHint}>선택</Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.editorMetaRow}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>내용</Text>
              <View style={[styles.editorTextareaWrap, isDark ? styles.editorTextareaWrapDark : null]}>
                <TextInput
                  value={content}
                  onChangeText={setContent}
                  placeholder="할 일을 입력하세요"
                  placeholderTextColor="#9aa3b2"
                  style={[styles.editorTextareaInput, isDark ? styles.textDark : null]}
                  multiline
                  scrollEnabled={false}
                  disableFullscreenUI
                  underlineColorAndroid="transparent"
                  textAlignVertical="top"
                />
              </View>
            </View>

          </ScrollView>

          <View style={[styles.editorActions, isKeyboardOpen ? styles.editorActionsCompact : null]}>
            {draft?.id ? (
              <Pressable onPress={confirmDelete} style={styles.editorDangerBtn}>
                <Text style={styles.editorDangerText}>삭제</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable onPress={handleSave} style={styles.editorSaveBtn}>
              <Text style={styles.editorSaveText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <PickerSheet
        visible={iosDateSheetVisible}
        title="날짜 선택"
        value={iosTempDate}
        mode="date"
        tone={tone}
        onCancel={() => setIosDateSheetVisible(false)}
        onConfirm={(selected) => {
          setIosDateSheetVisible(false)
          if (!selected) return
          setDate(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
        }}
      />
      <PickerSheet
        visible={iosTimeSheetVisible}
        title="시간 선택"
        value={iosTempTime}
        mode="time"
        is24Hour={false}
        tone={tone}
        onCancel={() => setIosTimeSheetVisible(false)}
        onConfirm={(selected) => {
          setIosTimeSheetVisible(false)
          if (!selected) return
          if (!time) setAlarmEnabled(true)
          const nextTime = `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`
          setTime(nextTime)
          setEndTime((prev) => (normalizeClockTime(prev) === nextTime ? "" : prev))
        }}
      />
      <PickerSheet
        visible={iosEndTimeSheetVisible}
        title="종료시간 선택"
        value={iosTempEndTime}
        mode="time"
        is24Hour={false}
        tone={tone}
        onCancel={() => setIosEndTimeSheetVisible(false)}
        onConfirm={(selected) => {
          setIosEndTimeSheetVisible(false)
          if (!selected) return
          const nextEndTime = `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`
          if (normalizeClockTime(time) && nextEndTime === normalizeClockTime(time)) {
            Alert.alert("입력 확인", "시작시간과 종료시간은 같을 수 없어요.")
            setEndTime("")
            return
          }
          setEndTime(nextEndTime)
        }}
      />
      <PickerSheet
        visible={iosRepeatUntilSheetVisible}
        title="반복 종료일"
        value={iosTempRepeatUntil}
        mode="date"
        tone={tone}
        onCancel={() => setIosRepeatUntilSheetVisible(false)}
        onConfirm={(selected) => {
          setIosRepeatUntilSheetVisible(false)
          if (!selected) return
          setRepeatUntil(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
        }}
      />
      {Platform.OS === "android" && showDatePicker ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="calendar"
          onChange={(_event, selected) => {
            setShowDatePicker(false)
            if (!selected) return
            setDate(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
          }}
        />
      ) : null}
      {Platform.OS === "android" && showRepeatUntilPicker ? (
        <DateTimePicker
          value={repeatUntilValue}
          mode="date"
          display="calendar"
          onChange={(_event, selected) => {
            setShowRepeatUntilPicker(false)
            if (!selected) return
            setRepeatUntil(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
          }}
        />
      ) : null}
      {Platform.OS === "android" && showTimePicker ? (
        <DateTimePicker
          value={timeValue}
          mode="time"
          display="clock"
          is24Hour={false}
          onChange={(_event, selected) => {
            setShowTimePicker(false)
            if (!selected) return
            if (!time) setAlarmEnabled(true)
            const nextTime = `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`
            setTime(nextTime)
            setEndTime((prev) => (normalizeClockTime(prev) === nextTime ? "" : prev))
          }}
        />
      ) : null}
      {Platform.OS === "android" && showEndTimePicker ? (
        <DateTimePicker
          value={endTime ? endTimeValue : timeValue}
          mode="time"
          display="clock"
          is24Hour={false}
          onChange={(_event, selected) => {
            setShowEndTimePicker(false)
            if (!selected) return
            const nextEndTime = `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`
            if (normalizeClockTime(time) && nextEndTime === normalizeClockTime(time)) {
              Alert.alert("입력 확인", "시작시간과 종료시간은 같을 수 없어요.")
              setEndTime("")
              return
            }
            setEndTime(nextEndTime)
          }}
        />
      ) : null}
    </Modal>
  )
}

function PickerSheet({ visible, title, value, mode, is24Hour = true, tone = "light", onCancel, onConfirm }) {
  const isDark = tone === "dark"
  const [temp, setTemp] = useState(value instanceof Date ? value : new Date())

  useEffect(() => {
    if (!visible) return
    setTemp(value instanceof Date ? value : new Date())
  }, [visible, value])

  if (!visible) return null

  return (
    <Modal transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onCancel} />
        <View style={[styles.sheetCard, isDark ? styles.sheetCardDark : null]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>{title}</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onCancel} style={[styles.sheetBtnGhost, isDark ? styles.sheetBtnGhostDark : null]}>
                <Text style={[styles.sheetBtnGhostText, isDark ? styles.textDark : null]}>취소</Text>
              </Pressable>
              <Pressable onPress={() => onConfirm?.(temp)} style={styles.sheetBtnPrimary}>
                <Text style={styles.sheetBtnPrimaryText}>확인</Text>
              </Pressable>
            </View>
          </View>
          <DateTimePicker
            value={temp}
            mode={mode}
            is24Hour={is24Hour}
            display={mode === "date" ? "inline" : "spinner"}
            onChange={(_event, selected) => {
              if (!selected) return
              setTemp(selected)
            }}
            style={styles.sheetPicker}
          />
        </View>
      </View>
    </Modal>
  )
}

function CalendarScreen({
  itemsByDate,
  loading,
  onRefresh,
  onSignOut,
  tone = "light",
  windows,
  activeTabId,
  onSelectTab,
  onAddWindow,
  onRenameWindow,
  onDeleteWindow,
  onChangeWindowColor,
  onReorderWindows,
  holidaysByDate,
  ensureHolidayYear,
  onAddPlan,
  onEditPlan,
  onReorderNoTime,
  onQuickDeletePlan,
  onSelectDateKey
}) {
  const isDark = tone === "dark"
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1)
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const [calendarFilterVisible, setCalendarFilterVisible] = useState(false)
  const [calendarFilterTitles, setCalendarFilterTitles] = useState([])
  const filterInitRef = useRef(false)
  const [dayReorderMode, setDayReorderMode] = useState(false)
  const [dayReorderItems, setDayReorderItems] = useState([])
  const dayReorderItemsRef = useRef([])
  const dayReorderOriginalIdsRef = useRef([])
  const [dayReorderSaving, setDayReorderSaving] = useState(false)
  const [dayDraggingId, setDayDraggingId] = useState(null)
  const dayDragY = useRef(new Animated.Value(0)).current
  const dayLayoutsRef = useRef({})
  const dayDragStateRef = useRef({ activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 })
  const dayPendingAutoDragIdRef = useRef("")
  const daySuppressPressRef = useRef(false)

  const colorByTitle = useMemo(() => {
    const map = new Map()
    for (const w of windows ?? []) {
      if (!w?.title) continue
      map.set(w.title, w.color || "#94a3b8")
    }
    return map
  }, [windows])

  const monthLabel = `${viewYear}-${pad2(viewMonth)}`
  const todayKey = dateToKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const filterOptions = useMemo(
    () =>
      (windows ?? [])
        .filter((w) => w && w.id !== "all" && String(w.title ?? "").trim())
        .map((w) => ({ title: String(w.title), color: w.color || "#94a3b8" })),
    [windows]
  )
  const allFilterTitles = useMemo(() => filterOptions.map((opt) => opt.title), [filterOptions])
  const isAllFiltersSelected = allFilterTitles.length > 0 && calendarFilterTitles.length === allFilterTitles.length
  const applyCalendarFilter = useCallback(
    (items) => {
      const list = (Array.isArray(items) ? items : []).filter((item) => isRenderablePlanRow(item))
      if (activeTabId !== "all") return list
      const selected = new Set(calendarFilterTitles)
      return list.filter((item) => {
        const category = String(item?.category_id ?? "").trim()
        // Keep uncategorized items visible so Calendar matches List in 통합 view.
        if (!category || category === "__general__") return true
        if (!selected.size) return false
        return selected.has(category)
      })
    },
    [activeTabId, calendarFilterTitles]
  )
  const first = new Date(viewYear, viewMonth - 1, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
  const totalCells = startDay + daysInMonth
  const weeks = Math.ceil(totalCells / 7)
  const safeWeeks = Math.max(1, Number.isFinite(weeks) ? weeks : 0)
  const maxItemsPerDay = safeWeeks <= 4 ? 8 : 6
  const cells = []
  for (let i = 0; i < startDay; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d)
  while (cells.length < weeks * 7) cells.push(null)

  const cellHeightPercent = `${100 / safeWeeks}%`
  const dayItems = selectedDateKey ? applyCalendarFilter(itemsByDate.get(selectedDateKey) ?? []) : []
  const selectedDateLabel = useMemo(() => {
    if (!selectedDateKey) return ""
    const dt = parseDateKey(selectedDateKey)
    if (!dt) return selectedDateKey
    const dayName = weekdayLabel(selectedDateKey)
    const [y, m, d] = String(selectedDateKey).split("-")
    return `${y}.${m}.${d}${dayName ? ` (${dayName})` : ""}`
  }, [selectedDateKey])
  const dayModalCount = dayReorderMode ? dayReorderItems.length : dayItems.length
  const dayDraggingItem = dayReorderItems.find((item) => String(item?.id ?? "") === dayDraggingId)

  function moveDayItem(list, fromIndex, toIndex) {
    const safe = Array.isArray(list) ? list : []
    const next = [...safe]
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return next
    if (fromIndex >= next.length || toIndex >= next.length) return next
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  function dayIdsEqual(a, b) {
    const left = Array.isArray(a) ? a : []
    const right = Array.isArray(b) ? b : []
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false
    }
    return true
  }

  function hasPendingDayReorderChanges() {
    const nextIds = (dayReorderItemsRef.current ?? []).map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (nextIds.length === 0) return false
    return !dayIdsEqual(nextIds, dayReorderOriginalIdsRef.current)
  }

  async function commitDayReorderIfNeeded() {
    if (dayReorderSaving) return
    if (!onReorderNoTime) return
    const dateKey = String(selectedDateKey ?? "").trim()
    if (!dateKey) return
    const list = Array.isArray(dayReorderItemsRef.current) ? [...dayReorderItemsRef.current] : []
    const nextIds = list.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (nextIds.length === 0) return
    if (!hasPendingDayReorderChanges()) return
    setDayReorderSaving(true)
    try {
      await onReorderNoTime?.(dateKey, list)
      dayReorderOriginalIdsRef.current = nextIds
    } finally {
      setDayReorderSaving(false)
    }
  }

  function closeDayReorderMode() {
    setDayReorderMode(false)
    dayLayoutsRef.current = {}
    dayDragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
    dayPendingAutoDragIdRef.current = ""
    setDayDraggingId(null)
    setDayReorderSaving(false)
    daySuppressPressRef.current = false
    dayDragY.setValue(0)
  }

  async function closeDayReorderModeWithSave() {
    if (dayReorderSaving) return
    await commitDayReorderIfNeeded()
    closeDayReorderMode()
  }

  function clearDayReorderState() {
    closeDayReorderMode()
    setDayReorderItems([])
    dayReorderItemsRef.current = []
    dayReorderOriginalIdsRef.current = []
  }

  function openDayReorder(sourceItems = null, autoDragId = "") {
    if (!onReorderNoTime) return
    const dateKey = String(selectedDateKey ?? "").trim()
    if (!dateKey) return
    const rawItems = Array.isArray(sourceItems) ? sourceItems : dayItems
    const items = sortItemsByTimeAndOrder(rawItems)
    const ids = items.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (ids.length === 0) return
    setDayReorderMode(true)
    setDayReorderItems(items)
    dayReorderItemsRef.current = items
    dayReorderOriginalIdsRef.current = ids
    dayLayoutsRef.current = {}
    dayDragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
    dayPendingAutoDragIdRef.current = String(autoDragId ?? "").trim()
    setDayDraggingId(null)
    setDayReorderSaving(false)
    dayDragY.setValue(0)
  }

  function startDayDrag(item) {
    if (!item) return
    const id = String(item?.id ?? "").trim()
    if (!id) return
    const layout = dayLayoutsRef.current?.[id]
    if (!layout) return
    const list = dayReorderItemsRef.current
    const currentIndex = Array.isArray(list) ? list.findIndex((row) => String(row?.id ?? "").trim() === id) : -1
    if (currentIndex < 0) return
    const startY = Number(layout.y) || 0
    const height = Number(layout.height) || 48
    dayDragStateRef.current = { activeId: id, startY, height, startIndex: currentIndex, currentIndex, lastSwapAt: 0 }
    dayDragY.setValue(startY)
    requestAnimationFrame(() => {
      setDayDraggingId(id)
    })
  }

  function finishDayDrag() {
    const state = dayDragStateRef.current
    if (!state.activeId) return
    const activeId = String(state.activeId ?? "")
    const cleanup = () => {
      dayDragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
      setDayDraggingId(null)
    }

    dayDragY.stopAnimation((currentY) => {
      const rawTarget = Number(dayLayoutsRef.current?.[activeId]?.y ?? Number.NaN)
      const fallback = Number.isFinite(currentY) ? currentY : Number(state.startY ?? 0)
      const targetY = Number.isFinite(rawTarget) ? rawTarget : fallback
      Animated.spring(dayDragY, {
        toValue: targetY,
        tension: 220,
        friction: 22,
        useNativeDriver: true
      }).start(() => {
        cleanup()
      })
    })
  }

  function quickDeleteFromDayReorder(item) {
    if (!item || !onQuickDeletePlan) return
    Alert.alert("일정 삭제", "이 항목을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          await onQuickDeletePlan?.(item)
          const id = String(item?.id ?? "").trim()
          if (!id) return
          const next = (dayReorderItemsRef.current ?? []).filter((row) => String(row?.id ?? "").trim() !== id)
          dayReorderItemsRef.current = next
          dayReorderOriginalIdsRef.current = next.map((row) => String(row?.id ?? "").trim()).filter(Boolean)
          setDayReorderItems(next)
          if (dayDraggingId && String(dayDraggingId) === id) {
            dayDragStateRef.current = { activeId: null, startY: 0, height: 0, startIndex: -1, currentIndex: -1, lastSwapAt: 0 }
            setDayDraggingId(null)
            dayDragY.setValue(0)
          }
          if (next.length === 0) closeDayReorderMode()
        }
      }
    ])
  }

  const dayPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(dayDragStateRef.current.activeId),
        onStartShouldSetPanResponderCapture: () => Boolean(dayDragStateRef.current.activeId),
        onMoveShouldSetPanResponder: () => Boolean(dayDragStateRef.current.activeId),
        onMoveShouldSetPanResponderCapture: () => Boolean(dayDragStateRef.current.activeId),
        onPanResponderMove: (_evt, gesture) => {
          const state = dayDragStateRef.current
          if (!state.activeId) return
          const nextY = Number(state.startY ?? 0) + Number(gesture?.dy ?? 0)
          dayDragY.setValue(nextY)
          const list = dayReorderItemsRef.current
          if (!Array.isArray(list) || list.length === 0) return
          let currentIndex = Number(state.currentIndex ?? -1)
          if (!Number.isFinite(currentIndex) || currentIndex < 0 || currentIndex >= list.length) {
            currentIndex = list.findIndex((row) => String(row?.id ?? "") === String(state.activeId ?? ""))
          }
          if (currentIndex < 0) return
          const now = Date.now()
          if (now - Number(state.lastSwapAt ?? 0) < 16) return
          const startIndex = Number.isFinite(Number(state.startIndex))
            ? Number(state.startIndex)
            : currentIndex
          const rowHeight = Math.max(28, Number(state.height ?? 0) || 48)
          const stepOffset = Number(gesture?.dy ?? 0) / rowHeight
          const projected = Math.round(startIndex + stepOffset)
          const targetIndex = clamp(projected, 0, list.length - 1)
          if (targetIndex === currentIndex) return
          const nextItems = moveDayItem(list, currentIndex, targetIndex)
          runSwapLayoutAnimation()
          dayReorderItemsRef.current = nextItems
          dayDragStateRef.current = { ...state, currentIndex: targetIndex, lastSwapAt: now }
          setDayReorderItems(nextItems)
        },
        onPanResponderRelease: () => finishDayDrag(),
        onPanResponderTerminate: () => finishDayDrag(),
        onPanResponderTerminationRequest: () => false
      }),
    [selectedDateKey, onReorderNoTime]
  )

  async function closeDayModal() {
    if (dayReorderSaving) return
    if (dayReorderMode) {
      await commitDayReorderIfNeeded()
    }
    setSelectedDateKey(null)
    clearDayReorderState()
  }

  useEffect(() => {
    dayReorderItemsRef.current = dayReorderItems
  }, [dayReorderItems])

  useEffect(() => {
    if (selectedDateKey) return
    clearDayReorderState()
  }, [selectedDateKey])

  useEffect(() => {
    if (!selectedDateKey || dayReorderMode) return
    const sorted = sortItemsByTimeAndOrder(dayItems)
    const nextIds = sorted.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    const currentIds = (dayReorderItemsRef.current ?? []).map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (dayIdsEqual(nextIds, currentIds)) return
    setDayReorderItems(sorted)
    dayReorderItemsRef.current = sorted
  }, [selectedDateKey, dayItems, dayReorderMode])

  useEffect(() => {
    if (!dayReorderMode) return
    const pendingId = String(dayPendingAutoDragIdRef.current ?? "").trim()
    if (!pendingId) return
    const row = dayReorderItems.find((item) => String(item?.id ?? "").trim() === pendingId)
    if (!row) {
      dayPendingAutoDragIdRef.current = ""
      return
    }
    if (!dayLayoutsRef.current?.[pendingId]) return
    dayPendingAutoDragIdRef.current = ""
    startDayDrag(row)
  }, [dayReorderMode, dayReorderItems])

  useEffect(() => {
    ensureHolidayYear?.(viewYear)
  }, [viewYear, ensureHolidayYear])

  useEffect(() => {
    if (activeTabId === "all") return
    setCalendarFilterVisible(false)
  }, [activeTabId])

  useEffect(() => {
    if (!allFilterTitles.length) {
      setCalendarFilterTitles([])
      filterInitRef.current = false
      return
    }
    if (!filterInitRef.current) {
      setCalendarFilterTitles(allFilterTitles)
      filterInitRef.current = true
      return
    }
    setCalendarFilterTitles((prev) => prev.filter((t) => allFilterTitles.includes(t)))
  }, [allFilterTitles])


  function goPrevMonth() {
    const nextMonth = viewMonth - 1
    if (nextMonth < 1) {
      setViewYear(viewYear - 1)
      setViewMonth(12)
      return
    }
    setViewMonth(nextMonth)
  }

  function goNextMonth() {
    const nextMonth = viewMonth + 1
    if (nextMonth > 12) {
      setViewYear(viewYear + 1)
      setViewMonth(1)
      return
    }
    setViewMonth(nextMonth)
  }

  const calendarPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => {
          const { dx, dy } = gesture
          return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2
        },
        onPanResponderRelease: (_evt, gesture) => {
          const { dx, dy } = gesture
          if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
          if (dx > 0) {
            goPrevMonth()
          } else {
            goNextMonth()
          }
        }
      }),
    [viewMonth, viewYear]
  )

  function openDate(day) {
    if (!day) return
    const key = dateToKey(viewYear, viewMonth, day)
    onSelectDateKey?.(key)
    setSelectedDateKey(key)
  }

  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth() + 1)
  }

  function toggleCalendarFilter(title) {
    const key = String(title ?? "").trim()
    if (!key) return
    setCalendarFilterTitles((prev) => {
      const has = prev.includes(key)
      if (has) return prev.filter((v) => v !== key)
      return [...prev, key]
    })
  }

  function renderDayModalRow(item, options = {}) {
    if (!item) return null
    const { rowKey, onPress, onLongPress, onDelete, onLayout, draggable = false, ghost = false, placeholder = false } = options
    const line = formatLine(item)
    const time = buildPlanTimeTextFromRow(item)
    const canLongPress = !ghost && typeof onLongPress === "function"
    const canPress = !ghost && typeof onPress === "function"
    const isPressable = canPress || canLongPress || (draggable && !ghost)
    const showDelete = draggable && !ghost && !placeholder && typeof onDelete === "function"
    const Container = isPressable ? Pressable : View
    return (
      <Container
        key={rowKey}
        onLayout={onLayout}
        onPress={canPress ? onPress : undefined}
        onLongPress={canLongPress ? onLongPress : undefined}
        delayLongPress={canLongPress ? 110 : undefined}
        style={[
          styles.dayModalItemRow,
          isDark ? styles.dayModalItemRowDark : null,
          ghost ? styles.reorderDragGhost : null,
          ghost && isDark ? styles.reorderDragGhostDark : null,
          placeholder ? styles.reorderItemPlaceholder : null
        ]}
      >
        {time ? (
          <Text style={[styles.dayModalItemTime, isDark ? styles.textMutedDark : null]}>{time}</Text>
        ) : (
          <Text style={styles.dayModalItemTimeEmpty}>{"\u00A0"}</Text>
        )}
        <Text style={[styles.dayModalItemText, isDark ? styles.textDark : null]}>{line.text}</Text>
        {showDelete ? (
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            style={[styles.reorderDeleteBtn, isDark ? styles.reorderDeleteBtnDark : null]}
          >
            <Text style={styles.reorderDeleteBtnText}>X</Text>
          </Pressable>
        ) : null}
      </Container>
    )
  }

  const todayLabel = `${today.getMonth() + 1}/${today.getDate()}`

  return (
    <SafeAreaView style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        todayLabel={todayLabel}
        onToday={goToday}
        onFilter={activeTabId === "all" ? () => setCalendarFilterVisible(true) : null}
        filterActive={!isAllFiltersSelected}
        tone={tone}
        showLogo={false}
        titleStyle={styles.calendarTitleOffset}
        buttonsStyle={styles.calendarButtonsOffset}
      />
      <WindowTabs
        windows={windows}
        activeId={activeTabId}
        onSelect={onSelectTab}
        onAddWindow={onAddWindow}
        onRenameWindow={onRenameWindow}
        onDeleteWindow={onDeleteWindow}
        onChangeWindowColor={onChangeWindowColor}
        onReorderWindows={onReorderWindows}
        tone={tone}
      />
	      <View
          style={[styles.card, styles.calendarCard, isDark ? styles.cardDark : null, isDark ? styles.calendarCardDark : null]}
          {...calendarPanResponder.panHandlers}
        >
	          <View style={[styles.calendarHeaderWrap, isDark ? styles.calendarHeaderWrapDark : null]}>
	            <View style={[styles.calendarHeader, isDark ? styles.calendarHeaderDark : null]}>
              <TouchableOpacity
                style={[styles.calendarNavButton, isDark ? styles.calendarNavButtonDark : null, styles.calendarHeaderLeft]}
                onPress={goPrevMonth}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
	                <Text style={[styles.calendarNavText, isDark ? styles.calendarNavTextDark : null]}>{"<"}</Text>
	              </TouchableOpacity>
	              <Text style={[styles.calendarTitleCentered, isDark ? styles.textDark : null]}>{monthLabel}</Text>
	              <View style={styles.calendarHeaderRight}>
                <TouchableOpacity
                  style={[styles.calendarNavButton, styles.calendarNavButtonRight, isDark ? styles.calendarNavButtonDark : null]}
                  onPress={goNextMonth}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
	                  <Text style={[styles.calendarNavText, isDark ? styles.calendarNavTextDark : null]}>{">"}</Text>
	                </TouchableOpacity>
	              </View>
	            </View>
	            <View style={[styles.weekHeaderRow, isDark ? styles.weekHeaderRowDark : null]}>
	              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, idx) => (
	                <Text
                    key={d + idx}
                    style={[
                      styles.weekHeaderText,
                      idx === 0 ? styles.weekHeaderTextSun : null,
                      idx === 6 ? styles.weekHeaderTextSat : null,
                      isDark ? styles.weekHeaderTextDark : null,
                      isDark && idx === 0 ? styles.weekHeaderTextSunDark : null,
                      isDark && idx === 6 ? styles.weekHeaderTextSatDark : null
                    ]}
                  >
	                  {d}
	                </Text>
	              ))}
	            </View>
	          </View>
	          <View style={[styles.calendarGrid, isDark ? styles.calendarGridDark : null]}>
	            {cells.map((day, idx) => {
	              const key = day ? dateToKey(viewYear, viewMonth, day) : null
	              const rawItems = key ? itemsByDate.get(key) ?? [] : []
	              const items = applyCalendarFilter(rawItems)
              const count = items.length
              const holidayName = key ? holidaysByDate?.get?.(key) ?? "" : ""
              const holidayLabel = holidayName ? String(holidayName).trim() : ""
              const isHoliday = Boolean(holidayName)
              const maxItemsForCell = holidayLabel ? Math.max(0, maxItemsPerDay - 1) : maxItemsPerDay
              const visible = items.slice(0, maxItemsForCell)
              const hiddenCount = Math.max(0, count - visible.length)
              const col = idx % 7
              const row = Math.floor(idx / 7)
              const isSunday = col === 0
              const isSaturday = col === 6
	              const isLastCol = col === 6
	              const isLastRow = row === weeks - 1
	              const isToday = key === todayKey
	              const isSelected = key && key === selectedDateKey
	            return (
	              <Pressable
	                key={`${idx}-${day ?? "x"}`}
	                style={[
	                  styles.calendarCell,
	                  isDark ? styles.calendarCellDark : null,
	                  { height: cellHeightPercent },
	                  isLastCol ? styles.calendarCellLastCol : null,
	                  isLastRow ? styles.calendarCellLastRow : null,
	                  isToday ? (isDark ? styles.calendarCellTodayDark : styles.calendarCellToday) : null,
	                  isSelected ? (isDark ? styles.calendarCellSelectedDark : styles.calendarCellSelected) : null
	                ]}
	                onPress={() => openDate(day)}
	              >
                  {isToday ? <View style={[styles.calendarTodayOutline, isDark ? styles.calendarTodayOutlineDark : null]} /> : null}
	                <View style={styles.calendarCellHeader}>
	                  <Text
	                    style={[
	                      styles.calendarDay,
	                      isDark ? styles.calendarDayDark : null,
	                      day ? null : styles.calendarDayMuted,
	                      isSunday ? styles.calendarDaySunday : null,
	                      isSaturday ? styles.calendarDaySaturday : null,
	                      isToday ? (isDark ? styles.calendarDayTodayDark : styles.calendarDayToday) : null,
	                      isSelected ? (isDark ? styles.calendarDaySelectedDark : styles.calendarDaySelected) : null,
	                      isHoliday ? styles.calendarDayHoliday : null
	                    ]}
	                  >
	                    {day ?? ""}
	                  </Text>
	                  {hiddenCount > 0 ? (
	                    <View style={[styles.calendarMoreBadge, isDark ? styles.calendarMoreBadgeDark : null]}>
	                      <Text style={[styles.calendarMoreText, isDark ? styles.calendarMoreTextDark : null]}>+{hiddenCount}</Text>
	                    </View>
	                  ) : null}
	                </View>
	                {holidayLabel ? (
	                  <Text
	                    numberOfLines={1}
	                    adjustsFontSizeToFit
	                    minimumFontScale={0.6}
	                    style={[styles.calendarHolidayText, isDark ? styles.calendarHolidayTextDark : null]}
	                  >
	                    {holidayLabel}
	                  </Text>
	                ) : null}
	                <View style={styles.calendarLineStack}>
	                  {visible.map((item) => {
	                    const line = formatLine(item)
                      const timeLabel = splitTimeLabel(line.time)
                      const hasRangeTime = Boolean(timeLabel.end)
	                    const category = String(item?.category_id ?? "").trim()
	                    const dotColor =
	                      category && category !== "__general__"
	                        ? colorByTitle.get(category) || "#94a3b8"
	                        : "#9aa3b2"
	                    return (
	                      <View key={item.id ?? `${item.date}-${item.content}`} style={styles.calendarLine}>
	                        <View
	                          style={[
	                            styles.calendarLabel,
                              hasRangeTime ? styles.calendarLabelRange : null,
	                            { backgroundColor: dotColor },
	                            isDark ? styles.calendarLabelDark : null
	                          ]}
	                        >
                            <View style={styles.calendarLabelRow}>
		                            {timeLabel.start ? (
                                hasRangeTime ? (
                                  <View style={[styles.calendarLabelTimeCol, styles.calendarLabelTimeColRange]}>
                                    <Text numberOfLines={1} style={[styles.calendarLabelTime, isDark ? styles.calendarLabelTimeDark : null]}>
                                      {timeLabel.start}
                                    </Text>
                                    <Text numberOfLines={1} style={[styles.calendarLabelTime, isDark ? styles.calendarLabelTimeDark : null]}>
                                      {timeLabel.end}
                                    </Text>
                                  </View>
                                ) : (
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.calendarLabelTime,
                                      styles.calendarLabelTimeSingleSlot,
                                      styles.calendarLabelTimeSingle,
                                      isDark ? styles.calendarLabelTimeDark : null
                                    ]}
                                  >
                                    {timeLabel.start}
                                  </Text>
                                )
                              ) : null}
		                          <Text
                                numberOfLines={1}
                                ellipsizeMode="clip"
                                style={[
                                  styles.calendarLabelText,
                                  !hasRangeTime ? styles.calendarLabelTextSingle : null,
                                  hasRangeTime ? styles.calendarLabelTextRange : null,
                                  isDark ? styles.calendarLabelTextDark : null
                                ]}
                              >
		                            {line.text}
		                          </Text>
                            </View>
		                        </View>
		                      </View>
	                    )
	                  })}
	                </View>
	              </Pressable>
	            )
	          })}
	        </View>
	      </View>

      <Modal
        visible={calendarFilterVisible}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setCalendarFilterVisible(false)}
      >
        <View style={styles.dayModalOverlay}>
          <Pressable style={styles.dayModalBackdrop} onPress={() => setCalendarFilterVisible(false)} />
          <View style={[styles.calendarFilterCard, isDark ? styles.calendarFilterCardDark : null]}>
            <View style={styles.calendarFilterHeader}>
              <Text style={[styles.calendarFilterTitle, isDark ? styles.textDark : null]}>필터</Text>
              <View style={styles.calendarFilterActions}>
                <Pressable onPress={() => setCalendarFilterTitles(allFilterTitles)} style={styles.calendarFilterResetBtn}>
                  <Text style={styles.calendarFilterResetText}>전체</Text>
                </Pressable>
                <Pressable onPress={() => setCalendarFilterVisible(false)} style={styles.calendarFilterDoneBtn}>
                  <Text style={styles.calendarFilterDoneText}>닫기</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.calendarFilterList}>
              {filterOptions.map((opt) => {
                const active = calendarFilterTitles.includes(opt.title)
                return (
                  <Pressable
                    key={opt.title}
                    onPress={() => toggleCalendarFilter(opt.title)}
                    style={[styles.calendarFilterItem, isDark ? styles.calendarFilterItemDark : null]}
                  >
                    <View style={styles.calendarFilterItemLeft}>
                      <View style={[styles.tabDot, { backgroundColor: opt.color }]} />
                      <Text style={[styles.calendarFilterItemText, isDark ? styles.textDark : null]}>{opt.title}</Text>
                    </View>
                    <View
                      style={[
                        styles.calendarFilterCheck,
                        active ? styles.calendarFilterCheckActive : null,
                        isDark ? styles.calendarFilterCheckDark : null
                      ]}
                    >
                      {active ? <Text style={styles.calendarFilterCheckMark}>✓</Text> : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
            {isAllFiltersSelected ? (
              <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
                전체 일정 표시 중입니다.
              </Text>
            ) : (
              <Text style={[styles.calendarFilterHint, isDark ? styles.textMutedDark : null]}>
                선택한 탭 일정만 달력에 표시됩니다.
              </Text>
            )}
          </View>
        </View>
      </Modal>
    
      <Modal
        visible={Boolean(selectedDateKey)}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={closeDayModal}
      >
        <View style={styles.dayModalOverlay}>
          <Pressable style={styles.dayModalBackdrop} onPress={closeDayModal} />
          <View style={[styles.dayModalCard, isDark ? styles.dayModalCardDark : null]}>
            <View style={styles.dayModalHeader}>
              <View style={styles.dayModalHeaderLeft}>
                <Text style={[styles.dayModalTitle, isDark ? styles.textDark : null]}>{selectedDateLabel || selectedDateKey}</Text>
                <View style={[styles.dayModalCountPill, isDark ? styles.dayModalCountPillDark : null]}>
                  <Text style={styles.dayModalCountText}>{dayModalCount}개</Text>
                </View>
              </View>
              <View style={styles.dayModalHeaderRight}>
                {dayReorderMode ? (
                  <Pressable
                    onPress={closeDayReorderModeWithSave}
                    style={[styles.dayModalAddBtn, isDark ? styles.dayModalAddBtnDark : null]}
                    disabled={dayReorderSaving}
                  >
                    <Text style={styles.dayModalAddText}>{dayReorderSaving ? "저장중" : "완료"}</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={() => {
                        if (!selectedDateKey) return
                        onAddPlan?.(selectedDateKey)
                      }}
                      style={[styles.dayModalAddBtn, isDark ? styles.dayModalAddBtnDark : null]}
                    >
                      <Text style={styles.dayModalAddText}>+ 추가</Text>
                    </Pressable>
                    <Pressable onPress={closeDayModal} style={[styles.dayModalCloseBtn, isDark ? styles.dayModalCloseBtnDark : null]}>
                      <Text style={[styles.dayModalCloseX, isDark ? styles.textDark : null]}>닫기</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.dayModalList} scrollEnabled={!dayDraggingId}>
              {dayReorderMode ? (
                <View style={styles.reorderNoTimeList} {...dayPanResponder.panHandlers}>
                  {dayReorderItems.length === 0 ? (
                    <View style={styles.dayModalEmpty}>
                      <Text style={[styles.dayModalEmptyTitle, isDark ? styles.textDark : null]}>할 일이 없어요</Text>
                      <Text style={[styles.dayModalEmptySub, isDark ? styles.textMutedDark : null]}>이 날짜에 등록된 일정이 없습니다.</Text>
                    </View>
                  ) : (
                    dayReorderItems.map((item) => {
                      const rowId = String(item?.id ?? "").trim()
                      const rowKey = rowId || `${item?.date}-${item?.content}`
                      const isPlaceholder = rowId && rowId === dayDraggingId
                      return renderDayModalRow(item, {
                        rowKey,
                        draggable: true,
                        placeholder: isPlaceholder,
                        onLayout: (event) => {
                          if (!rowId) return
                          const layout = event?.nativeEvent?.layout
                          if (!layout) return
                          dayLayoutsRef.current[rowId] = { y: layout.y, height: layout.height }
                        },
                        onLongPress: () => startDayDrag(item),
                        onDelete: () => quickDeleteFromDayReorder(item)
                      })
                    })
                  )}
                  {dayDraggingItem ? (
                    <Animated.View pointerEvents="none" style={[styles.reorderDragOverlay, { transform: [{ translateY: dayDragY }] }]}>
                      {renderDayModalRow(dayDraggingItem, { ghost: true })}
                    </Animated.View>
                  ) : null}
                </View>
              ) : dayItems.length === 0 ? (
                <View style={styles.dayModalEmpty}>
                  <Text style={[styles.dayModalEmptyTitle, isDark ? styles.textDark : null]}>할 일이 없어요</Text>
                  <Text style={[styles.dayModalEmptySub, isDark ? styles.textMutedDark : null]}>이 날짜에 등록된 일정이 없습니다.</Text>
                </View>
              ) : (
                dayItems.map((item) => {
                  const itemId = String(item?.id ?? "").trim()
                  const canReorder = Boolean(onReorderNoTime && itemId)
                  const handlePress = () => {
                    if (daySuppressPressRef.current) {
                      daySuppressPressRef.current = false
                      return
                    }
                    onEditPlan?.(item)
                  }
                  const handleLongPress = () => {
                    if (!canReorder) return
                    daySuppressPressRef.current = true
                    openDayReorder(dayItems, itemId)
                  }
                  return renderDayModalRow(item, {
                    rowKey: item.id ?? `${item.date}-${item.content}`,
                    onPress: handlePress,
                    onLongPress: canReorder ? handleLongPress : undefined
                  })
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function AppInner() {
  const insets = useSafeAreaInsets()
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [themeMode, setThemeMode] = useState("light") // "light" | "dark"
  const [fontScale, setFontScale] = useState(1)

  const safeBottomInset = useMemo(
    () => (Platform.OS === "android" ? 7 : Math.max(insets.bottom, 10)),
    [insets.bottom]
  )
  const androidNavLift = useMemo(() => {
    if (Platform.OS !== "android") return 0
    const inset = Number(insets.bottom) || 0
    // Lift tab row above Android 3-button/gesture navigation area.
    return Math.min(48, Math.max(36, inset + 8))
  }, [insets.bottom])
  const androidNavStripStyle = useMemo(() => {
    if (Platform.OS !== "android") return null
    return [
      styles.androidNavStrip,
      themeMode === "dark" ? styles.androidNavStripDark : styles.androidNavStripLight,
      { height: androidNavLift }
    ]
  }, [androidNavLift, themeMode])

  const tabBarStyle = useMemo(() => {
    const isDark = themeMode === "dark"
    return [
      styles.tabBar,
      isDark ? styles.tabBarDark : null,
      {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: androidNavLift,
        height: 52 + safeBottomInset,
        paddingBottom: safeBottomInset
      }
    ]
  }, [androidNavLift, safeBottomInset, themeMode])

  const sceneBottomInset = useMemo(
    () => 52 + safeBottomInset + androidNavLift,
    [androidNavLift, safeBottomInset]
  )

  const fabBottom = useMemo(() => 58 + safeBottomInset + androidNavLift + 18, [androidNavLift, safeBottomInset])

  const [session, setSession] = useState(null)
  const [clientId, setClientId] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState("")
  const [authMessageTone, setAuthMessageTone] = useState("error")
  const [authMode, setAuthMode] = useState("signin")
  const [rememberCreds, setRememberCreds] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const authDraftTimerRef = useRef(null)
  const [plans, setPlans] = useState([])
  const [alarmDisabledByPlanId, setAlarmDisabledByPlanId] = useState({})
  const [alarmLeadByPlanId, setAlarmLeadByPlanId] = useState({})
  const [windows, setWindows] = useState(DEFAULT_WINDOWS)
  const [activeTabId, setActiveTabId] = useState("all")
  const [rightMemos, setRightMemos] = useState({})
  const [loading, setLoading] = useState(false)
  const [holidaysByDate, setHolidaysByDate] = useState(() => new Map())
  const holidayYearCacheRef = useRef(new Map())
  const holidayInflightRef = useRef(new Map())
  const [planEditorVisible, setPlanEditorVisible] = useState(false)
  const [planDraft, setPlanDraft] = useState(null)
  const [activeScreen, setActiveScreen] = useState("List")
  const lastCalendarDateKeyRef = useRef(null)
  const repeatColumnsSupportedRef = useRef(true)
  const repeatFallbackNoticeRef = useRef(false)
  const endTimeColumnSupportedRef = useRef(true)
  const endTimeFallbackNoticeRef = useRef(false)
  const sortOrderSupportedRef = useRef(true)
  const sortOrderFallbackNoticeRef = useRef(false)
  const notificationPermissionCheckedRef = useRef(false)
  const notificationPermissionGrantedRef = useRef(false)
  const notificationSyncSeqRef = useRef(0)

  const memoYear = new Date().getFullYear()

  async function fetchHolidayYear(year) {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`)
    if (!res.ok) throw new Error(`Holiday fetch failed (${res.status})`)
    const data = await res.json()
    const map = new Map()
    for (const row of data ?? []) {
      const date = String(row?.date ?? "")
      if (!date) continue
      const localName = String(row?.localName ?? "").trim()
      const name = String(row?.name ?? "").trim()
      map.set(date, localName || name || "Holiday")
    }
    return map
  }

  const ensureHolidayYear = useMemo(() => {
    return async (year) => {
      const y = Number(year)
      if (!Number.isFinite(y)) return
      if (holidayYearCacheRef.current.has(y)) return
      if (holidayInflightRef.current.has(y)) return holidayInflightRef.current.get(y)

      const promise = (async () => {
        try {
          const map = await fetchHolidayYear(y)
          holidayYearCacheRef.current.set(y, map)
          setHolidaysByDate((prev) => {
            const next = new Map(prev)
            for (const [key, value] of map.entries()) next.set(key, value)
            return next
          })
        } catch (_err) {
          // ignore
        } finally {
          holidayInflightRef.current.delete(y)
        }
      })()

      holidayInflightRef.current.set(y, promise)
      return promise
    }
  }, [])

  function alarmPrefsStorageKey(userId) {
    return `${PLAN_ALARM_PREFS_KEY}.${userId}`
  }

  function alarmLeadPrefsStorageKey(userId) {
    return `${PLAN_ALARM_LEAD_PREFS_KEY}.${userId}`
  }

  async function persistAlarmPrefs(userId, map) {
    if (!userId) return
    const safe = {}
    for (const [id, disabled] of Object.entries(map ?? {})) {
      const key = String(id ?? "").trim()
      if (!key) continue
      if (disabled) safe[key] = true
    }
    try {
      await AsyncStorage.setItem(alarmPrefsStorageKey(userId), JSON.stringify(safe))
    } catch (_e) {
      // ignore
    }
  }

  async function persistAlarmLeadPrefs(userId, map) {
    if (!userId) return
    const safe = {}
    for (const [id, lead] of Object.entries(map ?? {})) {
      const key = String(id ?? "").trim()
      if (!key) continue
      const normalized = normalizeAlarmLeadMinutes(lead)
      if (normalized > 0) safe[key] = normalized
    }
    try {
      await AsyncStorage.setItem(alarmLeadPrefsStorageKey(userId), JSON.stringify(safe))
    } catch (_e) {
      // ignore
    }
  }

  async function setAlarmEnabledForIds(userId, ids, enabled) {
    const normalized = [...new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (!userId || normalized.length === 0) return
    let snapshot = null
    setAlarmDisabledByPlanId((prev) => {
      const next = { ...(prev ?? {}) }
      for (const id of normalized) {
        if (enabled) delete next[id]
        else next[id] = true
      }
      snapshot = next
      return next
    })
    if (snapshot) await persistAlarmPrefs(userId, snapshot)
  }

  async function setAlarmLeadMinutesForIds(userId, ids, leadMinutes) {
    const normalized = [...new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (!userId || normalized.length === 0) return
    const safeLead = normalizeAlarmLeadMinutes(leadMinutes)
    let snapshot = null
    setAlarmLeadByPlanId((prev) => {
      const next = { ...(prev ?? {}) }
      for (const id of normalized) {
        if (safeLead <= 0) delete next[id]
        else next[id] = safeLead
      }
      snapshot = next
      return next
    })
    if (snapshot) await persistAlarmLeadPrefs(userId, snapshot)
  }

  function isNotificationPermissionGranted(status) {
    if (status?.granted) return true
    const provisional = Notifications?.IosAuthorizationStatus?.PROVISIONAL
    if (provisional != null && status?.ios?.status === provisional) return true
    return false
  }

  async function ensureNotificationPermission() {
    if (Platform.OS === "web") return false
    let status = await Notifications.getPermissionsAsync()
    let granted = isNotificationPermissionGranted(status)
    if (!granted && !notificationPermissionCheckedRef.current) {
      status = await Notifications.requestPermissionsAsync()
      granted = isNotificationPermissionGranted(status)
    }
    notificationPermissionCheckedRef.current = true
    notificationPermissionGrantedRef.current = granted
    return granted
  }

  async function syncPlanNotifications(userId, planRows, syncId = 0) {
    if (syncId && syncId !== notificationSyncSeqRef.current) return
    if (Platform.OS === "web") return
    if (!userId) {
      notificationPermissionCheckedRef.current = false
      notificationPermissionGrantedRef.current = false
      await Notifications.cancelAllScheduledNotificationsAsync()
      return
    }

    const allowed = await ensureNotificationPermission()
    if (!allowed) return

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(PLAN_NOTIFICATION_CHANNEL_ID, {
        name: "일정 알림",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        sound: "default"
      })
    }

    const now = Date.now()
    const lookahead = now + PLAN_NOTIFICATION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
    const candidates = (planRows ?? [])
      .map((row) => {
        const when = planDateTimeFromRow(row)
        return { row, when }
      })
      .filter(({ row, when }) => {
        if (!row || !when) return false
        const rowId = String(row?.id ?? "").trim()
        const alarmDisabled = rowId ? Boolean(alarmDisabledByPlanId?.[rowId]) : false
        const alarmEnabled = alarmDisabled ? false : row?.alarm_enabled == null ? true : Boolean(row?.alarm_enabled)
        if (!alarmEnabled) return false
        const leadMinutes = rowId ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[rowId] ?? 0) : 0
        const timeMs = when.getTime() - leadMinutes * 60 * 1000
        return Number.isFinite(timeMs) && timeMs > now + 3000 && timeMs <= lookahead
      })
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .slice(0, PLAN_NOTIFICATION_MAX_COUNT)

    if (syncId && syncId !== notificationSyncSeqRef.current) return
    await Notifications.cancelAllScheduledNotificationsAsync()

    for (const { row, when } of candidates) {
      if (syncId && syncId !== notificationSyncSeqRef.current) return
      const rowId = String(row?.id ?? "").trim()
      const leadMinutes = rowId ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[rowId] ?? 0) : 0
      const triggerAt = new Date(when.getTime() - leadMinutes * 60 * 1000)
      if (!Number.isFinite(triggerAt.getTime())) continue
      const timeText = formatPlanTimeForDisplay(row)
      const rawCategory = String(row?.category_id ?? "").trim()
      const categoryLabel = !rawCategory || rawCategory === "__general__" ? "통합" : rawCategory
      const contentText = String(row?.content ?? "").trim() || "내용 없음"
      const body = `${timeText || "시간 없음"} · ${categoryLabel} · ${contentText}`
      try {
        const content = {
          title: "일정 알림",
          body,
          sound: "default",
          data: { planId: String(row?.id ?? ""), date: String(row?.date ?? "") },
          ...(Platform.OS === "android" ? { channelId: PLAN_NOTIFICATION_CHANNEL_ID } : {})
        }
        const androidDateTriggerType = Notifications?.SchedulableTriggerInputTypes?.DATE
        await Notifications.scheduleNotificationAsync({
          content,
          trigger:
            Platform.OS === "android" && androidDateTriggerType
              ? { type: androidDateTriggerType, date: triggerAt }
              : triggerAt
        })
      } catch (_e) {
        // ignore individual schedule errors
      }
    }
  }

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
    })
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null)
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const userId = session?.user?.id
    ;(async () => {
      if (!userId) {
        if (mounted) setAlarmDisabledByPlanId({})
        return
      }
      try {
        const raw = await AsyncStorage.getItem(alarmPrefsStorageKey(userId))
        if (!mounted) return
        if (!raw) {
          setAlarmDisabledByPlanId({})
          return
        }
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          const next = {}
          for (const [id, disabled] of Object.entries(parsed)) {
            const key = String(id ?? "").trim()
            if (!key) continue
            if (disabled) next[key] = true
          }
          setAlarmDisabledByPlanId(next)
          return
        }
        setAlarmDisabledByPlanId({})
      } catch (_e) {
        if (mounted) setAlarmDisabledByPlanId({})
      }
    })()
    return () => {
      mounted = false
    }
  }, [session?.user?.id])

  useEffect(() => {
    let mounted = true
    const userId = session?.user?.id
    ;(async () => {
      if (!userId) {
        if (mounted) setAlarmLeadByPlanId({})
        return
      }
      try {
        const raw = await AsyncStorage.getItem(alarmLeadPrefsStorageKey(userId))
        if (!mounted) return
        if (!raw) {
          setAlarmLeadByPlanId({})
          return
        }
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          const next = {}
          for (const [id, lead] of Object.entries(parsed)) {
            const key = String(id ?? "").trim()
            if (!key) continue
            const normalized = normalizeAlarmLeadMinutes(lead)
            if (normalized > 0) next[key] = normalized
          }
          setAlarmLeadByPlanId(next)
          return
        }
        setAlarmLeadByPlanId({})
      } catch (_e) {
        if (mounted) setAlarmLeadByPlanId({})
      }
    })()
    return () => {
      mounted = false
    }
  }, [session?.user?.id])

  useEffect(() => {
    const userId = session?.user?.id
    if (!supabase || !userId) return

    let disposed = false
    const timers = new Map()

    const schedule = (key, fn, delay = 350) => {
      if (disposed) return
      if (timers.has(key)) clearTimeout(timers.get(key))
      const t = setTimeout(() => {
        timers.delete(key)
        fn()
      }, delay)
      timers.set(key, t)
    }

    const channel = supabase
      .channel(`planner-mobile-sync-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans", filter: `user_id=eq.${userId}` },
        () => schedule("plans", () => loadPlans(userId))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "windows", filter: `user_id=eq.${userId}` },
        () =>
          schedule("windows", async () => {
            await loadWindows(userId)
            await loadRightMemos(userId, memoYear)
          })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "right_memos", filter: `user_id=eq.${userId}` },
        () => schedule("right_memos", () => loadRightMemos(userId, memoYear))
      )
      .subscribe()

    return () => {
      disposed = true
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      try {
        supabase.removeChannel(channel)
      } catch (_e) {
        // ignore
      }
    }
  }, [session?.user?.id])

  useEffect(() => {
    ensureHolidayYear?.(new Date().getFullYear())
  }, [ensureHolidayYear])

  useEffect(() => {
    if (Platform.OS === "web") return
    const syncId = notificationSyncSeqRef.current + 1
    notificationSyncSeqRef.current = syncId
    const userId = session?.user?.id ?? null
    const rows = plans ?? []
    ;(async () => {
      try {
        await syncPlanNotifications(userId, rows, syncId)
      } catch (_e) {
        // ignore
      }
    })()
  }, [session?.user?.id, plans, alarmDisabledByPlanId, alarmLeadByPlanId])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(CLIENT_ID_KEY)
        if (!mounted) return
        if (raw) {
          setClientId(raw)
          return
        }
        const next = genClientId()
        await AsyncStorage.setItem(CLIENT_ID_KEY, next)
        if (mounted) setClientId(next)
      } catch (_e) {
        if (mounted) setClientId(genClientId())
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function hydrate() {
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY)
        if (!mounted) return
        if (!raw) {
          setAuthReady(true)
          return
        }
        const parsed = JSON.parse(raw)
        const remember = Boolean(parsed?.remember)
        setRememberCreds(remember)
        if (remember) {
          if (typeof parsed?.email === "string") setEmail(parsed.email)
          if (typeof parsed?.password === "string") setPassword(parsed.password)
        }
      } catch (_err) {
        // ignore
      } finally {
        if (mounted) setAuthReady(true)
      }
    }
    hydrate()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const rawTheme = await AsyncStorage.getItem(UI_THEME_KEY)
        const rawFont = await AsyncStorage.getItem(UI_FONT_SCALE_KEY)
        if (!mounted) return
        if (rawTheme === "dark" || rawTheme === "light") setThemeMode(rawTheme)
        const parsed = rawFont ? Number(rawFont) : 1
        if (Number.isFinite(parsed)) setFontScale(Math.max(0.85, Math.min(1.25, parsed)))
      } catch (_e) {
        // ignore
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const tone = themeMode === "dark" ? "dark" : "light"

  const persistTheme = useCallback(async (next) => {
    try {
      await AsyncStorage.setItem(UI_THEME_KEY, next)
    } catch (_e) {
      // ignore
    }
  }, [])

  const persistFontScale = useCallback(async (next) => {
    try {
      await AsyncStorage.setItem(UI_FONT_SCALE_KEY, String(next))
    } catch (_e) {
      // ignore
    }
  }, [])

  async function persistAuthDraft(next) {
    try {
      if (!next?.remember) {
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY)
        return
      }
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
    } catch (_err) {
      // ignore
    }
  }

  useEffect(() => {
    if (!authReady) return
    if (!rememberCreds) return
    if (authDraftTimerRef.current) clearTimeout(authDraftTimerRef.current)
    authDraftTimerRef.current = setTimeout(() => {
      persistAuthDraft({ remember: true, email, password })
    }, 250)
    return () => {
      if (authDraftTimerRef.current) clearTimeout(authDraftTimerRef.current)
    }
  }, [email, password, rememberCreds, authReady])

  useEffect(() => {
    if (!supabase || !session?.user?.id) return
    loadPlans(session.user.id)
    loadWindows(session.user.id)
    loadRightMemos(session.user.id, memoYear)
  }, [session?.user?.id])

  async function loadPlans(userId, options = {}) {
    if (!supabase || !userId) return
    const silent = Boolean(options?.silent)
    if (!silent) setLoading(true)
    let data = null
    let error = null
    if (sortOrderSupportedRef.current) {
      const ordered = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("date", { ascending: true })
        .order("sort_order", { ascending: true })
      data = ordered.data
      error = ordered.error
      if (error && isSortOrderColumnError(error)) {
        markSortOrderFallbackNotice()
        const fallback = await supabase
          .from("plans")
          .select("*")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("date", { ascending: true })
          .order("time", { ascending: true })
        data = fallback.data
        error = fallback.error
      }
    } else {
      const fallback = await supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("date", { ascending: true })
        .order("time", { ascending: true })
      data = fallback.data
      error = fallback.error
    }
    if (error) {
      setAuthMessage(error.message || "Load failed.")
      setPlans([])
    } else {
      setPlans(data ?? [])
      await backfillSortOrderFromLegacy(userId, data ?? [])
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    const now = new Date()
    const todayKey = dateToKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
    if (!session?.user?.id) {
      syncAndroidWidgetPayload({
        list: {
          rows: [],
          emptyText: "로그인이 필요합니다."
        },
        calendar: {
          title: `${now.getMonth() + 1}월`,
          anchorDateKey: todayKey,
          todayKey,
          itemsByDate: {},
          emptyText: "로그인이 필요합니다."
        },
        updatedAt: new Date().toISOString()
      })
      return
    }
    const payload = buildWidgetsPayload(plans, todayKey)
    syncAndroidWidgetPayload(payload)
  }, [plans, session?.user?.id])

  async function backfillSortOrderFromLegacy(userId, rows) {
    if (!sortOrderSupportedRef.current) return
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return
    const updates = []
    for (const row of list) {
      const rowId = String(row?.id ?? "").trim()
      if (!rowId) continue
      const existing = parseSortOrderValue(row?.sort_order ?? row?.sortOrder)
      if (existing != null) continue
      const legacy = parseSortOrderValue(row?.order)
      if (legacy == null) continue
      updates.push({ id: rowId, order: legacy })
    }
    if (updates.length === 0) return
    try {
      await updatePlanSortOrders(userId, updates, Date.now())
    } catch (_e) {
      // ignore legacy backfill errors
    }
  }

  async function loadWindows(userId) {
    if (!supabase || !userId) return
    const { data, error } = await supabase
      .from("windows")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
    if (error) return
    const normalized = (data ?? [])
      .filter((row) => row && row.title)
      .map((row) => ({
        id: row.id,
        title: normalizeWindowTitle(row.title),
        color: typeof row.color === "string" ? row.color : "#3b82f6",
        fixed: Boolean(row.is_fixed)
      }))
    const next = [DEFAULT_WINDOWS[0], ...normalized]
    setWindows(next)
    if (!next.find((w) => w.id === activeTabId)) setActiveTabId("all")
  }

  async function refreshAfterWindowChange(userId) {
    await loadPlans(userId)
    await loadWindows(userId)
    await loadRightMemos(userId, memoYear)
  }

  function pickNextWindowColor(currentWindows) {
    const used = new Set(
      (currentWindows ?? [])
        .filter((w) => w && w.id !== "all")
        .map((w) => String(w?.color ?? "").toLowerCase())
        .filter(Boolean)
    )
    const available = WINDOW_COLORS.find((c) => !used.has(String(c).toLowerCase()))
    return available ?? WINDOW_COLORS[(currentWindows?.length ?? 1) % WINDOW_COLORS.length] ?? WINDOW_COLORS[0]
  }

  async function addWindow(title, color) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    const nextTitle = normalizeWindowTitle(title)
    if (!nextTitle || nextTitle === "통합") {
      Alert.alert("오류", "탭 이름을 입력해주세요.")
      return
    }
    const exists = (windows ?? []).some((w) => w?.id !== "all" && normalizeWindowTitle(w.title) === nextTitle)
    if (exists) {
      Alert.alert("오류", "같은 이름의 탭이 이미 있어요.")
      return
    }
    const sortOrder = Math.max(10, (windows ?? []).filter((w) => w?.id !== "all").length * 10 + 10)
    const normalizedColor = WINDOW_COLORS.includes(String(color ?? "").toLowerCase())
      ? String(color).toLowerCase()
      : pickNextWindowColor(windows)
    const { error } = await supabase.from("windows").insert({
      user_id: userId,
      title: nextTitle,
      color: normalizedColor,
      sort_order: sortOrder,
      is_fixed: false
    })
    if (error) {
      Alert.alert("오류", error.message || "탭 추가 실패")
      return
    }
    await refreshAfterWindowChange(userId)
  }

  async function renameWindow(windowItem, nextTitleRaw) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    if (!windowItem || windowItem.id === "all") return
    const nextTitle = normalizeWindowTitle(nextTitleRaw)
    const prevTitle = normalizeWindowTitle(windowItem.title)
    if (!nextTitle) return
    if (nextTitle === "통합") {
      Alert.alert("오류", "이 이름은 사용할 수 없어요.")
      return
    }
    if (nextTitle === prevTitle) return
    const exists = (windows ?? []).some(
      (w) => w?.id !== "all" && String(w?.id) !== String(windowItem.id) && normalizeWindowTitle(w.title) === nextTitle
    )
    if (exists) {
      Alert.alert("오류", "같은 이름의 탭이 이미 있어요.")
      return
    }
    const { error } = await supabase
      .from("windows")
      .update({ title: nextTitle })
      .eq("user_id", userId)
      .eq("id", windowItem.id)
    if (error) {
      Alert.alert("오류", error.message || "탭 수정 실패")
      return
    }
    await supabase
      .from("plans")
      .update({ category_id: nextTitle })
      .eq("user_id", userId)
      .eq("category_id", prevTitle)
    await refreshAfterWindowChange(userId)
  }

  async function changeWindowColor(windowItem, nextColor) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    if (!windowItem || windowItem.id === "all") return
    const normalizedColor = WINDOW_COLORS.includes(String(nextColor ?? "").toLowerCase())
      ? String(nextColor).toLowerCase()
      : pickNextWindowColor(windows)
    const { error } = await supabase
      .from("windows")
      .update({ color: normalizedColor })
      .eq("user_id", userId)
      .eq("id", windowItem.id)
    if (error) {
      Alert.alert("오류", error.message || "색 변경 실패")
      return
    }
    await loadWindows(userId)
  }

    async function reorderWindows(orderedWindows) {
    const userId = session?.user?.id
    const list = Array.isArray(orderedWindows) ? orderedWindows : []
    const orderedIds = list.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (orderedIds.length === 0) return
    const allMovableIds = (windows ?? [])
      .filter((w) => !w?.fixed)
      .map((w) => String(w?.id ?? "").trim())
      .filter(Boolean)
    const missingIds = allMovableIds.filter((id) => !orderedIds.includes(id))
    const nextIds = missingIds.length ? [...orderedIds, ...missingIds] : orderedIds

    setWindows((prev) => {
      const fixedTabs = (prev ?? []).filter((w) => w?.fixed)
      const movableMap = new Map((prev ?? []).filter((w) => !w?.fixed).map((w) => [String(w?.id ?? ""), w]))
      const nextMovable = nextIds.map((id) => movableMap.get(id)).filter(Boolean)
      if (movableMap.size > nextMovable.length) {
        const used = new Set(nextMovable.map((w) => String(w?.id ?? "")))
        for (const [id, item] of movableMap.entries()) {
          if (!used.has(id)) nextMovable.push(item)
        }
      }
      return [...fixedTabs, ...nextMovable]
    })

    if (!supabase || !userId) return

    try {
      const movableMap = new Map(
        (windows ?? [])
          .filter((w) => !w?.fixed)
          .map((w) => [String(w?.id ?? ""), w])
      )
      const payloads = nextIds
        .map((id, idx) => {
          const row = movableMap.get(id)
          const title = String(row?.title ?? "").trim()
          if (!title) return null
          return {
            id,
            user_id: userId,
            title,
            color: row?.color || "#3b82f6",
            is_fixed: false,
            sort_order: (idx + 1) * 10
          }
        })
        .filter(Boolean)
      if (payloads.length === 0) return
      const { error } = await supabase.from("windows").upsert(payloads, { onConflict: "id" })
      if (error) throw error
    } catch (error) {
      const message = error?.message || "Save failed."
      Alert.alert("정렬 저장 실패", message)
      await loadWindows(userId)
    }
  }

  async function deleteWindow(windowItem) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    if (!windowItem || windowItem.id === "all") return
    const title = normalizeWindowTitle(windowItem.title)
    const deletedAt = new Date().toISOString()
    await supabase
      .from("plans")
      .update({ deleted_at: deletedAt, client_id: clientId || null, updated_at: deletedAt })
      .eq("user_id", userId)
      .eq("category_id", title)
    await supabase.from("right_memos").delete().eq("user_id", userId).eq("window_id", windowItem.id)
    const { error } = await supabase.from("windows").delete().eq("user_id", userId).eq("id", windowItem.id)
    if (error) {
      Alert.alert("오류", error.message || "탭 삭제 실패")
      return
    }
    if (String(activeTabId) === String(windowItem.id)) setActiveTabId("all")
    await refreshAfterWindowChange(userId)
  }

  async function loadRightMemos(userId, year) {
    if (!supabase || !userId) return
    const { data, error } = await supabase
      .from("right_memos")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
    if (error) return
    const map = {}
    for (const row of data ?? []) {
      if (!row?.window_id) continue
      map[row.window_id] = String(row?.content ?? "")
    }
    setRightMemos(map)
  }

  async function saveRightMemo(windowId, content) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    const id = String(windowId ?? "").trim()
    if (!id || id === "all") return
    const text = String(content ?? "")
    const trimmed = text.trim()
    if (!trimmed) {
      const { error } = await supabase
        .from("right_memos")
        .delete()
        .eq("user_id", userId)
        .eq("year", memoYear)
        .eq("window_id", id)
      if (error) {
        Alert.alert("오류", error.message || "메모 삭제 실패")
        return
      }
      setRightMemos((prev) => ({ ...(prev ?? {}), [id]: "" }))
      return
    }
    const payload = {
      user_id: userId,
      year: memoYear,
      window_id: id,
      content: text
    }
    const { error } = await supabase.from("right_memos").upsert(payload, {
      onConflict: "user_id,year,window_id"
    })
    if (error) {
      Alert.alert("오류", error.message || "메모 저장 실패")
      return
    }
    setRightMemos((prev) => ({ ...(prev ?? {}), [id]: text }))
  }

  function getNextSortOrderForDate(dateKey, planRows) {
    if (!sortOrderSupportedRef.current) return null
    const key = String(dateKey ?? "").trim()
    if (!key) return null
    const list = (planRows ?? []).filter(
      (row) => row && !row?.deleted_at && String(row?.date ?? "").trim() === key
    )
    if (list.length === 0) return 0
    const values = list
      .map((row) => parseSortOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order))
      .filter((n) => n != null)
    if (values.length === 0) return null
    return Math.max(...values) + 1
  }

  function buildSinglePlanPayload(userId, next, { seriesIdOverride, dateOverride, sortOrderOverride } = {}) {
    const dateKey = String(dateOverride ?? next?.date ?? "").trim()
    const repeatMeta = normalizeRepeatMeta({ ...(next ?? {}), date: dateKey })
    const repeatType = repeatMeta.repeatType
    const normalizedTime = normalizeClockTime(next?.time)
    let normalizedEndTime = normalizeClockTime(next?.end_time ?? next?.endTime)
    if (!normalizedTime || !normalizedEndTime || normalizedEndTime === normalizedTime) normalizedEndTime = ""
    const candidateSeries =
      typeof seriesIdOverride === "string"
        ? String(seriesIdOverride).trim()
        : seriesIdOverride === null
          ? ""
          : String(repeatMeta.seriesId ?? "").trim()

    const payload = {
      user_id: userId,
      date: dateKey,
      time: normalizedTime || null,
      content: String(next?.content ?? "").trim(),
      category_id: String(next?.category_id ?? "__general__").trim() || "__general__",
      series_id: repeatType === "none" ? null : candidateSeries || null,
      repeat_type: repeatType,
      repeat_interval: repeatType === "none" ? 1 : repeatMeta.repeatInterval,
      repeat_days: repeatType === "weekly" ? normalizeRepeatDays(repeatMeta.repeatDays) : null,
      repeat_until: repeatType === "none" ? null : repeatMeta.repeatUntil,
      client_id: clientId || null,
      updated_at: new Date().toISOString()
    }
    if (endTimeColumnSupportedRef.current) payload.end_time = normalizedEndTime || null
    if (sortOrderOverride != null) payload.sort_order = sortOrderOverride
    return payload
  }

  function stripRepeatColumns(payload) {
    const { series_id, repeat_type, repeat_interval, repeat_days, repeat_until, ...rest } = payload ?? {}
    return rest
  }

  function stripEndTimeColumns(payload) {
    const rest = { ...(payload ?? {}) }
    delete rest.end_time
    delete rest.original_end_time
    delete rest.endTime
    return rest
  }

  function stripEndTimeFromRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    return list.map((row) => stripEndTimeColumns(row))
  }

  function stripSortOrderFromRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    return list.map((row) => {
      const next = { ...(row ?? {}) }
      delete next.sort_order
      return next
    })
  }

function isRepeatColumnError(error) {
  const msg = String(error?.message ?? "").toLowerCase()
  if (!msg) return false
  return (
      msg.includes("repeat_type") ||
      msg.includes("repeat_interval") ||
      msg.includes("repeat_days") ||
      msg.includes("repeat_until") ||
      msg.includes("series_id") ||
      // Some Postgres errors omit column name and only mention uuid syntax.
      msg.includes("invalid input syntax for type uuid")
  )
}

function isDuplicateConflictError(error) {
  const msg = String(error?.message ?? "").toLowerCase()
  if (!msg) return false
  return msg.includes("duplicate key value") || msg.includes("unique constraint")
}

function isSortOrderColumnError(error) {
  const msg = String(error?.message ?? "").toLowerCase()
  if (!msg) return false
  return msg.includes("sort_order") || (msg.includes("column") && msg.includes("sort") && msg.includes("order"))
}

function isEndTimeColumnError(error) {
  const msg = String(error?.message ?? "").toLowerCase()
  if (!msg) return false
  return msg.includes("end_time") || (msg.includes("column") && msg.includes("end") && msg.includes("time"))
}

  function markRepeatFallbackNotice() {
    if (!repeatColumnsSupportedRef.current) return
    repeatColumnsSupportedRef.current = false
    if (repeatFallbackNoticeRef.current) return
    repeatFallbackNoticeRef.current = true
    setAuthMessageTone("info")
    setAuthMessage("반복 일정 DB 컬럼이 없어 기본 저장 모드로 동작합니다. SQL 마이그레이션을 적용하면 반복 범위 수정이 완전히 동작해요.")
  }

  function markSortOrderFallbackNotice() {
    if (!sortOrderSupportedRef.current) return
    sortOrderSupportedRef.current = false
    if (sortOrderFallbackNoticeRef.current) return
    sortOrderFallbackNoticeRef.current = true
    setAuthMessageTone("info")
    setAuthMessage("정렬 순서 컬럼(sort_order)이 없어 시간 없는 일정의 순서가 기기 간에 완전히 동기화되지 않을 수 있습니다.")
  }

  function markEndTimeFallbackNotice() {
    if (!endTimeColumnSupportedRef.current) return
    endTimeColumnSupportedRef.current = false
    if (endTimeFallbackNoticeRef.current) return
    endTimeFallbackNoticeRef.current = true
    setAuthMessageTone("info")
    setAuthMessage("종료시간 DB 컬럼(end_time)이 없어 종료시간 없이 저장됩니다. SQL 마이그레이션을 적용하면 시간 구간이 동기화됩니다.")
  }

  function buildRecurringRows(userId, next, { seriesIdOverride, forceSortOrder = false } = {}) {
    const dateKey = String(next?.date ?? "").trim()
    const repeatMeta = normalizeRepeatMeta({ ...(next ?? {}), date: dateKey })
    if (repeatMeta.repeatType === "none") {
      const shouldAssignSortOrder = sortOrderSupportedRef.current && (forceSortOrder || !next?.id)
      const baseSortOrder = shouldAssignSortOrder ? getNextSortOrderForDate(dateKey, plans) : null
      return [
        buildSinglePlanPayload(userId, next, {
          seriesIdOverride: null,
          dateOverride: dateKey,
          sortOrderOverride: baseSortOrder
        })
      ]
    }
    const seriesId = String(seriesIdOverride ?? repeatMeta.seriesId ?? genSeriesId()).trim() || genSeriesId()
    const dateKeys = generateRecurringDateKeys({
      startDateKey: dateKey,
      repeatType: repeatMeta.repeatType,
      repeatInterval: repeatMeta.repeatInterval,
      repeatDays: repeatMeta.repeatDays ?? [],
      repeatUntilKey: repeatMeta.repeatUntil
    })
    const shouldAssignSortOrder = sortOrderSupportedRef.current && (forceSortOrder || !next?.id)
    const sortOrderSeeds = new Map()
    return dateKeys.map((key) => {
      let sortOrderOverride = null
      if (shouldAssignSortOrder) {
        if (sortOrderSeeds.has(key)) {
          sortOrderOverride = sortOrderSeeds.get(key)
          sortOrderSeeds.set(key, sortOrderOverride + 1)
        } else {
          const seed = getNextSortOrderForDate(key, plans)
          if (seed != null) {
            sortOrderOverride = seed
            sortOrderSeeds.set(key, seed + 1)
          }
        }
      }
      return buildSinglePlanPayload(userId, next, {
        seriesIdOverride: seriesId,
        dateOverride: key,
        sortOrderOverride
      })
    })
  }

  async function insertPlansInChunks(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return []
    const chunkSize = 200
    const insertedIds = []
    for (let i = 0; i < rows.length; i += chunkSize) {
      let insertChunk = rows.slice(i, i + chunkSize)
      let { data, error } = await supabase.from("plans").insert(insertChunk).select("id")
      if (error && isRepeatColumnError(error)) {
        markRepeatFallbackNotice()
        insertChunk = insertChunk.map((row) => stripRepeatColumns(row))
        const retry = await supabase.from("plans").insert(insertChunk).select("id")
        data = retry.data
        error = retry.error
      }
      if (error && isEndTimeColumnError(error)) {
        markEndTimeFallbackNotice()
        insertChunk = stripEndTimeFromRows(insertChunk)
        const retry = await supabase.from("plans").insert(insertChunk).select("id")
        data = retry.data
        error = retry.error
      }
      if (error && isSortOrderColumnError(error)) {
        markSortOrderFallbackNotice()
        insertChunk = stripSortOrderFromRows(insertChunk)
        const retry = await supabase.from("plans").insert(insertChunk).select("id")
        data = retry.data
        error = retry.error
      }
      if (error) throw error
      for (const row of data ?? []) {
        const id = String(row?.id ?? "").trim()
        if (id) insertedIds.push(id)
      }
    }
    return insertedIds
  }

  async function updatePlanRow(userId, id, payload) {
    let { error } = await supabase.from("plans").update(payload).eq("id", id).eq("user_id", userId)
    if (error && isRepeatColumnError(error)) {
      markRepeatFallbackNotice()
      const retry = await supabase.from("plans").update(stripRepeatColumns(payload)).eq("id", id).eq("user_id", userId)
      error = retry.error
    }
    if (error && isEndTimeColumnError(error)) {
      markEndTimeFallbackNotice()
      const retry = await supabase.from("plans").update(stripEndTimeColumns(payload)).eq("id", id).eq("user_id", userId)
      error = retry.error
    }
    if (error) throw error
  }

  async function updatePlanSortOrders(userId, updates, baseMs = Date.now()) {
    if (!supabase || !userId) return
    const list = Array.isArray(updates) ? updates : []
    if (list.length === 0) return
    const payloads = list.map((item, idx) => ({
      id: String(item?.id ?? "").trim(),
      user_id: userId,
      sort_order: item?.order ?? idx,
      updated_at: new Date(baseMs + idx).toISOString(),
      client_id: clientId || null
    })).filter((row) => row.id)

    if (payloads.length === 0) return
    if (sortOrderSupportedRef.current) {
      const { error } = await supabase.from("plans").upsert(payloads, { onConflict: "id" })
      if (error) {
        if (isSortOrderColumnError(error)) {
          markSortOrderFallbackNotice()
        } else {
          throw error
        }
      } else {
        return
      }
    }

    const fallbackPayloads = payloads.map(({ id, user_id, updated_at, client_id }) => ({
      id,
      user_id,
      updated_at,
      client_id
    }))
    const { error: fallbackError } = await supabase.from("plans").upsert(fallbackPayloads, { onConflict: "id" })
    if (fallbackError) throw fallbackError
  }

  function applyLegacySeriesMatch(query, target, { futureOnly = false } = {}) {
    let nextQuery = query
    const baseDate = String(target?.original_date ?? target?.date ?? "").trim()
    const baseCategory = String(target?.original_category_id ?? target?.category_id ?? "__general__").trim() || "__general__"
    const baseContent = String(target?.original_content ?? target?.content ?? "").trim()
    const baseTime = normalizeClockTime(target?.original_time ?? target?.time)
    const baseEndTime = normalizeClockTime(target?.original_end_time ?? target?.end_time ?? target?.endTime)

    nextQuery = nextQuery.eq("category_id", baseCategory).eq("content", baseContent)
    if (baseTime) nextQuery = nextQuery.eq("time", baseTime)
    else nextQuery = nextQuery.is("time", null)
    if (endTimeColumnSupportedRef.current) {
      if (baseEndTime && baseEndTime !== baseTime) nextQuery = nextQuery.eq("end_time", baseEndTime)
      else nextQuery = nextQuery.is("end_time", null)
    }
    if (futureOnly && baseDate) nextQuery = nextQuery.gte("date", baseDate)
    return nextQuery
  }

  async function fetchLegacySeriesIds(userId, target, { futureOnly = false } = {}) {
    let query = supabase.from("plans").select("id").eq("user_id", userId).is("deleted_at", null)
    query = applyLegacySeriesMatch(query, target, { futureOnly })
    let { data, error } = await query
    if (error && isEndTimeColumnError(error)) {
      markEndTimeFallbackNotice()
      let retryQuery = supabase.from("plans").select("id").eq("user_id", userId).is("deleted_at", null)
      retryQuery = applyLegacySeriesMatch(retryQuery, target, { futureOnly })
      const retry = await retryQuery
      data = retry.data
      error = retry.error
    }
    if (error) throw error
    return (data ?? []).map((row) => row?.id).filter(Boolean)
  }

  async function softDeletePlansByIds(userId, ids, deletedAt) {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (uniqueIds.length === 0) return
    const MAX_DELETE_IDS_PER_MUTATION = 120
    const boundedIds = uniqueIds.slice(0, MAX_DELETE_IDS_PER_MUTATION)
    if (uniqueIds.length > boundedIds.length) {
      console.warn("mobile delete capped", { requested: uniqueIds.length, applied: boundedIds.length })
    }
    const chunkSize = 200
    for (let i = 0; i < boundedIds.length; i += chunkSize) {
      const chunk = boundedIds.slice(i, i + chunkSize)
      const { error } = await supabase
        .from("plans")
        .update({ deleted_at: deletedAt, client_id: clientId || null, updated_at: deletedAt })
        .eq("user_id", userId)
        .in("id", chunk)
      if (error) throw error
    }
  }

  async function upsertPlan(userId, next) {
    if (!supabase || !userId) return false
    const dateKey = String(next?.date ?? "").trim()
    const contentText = String(next?.content ?? "").trim()
    if (!dateKey || !contentText) return false
    const hasTimeText = Boolean(normalizeClockTime(next?.time))
    const nextAlarmEnabled = hasTimeText ? Boolean(next?.alarm_enabled ?? true) : true
    const nextAlarmLeadMinutes = hasTimeText && nextAlarmEnabled ? normalizeAlarmLeadMinutes(next?.alarm_lead_minutes) : 0

    setLoading(true)
    try {
      let affectedPlanIds = []
      const editScope = String(next?.edit_scope ?? "single")
      const nextRepeatType = normalizeRepeatType(next?.repeat_type)
      const sourceSeriesId = repeatColumnsSupportedRef.current
        ? String(next?.original_series_id ?? next?.series_id ?? "").trim()
        : ""
      const sourceRepeatType = normalizeRepeatType(next?.original_repeat_type ?? next?.repeat_type)
      const legacySeriesIds = [...new Set((next?.legacy_series_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
      const legacyFutureIds = [...new Set((next?.legacy_future_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
      const sourceIsRecurring = Boolean(sourceSeriesId) || sourceRepeatType !== "none"
      const enableRecurringFromSingle = Boolean(next?.id) && !sourceIsRecurring && nextRepeatType !== "none"
      const shouldRegenerate = Boolean(next?.id) && (editScope === "future" || editScope === "all" || enableRecurringFromSingle)

      if (next?.id && !shouldRegenerate) {
        const nextDate = String(next?.date ?? "").trim()
        const originalDate = String(next?.original_date ?? "").trim()
        const nextTime = normalizeClockTime(next?.time)
        const originalTime = normalizeClockTime(next?.original_time)
        const dateChanged = originalDate && nextDate && nextDate !== originalDate
        const becameNoTime = Boolean(originalTime) && !nextTime
        const shouldAssignSortOrder =
          sortOrderSupportedRef.current && !nextTime && (dateChanged || becameNoTime)
        const sortOrderOverride = shouldAssignSortOrder ? getNextSortOrderForDate(nextDate, plans) : null
        const payload = buildSinglePlanPayload(userId, next, {
          seriesIdOverride: nextRepeatType === "none" ? null : sourceSeriesId || null,
          sortOrderOverride
        })
        await updatePlanRow(userId, next.id, payload)
        affectedPlanIds = [String(next.id)]
      } else if (next?.id && shouldRegenerate) {
        // Pre-calculate legacy ids so we can still delete old rows if repeat-column fallback happens mid-save.
        const useLegacyRange = Boolean(next?.has_recurrence_hint) && (editScope === "future" || editScope === "all")
        let legacyDeleteIds = []
        if (useLegacyRange) {
          if (editScope === "all" && legacySeriesIds.length > 0) {
            legacyDeleteIds = legacySeriesIds
          } else if (editScope === "future" && legacyFutureIds.length > 0) {
            legacyDeleteIds = legacyFutureIds
          } else if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
            legacyDeleteIds = await fetchLegacySeriesIds(userId, next, { futureOnly: editScope === "future" })
          } else {
            legacyDeleteIds = [next.id]
          }
        } else {
          legacyDeleteIds = [next.id]
        }

        const rows = buildRecurringRows(userId, next, {
          // Regenerate with a new series id so insert can succeed before old rows are removed.
          seriesIdOverride: nextRepeatType === "none" ? null : genSeriesId(),
          forceSortOrder: true
        })
        let deletedBeforeInsert = false
        const softDeleteOldRows = async () => {
          if (deletedBeforeInsert) return
          const deletedAt = new Date().toISOString()
          if (sourceSeriesId && repeatColumnsSupportedRef.current) {
            let query = supabase
              .from("plans")
              .update({ deleted_at: deletedAt, client_id: clientId || null, updated_at: deletedAt })
              .eq("user_id", userId)
              .eq("series_id", sourceSeriesId)
            if (editScope === "future") {
              const futureFrom = String(next?.original_date ?? dateKey).trim() || dateKey
              query = query.gte("date", futureFrom)
            }
            const { error } = await query
            if (error && isRepeatColumnError(error)) {
              markRepeatFallbackNotice()
              if (legacyDeleteIds.length === 0) {
                if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
                  legacyDeleteIds = await fetchLegacySeriesIds(userId, next, { futureOnly: editScope === "future" })
                } else {
                  legacyDeleteIds = [next.id]
                }
              }
              await softDeletePlansByIds(userId, legacyDeleteIds, deletedAt)
            } else if (error) {
              throw error
            }
          } else {
            if (legacyDeleteIds.length === 0) {
              if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
                legacyDeleteIds = await fetchLegacySeriesIds(userId, next, { futureOnly: editScope === "future" })
              } else {
                legacyDeleteIds = [next.id]
              }
            }
            await softDeletePlansByIds(userId, legacyDeleteIds, deletedAt)
          }
          deletedBeforeInsert = true
        }

        try {
          affectedPlanIds = await insertPlansInChunks(rows)
        } catch (insertError) {
          if (!isDuplicateConflictError(insertError)) throw insertError
          // If DB has a uniqueness constraint on date/time/content, delete old rows first and retry.
          await softDeleteOldRows()
          affectedPlanIds = await insertPlansInChunks(rows)
        }
        await softDeleteOldRows()
      } else {
        const rows = buildRecurringRows(userId, next, {
          seriesIdOverride: nextRepeatType === "none" ? null : genSeriesId(),
          forceSortOrder: true
        })
        affectedPlanIds = await insertPlansInChunks(rows)
      }

      await Promise.all([
        setAlarmEnabledForIds(userId, affectedPlanIds, nextAlarmEnabled),
        setAlarmLeadMinutesForIds(userId, affectedPlanIds, nextAlarmLeadMinutes)
      ])
      loadPlans(userId, { silent: true }).catch(() => {})
      return true
    } catch (error) {
      const message = error?.message || "Save failed."
      setAuthMessage(message)
      Alert.alert("저장 실패", message)
      return false
    } finally {
      setLoading(false)
    }
  }

  async function reorderNoTimePlans(dateKey, orderedItems) {
    const key = String(dateKey ?? "").trim()
    if (!key) return
    const list = Array.isArray(orderedItems) ? orderedItems : []
    const orderedIds = list
      .map((item) => String(item?.id ?? "").trim())
      .filter(Boolean)
    if (orderedIds.length === 0) return

    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]))
    const baseMs = Date.now()
    setPlans((prev) =>
      (prev ?? []).map((row) => {
        const rowDate = String(row?.date ?? "").trim()
        if (rowDate !== key) return row
        const rowId = String(row?.id ?? "").trim()
        if (!rowId || !orderMap.has(rowId)) return row
        const sortOrder = orderMap.get(rowId)
        return {
          ...row,
          sort_order: sortOrder,
          updated_at: new Date(baseMs + sortOrder).toISOString()
        }
      })
    )

    const userId = session?.user?.id
    if (!supabase || !userId) return
    try {
      const updates = orderedIds.map((id, idx) => ({ id, order: idx }))
      await updatePlanSortOrders(userId, updates, baseMs)
    } catch (error) {
      const message = error?.message || "Save failed."
      Alert.alert("정렬 저장 실패", message)
      await loadPlans(userId)
    }
  }

  async function softDeletePlan(userId, target) {
    const nextTarget = typeof target === "string" ? { id: target, delete_scope: "single" } : target
    if (!supabase || !userId || !nextTarget?.id) return false

    setLoading(true)
    try {
      const deletedAt = new Date().toISOString()
      const scope = String(nextTarget?.delete_scope ?? "single")
      const seriesId = repeatColumnsSupportedRef.current ? String(nextTarget?.series_id ?? "").trim() : ""
      const dateKey = String(nextTarget?.date ?? "").trim()
      const legacySeriesIds = [...new Set((nextTarget?.legacy_series_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
      const legacyFutureIds = [...new Set((nextTarget?.legacy_future_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]

      let query = supabase
        .from("plans")
        .update({ deleted_at: deletedAt, client_id: clientId || null, updated_at: deletedAt })
        .eq("user_id", userId)

      if (scope === "all" && seriesId) {
        query = query.eq("series_id", seriesId)
      } else if (scope === "future" && seriesId) {
        query = query.eq("series_id", seriesId)
        if (dateKey) query = query.gte("date", dateKey)
      } else if (scope === "all" && legacySeriesIds.length > 0) {
        query = query.in("id", legacySeriesIds)
      } else if (scope === "future" && legacyFutureIds.length > 0) {
        query = query.in("id", legacyFutureIds)
      } else if (scope === "future" && Boolean(nextTarget?.has_recurrence_hint)) {
        if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
          query = applyLegacySeriesMatch(query, nextTarget, { futureOnly: true })
        } else {
          query = query.eq("id", nextTarget.id)
        }
      } else {
        query = query.eq("id", nextTarget.id)
      }

      const { error } = await query
      if (error && isRepeatColumnError(error)) {
        markRepeatFallbackNotice()
        const retry = await supabase
          .from("plans")
          .update({ deleted_at: deletedAt, client_id: clientId || null, updated_at: deletedAt })
          .eq("user_id", userId)
          .eq("id", nextTarget.id)
        if (retry.error) throw retry.error
      } else if (error) {
        throw error
      }

      loadPlans(userId, { silent: true }).catch(() => {})
      return true
    } catch (error) {
      setAuthMessage(error?.message || "Delete failed.")
      return false
    } finally {
      setLoading(false)
    }
  }

  async function handleSignIn() {
    if (!supabase) return
    setAuthMessage("")
    setAuthMessageTone("error")
    setAuthLoading(true)
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result?.error) {
      setAuthMessage(result.error.message)
    } else {
      await persistAuthDraft({ remember: rememberCreds, email, password: rememberCreds ? password : "" })
    }
    setAuthLoading(false)
  }

  async function handleSignUp() {
    if (!supabase) return
    setAuthMessage("")
    setAuthMessageTone("error")
    setAuthLoading(true)
    const result = await supabase.auth.signUp({ email, password })
    if (result?.error) {
      setAuthMessage(result.error.message)
    } else {
      await persistAuthDraft({ remember: rememberCreds, email, password: rememberCreds ? password : "" })
      setAuthMessageTone("info")
      setAuthMessage("가입이 완료됐어요. 이메일 인증이 필요할 수 있어요.")
      setAuthMode("signin")
    }
    setAuthLoading(false)
  }

  async function handleSignOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const activeTitle = useMemo(() => {
    if (activeTabId === "all") return null
    return windows.find((w) => w.id === activeTabId)?.title ?? null
  }, [windows, activeTabId])

  function openNewPlan(dateKey) {
    const defaultCategory = activeTitle ? String(activeTitle) : "__general__"
    setPlanDraft({
      date: String(dateKey ?? ""),
      time: "",
      end_time: null,
      alarm_enabled: true,
      alarm_lead_minutes: 0,
      content: "",
      category_id: defaultCategory,
      repeat_type: "none",
      repeat_interval: 1,
      repeat_days: null,
      repeat_until: null,
      series_id: null,
      has_recurrence_hint: false
    })
    setPlanEditorVisible(true)
  }

  function openEditPlan(item) {
    if (!item) return
    const repeatMeta = normalizeRepeatMeta(item ?? {})
    const inferredRepeatMeta = repeatMeta.repeatType === "none" ? inferLegacyRepeatMetaForItem(plans, item) : null
    const effectiveRepeatType = repeatMeta.repeatType !== "none" ? repeatMeta.repeatType : inferredRepeatMeta?.repeatType ?? "none"
    const effectiveRepeatInterval =
      repeatMeta.repeatType !== "none" ? repeatMeta.repeatInterval : inferredRepeatMeta?.repeatInterval ?? 1
    const effectiveRepeatDays = repeatMeta.repeatType !== "none" ? repeatMeta.repeatDays : inferredRepeatMeta?.repeatDays ?? null
    const effectiveRepeatUntil =
      repeatMeta.repeatType !== "none" ? repeatMeta.repeatUntil : inferredRepeatMeta?.repeatUntil ?? null
    const baseDate = String(item.date ?? "")
    const baseCategory = String(item.category_id ?? "__general__").trim() || "__general__"
    const baseContent = String(item.content ?? "").trim()
    const baseTimeRange = normalizePlanTimeRange(item)
    const baseTime = baseTimeRange.time
    const baseEndTime = baseTimeRange.endTime
    const itemId = String(item?.id ?? "").trim()
    const alarmDisabled = itemId ? Boolean(alarmDisabledByPlanId?.[itemId]) : false
    const alarmEnabledByRow = item?.alarm_enabled == null ? true : Boolean(item?.alarm_enabled)
    const effectiveAlarmEnabled = Boolean(baseTime) ? alarmEnabledByRow && !alarmDisabled : false
    const effectiveAlarmLeadMinutes = itemId ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[itemId] ?? 0) : 0
    const legacyMatches = (plans ?? [])
      .filter((row) => {
        if (!row) return false
        const rowDate = String(row?.date ?? "")
        if (!parseDateKey(rowDate)) return false
        const rowCategory = String(row?.category_id ?? "__general__").trim() || "__general__"
        const rowContent = String(row?.content ?? "").trim()
        const rowTimeRange = normalizePlanTimeRange(row)
        const rowTime = rowTimeRange.time
        const rowEndTime = rowTimeRange.endTime
        if (rowCategory !== baseCategory) return false
        if (rowContent !== baseContent) return false
        if (rowTime !== baseTime) return false
        if (rowEndTime !== baseEndTime) return false
        return true
      })
      .sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")))
    const legacySeriesIds = [...new Set(legacyMatches.map((row) => row?.id).filter(Boolean).map((id) => String(id)))]
    const legacyFutureIds = legacyMatches
      .filter((row) => String(row?.date ?? "") >= baseDate)
      .map((row) => row?.id)
      .filter(Boolean)
      .map((id) => String(id))
    const hasSeries = Boolean(String(repeatMeta.seriesId ?? "").trim()) || repeatMeta.repeatType !== "none"
    const legacySiblingCount = Math.max(0, legacySeriesIds.length - 1)
    const hasRecurrenceHint = hasSeries || legacySiblingCount > 0 || Boolean(inferredRepeatMeta?.hasHint)
    setPlanDraft({
      id: item.id,
      date: baseDate,
      original_date: baseDate,
      time: baseTime,
      end_time: baseEndTime || null,
      alarm_enabled: effectiveAlarmEnabled,
      alarm_lead_minutes: effectiveAlarmLeadMinutes,
      original_time: baseTime,
      original_end_time: baseEndTime || null,
      content: baseContent,
      original_content: baseContent,
      category_id: baseCategory,
      original_category_id: baseCategory,
      repeat_type: effectiveRepeatType,
      repeat_interval: effectiveRepeatInterval,
      repeat_days: effectiveRepeatDays,
      repeat_until: effectiveRepeatUntil,
      series_id: repeatMeta.seriesId,
      original_repeat_type: effectiveRepeatType,
      original_series_id: repeatMeta.seriesId,
      has_recurrence_hint: hasRecurrenceHint,
      legacy_series_ids: legacySeriesIds,
      legacy_future_ids: legacyFutureIds
    })
    setPlanEditorVisible(true)
  }

  const filteredPlans = useMemo(() => {
    if (!activeTitle) return plans
    return (plans ?? []).filter((row) => String(row?.category_id ?? "").trim() === activeTitle)
  }, [plans, activeTitle])

  const sections = useMemo(() => {
    const map = new Map()
    for (const row of filteredPlans ?? []) {
      const key = String(row?.date ?? "no-date")
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    const keys = [...map.keys()].sort()
    return keys.map((key) => ({
      title: key,
      data: sortItemsByTimeAndOrder(map.get(key) ?? [])
    }))
  }, [filteredPlans])

  const itemsByDate = useMemo(() => {
    const map = new Map()
    for (const row of filteredPlans ?? []) {
      const key = String(row?.date ?? "no-date")
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    for (const [key, items] of map.entries()) {
      map.set(key, sortItemsByTimeAndOrder(items))
    }
    return map
  }, [filteredPlans])

  const allItemsByDate = useMemo(() => {
    const map = new Map()
    for (const row of plans ?? []) {
      const key = String(row?.date ?? "no-date")
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    for (const [key, items] of map.entries()) {
      map.set(key, sortItemsByTimeAndOrder(items))
    }
    return map
  }, [plans])

  const memoText = useMemo(() => {
    if (activeTabId !== "all") return rightMemos[activeTabId] ?? ""
    return buildCombinedMemoText(windows, rightMemos)
  }, [rightMemos, activeTabId, windows])

  if (!supabase) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Planner Mobile</Text>
        <Text style={styles.errorText}>Supabase config missing.</Text>
        <Text style={styles.helpText}>Set supabaseUrl and supabaseAnonKey in app.json.</Text>
      </SafeAreaView>
    )
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, styles.authScreen]}>
        <KeyboardAvoidingView
          style={styles.authFlex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.authScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.authHero}>
              <LogoMark tone="light" size={56} />
              <Text style={styles.authHeadline}>Planner Mobile</Text>
              <Text style={styles.authTagline}>로그인해서 내 일정을 동기화하세요.</Text>
            </View>

            <View style={styles.authCard}>
              <View style={styles.authModeRow}>
                <Pressable
                  onPress={() => setAuthMode("signin")}
                  style={[styles.authModePill, authMode === "signin" ? styles.authModePillActive : null]}
                >
                  <Text style={[styles.authModeText, authMode === "signin" ? styles.authModeTextActive : null]}>
                    로그인
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setAuthMode("signup")}
                  style={[styles.authModePill, authMode === "signup" ? styles.authModePillActive : null]}
                >
                  <Text style={[styles.authModeText, authMode === "signup" ? styles.authModeTextActive : null]}>
                    가입
                  </Text>
                </Pressable>
              </View>

              <View style={styles.authField}>
                <Text style={styles.authLabel}>이메일</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="example@email.com"
                  placeholderTextColor="#9aa3b2"
                  style={[styles.input, styles.authInput]}
                />
              </View>

              <View style={styles.authField}>
                <Text style={styles.authLabel}>비밀번호</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="••••••••"
                  placeholderTextColor="#9aa3b2"
                  style={[styles.input, styles.authInput]}
                />
              </View>

              <Pressable
                style={styles.rememberRow}
                onPress={() => {
                  const next = !rememberCreds
                  setRememberCreds(next)
                  if (next) persistAuthDraft({ remember: true, email, password })
                  else persistAuthDraft({ remember: false })
                }}
                disabled={!authReady}
              >
                <View style={[styles.checkbox, rememberCreds ? styles.checkboxChecked : null]}>
                  {rememberCreds ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.rememberText}>아이디/비번 저장</Text>
              </Pressable>

              <TouchableOpacity
                style={[styles.primaryButton, styles.authPrimaryButton]}
                onPress={authMode === "signup" ? handleSignUp : handleSignIn}
                disabled={authLoading || !email || !password}
              >
                <Text style={styles.primaryButtonText}>
                  {authLoading ? "처리 중..." : authMode === "signup" ? "가입하기" : "로그인"}
                </Text>
              </TouchableOpacity>

              <View style={styles.authAltRow}>
                <Text style={styles.authAltText}>
                  {authMode === "signup" ? "이미 계정이 있어요." : "계정이 없나요?"}
                </Text>
                <Pressable
                  onPress={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                  style={styles.authAltBtn}
                >
                  <Text style={styles.authAltBtnText}>{authMode === "signup" ? "로그인" : "가입하기"}</Text>
                </Pressable>
              </View>

              {authMessage ? (
                <Text style={[styles.authMessage, authMessageTone === "info" ? styles.authMessageInfo : null]}>
                  {authMessage}
                </Text>
              ) : null}
            </View>

            <Text style={styles.authFooterNote}>비밀번호 저장은 기기 분실 시 위험할 수 있어요.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <NavigationContainer>
      <SettingsSheet
        visible={settingsVisible}
        themeMode={themeMode}
        fontScale={fontScale}
        onChangeTheme={(next) => {
          const mode = next === "dark" ? "dark" : "light"
          setThemeMode(mode)
          persistTheme(mode)
        }}
        onChangeFontScale={(next) => {
          const n = Number(next)
          if (!Number.isFinite(n)) return
          const clamped = Math.max(0.85, Math.min(1.25, n))
          setFontScale(clamped)
          persistFontScale(clamped)
        }}
        onRefresh={() => {
          loadPlans(session?.user?.id)
          loadWindows(session?.user?.id)
          loadRightMemos(session?.user?.id, memoYear)
        }}
        onLogout={() => {
          setSettingsVisible(false)
          handleSignOut()
        }}
        onClose={() => setSettingsVisible(false)}
      />
      <PlanEditorModal
        visible={planEditorVisible}
        draft={planDraft}
        windows={windows}
        tone={tone}
        onClose={() => setPlanEditorVisible(false)}
        onSave={async (next) => {
          const ok = await upsertPlan(session?.user?.id, next)
          if (ok) setPlanEditorVisible(false)
        }}
        onDelete={async (target) => {
          const ok = await softDeletePlan(session?.user?.id, target)
          if (ok) setPlanEditorVisible(false)
        }}
      />
      {activeScreen !== "Memo" ? (
        <Pressable
          onPress={() => {
            const today = new Date()
            const todayKey = dateToKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
            const key = activeScreen === "Calendar" ? lastCalendarDateKeyRef.current || todayKey : todayKey
            openNewPlan(key)
          }}
          style={[styles.fab, { bottom: fabBottom }]}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      ) : null}
      <Tab.Navigator
        screenListeners={{
          state: (e) => {
            const route = e?.data?.state?.routes?.[e.data.state.index]
            if (route?.name) setActiveScreen(route.name)
          }
        }}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle,
          sceneStyle: { paddingBottom: sceneBottomInset },
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
          tabBarActiveTintColor: ACCENT_BLUE,
          tabBarInactiveTintColor: tone === "dark" ? DARK_MUTED : "#94a3b8",
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ focused }) => {
            const glyph = route.name === "List" ? "≡" : route.name === "Memo" ? "✎" : "▦"
            return (
              <Text
                style={[
                  styles.tabIcon,
                  !focused && tone === "dark" ? styles.tabIconDark : null,
                  focused ? styles.tabIconActive : null
                ]}
              >
                {glyph}
              </Text>
            )
          }
        })}
      >
        <Tab.Screen name="List">
          {() => (
            <ListScreen
              sections={sections}
              allItemsByDate={allItemsByDate}
              loading={loading}
              windows={windows}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddWindow={addWindow}
              onRenameWindow={renameWindow}
              onDeleteWindow={deleteWindow}
              onChangeWindowColor={changeWindowColor}
              onReorderWindows={reorderWindows}
              holidaysByDate={holidaysByDate}
              ensureHolidayYear={ensureHolidayYear}
              onAddPlan={openNewPlan}
              onEditPlan={openEditPlan}
              onReorderNoTime={reorderNoTimePlans}
              onQuickDeletePlan={async (item) => {
                await softDeletePlan(session?.user?.id, { ...(item ?? {}), delete_scope: "single" })
              }}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
              fontScale={fontScale}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Memo">
          {() => (
            <MemoScreen
              memoText={memoText}
              loading={loading}
              windows={windows}
              rightMemos={rightMemos}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddWindow={addWindow}
              onRenameWindow={renameWindow}
              onDeleteWindow={deleteWindow}
              onChangeWindowColor={changeWindowColor}
              onReorderWindows={reorderWindows}
              onSaveMemo={saveRightMemo}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
              fontScale={fontScale}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Calendar">
          {() => (
            <CalendarScreen
              key={`calendar-${tone}`}
              itemsByDate={itemsByDate}
              loading={loading}
              windows={windows}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddWindow={addWindow}
              onRenameWindow={renameWindow}
              onDeleteWindow={deleteWindow}
              onChangeWindowColor={changeWindowColor}
              onReorderWindows={reorderWindows}
              holidaysByDate={holidaysByDate}
              ensureHolidayYear={ensureHolidayYear}
              onAddPlan={openNewPlan}
              onEditPlan={openEditPlan}
              onReorderNoTime={reorderNoTimePlans}
              onQuickDeletePlan={async (item) => {
                await softDeletePlan(session?.user?.id, { ...(item ?? {}), delete_scope: "single" })
              }}
              onSelectDateKey={(key) => {
                lastCalendarDateKeyRef.current = key
              }}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
            />
          )}
        </Tab.Screen>
      </Tab.Navigator>
      {Platform.OS === "android" ? <View pointerEvents="none" style={androidNavStripStyle} /> : null}
    </NavigationContainer>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
    paddingTop: 9,
    paddingHorizontal: 9,
    paddingBottom: 0
  },
  containerDark: {
    backgroundColor: DARK_BG
  },
  tabBar: {
    paddingTop: 1,
    borderTopWidth: 1,
    borderTopColor: "transparent",
    backgroundColor: "#f8fafc",
    shadowColor: "#0f172a",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 10
  },
  tabBarDark: {
    backgroundColor: DARK_SURFACE,
    shadowOpacity: 0
  },
  androidNavStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0
  },
  androidNavStripLight: {
    backgroundColor: "#e2e8f0"
  },
  androidNavStripDark: {
    backgroundColor: "#0f172a"
  },
  textDark: {
    color: DARK_TEXT
  },
  textMutedDark: {
    color: DARK_MUTED
  },
  tabItem: {
    paddingTop: 1,
    paddingBottom: 5
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: -4
  },
  tabIcon: {
    fontSize: 18,
    fontWeight: "800",
    color: "#94a3b8",
    transform: [{ translateY: -1 }]
  },
  tabIconDark: {
    color: DARK_MUTED
  },
  tabIconActive: {
    color: ACCENT_BLUE
  },
  authScreen: {
    paddingTop: 0,
    paddingBottom: 0
  },
  authFlex: {
    flex: 1
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 72
  },
  authHero: {
    alignItems: "center",
    marginBottom: 14
  },
  authLogo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  },
  authLogoText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 22
  },
  authHeadline: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a"
  },
  authTagline: {
    marginTop: 6,
    fontSize: 13,
    color: "#64748b"
  },
  authCard: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  authModeRow: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    marginBottom: 14
  },
  authModePill: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  authModePillActive: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe3f0"
  },
  authModeText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#64748b"
  },
  authModeTextActive: {
    color: "#0f172a"
  },
  authField: {
    marginBottom: 12
  },
  authLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 6
  },
  authInput: {
    marginBottom: 0
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    marginBottom: 12
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center"
  },
  checkboxChecked: {
    backgroundColor: ACCENT_BLUE,
    borderColor: ACCENT_BLUE
  },
  checkboxTick: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    marginTop: -1
  },
  rememberText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "700"
  },
  authPrimaryButton: {
    marginTop: 2
  },
  authAltRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  authAltText: {
    fontSize: 12,
    color: "#64748b"
  },
  authAltBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  authAltBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  authMessage: {
    marginTop: 12,
    fontSize: 12,
    color: ACCENT_RED,
    fontWeight: "700",
    textAlign: "center"
  },
  authMessageInfo: {
    color: ACCENT_BLUE
  },
  authFooterNote: {
    marginTop: 14,
    textAlign: "center",
    fontSize: 11,
    color: "#94a3b8"
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 6
  },
  headerDark: {
    backgroundColor: DARK_BG,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "transparent"
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  headerTitleWrapNoLogo: {
    paddingLeft: 15
  },
  headerTitleTranslateDown: {
    transform: [{ translateY: 2 }]
  },
  headerLogo: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: ACCENT_BLUE,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  headerLogoDark: {
    backgroundColor: "#1d4ed8",
    borderColor: "rgba(255, 255, 255, 0.18)"
  },
  headerLogoHighlight: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.18)"
  },
  headerLogoText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 16,
    includeFontPadding: false,
    textAlign: "center"
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: 10
  },
  headerTodayButton: {
    width: 38,
    height: 38,
    paddingHorizontal: 0,
    borderRadius: 14,
    backgroundColor: "rgba(43, 103, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.18)",
    position: "relative",
    alignItems: "center",
    justifyContent: "center"
  },
  headerTodayText: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 14,
    color: ACCENT_BLUE
  },
  headerTodayTextDark: {
    color: DARK_TEXT
  },
  headerFilterButton: {
    height: 38,
    width: 38,
    borderRadius: 14,
    backgroundColor: "rgba(43, 103, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  headerFilterIconImg: {
    width: 18,
    height: 16,
    tintColor: ACCENT_BLUE
  },
  headerFilterIconImgDark: {
    tintColor: DARK_TEXT
  },
  headerFilterActiveDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: ACCENT_BLUE
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0f172a"
  },
  subtitle: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2
  },
  headerBrandOnlyWrap: {
    minHeight: 38,
    justifyContent: "center",
    paddingLeft: 12
  },
  headerBrandOnlyLogoBoost: {
    transform: [{ scale: 1.04 }]
  },
  titleDark: {
    color: DARK_TEXT
  },
  subtitleDark: {
    color: DARK_MUTED_2
  },
  tabBarWrap: {
    marginTop: 4,
    marginBottom: 4,
    padding: 3,
    borderRadius: 12,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "#f2f7fd",
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopColor: "#cfdced",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftColor: "#d4dfec",
    borderRightColor: "#d4dfec",
    borderBottomColor: "#d4dfec",
    shadowColor: "#0f172a",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1
  },
  tabBarInner: {
    position: "relative",
    height: 42,
    overflow: "hidden"
  },
  tabAddMask: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
    backgroundColor: "#f2f7fd",
    borderLeftWidth: 0
  },
  tabAddMaskDark: {
    backgroundColor: DARK_SURFACE
  },
  tabBarWrapDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftColor: "rgba(255, 255, 255, 0.10)",
    borderRightColor: "rgba(255, 255, 255, 0.10)",
    borderBottomColor: "rgba(255, 255, 255, 0.10)",
    shadowColor: "#000000",
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 0,
    paddingHorizontal: 1,
    position: "relative"
  },
  tabScroll: {
    maxHeight: 42
  },
  tabRowDark: {},
  tabScrollDark: {
    maxHeight: 42
  },
  tabAddBtn: {
    position: "absolute",
    right: 4,
    top: 5,
    height: 32,
    width: 32,
    borderRadius: 9,
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    alignItems: "center",
    justifyContent: "center"
  },
  tabAddBtnDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  tabAddText: {
    fontSize: 18,
    fontWeight: "900",
    color: ACCENT_BLUE,
    marginTop: -1
  },
  tabAddTextDark: {
    color: "#8fb4ff"
  },
  tabMenuBtn: {
    marginLeft: 9,
    marginRight: -4,
    height: 22,
    width: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  tabMenuIcon: {
    fontSize: 16,
    fontWeight: "900",
    color: "#94a3b8",
    includeFontPadding: false
  },
  menuList: {
    gap: 10
  },
  menuItem: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  menuItemDanger: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3"
  },
  menuItemText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  menuItemTextDanger: {
    color: "#e11d48"
  },
  menuInput: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a"
  },
  menuHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b"
  },
  colorGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 10
  },
  colorSwatchActive: {
    borderWidth: 3,
    borderColor: "#0f172a"
  },
  listMonthBar: {
    marginTop: -4,
    marginBottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    height: 40,
    backgroundColor: "#f6f9fe",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderTopColor: "#e1e9f4",
    borderBottomColor: "transparent",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#e1e9f4",
    borderRightColor: "#e1e9f4",
    borderRadius: 0
  },
  listMonthBarDark: {
    backgroundColor: "#1f242c",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.04)",
    borderLeftColor: "rgba(255, 255, 255, 0.04)",
    borderRightColor: "rgba(255, 255, 255, 0.04)",
    borderBottomColor: "transparent",
    borderRadius: 0
  },
  listMonthLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 12,
    padding: 0
  },
  listMonthNavButton: {
    width: 36,
    height: 36,
    borderRadius: 0,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center"
  },
  listMonthNavText: {
    fontSize: 22,
    fontWeight: "900",
    color: ACCENT_BLUE,
    includeFontPadding: false,
    textAlign: "center",
    lineHeight: 24,
    transform: [{ translateY: -1.5 }]
  },
  listMonthRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  listMonthText: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0f172a",
    transform: [{ translateX: 0.5 }]
  },
  listTodayButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  listAddButton: {
    height: 32,
    paddingHorizontal: 2,
    backgroundColor: "transparent",
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateX: -4 }]
  },
  listPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  listAddText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  listTodayText: {
    fontSize: 12,
    fontWeight: "700",
    color: ACCENT_BLUE
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)"
  },
  tabPillAll: {
    minWidth: 72,
    justifyContent: "center",
    paddingHorizontal: 6
  },
  tabPillActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  tabPillDark: {
    backgroundColor: "transparent",
    borderColor: DARK_BORDER
  },
  tabPillActiveDark: {
    backgroundColor: DARK_SURFACE_2
  },
  tabPillGhost: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5
  },
  tabPillGhostDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  tabPillPlaceholder: {
    opacity: 0
  },
  tabDragOverlay: {
    position: "absolute",
    top: 0,
    zIndex: 20
  },
  tabText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#64748b"
  },
  tabTextAll: {
    textAlign: "center"
  },
  tabTextActive: {
    color: "#0f172a"
  },
  tabTextDark: {
    color: DARK_MUTED
  },
  tabTextActiveDark: {
    color: DARK_TEXT
  },
  tabDot: {
    width: 8,
    height: 8,
    borderRadius: 999
  },
  card: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  cardDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  listCard: {
    padding: 0,
    borderWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  listCardDark: {
    borderLeftWidth: 0,
    borderRightWidth: 0
  },
  memoCard: {
    marginTop: -4,
    padding: 0,
    borderWidth: 0,
    borderColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  memoCardDark: {
    backgroundColor: DARK_SURFACE_2,
    borderWidth: 0,
    borderColor: "transparent"
  },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 10
  },
  primaryButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700"
  },
  ghostButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(43, 103, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  ghostButtonText: {
    color: ACCENT_BLUE,
    fontWeight: "900",
    fontSize: 20,
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
    width: 38,
    height: 38,
    lineHeight: 38
  },
  ghostButtonTextDisabled: {
    opacity: 0.55
  },
  ghostButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  ghostButtonTextDark: {
    color: DARK_TEXT
  },
  errorText: {
    color: ACCENT_RED,
    fontSize: 12,
    marginTop: 8
  },
  helpText: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 8
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#f1f5fb",
    borderTopWidth: 1.2,
    borderTopColor: "#c9d8ea",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#edf2f8"
  },
  sectionHeaderDark: {
    backgroundColor: DARK_SURFACE_2,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    borderBottomColor: "rgba(255, 255, 255, 0.04)"
  },
  sectionHeaderToday: {
    backgroundColor: "#e9f2ff",
    borderTopColor: "#aecaee",
    borderBottomColor: "#d6e6ff"
  },
  sectionHeaderTodayDark: {
    backgroundColor: "rgba(59, 130, 246, 0.14)",
    borderTopColor: "rgba(125, 211, 252, 0.36)",
    borderBottomColor: "rgba(125, 211, 252, 0.22)"
  },
  sectionHeaderDateText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a",
    marginLeft: 4
  },
  sectionHeaderDateDowInline: {
    fontWeight: "400",
    opacity: 0.9
  },
  sectionHeaderTodayPill: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  sectionHeaderTodayPillDark: {
    backgroundColor: "rgba(125, 211, 252, 0.24)"
  },
  sectionHeaderTodayPillText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    color: "#1d4ed8"
  },
  sectionHeaderTodayPillTextDark: {
    color: "#d9efff"
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  sectionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  sectionHeaderDowBadge: {
    minWidth: 24,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "rgba(100, 116, 139, 0.10)",
    alignItems: "center",
    justifyContent: "center"
  },
  sectionHeaderDowBadgeDark: {
    backgroundColor: "rgba(148, 163, 184, 0.24)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.20)"
  },
  sectionHeaderDowBadgeSun: {
    backgroundColor: "rgba(220, 38, 38, 0.16)"
  },
  sectionHeaderDowBadgeSat: {
    backgroundColor: "rgba(37, 99, 235, 0.16)"
  },
  sectionHeaderDowBadgeHoliday: {
    backgroundColor: "rgba(220, 38, 38, 0.10)"
  },
  sectionHeaderDowBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  sectionHeaderDowBadgeTextDark: {
    color: "#dce8f8"
  },
  sectionHeaderDowBadgeTextSun: {
    color: "#f08080"
  },
  sectionHeaderDowBadgeTextSat: {
    color: "#7eb6ff"
  },
  sectionHeaderDowBadgeTextHoliday: {
    color: ACCENT_RED
  },
  sectionHeaderHolidayBadge: {
    maxWidth: 180,
    height: 20,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(220, 38, 38, 0.10)",
    alignItems: "center",
    justifyContent: "center"
  },
  holidayBadgeDark: {
    backgroundColor: "rgba(248, 113, 113, 0.16)"
  },
  sectionHeaderHolidayBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: ACCENT_RED
  },
  sectionHeaderDoneBtn: {
    height: 22,
    minWidth: 46,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  sectionHeaderDoneBtnDark: {
    backgroundColor: "#3b82f6"
  },
  sectionHeaderDoneBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#ffffff",
    includeFontPadding: false
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 12,
    paddingHorizontal: 0,
    paddingTop: 0
  },
  listEmptyWrap: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 18,
    alignItems: "center",
    justifyContent: "flex-start"
  },
  listEmptyCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingVertical: 24,
    paddingHorizontal: 14,
    alignItems: "center"
  },
  listEmptyCardDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  listEmptyTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a"
  },
  listEmptySub: {
    marginTop: 8,
    fontSize: 13,
    color: "#64748b",
    textAlign: "center"
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 9,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 0.8,
    borderBottomColor: "#f8fbfe"
  },
  itemRowDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.025)"
  },
  itemLeftCol: {
    width: 47,
    alignSelf: "stretch",
    marginVertical: -1.5,
    paddingTop: 0,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 5.5
  },
  itemTimeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155",
    textAlign: "right",
    includeFontPadding: false,
    textAlignVertical: "center",
    transform: [{ translateY: 0.5 }]
  },
  itemTimeTextDark: {
    color: DARK_MUTED
  },
  itemTimeTextEmpty: {
    fontSize: 12,
    fontWeight: "900",
    color: "#94a3b8",
    textAlign: "right",
    opacity: 0
  },
  itemMainCol: {
    flex: 1,
    justifyContent: "center",
    paddingLeft: 1.5
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    transform: [{ translateY: -1 }]
  },
  itemCategoryBadge: {
    flexShrink: 0,
    maxWidth: "100%",
    height: 20,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  badgeDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  itemCategoryDot: {
    width: 8,
    height: 8,
    borderRadius: 999
  },
  itemCategoryText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  memoContent: {
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 16
  },
  memoAllList: {
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 0,
    gap: 10
  },
  memoAllCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12
  },
  memoAllHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  memoAllHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  memoAllHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  memoAllDot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  memoAllTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoAllBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoAllInput: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 140,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoAllEditBtn: {
    height: 28,
    minWidth: 50,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#eef4ff",
    alignItems: "center",
    justifyContent: "center"
  },
  memoAllEditBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1d4ed8"
  },
  memoAllChevronBtn: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center"
  },
  memoAllChevron: {
    fontSize: 16,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoAllEmpty: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoEditorWrap: {
    flex: 1,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0
  },
  memoEditorBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: 6
  },
  memoEditorTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoInput: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 14,
    paddingBottom: 16,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a"
  },
  inputDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER,
    color: DARK_TEXT
  },
  memoSingleCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12
  },
  memoSingleCardDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoSingleInput: {
    padding: 0,
    minHeight: 220,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    borderRadius: 0
  },
  memoPaper: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 0,
    borderColor: "transparent",
    paddingTop: 0,
    paddingBottom: 10,
    paddingHorizontal: 8,
    minHeight: 240
  },
  paperDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: "transparent"
  },
  memoPaperContent: {
    flexGrow: 1,
    paddingBottom: 48
  },
  memoSection: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7"
  },
  memoSectionDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.08)"
  },
  memoSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6
  },
  memoSectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a"
  },
  memoEmpty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 20
  },
  memoEmptyCard: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 28
  },
  memoEmptyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a"
  },
  memoEmptySub: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b"
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
    position: "relative",
    width: "100%",
    height: 34,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#dce6f2",
    borderRightColor: "#dce6f2"
  },
  calendarHeaderDark: {
    borderLeftColor: "rgba(255, 255, 255, 0.08)",
    borderRightColor: "rgba(255, 255, 255, 0.08)"
  },
  calendarHeaderLeft: {
    position: "absolute",
    left: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center"
  },
  calendarTitleCentered: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    transform: [{ translateY: -4.25 }]
  },
  calendarHeaderRight: {
    position: "absolute",
    right: 10,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  calendarCard: {
    flex: 1,
    marginTop: -4,
    marginBottom: 0,
    padding: 0,
    overflow: "hidden",
    borderWidth: 0,
    borderColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  calendarCardDark: {
    borderWidth: 0,
    borderColor: "transparent"
  },
  calendarHeaderWrap: {
    paddingTop: 8,
    paddingBottom: 0,
    paddingHorizontal: 0,
    backgroundColor: "#ffffff"
  },
  calendarHeaderWrapDark: {
    backgroundColor: DARK_SURFACE
  },
  calendarFill: {
    paddingTop: 2,
    paddingHorizontal: 0,
    paddingBottom: 0
  },
  listFill: {
    paddingTop: 2,
    paddingHorizontal: 0,
    paddingBottom: 0
  },
  calendarButtonsOffset: {
    marginTop: 34
  },
  calendarTitleOffset: {
    marginTop: 28,
    marginLeft: 0,
    paddingTop: 2
  },
  calendarNavButton: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -3 }]
  },
  calendarNavButtonRight: {
    transform: [{ translateY: -4.25 }]
  },
  calendarNavButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  calendarNavText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "700",
    color: ACCENT_BLUE,
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  calendarNavTextDark: {
    color: DARK_TEXT
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  weekHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 0,
    marginTop: 0,
    paddingVertical: 0,
    height: 20,
    backgroundColor: "#f8fafc",
    borderRadius: 6
  },
  weekHeaderRowDark: {
    backgroundColor: DARK_SURFACE_2
  },
  weekHeaderText: {
    width: "14.285%",
    textAlign: "center",
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
    textAlignVertical: "center",
    color: "#64748b",
    fontWeight: "600"
  },
  weekHeaderTextDark: {
    color: "#a8b8d0"
  },
  weekHeaderTextSun: {
    color: "#d34a4a"
  },
  weekHeaderTextSat: {
    color: "#2f67c6"
  },
  weekHeaderTextSunDark: {
    color: "#ff9d9d"
  },
  weekHeaderTextSatDark: {
    color: "#9bc4ff"
  },
  calendarGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 0.8,
    borderColor: "#dfe7f3",
    borderTopWidth: 0
  },
  calendarGridDark: {
    borderColor: DARK_BORDER
  },
  calendarCell: {
    width: "14.285%",
    borderRightWidth: 0.8,
    borderBottomWidth: 0.8,
    borderColor: "#e1e8f2",
    paddingTop: 4,
    paddingHorizontal: 0,
    paddingBottom: 6,
    alignItems: "flex-start",
    justifyContent: "flex-start"
  },
  calendarCellDark: {
    borderColor: DARK_BORDER_SOFT
  },
  calendarCellToday: {
    backgroundColor: "#eef2ff"
  },
  calendarCellTodayDark: {
    backgroundColor: "rgba(59, 130, 246, 0.20)"
  },
  calendarTodayOutline: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 0.8,
    borderColor: "#bfdcff",
    zIndex: 1
  },
  calendarTodayOutlineDark: {
    borderColor: "rgba(147, 197, 253, 0.46)"
  },
  calendarTodayTopLine: {
    position: "absolute",
    top: -1,
    left: 0.5,
    right: 0.5,
    height: 1.5,
    backgroundColor: "#c7edff",
    zIndex: 2
  },
  calendarTodayTopLineDark: {
    backgroundColor: "#b8e7ff"
  },
  calendarCellSelected: {
    backgroundColor: "#dbeafe"
  },
  calendarCellSelectedDark: {
    backgroundColor: "rgba(43, 103, 199, 0.18)"
  },
  calendarCellLastCol: {
    borderRightWidth: 0
  },
  calendarCellLastRow: {
    borderBottomWidth: 0
  },
  calendarCellHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 2
  },
  calendarDay: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0f172a",
    paddingLeft: 2,
    marginTop: -2.5,
    marginLeft: 0.5
  },
  calendarDayDark: {
    color: DARK_TEXT
  },
  calendarDayToday: {
    color: ACCENT_BLUE
  },
  calendarDayTodayDark: {
    color: "#b8d4ff"
  },
  calendarDaySelected: {
    color: "#1e40af"
  },
  calendarDaySelectedDark: {
    color: "#d6e8ff"
  },
  calendarDayMuted: {
    color: "#cbd5f5"
  },
  calendarDaySunday: {
    color: ACCENT_RED
  },
  calendarDaySaturday: {
    color: ACCENT_BLUE
  },
  calendarDayHoliday: {
    color: ACCENT_RED
  },
  calendarHolidayText: {
    width: "100%",
    marginTop: -1,
    paddingLeft: 4,
    fontSize: 8,
    fontWeight: "800",
    color: ACCENT_RED,
    lineHeight: 10,
    textAlign: "left"
  },
  calendarHolidayTextDark: {
    color: "#f3a4a4"
  },
  calendarLineStack: {
    width: "100%",
    gap: 1,
    marginTop: 4,
    paddingHorizontal: 1
  },
  calendarLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0
  },
  calendarDot: {
    width: 6,
    height: 6,
    borderRadius: 999
  },
  calendarLabel: {
    width: "100%",
    paddingHorizontal: 4,
    minHeight: 13,
    paddingVertical: 1,
    borderRadius: 4,
    alignItems: "flex-start",
    justifyContent: "center"
  },
  calendarLabelRange: {
    minHeight: 17
  },
  calendarLabelRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center"
  },
  calendarLabelTimeCol: {
    minWidth: 18,
    width: 18,
    marginRight: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    alignSelf: "center",
    flexShrink: 0
  },
  calendarLabelTimeColRange: {
    justifyContent: "center"
  },
  calendarLabelTimeSingleSlot: {
    minWidth: 18,
    width: 18,
    marginRight: 1,
    alignSelf: "center",
    textAlign: "left"
  },
  calendarLabelDark: {
    borderWidth: 0
  },
  calendarLabelTime: {
    fontSize: 6,
    lineHeight: 8,
    color: "rgba(255, 255, 255, 0.92)",
    fontWeight: "800",
    includeFontPadding: false,
    textAlignVertical: "center",
    marginRight: 0
  },
  calendarLabelTimeSingle: {
    lineHeight: 10
  },
  calendarLabelTimeDark: {
    color: "rgba(11, 18, 32, 0.82)"
  },
  calendarLabelText: {
    fontSize: 8,
    lineHeight: 10,
    color: "#ffffff",
    fontWeight: "800",
    flex: 1,
    textAlign: "left",
    alignSelf: "center",
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  calendarLabelTextSingle: {
    marginTop: -2
  },
  calendarLabelTextRange: {
    alignSelf: "center"
  },
  calendarLabelTextDark: {
    color: "#0b1220"
  },
  calendarLineText: {
    flex: 1,
    fontSize: 8,
    lineHeight: 10,
    color: "#1f2937"
  },
  calendarLineTextDark: {
    color: DARK_MUTED
  },
  calendarMoreBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 3,
    paddingVertical: 0,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
    marginLeft: 0,
    marginTop: -0.5
  },
  calendarMoreBadgeDark: {
    borderColor: DARK_BORDER,
    backgroundColor: "rgba(255, 255, 255, 0.06)"
  },
  calendarMoreText: {
    fontSize: 6,
    fontWeight: "700",
    color: ACCENT_BLUE
  },
  calendarMoreTextDark: {
    color: DARK_TEXT
  },
  dayModalOverlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    padding: 16,
    justifyContent: "center",
    alignItems: "center"
  },
  dayModalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  dayModalCard: {
    width: "92%",
    alignSelf: "center",
    maxWidth: 520,
    maxHeight: "78%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  dayModalCardDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  dayModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  dayModalHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  dayModalHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  dayModalAddBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  dayModalAddBtnDark: {
    backgroundColor: ACCENT_BLUE
  },
  dayModalAddText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#ffffff"
  },
  dayModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a"
  },
  dayModalCountPill: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#c7d2fe",
    alignItems: "center",
    justifyContent: "center"
  },
  dayModalCountPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  dayModalCountText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  dayModalCloseBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  dayModalCloseBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)"
  },
  dayModalCloseX: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  dayModalList: {
    paddingBottom: 6
  },
  dayModalEmpty: {
    paddingVertical: 30,
    alignItems: "center",
    justifyContent: "center"
  },
  dayModalEmptyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  dayModalEmptySub: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b"
  },
  dayModalItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7"
  },
  dayModalItemRowDark: {
    borderBottomColor: DARK_BORDER_SOFT
  },
  dayModalItemTime: {
    width: 62,
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  dayModalItemTimeEmpty: {
    width: 62,
    fontSize: 12,
    fontWeight: "900",
    color: "#94a3b8"
  },
  dayModalItemText: {
    flex: 1,
    fontSize: 13,
    color: "#0f172a"
  },
  reorderCard: {
    width: "92%",
    alignSelf: "center",
    maxWidth: 560,
    maxHeight: "86%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  reorderCardDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  reorderInlineCard: {
    marginTop: 0,
    marginBottom: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0
  },
  reorderInlineCardDark: {
    backgroundColor: "transparent",
    borderWidth: 0
  },
  reorderInlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6
  },
  reorderInlineTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  reorderInlineHint: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    marginBottom: 6
  },
  reorderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  reorderHeaderTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0f172a"
  },
  reorderHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  reorderHeaderBtn: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  reorderHeaderBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)"
  },
  reorderHeaderBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  reorderHeaderBtnPrimary: {
    backgroundColor: ACCENT_BLUE
  },
  reorderHeaderBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#ffffff"
  },
  reorderDateText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b"
  },
  reorderScroll: {
    flex: 1
  },
  reorderScrollContent: {
    paddingBottom: 10
  },
  reorderSection: {
    marginTop: 10
  },
  reorderSectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#334155",
    marginBottom: 8
  },
  reorderNoTimeList: {
    position: "relative"
  },
  reorderItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7"
  },
  reorderItemRowDark: {
    borderBottomColor: DARK_BORDER_SOFT
  },
  reorderItemPlaceholder: {
    opacity: 0
  },
  reorderDragOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20
  },
  reorderDragGhost: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  reorderDragGhostDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  reorderHandle: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6
  },
  reorderHandleText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#94a3b8"
  },
  reorderHandleTextDark: {
    color: DARK_MUTED
  },
  reorderDeleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2
  },
  reorderDeleteBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  reorderDeleteBtnText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#94a3b8",
    includeFontPadding: false
  },
  reorderEmpty: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  reorderEmptyText: {
    fontSize: 12,
    color: "#64748b"
  },
  calendarFilterCard: {
    width: "90%",
    maxWidth: 460,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  calendarFilterCardDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  calendarFilterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  calendarFilterTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a"
  },
  calendarFilterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  calendarFilterResetBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center"
  },
  calendarFilterResetText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#475569"
  },
  calendarFilterDoneBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eaf2ff",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.20)",
    alignItems: "center",
    justifyContent: "center"
  },
  calendarFilterDoneText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  calendarFilterList: {
    marginTop: 12,
    gap: 8,
    paddingBottom: 4
  },
  calendarFilterItem: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  calendarFilterItemDark: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: DARK_BORDER
  },
  calendarFilterItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  calendarFilterItemText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#334155"
  },
  calendarFilterCheck: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#9ca3af",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent"
  },
  calendarFilterCheckDark: {
    borderColor: "#94a3b8"
  },
  calendarFilterCheckActive: {
    backgroundColor: ACCENT_BLUE,
    borderColor: ACCENT_BLUE
  },
  calendarFilterCheckMark: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    marginTop: -1
  },
  calendarFilterHint: {
    marginTop: 10,
    fontSize: 12,
    color: "#64748b"
  },
  editorCard: {
    width: "92%",
    maxWidth: 520,
    maxHeight: "82%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    overflow: "hidden"
  },
  editorCardDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  editorOverlayKeyboard: {
    justifyContent: "flex-end",
    paddingBottom: 0
  },
  editorCardKeyboard: {
    marginBottom: 0
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  editorTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0f172a"
  },
  editorCloseBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  editorCloseBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: DARK_BORDER
  },
  editorCloseText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  editorMetaRow: {
    marginTop: 10
  },
  editorBody: {
    flexGrow: 0
  },
  editorBodyContent: {
    paddingBottom: 4
  },
  editorMetaLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#475569",
    marginBottom: 6
  },
  editorMetaValue: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  editorCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8
  },
  editorCategoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  editorCategoryPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: DARK_BORDER
  },
  editorCategoryPillActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorCategoryPillActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.18)",
    borderColor: "rgba(43, 103, 199, 0.40)"
  },
  editorCategoryText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#334155"
  },
  editorCategoryTextActive: {
    color: ACCENT_BLUE
  },
  editorRepeatBlock: {
    marginTop: 8,
    gap: 8
  },
  editorRepeatStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10
  },
  editorRepeatStepRowDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  editorRepeatStepLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155"
  },
  editorRepeatStepBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorRepeatStepBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorRepeatStepBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#334155",
    lineHeight: 17
  },
  editorRepeatStepValue: {
    minWidth: 24,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  editorRepeatWeekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorRepeatDayPill: {
    width: 34,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  editorRepeatDayPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: DARK_BORDER
  },
  editorRepeatDayPillActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorRepeatDayPillActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.18)",
    borderColor: "rgba(43, 103, 199, 0.40)"
  },
  editorRepeatDayText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#334155"
  },
  editorRepeatDayTextActive: {
    color: ACCENT_BLUE
  },
  editorRepeatUntilRow: {
    marginTop: 0
  },
  editorInput: {
    marginBottom: 0
  },
  editorTextareaWrap: {
    height: 110,
    minHeight: 110,
    maxHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden"
  },
  editorTextareaWrapDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  editorTextareaInput: {
    flex: 1,
    minHeight: 0,
    margin: 0,
    padding: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a"
  },
  editorTextarea: {
    marginBottom: 0,
    height: 110,
    textAlignVertical: "top"
  },
  editorActions: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  editorActionsCompact: {
    marginTop: 10
  },
  editorPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    paddingHorizontal: 12,
    backgroundColor: "#ffffff"
  },
  editorPickerRowDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  editorRangeRow: {
    marginTop: 8
  },
  editorPickerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorPickerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  editorPickerIcon: {
    fontSize: 14
  },
  editorPickerIconSpacer: {
    width: 16,
    height: 16
  },
  editorPickerValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a"
  },
  editorPickerHint: {
    fontSize: 12,
    fontWeight: "900",
    color: ACCENT_BLUE
  },
  editorPickerClearPill: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center"
  },
  editorPickerClearPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorPickerClearText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  editorAlarmRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  editorAlarmLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b"
  },
  editorAlarmToggle: {
    minWidth: 72,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorAlarmToggleDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorAlarmToggleOn: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorAlarmToggleOnDark: {
    backgroundColor: "rgba(43, 103, 199, 0.24)",
    borderColor: "rgba(125, 211, 252, 0.42)"
  },
  editorAlarmToggleDisabled: {
    opacity: 0.62
  },
  editorAlarmToggleText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  editorAlarmToggleTextDark: {
    color: DARK_MUTED
  },
  editorAlarmToggleTextOn: {
    color: ACCENT_BLUE
  },
  editorAlarmToggleTextDisabled: {
    color: "#94a3b8"
  },
  editorAlarmLeadRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorAlarmLeadPill: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorAlarmLeadPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorAlarmLeadPillActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorAlarmLeadPillActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.24)",
    borderColor: "rgba(125, 211, 252, 0.42)"
  },
  editorAlarmLeadText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  editorAlarmLeadTextActive: {
    color: ACCENT_BLUE
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end"
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.45)"
  },
  sheetCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12
  },
  sheetCardDark: {
    backgroundColor: DARK_SURFACE,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  sheetHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  sheetBtnGhost: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  sheetBtnGhostDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: DARK_BORDER
  },
  sheetBtnGhostText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  sheetBtnPrimary: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  sheetBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#ffffff"
  },
  settingsList: {
    gap: 14,
    paddingTop: 4,
    paddingBottom: 6
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  settingsLabel: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  settingsSegment: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    overflow: "hidden"
  },
  settingsSegmentDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  settingsSegBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  settingsSegBtnActive: {
    backgroundColor: "#ffffff"
  },
  settingsSegBtnActiveDark: {
    backgroundColor: "rgba(255, 255, 255, 0.08)"
  },
  settingsSegText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748b"
  },
  settingsSegTextDark: {
    color: DARK_MUTED
  },
  settingsSegTextActive: {
    color: ACCENT_BLUE
  },
  settingsSegTextActiveDark: {
    color: DARK_TEXT
  },
  settingsRefreshBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    alignItems: "center",
    justifyContent: "center"
  },
  settingsRefreshText: {
    fontSize: 13,
    fontWeight: "900",
    color: ACCENT_BLUE
  },
  settingsLogoutBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
    alignItems: "center",
    justifyContent: "center"
  },
  settingsLogoutText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#e11d48"
  },
  sheetPicker: {
    marginBottom: 6
  },
  fab: {
    position: "absolute",
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10
  },
  fabText: {
    fontSize: 28,
    fontWeight: "900",
    color: "#ffffff",
    marginTop: -2
  },
  editorSaveBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  editorSaveText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#ffffff"
  },
  editorDangerBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center"
  },
  editorDangerText: {
    fontSize: 13,
    fontWeight: "900",
    color: ACCENT_RED
  },
  detailCard: {
    flex: 1
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  detailBody: {
    paddingTop: 12,
    paddingBottom: 12
  }
})

