import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Constants from "expo-constants"
import { StatusBar } from "expo-status-bar"
import * as Notifications from "expo-notifications"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient } from "@supabase/supabase-js"
import DateTimePicker from "@react-native-community/datetimepicker"
import {
  ActivityIndicator,
  AppState,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Image,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  findNodeHandle
} from "react-native"
import { NavigationContainer, useFocusEffect } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler"
import DraggableFlatList from "react-native-draggable-flatlist"

const { resolveRecurringEditScope, resolveFutureRecurringRepeatDays } = require("./utils/recurringEditScope")

const ACCENT_BLUE = "#2b67c7"
const ACCENT_RED = "#d04b4b"
const AUTH_IDENTIFIER_EMAIL_DOMAIN = "planner.local"
const AUTH_MIN_PASSWORD_LENGTH = 6

// Dark theme palette (match web app feel: neutral dark surfaces + subtle borders)
const DARK_BG = "#141b26"
const DARK_SURFACE = "#1b1f26"
const DARK_SURFACE_2 = "#232a33"
const DARK_BORDER = "rgba(255, 255, 255, 0.10)"
const DARK_BORDER_SOFT = "rgba(255, 255, 255, 0.07)"
const DARK_TEXT = "#f1f5f9"
const DARK_MUTED = "#a9b4c2"
const DARK_MUTED_2 = "#7f8b9b"
const LEGACY_WINDOW_COLORS = [
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
const WINDOW_COLORS = [
  "#d7686d",
  "#de8b5b",
  "#e28a67",
  "#d9c56a",
  "#d6ba58",
  "#c5d97b",
  "#93c96a",
  "#4f9d63",
  "#4e7f65",
  "#79c9b8",
  "#86c0e6",
  "#b2c8eb",
  "#5eaed1",
  "#5a78cf",
  "#5b62aa",
  "#8765b3",
  "#c9b4e8",
  "#e5b9cf"
]
const WINDOW_COLOR_LEGACY_MAP = Object.freeze(
  LEGACY_WINDOW_COLORS.reduce((acc, legacy, index) => {
    acc[legacy] = WINDOW_COLORS[index] || legacy
    return acc
  }, {})
)

function normalizeWindowColor(value) {
  const key = String(value ?? "").trim().toLowerCase()
  if (!key) return ""
  return WINDOW_COLOR_LEGACY_MAP[key] || (WINDOW_COLORS.includes(key) ? key : key)
}

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
const LEGACY_UI_FONT_SCALE_KEY = "plannerMobile.ui.fontScale.v1"
const UI_LIST_FONT_SCALE_KEY = "plannerMobile.ui.font.list.v1"
const UI_MEMO_FONT_SCALE_KEY = "plannerMobile.ui.font.memo.v1"
const UI_CALENDAR_FONT_SCALE_KEY = "plannerMobile.ui.font.calendar.v1"
const UI_TAB_FONT_SCALE_KEY = "plannerMobile.ui.font.tab.v1"
const UI_FONT_SCALE_DEFAULT = 1
const UI_FONT_SCALE_MIN = 0.85
const UI_FONT_SCALE_MAX = 1.25
const UI_FONT_SCALE_PRESETS = [
  { key: "small", label: "작게", scale: 0.9 },
  { key: "normal", label: "보통", scale: 1 },
  { key: "large", label: "크게", scale: 1.12 }
]
const PLAN_ALARM_PREFS_KEY = "plannerMobile.planAlarmPrefs.v1"
const PLAN_ALARM_LEAD_PREFS_KEY = "plannerMobile.planAlarmLeadPrefs.v1"
const PLAN_NOTIFICATION_SCHEDULE_IDS_KEY = "plannerMobile.planNotificationScheduleIds.v1"
const PLAN_NOTIFICATION_CHANNEL_ID = "planner-reminders"
const PLAN_NOTIFICATION_MAX_COUNT = Platform.OS === "android" ? 240 : 60
const PLAN_NOTIFICATION_LOOKAHEAD_DAYS = Platform.OS === "android" ? 365 : 180
const OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS = 730
const ENABLE_LEGACY_BROAD_DELETE_FALLBACK = false
const DEFAULT_RIGHT_MEMO_DOC_TITLE = "기본 메모"
const UNTITLED_RIGHT_MEMO_DOC_TITLE = "새 메모"

function isInvalidRefreshTokenError(error) {
  const message = String(error?.message ?? error ?? "")
    .trim()
    .toLowerCase()
  if (!message) return false
  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("refresh token has been revoked") ||
    message.includes("refresh token already used")
  )
}

function getSupabaseAuthStorageKeys() {
  if (!supabaseUrl) return []
  try {
    const projectRef = String(new URL(supabaseUrl).hostname ?? "").split(".")[0]
    if (!projectRef) return []
    return [`sb-${projectRef}-auth-token`, `sb-${projectRef}-auth-token-code-verifier`]
  } catch (_e) {
    return []
  }
}

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

function clampUiFontScale(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return UI_FONT_SCALE_DEFAULT
  return Math.max(UI_FONT_SCALE_MIN, Math.min(UI_FONT_SCALE_MAX, n))
}

function getClosestUiFontPreset(value) {
  const scale = clampUiFontScale(value)
  let closest = UI_FONT_SCALE_PRESETS[0]
  let minDistance = Number.POSITIVE_INFINITY
  for (const preset of UI_FONT_SCALE_PRESETS) {
    const distance = Math.abs(scale - preset.scale)
    if (distance < minDistance) {
      minDistance = distance
      closest = preset
    }
  }
  return closest
}

function normalizeUiFontPresetScale(value) {
  return getClosestUiFontPreset(value).scale
}

function getUiFontPresetLabel(value) {
  return getClosestUiFontPreset(value).label
}

function parseStoredUiFontScale(rawValue, fallback = UI_FONT_SCALE_DEFAULT) {
  if (rawValue == null || rawValue === "") return normalizeUiFontPresetScale(fallback)
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return normalizeUiFontPresetScale(fallback)
  return normalizeUiFontPresetScale(parsed)
}

function scaleFontSize(baseSize, scale = UI_FONT_SCALE_DEFAULT) {
  const base = Number(baseSize)
  const multiplier = Number(scale)
  if (!Number.isFinite(base)) return 0
  if (!Number.isFinite(multiplier)) return Math.round(base * 10) / 10
  return Math.round(base * multiplier * 10) / 10
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

function formatDateWithWeekday(dateKey) {
  const normalized = String(dateKey ?? "").trim()
  const dow = weekdayLabel(normalized)
  return dow ? `${normalized} ${dow}` : normalized
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

function parseHexColorToRgb(value) {
  const raw = String(value ?? "").trim()
  const hex = raw.startsWith("#") ? raw.slice(1) : raw
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16)
    }
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    }
  }
  return null
}

function colorWithAlpha(color, alpha = 1) {
  const raw = String(color ?? "").trim()
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0))
  const hex = raw.startsWith("#") ? raw.slice(1) : raw
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(hex[0] + hex[0], 16)
    const g = Number.parseInt(hex[1] + hex[1], 16)
    const b = Number.parseInt(hex[2] + hex[2], 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }
  return raw || color
}

function getReadableCalendarTextColor(backgroundColor) {
  const rgb = parseHexColorToRgb(backgroundColor)
  if (!rgb) return "#0f172a"
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance < 0.58 ? "#ffffff" : "#0f172a"
}

function rgbToHex(rgb) {
  if (!rgb) return "#475569"
  const toHex = (value) => {
    const clamped = Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
    return clamped.toString(16).padStart(2, "0")
  }
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

function mixHexColors(colorA, colorB, ratio = 0.5) {
  const a = parseHexColorToRgb(colorA)
  const b = parseHexColorToRgb(colorB)
  if (!a && !b) return "#475569"
  if (!a) return colorB
  if (!b) return colorA
  const amount = Math.max(0, Math.min(1, Number(ratio) || 0))
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  })
}

function getMutedCalendarPillColor(backgroundColor, isDark = false) {
  const base = String(backgroundColor ?? "").trim()
  const firstPass = mixHexColors(base || "#64748b", isDark ? "#334155" : "#475569", 0.42)
  const rgb = parseHexColorToRgb(firstPass)
  if (!rgb) return isDark ? "#475569" : "#5b6b80"
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  if (luminance <= 0.5) return firstPass
  return mixHexColors(firstPass, "#1f2937", 0.18)
}

function formatDateMD(dateKey) {
  const dt = parseDateKey(dateKey)
  if (!dt) return String(dateKey ?? "")
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

function formatTodayHeaderText(dateValue = new Date()) {
  const dt = dateValue instanceof Date ? dateValue : new Date()
  const dateKey = dateToKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  return `${dt.getFullYear()}.${pad2(dt.getMonth() + 1)}.${pad2(dt.getDate())} (${weekdayLabel(dateKey)})`
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
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*[~-]\s*|\s+)(\d{1,2}):(\d{2})$/)
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

function parsePlanMetaSuffixes(rawText) {
  let baseRaw = String(rawText ?? "").trim()
  if (!baseRaw) {
    return {
      baseRaw: "",
      completed: null,
      marker: ""
    }
  }

  let completed = null
  let marker = ""

  while (baseRaw) {
    const taskMatch = completed == null ? baseRaw.match(/^(.*?);\s*([OX])\s*$/i) : null
    if (taskMatch) {
      const nextBaseRaw = String(taskMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      marker = String(taskMatch[2] ?? "").trim().toUpperCase()
      completed = marker === "O"
      continue
    }

    const legacyCountMetaMatch = baseRaw.match(/^(.*?);\s*(?:COUNT|ANN)\s*=\s*[^;]+\s*$/i)
    if (legacyCountMetaMatch) {
      const nextBaseRaw = String(legacyCountMetaMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      continue
    }

    const legacyFlagMarkerMatch = baseRaw.match(/^(.*?);\s*D\s*$/i)
    if (legacyFlagMarkerMatch) {
      const nextBaseRaw = String(legacyFlagMarkerMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      continue
    }

    break
  }

  return {
    baseRaw: baseRaw || String(rawText ?? "").trim(),
    completed,
    marker
  }
}

function stripPlanMetaSuffix(rawText) {
  const parsed = parsePlanMetaSuffixes(rawText)
  return {
    text: parsed.baseRaw || String(rawText ?? "").trim(),
    completed: parsed.completed
  }
}

function getPlanDisplayText(row) {
  return stripPlanMetaSuffix(row?.content).text
}

function hasVisiblePlanDisplayText(row) {
  return Boolean(String(getPlanDisplayText(row) ?? "").trim())
}

function normalizePlanEntryType(value) {
  void value
  return "task"
}

function getPlanEntryMeta(rawText) {
  const parsed = parsePlanMetaSuffixes(rawText)
  return {
    text: parsed.baseRaw || String(rawText ?? "").trim(),
    entryType: "task",
    taskCompleted: parsed.completed === true
  }
}

function buildPlanContentWithMeta(
  baseText,
  entryType = "task",
  taskCompleted = false
) {
  const parsed = parsePlanMetaSuffixes(baseText)
  const text = String(parsed.baseRaw ?? baseText ?? "").trim()
  if (!text) return ""
  const normalizedType = normalizePlanEntryType(entryType)
  let next = text
  if (normalizedType === "task") next += `;${taskCompleted ? "O" : "X"}`
  return next
}

function getRepeatLabelFromPlanRow(row) {
  const repeatType = normalizeRepeatType(row?.repeat_type ?? row?.repeatType)
  const interval = normalizeRepeatInterval(row?.repeat_interval ?? row?.repeatInterval)
  if (repeatType === "daily") return interval === 1 ? "매일" : `${interval}일마다`
  if (repeatType === "weekly") return interval === 1 ? "매주" : `${interval}주마다`
  if (repeatType === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`
  if (repeatType === "yearly") return interval === 1 ? "매년" : `${interval}년마다`
  return ""
}

function buildTaskItemFromPlanRow(row) {
  if (!isRenderablePlanRow(row)) return null
  const parsed = parsePlanMetaSuffixes(row?.content)
  const id = String(row?.id ?? "").trim()
  const dateKey = String(row?.date ?? "").trim()
  const title = String(row?.category_id ?? "").trim()
  const text = String(parsed.baseRaw ?? "").trim()
  if (!id || !dateKey || !text) return null

  return {
    id,
    planId: id,
    dateKey,
    time: buildPlanTimeTextFromRow(row),
    title: title && title !== "__general__" ? title : "",
    text,
    display: text,
    completed: Boolean(parsed.completed),
    repeatLabel: getRepeatLabelFromPlanRow(row),
    row
  }
}

function extractTaskItemsFromPlanRows(planRows) {
  const items = []
  for (const row of planRows ?? []) {
    const item = buildTaskItemFromPlanRow(row)
    if (item) items.push(item)
  }
  items.sort((a, b) => {
    const dateDiff = keyToTime(a.dateKey) - keyToTime(b.dateKey)
    if (dateDiff !== 0) return dateDiff
    const timeA = String(a?.time ?? "")
    const timeB = String(b?.time ?? "")
    if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
    if (timeA && !timeB) return -1
    if (!timeA && timeB) return 1
    return String(a?.display ?? "").localeCompare(String(b?.display ?? ""), "ko")
  })
  return items
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

function planEndDateTimeFromRow(row) {
  const date = parseDateKey(String(row?.date ?? ""))
  if (!date) return null
  const { endTime } = normalizePlanTimeRange(row)
  const match = String(endTime).match(/^(\d{2}):(\d{2})$/)
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

function sameRepeatDays(a, b) {
  const left = normalizeRepeatDays(a)
  const right = normalizeRepeatDays(b)
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function dateFromDate(dateValue) {
  return new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate())
}

function dateKeyFromDate(dateValue) {
  return dateToKey(dateValue.getFullYear(), dateValue.getMonth() + 1, dateValue.getDate())
}

function keyToTime(dateKey) {
  const dt = parseDateKey(dateKey)
  return dt ? dt.getTime() : Number.NaN
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

function getOpenEndedRepeatHorizonDate(baseDate = new Date(), lookaheadDays = OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS) {
  const start = baseDate instanceof Date ? dateFromDate(baseDate) : dateFromDate(new Date())
  return addDays(start, Math.max(1, Number(lookaheadDays) || OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS))
}

function getOpenEndedRepeatSpanDays(startDateKey, baseDate = new Date(), lookaheadDays = OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS) {
  const start = parseDateKey(startDateKey)
  if (!start) return REPEAT_DEFAULT_SPAN_DAYS
  const horizonDate = getOpenEndedRepeatHorizonDate(baseDate, lookaheadDays)
  const diffDays = Math.ceil((horizonDate.getTime() - dateFromDate(start).getTime()) / (24 * 60 * 60 * 1000))
  return Math.max(REPEAT_DEFAULT_SPAN_DAYS, diffDays)
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
    const body = buildRightMemoCombinedText(rightMemos?.[w.id] ?? "").trimEnd()
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

function genRightMemoDocId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return `rmd-${globalThis.crypto.randomUUID()}`
    }
  } catch (error) {
    void error
  }
  return `rmd-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function hashStableMemoDocSeed(value = "") {
  let hash = 0
  const text = String(value ?? "")
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

function hashAuthIdentifier(value = "") {
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  const text = String(value ?? "")
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    left ^= code
    left = Math.imul(left, 0x01000193) >>> 0
    right ^= code + 0x9e37
    right = Math.imul(right, 0x85ebca6b) >>> 0
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`
}

function isValidAuthEmail(value = "") {
  const text = String(value ?? "").trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

function resolveAuthIdentifier(value = "") {
  const raw = String(value ?? "").trim()
  if (!raw) return { input: "", email: "", isEmail: false }
  if (isValidAuthEmail(raw)) {
    const normalizedEmail = raw.toLowerCase()
    return { input: raw, email: normalizedEmail, isEmail: true }
  }
  const normalizedId = raw.toLowerCase()
  return {
    input: raw,
    email: `id_${hashAuthIdentifier(normalizedId)}@${AUTH_IDENTIFIER_EMAIL_DOMAIN}`,
    isEmail: false
  }
}

function getStableRightMemoDocId(input = {}, index = 0) {
  const title = normalizeRightMemoDocTitle(input?.title, getRightMemoFallbackTitle(index))
  const content = String(input?.content ?? "")
  return `rmd-stable-${index}-${hashStableMemoDocSeed(`${title}\u241f${content}`)}`
}

function normalizeRightMemoDocTitle(value, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function buildUntitledRightMemoDocTitle(sequence = 1) {
  const nextSequence = Number(sequence)
  if (!Number.isFinite(nextSequence) || nextSequence <= 1) return UNTITLED_RIGHT_MEMO_DOC_TITLE
  return `${UNTITLED_RIGHT_MEMO_DOC_TITLE} ${Math.floor(nextSequence)}`
}

function parseUntitledRightMemoDocSequence(title) {
  const trimmed = String(title ?? "").trim()
  if (!trimmed) return null
  if (trimmed === UNTITLED_RIGHT_MEMO_DOC_TITLE) return 1
  let match = trimmed.match(/^새 메모\s+(\d+)$/)
  if (match) {
    const sequence = Number(match[1] ?? NaN)
    return Number.isFinite(sequence) && sequence >= 2 ? sequence : 1
  }
  match = trimmed.match(/^메모\s+(\d+)$/)
  if (match) {
    const sequence = Number(match[1] ?? NaN)
    return Number.isFinite(sequence) && sequence >= 2 ? sequence : 2
  }
  return null
}

function getRightMemoFallbackTitle(index = 0) {
  return index === 0 ? DEFAULT_RIGHT_MEMO_DOC_TITLE : buildUntitledRightMemoDocTitle(index)
}

function getRightMemoDocDisplayTitle(title, index = 0) {
  const next = String(title ?? "").trim()
  return next || getRightMemoFallbackTitle(index)
}

function createRightMemoDoc(input = {}) {
  if (typeof input === "string") {
    return {
      id: genRightMemoDocId(),
      title: normalizeRightMemoDocTitle(input, UNTITLED_RIGHT_MEMO_DOC_TITLE),
      content: ""
    }
  }
  return {
    id: genRightMemoDocId(),
    title: normalizeRightMemoDocTitle(input?.title, UNTITLED_RIGHT_MEMO_DOC_TITLE),
    content: String(input?.content ?? "")
  }
}

function normalizeRightMemoDoc(doc, index = 0) {
  return {
    id: typeof doc?.id === "string" && doc.id.trim() ? doc.id : getStableRightMemoDocId(doc, index),
    title: normalizeRightMemoDocTitle(doc?.title, getRightMemoFallbackTitle(index)),
    content: String(doc?.content ?? "")
  }
}

function buildSafeRightMemoDocs(rawDocs) {
  const docs = Array.isArray(rawDocs) ? rawDocs.map((doc, index) => normalizeRightMemoDoc(doc, index)) : []
  return docs.length > 0 ? docs : [normalizeRightMemoDoc({}, 0)]
}

function parseLegacyCombinedRightMemo(rawContent) {
  const raw = String(rawContent ?? "")
  const lines = raw.split("\n")
  const docs = []
  const leadingLines = []
  let currentTitle = null
  let currentLines = []

  function pushCurrent() {
    if (!currentTitle) return
    docs.push({
      title: currentTitle,
      content: currentLines.join("\n").trimEnd()
    })
  }

  for (const line of lines) {
    const trimmed = String(line ?? "").trim()
    const match =
      trimmed.match(/^《\s*(.+?)\s*》$/) ||
      trimmed.match(/^〈\s*(.+?)\s*〉$/) ||
      trimmed.match(/^「\s*(.+?)\s*」$/) ||
      trimmed.match(/^<\s*(.+?)\s*>$/)

    if (match) {
      pushCurrent()
      currentTitle = String(match[1] ?? "").trim() || UNTITLED_RIGHT_MEMO_DOC_TITLE
      currentLines = []
      continue
    }

    if (currentTitle) currentLines.push(line)
    else leadingLines.push(line)
  }

  pushCurrent()

  const leadingContent = leadingLines.join("\n").trim()
  const detectedDocCount = docs.length
  if (leadingContent) {
    docs.unshift({
      title: DEFAULT_RIGHT_MEMO_DOC_TITLE,
      content: leadingLines.join("\n").trimEnd()
    })
  }

  if (detectedDocCount === 1 && !leadingContent) return null
  return docs.length > 0 ? docs : null
}

function normalizeRightMemoDocState(rawContent) {
  const raw = String(rawContent ?? "")

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.docs)) {
      const docs = buildSafeRightMemoDocs(parsed.docs)
      const activeDocId =
        typeof parsed.activeDocId === "string" && docs.some((doc) => doc.id === parsed.activeDocId)
          ? parsed.activeDocId
          : docs[0]?.id ?? null
      return { docs, activeDocId }
    }
  } catch (error) {
    void error
  }

  const legacyDocs = parseLegacyCombinedRightMemo(raw)
  if (legacyDocs) {
    const docs = buildSafeRightMemoDocs(legacyDocs)
    return {
      docs,
      activeDocId: docs[0]?.id ?? null
    }
  }

  return {
    docs: [normalizeRightMemoDoc({ title: DEFAULT_RIGHT_MEMO_DOC_TITLE, content: raw }, 0)],
    activeDocId: null
  }
}

function serializeRightMemoDocState(state) {
  const docs = buildSafeRightMemoDocs(state?.docs)
  const activeDocId =
    typeof state?.activeDocId === "string" && docs.some((doc) => doc.id === state.activeDocId)
      ? state.activeDocId
      : docs[0]?.id ?? null

  return JSON.stringify({
    version: 1,
    activeDocId,
    docs: docs.map((doc) => ({
      id: doc.id,
      title: normalizeRightMemoDocTitle(doc.title),
      content: String(doc.content ?? "")
    }))
  })
}

function getNextRightMemoDocTitle(docs) {
  const used = new Set(
    (docs ?? [])
      .map((doc, index) => parseUntitledRightMemoDocSequence(getRightMemoDocDisplayTitle(doc?.title, index)))
      .filter((value) => value != null)
  )
  if (!used.has(1)) return buildUntitledRightMemoDocTitle(1)
  let n = 2
  while (used.has(n)) n += 1
  return buildUntitledRightMemoDocTitle(n)
}

function buildRightMemoCombinedText(rawContent) {
  const state = normalizeRightMemoDocState(rawContent)
  const docsWithContent = state.docs.filter((doc) => String(doc?.content ?? "").trim() !== "")
  if (docsWithContent.length === 0) return ""
  if (
    docsWithContent.length === 1 &&
    getRightMemoDocDisplayTitle(docsWithContent[0]?.title, 0) === DEFAULT_RIGHT_MEMO_DOC_TITLE
  ) {
    return String(docsWithContent[0]?.content ?? "").trimEnd()
  }
  const lines = []
  for (const [index, doc] of docsWithContent.entries()) {
    if (index > 0) lines.push("")
    lines.push(`《${getRightMemoDocDisplayTitle(doc?.title, index)}》`)
    lines.push(...String(doc?.content ?? "").split("\n"))
  }
  return lines.join("\n").trimEnd()
}

function hasPersistableRightMemoState(rawContent) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs)
  if (docs.length > 1) return true
  const firstDoc = docs[0]
  if (!firstDoc) return false
  if (String(firstDoc?.content ?? "").trim()) return true
  const title = String(firstDoc?.title ?? "").trim()
  return title !== "" && title !== getRightMemoFallbackTitle(0)
}

function buildRightMemoDocView(rawContent, selectedDocId = null) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs)
  const activeDocId =
    typeof selectedDocId === "string" && docs.some((doc) => doc.id === selectedDocId)
      ? selectedDocId
      : typeof state.activeDocId === "string" && docs.some((doc) => doc.id === state.activeDocId)
        ? state.activeDocId
        : docs[0]?.id ?? null
  const activeIndex = Math.max(
    0,
    docs.findIndex((doc) => doc.id === activeDocId)
  )
  return {
    state,
    docs,
    activeDocId,
    activeIndex,
    activeDoc: docs[activeIndex] ?? docs[0] ?? createRightMemoDoc()
  }
}

function updateRightMemoRawForDocContent(rawContent, docId, nextContent) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs).map((doc) =>
    doc.id === docId ? { ...doc, content: String(nextContent ?? "") } : doc
  )
  return serializeRightMemoDocState({
    docs,
    activeDocId:
      typeof docId === "string" && docs.some((doc) => doc.id === docId)
        ? docId
        : state.activeDocId
  })
}

function updateRightMemoRawForDocTitle(rawContent, docId, nextTitle) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs).map((doc) =>
    doc.id === docId ? { ...doc, title: String(nextTitle ?? "") } : doc
  )
  return serializeRightMemoDocState({
    docs,
    activeDocId:
      typeof docId === "string" && docs.some((doc) => doc.id === docId)
        ? docId
        : state.activeDocId
  })
}

function addRightMemoDocToRaw(rawContent) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs)
  const nextDoc = createRightMemoDoc({ title: getNextRightMemoDocTitle(docs), content: "" })
  const nextDocs = [...docs, nextDoc]
  return {
    raw: serializeRightMemoDocState({ docs: nextDocs, activeDocId: nextDoc.id }),
    docId: nextDoc.id
  }
}

function removeRightMemoDocFromRaw(rawContent, docId) {
  const state = normalizeRightMemoDocState(rawContent)
  const docs = buildSafeRightMemoDocs(state.docs)
  const targetIndex = docs.findIndex((doc) => doc.id === docId)
  if (targetIndex < 0) {
    return { raw: serializeRightMemoDocState(state), docId: state.activeDocId, removed: false }
  }
  if (docs.length <= 1) {
    return {
      raw: serializeRightMemoDocState(state),
      docId: docs[targetIndex]?.id ?? docs[0]?.id ?? state.activeDocId ?? null,
      removed: false
    }
  }
  const nextDocs = docs.filter((doc) => doc.id !== docId)
  const nextIndex = Math.min(targetIndex, nextDocs.length - 1)
  const nextDocId = nextDocs[nextIndex]?.id ?? nextDocs[0]?.id ?? null
  return {
    raw: serializeRightMemoDocState({ docs: nextDocs, activeDocId: nextDocId }),
    docId: nextDocId,
    removed: true
  }
}

function formatLine(item) {
  const time = buildPlanTimeTextFromRow(item)
  const text = getPlanDisplayText(item)
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
  const content = getPlanDisplayText(row)
  if (!content) return ""
  const category = String(row?.category_id ?? "").trim()
  if (!category || category === "__general__") return content
  return `[${category}] ${content}`
}

function buildWidgetCalendarText(row) {
  const content = getPlanDisplayText(row)
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
        return isVisibleSchedulePlanRow(row)
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
    if (!isVisibleSchedulePlanRow(row)) continue
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

function isRenderablePlanRow(row) {
  if (!row || typeof row !== "object") return false
  const dateKey = String(row?.date ?? "").trim()
  const content = String(row?.content ?? "").trim()
  return Boolean(dateKey && content)
}

function isVisibleSchedulePlanRow(row) {
  return isRenderablePlanRow(row)
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

function comparePlanRowFallbackMeta(a, b) {
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
}

function comparePlanTimedMeta(a, b) {
  const ta = a.time
  const tb = b.time
  if (ta && tb && ta !== tb) return ta.localeCompare(tb)
  if (ta && !tb) return -1
  if (!ta && tb) return 1
  const ea = a.endTime
  const eb = b.endTime
  if (ea && eb && ea !== eb) return ea.localeCompare(eb)
  if (ea && !eb) return -1
  if (!ea && eb) return 1
  return comparePlanRowFallbackMeta(a, b)
}

function buildPlanOrderMeta(row, idx = 0) {
  const sortOrder = parseSortOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order)
  const createdAtMs = parseTimestampMs(row?.created_at ?? row?.createdAt)
  const updatedAtMs = parseTimestampMs(row?.updated_at ?? row?.updatedAt)
  const id = row?.id != null ? String(row.id) : ""
  const { time, endTime } = normalizePlanTimeRange(row)
  return { row, sortOrder, createdAtMs, updatedAtMs, id, idx, time, endTime }
}

function enforceTimedPlanOrderInSlots(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length <= 1) return list
  const meta = list.map((row, idx) => buildPlanOrderMeta(row, idx))
  const timed = meta.filter((entry) => entry.time).sort(comparePlanTimedMeta)
  if (timed.length <= 1) return list
  let timedIndex = 0
  return meta.map((entry) => (entry.time ? timed[timedIndex++]?.row ?? entry.row : entry.row))
}

function sortItemsByTimeAndOrder(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length <= 1) return list
  const meta = list.map((row, idx) => buildPlanOrderMeta(row, idx))
  const hasSortOrder = meta.some((item) => item.sortOrder != null)
  if (hasSortOrder) {
    const ordered = [...meta]
      .sort((a, b) => {
        const oa = a.sortOrder
        const ob = b.sortOrder
        if (!(oa == null && ob == null)) {
          if (oa == null) return 1
          if (ob == null) return -1
          if (oa !== ob) return oa - ob
        }
        return comparePlanRowFallbackMeta(a, b)
      })
      .map((entry) => entry.row)
    return enforceTimedPlanOrderInSlots(ordered)
  }
  return [...meta]
    .sort((a, b) => {
      if (a.time || b.time) {
        if (a.time && !b.time) return -1
        if (!a.time && b.time) return 1
        return comparePlanTimedMeta(a, b)
      }
      return comparePlanRowFallbackMeta(a, b)
    })
    .map((entry) => entry.row)
}

function dedupeRowsById(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length <= 1) return list
  const seen = new Set()
  const next = []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i]
    const key = String(row?.id ?? "").trim()
    if (!key) {
      next.push(row)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    next.push(row)
  }
  return next.reverse()
}

function getPlanBucketKey(row) {
  const entryMeta = getPlanEntryMeta(row?.content)
  const isTask = entryMeta.entryType === "task"
  const repeatMeta = normalizeRepeatMeta(row ?? {})
  const isRecurring =
    repeatMeta.repeatType !== "none" ||
    Boolean(String(row?.series_id ?? row?.seriesId ?? "").trim()) ||
    Boolean(row?.has_recurrence_hint)

  if (!isTask && !isRecurring) return "plan"
  if (!isTask && isRecurring) return "recurring-plan"
  if (isTask && !isRecurring) return "task"
  return "recurring-task"
}

function isRecurringPlanRowForMove(row) {
  const repeatMeta = normalizeRepeatMeta(row ?? {})
  return (
    repeatMeta.repeatType !== "none" ||
    Boolean(String(repeatMeta.seriesId ?? row?.series_id ?? row?.seriesId ?? "").trim()) ||
    Boolean(row?.has_recurrence_hint)
  )
}

function planRowHasStartTime(row) {
  return Boolean(normalizePlanTimeRange(row).time)
}

function isMovableNoTimePlanRow(row) {
  if (isRecurringPlanRowForMove(row) && planRowHasStartTime(row)) return false
  return isVisibleSchedulePlanRow(row)
}

function getPlanMoveBlockedMessage(row) {
  if (isRecurringPlanRowForMove(row)) {
    if (planRowHasStartTime(row)) return "시간 있는 반복 일정은 시간순으로 고정돼요."
    return "반복 일정은 같은 날짜 안에서만 순서를 바꿀 수 있어요."
  }
  return "이 항목은 드래그로 이동할 수 없어요."
}

function renderTaskTimeClock(isDark = false, variant = "calendar") {
  const baseStyle =
    variant === "sheet"
      ? styles.tasksSheetTimeClock
      : variant === "list"
        ? styles.itemTaskTimeClock
        : styles.calendarTaskTimeClock
  const darkStyle =
    variant === "sheet"
      ? styles.tasksSheetTimeClockDark
      : variant === "list"
        ? styles.itemTaskTimeClockDark
        : styles.calendarTaskTimeClockDark
  const hourStyle =
    variant === "sheet"
      ? styles.tasksSheetTimeClockHour
      : variant === "list"
        ? styles.itemTaskTimeClockHour
        : styles.calendarTaskTimeClockHour
  const minuteStyle =
    variant === "sheet"
      ? styles.tasksSheetTimeClockMinute
      : variant === "list"
        ? styles.itemTaskTimeClockMinute
        : styles.calendarTaskTimeClockMinute
  return (
    <View
      pointerEvents="none"
      style={[
        baseStyle,
        isDark ? darkStyle : null
      ]}
    >
      <View
        style={[
          hourStyle,
          isDark ? styles.calendarTaskTimeClockHandDark : null
        ]}
      />
      <View
        style={[
          minuteStyle,
          isDark ? styles.calendarTaskTimeClockHandDark : null
        ]}
      />
    </View>
  )
}

function renderTaskMarkerContent(row, completed, isDark = false, variant = "list") {
  const markerRow = row?.row ?? row
  if (completed) {
    const checkedStyle =
      variant === "calendar"
        ? [styles.calendarTaskMarkerText, isDark ? styles.calendarTaskMarkerTextDark : null]
        : variant === "sheet"
          ? [styles.tasksSheetCheckText, styles.tasksSheetCheckTextActive]
          : styles.itemTaskToggleTick
    return <Text style={checkedStyle}>✓</Text>
  }
  const hasTime = Boolean(normalizePlanTimeRange(markerRow).time)
  if (!hasTime) return null
  return renderTaskTimeClock(isDark, variant === "sheet" ? "sheet" : variant === "calendar" ? "calendar" : "list")
}

function buildPlanDragPreview(item, colorByTitle, gesture, layout = {}, options = {}) {
  const screen = Dimensions.get("window")
  const minWidth = Math.max(1, Number(options?.minWidth) || 168)
  const maxWidth = Math.max(minWidth, Number(options?.maxWidth) || Math.max(168, screen.width - 18))
  const minHeight = Math.max(1, Number(options?.minHeight) || 34)
  const maxHeight = Math.max(minHeight, Number(options?.maxHeight) || 72)
  const width = clamp(Number(layout?.width) || Math.round(screen.width * 0.68), minWidth, maxWidth)
  const height = clamp(Number(layout?.height) || 42, minHeight, maxHeight)
  const moveX = Number(gesture?.moveX) || 0
  const moveY = Number(gesture?.moveY) || 0
  const gap = Number.isFinite(Number(options?.gap)) ? Number(options.gap) : 8
  const x = moveX - width / 2
  const y = options?.anchor === "above" ? moveY - height - gap : moveY - height / 2
  const category = String(item?.category_id ?? "").trim()
  const isGeneral = !category || category === "__general__"
  const color = !isGeneral ? colorByTitle?.get?.(category) || "#94a3b8" : "#94a3b8"
  return {
    id: String(item?.id ?? "").trim(),
    x: clamp(x, 8, Math.max(8, screen.width - width - 8)),
    y: clamp(y, 8, Math.max(8, screen.height - height - 8)),
    width,
    time: buildPlanTimeTextFromRow(item),
    title: getPlanDisplayText(item),
    category: isGeneral ? "" : category,
    color,
    compact: Boolean(options?.compact)
  }
}

function getResponderScreenPoint(evt, gesture = {}, options = {}) {
  const native = evt?.nativeEvent ?? {}
  const pageX = Number(native.pageX)
  const pageY = Number(native.pageY)
  const moveX = Number(gesture?.moveX)
  const moveY = Number(gesture?.moveY)
  const x0 = Number(gesture?.x0)
  const y0 = Number(gesture?.y0)
  const preferGesture = Boolean(options?.preferGesture)
  const nextPageX = preferGesture
    ? Number.isFinite(moveX) && moveX > 0
      ? moveX
      : Number.isFinite(pageX) && pageX > 0
        ? pageX
        : Number.isFinite(x0)
          ? x0
          : 0
    : Number.isFinite(pageX) && pageX > 0
      ? pageX
      : Number.isFinite(moveX) && moveX > 0
        ? moveX
        : Number.isFinite(x0)
          ? x0
          : 0
  const nextPageY = preferGesture
    ? Number.isFinite(moveY) && moveY > 0
      ? moveY
      : Number.isFinite(pageY) && pageY > 0
        ? pageY
        : Number.isFinite(y0)
          ? y0
          : 0
    : Number.isFinite(pageY) && pageY > 0
      ? pageY
      : Number.isFinite(moveY) && moveY > 0
        ? moveY
        : Number.isFinite(y0)
          ? y0
          : 0
  return {
    pageX: nextPageX,
    pageY: nextPageY
  }
}

const PLAN_BUCKET_ORDER = ["plan", "recurring-plan", "task", "recurring-task"]
const PLAN_BUCKET_LABELS = {
  plan: "일정",
  "recurring-plan": "반복 일정",
  task: "Task",
  "recurring-task": "반복 Task"
}

function groupPlanRowsByBuckets(items) {
  const grouped = new Map(PLAN_BUCKET_ORDER.map((key) => [key, []]))
  for (const row of Array.isArray(items) ? items : []) {
    const key = getPlanBucketKey(row)
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }
  return grouped
}

function orderRowsByBuckets(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length <= 1) return list
  const buckets = groupPlanRowsByBuckets(list)
  return PLAN_BUCKET_ORDER.flatMap((key) => {
    const bucketRows = buckets.get(key) ?? []
    if (key !== "task" && key !== "recurring-task") return bucketRows
    const pending = []
    const completed = []
    for (const row of bucketRows) {
      const parsed = parsePlanMetaSuffixes(row?.content)
      if (parsed.completed === true) completed.push(row)
      else pending.push(row)
    }
    return [...pending, ...completed]
  })
}

function buildPlanBucketSections(items) {
  const buckets = groupPlanRowsByBuckets(items)
  return PLAN_BUCKET_ORDER
    .map((key) => ({
      key,
      title: PLAN_BUCKET_LABELS[key] ?? key,
      items: (buckets.get(key) ?? []).filter((row) => hasVisiblePlanDisplayText(row))
    }))
    .filter((section) => section.items.length > 0)
}

function replacePlanBucketRows(items, bucketKey, nextBucketRows) {
  const buckets = groupPlanRowsByBuckets(items)
  buckets.set(bucketKey, Array.isArray(nextBucketRows) ? nextBucketRows : [])
  return PLAN_BUCKET_ORDER.flatMap((key) => buckets.get(key) ?? [])
}

function buildTaskOrderedRows(items) {
  return sortItemsByTimeAndOrder(items)
}

function buildTaskGroupedListRows(items, dateKey = "", options = {}) {
  void dateKey
  void options
  return buildTaskOrderedRows(items)
}

function getListSectionRowGroupKey(item) {
  if (!item) return ""
  if (item.__reorder) return "reorder"
  if (item.__taskDivider) return "__task-divider"
  if (item.__bucketDivider) return "__bucket-divider"
  return getPlanBucketKey(item)
}

function getListSectionSeparatorTone(item, nextItem) {
  if (!item || !nextItem) return "none"
  const currentGroup = getListSectionRowGroupKey(item)
  const nextGroup = getListSectionRowGroupKey(nextItem)
  if (!currentGroup || !nextGroup) return "soft"
  return currentGroup === nextGroup ? "soft" : "strong"
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
  entryType = "task",
  taskCompleted = false,
  category = "__general__",
  alarmEnabled = true,
  alarmLeadMinutes = 0,
  repeatType = "none",
  repeatInterval = 1,
  repeatDays = [],
  repeatUntil = ""
}) {
  const normalizedRepeatType = normalizeRepeatType(repeatType)
  const normalizedEntryType = normalizePlanEntryType(entryType)
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
    entryType: normalizedEntryType,
    taskCompleted: normalizedEntryType === "task" ? Boolean(taskCompleted) : false,
    category: String(category ?? "__general__") || "__general__",
    alarmEnabled: normalizedAlarmEnabled,
    alarmLeadMinutes: normalizedAlarmEnabled ? normalizeAlarmLeadMinutes(alarmLeadMinutes) : 0,
    repeatType: normalizedRepeatType,
    repeatInterval: normalizedRepeatInterval,
    repeatDays: normalizedRepeatType === "weekly" ? normalizeRepeatDays(repeatDays) : [],
    repeatUntil: normalizedRepeatType === "none" ? "" : String(repeatUntil ?? "").trim()
  }
}

function HeaderQuickSheet({ visible, title, hint = "", actions = [], tone = "light", onClose }) {
  const isDark = tone === "dark"
  const insets = useSafeAreaInsets()
  const sheetBottomInset = useMemo(
    () => (Platform.OS === "android" ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 22)),
    [insets.bottom]
  )
  const actionList = useMemo(() => (Array.isArray(actions) ? actions.filter(Boolean) : []), [actions])

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View
          style={[
            styles.sheetCard,
            styles.headerQuickSheetCard,
            isDark ? styles.sheetCardDark : null,
            { marginBottom: sheetBottomInset }
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.tasksSheetHeaderCopy}>
              <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>{title}</Text>
              {hint ? <Text style={[styles.tasksSheetHint, isDark ? styles.textMutedDark : null]}>{hint}</Text> : null}
            </View>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onClose} style={[styles.sheetBtnGhost, isDark ? styles.sheetBtnGhostDark : null]}>
                <Text style={[styles.sheetBtnGhostText, isDark ? styles.textDark : null]}>닫기</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.headerQuickActions}>
            {actionList.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => {
                  onClose?.()
                  requestAnimationFrame(() => action.onPress?.())
                }}
                style={[
                  styles.headerQuickAction,
                  isDark ? styles.headerQuickActionDark : null,
                  action.danger ? styles.headerQuickActionDanger : null
                ]}
              >
                <View style={styles.headerQuickActionCopy}>
                  <Text
                    style={[
                      styles.headerQuickActionTitle,
                      isDark ? styles.textDark : null,
                      action.danger ? styles.headerQuickActionTitleDanger : null
                    ]}
                  >
                    {action.label}
                  </Text>
                  {action.description ? (
                    <Text style={[styles.headerQuickActionHint, isDark ? styles.textMutedDark : null]}>{action.description}</Text>
                  ) : null}
                </View>
                {action.badge ? (
                  <View style={[styles.headerQuickActionBadge, isDark ? styles.headerQuickActionBadgeDark : null]}>
                    <Text style={styles.headerQuickActionBadgeText}>{action.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
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
  const HeaderLeftTag = onToday ? Pressable : View

  return (
    <>
      <View style={[styles.header, isDark ? styles.headerDark : null]}>
        <HeaderLeftTag
          style={[styles.headerLeft, onToday ? styles.headerLeftPressable : null]}
          onPress={onToday ?? undefined}
          accessibilityRole={onToday ? "button" : undefined}
          accessibilityLabel={onToday ? "오늘로 이동" : undefined}
        >
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
        </HeaderLeftTag>
        <View style={[styles.headerButtons, buttonsStyle]}>
          {onToday && todayLabel ? (
            <TouchableOpacity
              style={[
                styles.headerTodayButton,
                styles.headerTasksButtonActive,
                isDark ? styles.headerTasksButtonActiveDark : null
              ]}
              onPress={onToday}
              accessibilityRole="button"
              accessibilityLabel="Today"
            >
              <Text style={[styles.headerTodayText, isDark ? styles.headerTodayTextDark : null]}>{todayLabel}</Text>
            </TouchableOpacity>
          ) : null}
          {onSignOut ? (
            <TouchableOpacity
              style={[
                styles.headerTasksButton,
                styles.headerTasksButtonActive,
                isDark ? styles.headerTasksButtonActiveDark : null
              ]}
              onPress={onSignOut}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Text style={[styles.ghostButtonText, isDark ? styles.ghostButtonTextDark : null]}>{"\u2699"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </>
  )
}

function SettingsSheet({
  visible,
  themeMode,
  listFontScale = UI_FONT_SCALE_DEFAULT,
  memoFontScale = UI_FONT_SCALE_DEFAULT,
  calendarFontScale = UI_FONT_SCALE_DEFAULT,
  tabFontScale = UI_FONT_SCALE_DEFAULT,
  onChangeTheme,
  onChangeListFontScale,
  onChangeMemoFontScale,
  onChangeCalendarFontScale,
  onChangeTabFontScale,
  onRefresh,
  onLogout,
  onDeleteAccount,
  deleteAccountLoading = false,
  onClose
}) {
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
  const fontSettingRows = useMemo(
    () => [
      {
        key: "list",
        label: "리스트 글씨",
        value: listFontScale,
        onChange: onChangeListFontScale
      },
      {
        key: "memo",
        label: "메모 글씨",
        value: memoFontScale,
        onChange: onChangeMemoFontScale
      },
      {
        key: "calendar",
        label: "달력 글씨",
        value: calendarFontScale,
        onChange: onChangeCalendarFontScale
      },
      {
        key: "tab",
        label: "탭 제목 글씨",
        value: tabFontScale,
        onChange: onChangeTabFontScale
      }
    ],
    [
      listFontScale,
      memoFontScale,
      calendarFontScale,
      tabFontScale,
      onChangeListFontScale,
      onChangeMemoFontScale,
      onChangeCalendarFontScale,
      onChangeTabFontScale
    ]
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

            {fontSettingRows.map((row) => {
              const selectedScale = normalizeUiFontPresetScale(row.value)
              return (
                <View key={row.key} style={[styles.settingsRow, styles.settingsRowStack]}>
                  <View style={styles.settingsLabelBlock}>
                    <Text style={[styles.settingsLabel, isDark ? styles.textDark : null]}>{row.label}</Text>
                    <Text style={[styles.settingsValue, isDark ? styles.textMutedDark : null]}>
                      {getUiFontPresetLabel(selectedScale)}
                    </Text>
                  </View>
                  <View style={[styles.settingsSegment, isDark ? styles.settingsSegmentDark : null]}>
                    {UI_FONT_SCALE_PRESETS.map((preset) => {
                      const active = Math.abs(selectedScale - preset.scale) < 0.001
                      return (
                        <Pressable
                          key={`${row.key}-${preset.key}`}
                          onPress={() => row.onChange?.(preset.scale)}
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
                            {preset.label}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              )
            })}

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

            {onDeleteAccount ? (
              <Pressable
                style={[styles.settingsDeleteAccountBtn, deleteAccountLoading ? styles.settingsDeleteAccountBtnDisabled : null]}
                onPress={onDeleteAccount}
                disabled={deleteAccountLoading}
              >
                <Text style={styles.settingsDeleteAccountText}>{deleteAccountLoading ? "탈퇴 중..." : "계정 탈퇴"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function TasksSheet({ visible, tone = "light", tasks = [], onToggleTask, onOpenTask, onAddTask, onDeleteTask, onClose }) {
  const isDark = tone === "dark"
  const insets = useSafeAreaInsets()
  const sheetBottomInset = useMemo(
    () => (Platform.OS === "android" ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 22)),
    [insets.bottom]
  )
  const taskList = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks])
  const pendingTasks = useMemo(() => taskList.filter((item) => !item?.completed), [taskList])
  const completedTasks = useMemo(() => taskList.filter((item) => Boolean(item?.completed)), [taskList])

  function renderDeleteAction(item) {
    if (typeof onDeleteTask !== "function") return null
    return (
      <Pressable
        onPress={() => onDeleteTask?.(item)}
        style={[styles.tasksSheetDeleteSwipeAction, isDark ? styles.tasksSheetDeleteSwipeActionDark : null]}
      >
        <Text style={styles.tasksSheetDeleteSwipeText}>×</Text>
      </Pressable>
    )
  }

  function renderTaskItem(item) {
    const completed = Boolean(item?.completed)
    const card = (
      <View style={[styles.tasksSheetItem, isDark ? styles.tasksSheetItemDark : null]}>
        <Pressable
          onPress={() => onToggleTask?.(item)}
          style={[
            styles.tasksSheetCheck,
            completed ? styles.tasksSheetCheckActive : null,
            isDark ? styles.tasksSheetCheckDark : null,
            completed && isDark ? styles.tasksSheetCheckActiveDark : null
          ]}
          accessibilityRole="button"
          accessibilityLabel={completed ? "완료 해제" : "완료"}
        >
          {renderTaskMarkerContent(item?.row ?? item, completed, isDark, "sheet")}
        </Pressable>
        <Pressable onPress={() => onOpenTask?.(item)} style={styles.tasksSheetItemBody}>
          <View style={styles.tasksSheetTitleRow}>
            {item?.repeatLabel ? (
              <View style={[styles.tasksSheetMetaPill, isDark ? styles.tasksSheetMetaPillDark : null]}>
                <Text style={[styles.tasksSheetMetaPillText, isDark ? styles.textMutedDark : null]}>{item.repeatLabel}</Text>
              </View>
            ) : null}
            <Text
              style={[
                styles.tasksSheetItemTitle,
                isDark ? styles.textDark : null,
                completed ? styles.tasksSheetItemTitleDone : null
              ]}
            >
              {item?.display}
            </Text>
          </View>
          <View style={styles.tasksSheetMetaRow}>
            <Text style={[styles.tasksSheetMetaText, isDark ? styles.textMutedDark : null]}>{item?.dateKey}</Text>
            {item?.time ? (
              <Text style={[styles.tasksSheetMetaText, isDark ? styles.textMutedDark : null]}>{item.time}</Text>
            ) : null}
            {item?.title ? (
              <Text style={[styles.tasksSheetMetaText, isDark ? styles.textMutedDark : null]}>{`[${item.title}]`}</Text>
            ) : null}
          </View>
        </Pressable>
        {typeof onDeleteTask === "function" ? (
          <Pressable
            onPress={() => onDeleteTask?.(item)}
            style={[styles.tasksSheetDeleteBtn, isDark ? styles.tasksSheetDeleteBtnDark : null]}
          >
            <Text style={styles.tasksSheetDeleteBtnText}>×</Text>
          </Pressable>
        ) : null}
      </View>
    )
    if (typeof onDeleteTask !== "function") {
      return (
        <View key={item?.id} style={styles.tasksSheetItemWrap}>
          {card}
        </View>
      )
    }
    return (
      <Swipeable
        key={item?.id}
        overshootRight={false}
        renderRightActions={() => renderDeleteAction(item)}
        containerStyle={styles.tasksSheetItemWrap}
      >
        {card}
      </Swipeable>
    )
  }

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View
          style={[
            styles.sheetCard,
            styles.tasksSheetCard,
            isDark ? styles.sheetCardDark : null,
            { marginBottom: sheetBottomInset }
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.tasksSheetHeaderCopy}>
              <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>Task</Text>
              <Text style={[styles.tasksSheetHint, isDark ? styles.textMutedDark : null]}>
                {taskList.length > 0
                  ? `미완료 ${pendingTasks.length}개 · 완료 ${completedTasks.length}개`
                  : "일정 편집 화면에서 Task를 선택하면 여기서 모아볼 수 있습니다."}
              </Text>
            </View>
            <View style={styles.sheetHeaderRight}>
              {typeof onAddTask === "function" ? (
                <Pressable onPress={onAddTask} style={styles.sheetBtnPrimary}>
                  <Text style={styles.sheetBtnPrimaryText}>Task 추가</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={[styles.sheetBtnGhost, isDark ? styles.sheetBtnGhostDark : null]}>
                <Text style={[styles.sheetBtnGhostText, isDark ? styles.textDark : null]}>닫기</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.tasksSheetScroll} contentContainerStyle={styles.tasksSheetContent}>
            {pendingTasks.length ? (
              <View style={styles.tasksSheetSection}>
                <View style={styles.tasksSheetSectionHeader}>
                  <Text style={[styles.tasksSheetSectionTitle, isDark ? styles.textDark : null]}>할 일</Text>
                </View>
                {pendingTasks.map(renderTaskItem)}
              </View>
            ) : null}

            {completedTasks.length ? (
              <View style={styles.tasksSheetSection}>
                <View style={styles.tasksSheetSectionHeader}>
                  <Text style={[styles.tasksSheetSectionTitle, isDark ? styles.textDark : null]}>완료</Text>
                  <Text style={[styles.tasksSheetSectionCount, isDark ? styles.textMutedDark : null]}>
                    {completedTasks.length}개
                  </Text>
                </View>
                {completedTasks.map(renderTaskItem)}
              </View>
            ) : null}

            {taskList.length === 0 ? (
              <View style={[styles.tasksSheetEmpty, isDark ? styles.tasksSheetEmptyDark : null]}>
                <Text style={[styles.tasksSheetEmptyTitle, isDark ? styles.textDark : null]}>표시할 항목이 없습니다.</Text>
                <Text style={[styles.tasksSheetEmptyText, isDark ? styles.textMutedDark : null]}>
                  일정 추가/수정 화면에서 Task를 선택하세요.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </GestureHandlerRootView>
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
  tone = "light",
  fontScale = UI_FONT_SCALE_DEFAULT
}) {
  const isDark = tone === "dark"
  const tabTextScale = useMemo(() => clampUiFontScale(fontScale), [fontScale])
  const tabTextSizeStyle = useMemo(
    () => ({ fontSize: scaleFontSize(13, tabTextScale) }),
    [tabTextScale]
  )
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
    if (global?.nativeFabricUIManager) return
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
      tabTextSizeStyle,
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
        delayLongPress={260}
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
  listFontScale = UI_FONT_SCALE_DEFAULT,
  tabFontScale = UI_FONT_SCALE_DEFAULT,
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
  onMovePlan,
  onQuickDeletePlan,
  onTasks,
  tasksCount = 0,
  onToggleTask
}) {
  const scale = useMemo(() => {
    return clampUiFontScale(listFontScale)
  }, [listFontScale])
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
  const headerSubtitle = formatTodayHeaderText(today)
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
  const [listDragRefreshKey, setListDragRefreshKey] = useState(0)
  const flatDragItemIdRef = useRef("")
  const listScrollOffsetRef = useRef(0)
  const pendingListScrollRestoreRef = useRef(null)
  const [dragPreview, setDragPreview] = useState(null)
  const suppressPressRef = useRef(false)
  const listSectionNodesRef = useRef({})
  const listRowNodesRef = useRef({})
  const listSectionLayoutsRef = useRef({})
  const listRowLayoutsRef = useRef({})

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
      const list = (Array.isArray(items) ? items : []).filter((item) => isVisibleSchedulePlanRow(item))
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

  function measureListSection(dateKey, node) {
    const key = String(dateKey ?? "").trim()
    if (!key || !node || typeof node.measureInWindow !== "function") return
    listSectionNodesRef.current[key] = node
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        listSectionLayoutsRef.current[key] = { x, y, width, height }
      })
    })
  }

  function measureListRow(dateKey, itemId, node) {
    const key = String(dateKey ?? "").trim()
    const id = String(itemId ?? "").trim()
    if (!key || !id || !node || typeof node.measureInWindow !== "function") return
    listRowNodesRef.current[id] = { node, dateKey: key }
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        listRowLayoutsRef.current[id] = { id, dateKey: key, x, y, width, height }
      })
    })
  }

  function measureNodeInWindow(node) {
    return new Promise((resolve) => {
      if (!node || typeof node.measureInWindow !== "function") {
        resolve(null)
        return
      }
      node.measureInWindow((x, y, width, height) => {
        resolve({ x, y, width, height })
      })
    })
  }

  async function measureListLayoutsNow() {
    const sectionEntries = Object.entries(listSectionNodesRef.current ?? {})
    const rowEntries = Object.entries(listRowNodesRef.current ?? {})
    await Promise.all(
      sectionEntries.map(async ([key, node]) => {
        const layout = await measureNodeInWindow(node)
        if (layout) listSectionLayoutsRef.current[key] = layout
      })
    )
    await Promise.all(
      rowEntries.map(async ([id, entry]) => {
        const layout = await measureNodeInWindow(entry?.node)
        if (layout) listRowLayoutsRef.current[id] = { id, dateKey: entry?.dateKey, ...layout }
      })
    )
  }

  function findListDropTarget(moveY, fallbackDateKey, movingId = "") {
    const fallback = String(fallbackDateKey ?? "").trim()
    const sectionBounds = visibleSections
      .map((section) => {
        const dateKey = String(section?.title ?? "").trim()
        if (!dateKey) return null
        const sectionLayout = listSectionLayoutsRef.current?.[dateKey]
        const rowLayouts = Object.values(listRowLayoutsRef.current ?? {}).filter((layout) => layout?.dateKey === dateKey)
        const yValues = [
          sectionLayout ? sectionLayout.y : null,
          ...rowLayouts.map((layout) => layout.y)
        ].filter((value) => Number.isFinite(value))
        const bottomValues = [
          sectionLayout ? sectionLayout.y + sectionLayout.height : null,
          ...rowLayouts.map((layout) => layout.y + layout.height)
        ].filter((value) => Number.isFinite(value))
        if (!yValues.length || !bottomValues.length) return null
        return {
          dateKey,
          y: Math.min(...yValues),
          bottom: Math.max(...bottomValues)
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y)
    if (!sectionBounds.length) return fallback ? { dateKey: fallback, index: 0 } : null

    const containing = sectionBounds.find((section) => moveY >= section.y && moveY <= section.bottom)
    const targetSection =
      containing ??
      sectionBounds.reduce((best, section) => {
        if (!best) return section
        const sectionDistance = Math.min(Math.abs(moveY - section.y), Math.abs(moveY - section.bottom))
        const bestDistance = Math.min(Math.abs(moveY - best.y), Math.abs(moveY - best.bottom))
        return sectionDistance < bestDistance ? section : best
      }, null)
    const dateKey = String(targetSection?.dateKey ?? fallback).trim()
    if (!dateKey) return null
    const rowLayouts = Object.values(listRowLayoutsRef.current ?? {})
      .filter((layout) => layout?.dateKey === dateKey && String(layout?.id ?? "") !== String(movingId ?? ""))
      .sort((a, b) => a.y - b.y)
    let index = 0
    for (const layout of rowLayouts) {
      if (moveY > layout.y + layout.height / 2) index += 1
    }
    return { dateKey, index }
  }

  function createListDragHandlers(item, dateKey) {
    const id = String(item?.id ?? "").trim()
    if (!id || !onMovePlan) return null
    let didMove = false
    let blocked = false
    let activated = false
    let startPoint = null
    let latestPoint = null
    let longPressTimer = null
    const clearLongPressTimer = () => {
      if (!longPressTimer) return
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    const activateDrag = (evt, gesture = {}) => {
      if (activated) return
      activated = true
      blocked = !isMovableNoTimePlanRow(item)
      suppressPressRef.current = true
      if (blocked) return
      const point = getResponderScreenPoint(evt, gesture)
      latestPoint =
        point.pageX || point.pageY
          ? point
          : {
              pageX: Number(startPoint?.pageX) || 0,
              pageY: Number(startPoint?.pageY) || 0
            }
      setDraggingId(id)
      setDragPreview(
        buildPlanDragPreview(
          item,
          colorByTitle,
          {
            moveX: latestPoint.pageX,
            moveY: latestPoint.pageY,
            startX: startPoint?.pageX,
            startY: startPoint?.pageY
          },
          listRowLayoutsRef.current?.[id]
        )
      )
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        return activated || distance > 4
      },
      onMoveShouldSetPanResponderCapture: (_evt, gesture) => {
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        return activated || distance > 4
      },
      onPanResponderGrant: (evt) => {
        didMove = false
        blocked = false
        activated = false
        startPoint = getResponderScreenPoint(evt)
        latestPoint = startPoint
        clearLongPressTimer()
        longPressTimer = setTimeout(() => {
          activateDrag(null)
        }, 260)
      },
      onPanResponderMove: (_evt, gesture) => {
        const point = getResponderScreenPoint(_evt, gesture)
        if (point.pageX || point.pageY) latestPoint = point
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        if (!activated && distance > 12) {
          clearLongPressTimer()
        }
        if (!activated) return
        const pointDistance = Math.max(
          Math.abs((latestPoint?.pageX ?? 0) - (startPoint?.pageX ?? 0)),
          Math.abs((latestPoint?.pageY ?? 0) - (startPoint?.pageY ?? 0))
        )
        if (distance > 2 || pointDistance > 2) {
          didMove = true
          if (!blocked) {
            setDraggingId(id)
            setDragPreview(
              buildPlanDragPreview(
                item,
                colorByTitle,
                {
                  moveX: latestPoint?.pageX,
                  moveY: latestPoint?.pageY,
                  startX: startPoint?.pageX,
                  startY: startPoint?.pageY
                },
                listRowLayoutsRef.current?.[id]
              )
            )
          }
        }
      },
      onPanResponderRelease: async (_evt, gesture) => {
        clearLongPressTimer()
        setDraggingId(null)
        setDragPreview(null)
        if (!activated) {
          suppressPressRef.current = false
          onEditPlan?.(item)
          return
        }
        if (blocked) {
          showMoveBlockedAlert(item)
          setTimeout(() => {
            suppressPressRef.current = false
          }, 180)
          return
        }
        if (!didMove) {
          setTimeout(() => {
            suppressPressRef.current = false
          }, 120)
          return
        }
        await measureListLayoutsNow()
        const target = findListDropTarget(latestPoint?.pageY ?? gesture.moveY, dateKey, id)
        if (target?.dateKey) {
          await onMovePlan?.(item, target.dateKey, target.index)
        }
        setTimeout(() => {
          suppressPressRef.current = false
        }, 120)
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer()
        setDraggingId(null)
        setDragPreview(null)
        setTimeout(() => {
          suppressPressRef.current = false
        }, 120)
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true
    })
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
    const rawItems = (Array.isArray(sourceItems) ? sourceItems : getAllItemsForDate(key)).filter((row) =>
      isVisibleSchedulePlanRow(row)
    )
    const items = buildTaskOrderedRows(sortItemsByTimeAndOrder(rawItems))
    setReorderState({ visible: true, dateKey: key })
    setReorderItems(items)
    reorderItemsRef.current = items
    reorderOriginalIdsRef.current = items
      .map((item) => String(item?.id ?? "").trim())
      .filter(Boolean)
    setDraggingId(null)
    setReorderSaving(false)
  }

  function closeReorderModal() {
    setReorderState({ visible: false, dateKey: "" })
    setReorderItems([])
    reorderItemsRef.current = []
    reorderOriginalIdsRef.current = []
    setDraggingId(null)
    setReorderSaving(false)
    suppressPressRef.current = false
  }

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
          if (draggingId && String(draggingId) === id) setDraggingId(null)
          if (next.length === 0) closeReorderModal()
        }
      }
    ])
  }

  function showMoveBlockedAlert(item) {
    Alert.alert("이동할 수 없어요", getPlanMoveBlockedMessage(item))
  }

  function scrollToToday() {
    const exactIndex = visibleFlatRows.findIndex((row) => row?.__dateHeader && row.dateKey === todayKey)
    const nextIndex =
      exactIndex !== -1
        ? exactIndex
        : visibleFlatRows.findIndex((row) => row?.__dateHeader && String(row?.dateKey ?? "") > todayKey)
    const fallbackIndex = nextIndex !== -1 ? nextIndex : visibleFlatRows.length > 0 ? visibleFlatRows.length - 1 : -1
    const index = fallbackIndex
    if (index === -1) return false
    listRef.current?.scrollToIndex?.({
      index,
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
    const nextSections = (sections ?? [])
      .filter((section) => String(section.title ?? "").startsWith(prefix))
      .map((section) => {
        const key = String(section?.title ?? "")
        const baseData = applyListFilter(section?.data ?? [])
        if (activeKey && key === activeKey) {
          const reorderData = [{ id: `__reorder__-${key}`, __reorder: true, date: key }]
          return {
            ...section,
            rawData: baseData,
            data: reorderData
          }
        }
        return {
          ...section,
          rawData: baseData,
          data: buildTaskGroupedListRows(baseData, key, { showBucketDividers: false })
        }
      })
      .filter((section) => (section?.data?.length ?? 0) > 0)

    return nextSections
  }, [sections, viewYear, viewMonth, applyListFilter, reorderState])

  const visibleFlatRows = useMemo(() => {
    const rows = []
    for (let sectionIndex = 0; sectionIndex < (visibleSections ?? []).length; sectionIndex += 1) {
      const section = visibleSections[sectionIndex]
      const dateKey = String(section?.title ?? "").trim()
      if (!dateKey) continue
      rows.push({
        id: `__date__-${dateKey}`,
        __dateHeader: true,
        dateKey,
        isFirstSection: sectionIndex === 0,
        section
      })
      const data = Array.isArray(section?.data) ? section.data : []
      for (const row of data) {
        if (!row || row.__reorder || row.__taskDivider || row.__bucketDivider) continue
        const rowId = String(row?.id ?? `${row?.date}-${row?.content}`).trim()
        rows.push({
          id: `plan-${dateKey}-${rowId}`,
          __planRow: true,
          dateKey,
          plan: row,
          section
        })
      }
    }
    return rows
  }, [visibleSections])

  const visibleFlatListKey = useMemo(
    () => `planner-list-${viewYear}-${viewMonth}-${listDragRefreshKey}`,
    [listDragRefreshKey, viewMonth, viewYear]
  )

  useEffect(() => {
    const restoreOffset = pendingListScrollRestoreRef.current
    if (restoreOffset == null) return undefined
    pendingListScrollRestoreRef.current = null

    let cancelled = false
    const restore = () => {
      if (cancelled) return
      const offset = Math.max(0, Number(restoreOffset) || 0)
      listRef.current?.scrollToOffset?.({ offset, animated: false })
    }
    const rafId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(restore) : null
    const timers = [setTimeout(restore, 40), setTimeout(restore, 140)]
    return () => {
      cancelled = true
      if (rafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId)
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [listDragRefreshKey])

  function refreshFlatListPreservingScroll() {
    pendingListScrollRestoreRef.current = Math.max(0, Number(listScrollOffsetRef.current) || 0)
    setListDragRefreshKey((prev) => prev + 1)
  }

  function getFlatDropInfo(data, movedId) {
    const movedKey = String(movedId ?? "").trim()
    if (!movedKey) return null
    let currentDate = ""
    let indexInDate = 0
    for (const row of Array.isArray(data) ? data : []) {
      if (row?.__dateHeader) {
        currentDate = String(row?.dateKey ?? "").trim()
        indexInDate = 0
        continue
      }
      if (!row?.__planRow) continue
      if (!currentDate) currentDate = String(row?.dateKey ?? row?.plan?.date ?? "").trim()
      const rowId = String(row?.plan?.id ?? "").trim()
      if (rowId === movedKey) {
        return { dateKey: currentDate || String(row?.plan?.date ?? "").trim(), index: indexInDate }
      }
      indexInDate += 1
    }
    return null
  }

  function getFlatPlanRowsForDate(dateKey, excludeId = "") {
    const key = String(dateKey ?? "").trim()
    const blockedId = String(excludeId ?? "").trim()
    if (!key) return []
    return (visibleFlatRows ?? [])
      .filter((row) => row?.__planRow && String(row?.dateKey ?? row?.plan?.date ?? "").trim() === key)
      .map((row) => row?.plan)
      .filter((row) => row && String(row?.id ?? "").trim() !== blockedId)
  }

  function getFlatPlanIndexInDate(dateKey, planId) {
    const key = String(dateKey ?? "").trim()
    const id = String(planId ?? "").trim()
    if (!key || !id) return -1
    let index = 0
    for (const row of visibleFlatRows ?? []) {
      if (!row?.__planRow) continue
      const rowDate = String(row?.dateKey ?? row?.plan?.date ?? "").trim()
      if (rowDate !== key) continue
      if (String(row?.plan?.id ?? "").trim() === id) return index
      index += 1
    }
    return -1
  }

  function normalizeFlatTimedDrop(item, drop) {
    const dateKey = String(drop?.dateKey ?? "").trim()
    const itemId = String(item?.id ?? "").trim()
    if (!dateKey || !itemId) return null
    const rows = getFlatPlanRowsForDate(dateKey, itemId)
    const requestedIndex = clamp(Math.round(Number(drop?.index) || 0), 0, rows.length)
    const movingTime = normalizePlanTimeRange(item).time
    if (!movingTime) return { dateKey, index: requestedIndex, corrected: false }

    let minIndex = 0
    let maxIndex = rows.length
    for (let index = 0; index < rows.length; index += 1) {
      const rowTime = normalizePlanTimeRange(rows[index]).time
      if (!rowTime) continue
      if (rowTime <= movingTime) {
        minIndex = index + 1
      } else {
        maxIndex = Math.min(maxIndex, index)
      }
    }
    const correctedIndex = clamp(requestedIndex, minIndex, maxIndex)
    return { dateKey, index: correctedIndex, corrected: correctedIndex !== requestedIndex }
  }

  async function handleFlatListDragEnd({ data, from, to }) {
    setDraggingId(null)
    const activeId = String(flatDragItemIdRef.current ?? "").trim()
    flatDragItemIdRef.current = ""
    if (from === to) {
      return
    }
    const moved = Array.isArray(data)
      ? data.find((row) => row?.__planRow && String(row?.plan?.id ?? "").trim() === activeId) ?? data[to]
      : null
    const item = moved?.plan
    const itemId = String(item?.id ?? "").trim()
    if (!item || !itemId) {
      refreshFlatListPreservingScroll()
      return
    }
    if (!isMovableNoTimePlanRow(item)) {
      showMoveBlockedAlert(item)
      refreshFlatListPreservingScroll()
      return
    }
    const drop = normalizeFlatTimedDrop(item, getFlatDropInfo(data, itemId))
    if (!drop?.dateKey) {
      refreshFlatListPreservingScroll()
      return
    }
    const currentDate = String(item?.date ?? "").trim()
    const currentIndex = getFlatPlanIndexInDate(currentDate, itemId)
    if (drop.dateKey === currentDate && drop.index === currentIndex) {
      refreshFlatListPreservingScroll()
      return
    }
    try {
      await onMovePlan?.(item, drop.dateKey, drop.index)
    } catch (error) {
      refreshFlatListPreservingScroll()
      throw error
    }
  }

  function renderReorderRow(item, options = {}) {
    if (!item) return null
    const { draggable = false, isActive = false, onLongPress, onDelete, rowKey } = options
    const time = buildPlanTimeTextFromRow(item)
    const content = getPlanDisplayText(item)
    const category = String(item?.category_id ?? "").trim()
    const isGeneral = !category || category === "__general__"
    const categoryColor = colorByTitle.get(category) || "#94a3b8"
    const canLongPress = typeof onLongPress === "function"
    const Container = canLongPress ? Pressable : View
    return (
      <Container
        key={rowKey}
        onLongPress={canLongPress ? onLongPress : undefined}
        delayLongPress={canLongPress ? (draggable ? 140 : 220) : undefined}
        style={[
          styles.reorderItemRow,
          isDark ? styles.reorderItemRowDark : null,
          isActive ? styles.reorderDragGhost : null,
          isActive && isDark ? styles.reorderDragGhostDark : null
        ]}
      >
        <View style={[styles.itemLeftCol, styles.reorderItemLeftCol, isDark ? styles.itemLeftColDark : null, isDark ? styles.reorderItemLeftColDark : null]}>
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
              numberOfLines={1}
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
        {draggable ? (
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
    if (viewYear !== todayYear || viewMonth !== todayMonth) return
    const timer = setTimeout(() => {
      const didScroll = scrollToToday()
      if (!didScroll) {
        pendingScrollRef.current = false
        return
      }
      requestAnimationFrame(() => {
        scrollToToday()
        pendingScrollRef.current = false
      })
    }, 40)
    return () => clearTimeout(timer)
  }, [visibleSections, todayKey, scrollToken, viewYear, viewMonth, todayYear, todayMonth])

  function renderFlatListRow({ item, drag, isActive }) {
    if (item?.__dateHeader) {
      const key = String(item?.dateKey ?? "")
      const isTodaySection = key === todayKey
      const holidayName = holidaysByDate?.get?.(key) ?? ""
      const isHoliday = Boolean(holidayName)
      const color = weekdayColor(key, { isHoliday, isDark })
      const dow = weekdayLabel(key)
      return (
        <View
          ref={(node) => measureListSection(key, node)}
          style={[styles.sectionHeaderWrap, !item?.isFirstSection ? styles.sectionHeaderWrapSpaced : null]}
        >
          <Pressable
            style={[
              styles.sectionHeader,
              isDark ? styles.sectionHeaderDark : null,
              isTodaySection ? (isDark ? styles.sectionHeaderTodayDark : styles.sectionHeaderToday) : null
            ]}
            onPress={() => onAddPlan?.(key)}
          >
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Text style={[styles.sectionHeaderDateText, { color, fontSize: fs(14) }]}>
                  {formatDateMD(key)}
                  {dow ? <Text style={[styles.sectionHeaderDateDowInline, { fontSize: fs(10) }]}> ({dow})</Text> : null}
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
              </View>
            </View>
          </Pressable>
        </View>
      )
    }

    const row = item?.plan
    if (!row) return null
    const sectionData = Array.isArray(item?.section?.data) ? item.section.data.filter((candidate) => candidate?.id) : []
    const index = sectionData.findIndex((candidate) => String(candidate?.id ?? "") === String(row?.id ?? ""))
    const isFirstRow = index <= 0
    const isLastRow = index === sectionData.length - 1
    const nextItem = index >= 0 ? sectionData[index + 1] ?? null : null
    const separatorTone = isLastRow ? "none" : getListSectionSeparatorTone(row, nextItem)
    const time = buildPlanTimeTextFromRow(row)
    const content = getPlanDisplayText(row)
    const entryMeta = getPlanEntryMeta(row?.content)
    const isTaskDone = Boolean(entryMeta.taskCompleted)
    const category = String(row?.category_id ?? "").trim()
    const isGeneral = !category || category === "__general__"
    const categoryColor = colorByTitle.get(category) || "#94a3b8"
    const dateKey = String(item?.dateKey ?? row?.date ?? "")
    const itemId = String(row?.id ?? "").trim()
    const movable = isMovableNoTimePlanRow(row)

    return (
      <Pressable
        ref={(node) => measureListRow(dateKey, itemId, node)}
        style={[
          styles.itemRow,
          styles.listSectionBodyFrame,
          isFirstRow ? styles.listSectionBodyFrameFirst : null,
          isFirstRow ? styles.itemRowFirst : null,
          isFirstRow && isDark ? styles.itemRowFirstDark : null,
          separatorTone === "strong" ? styles.itemRowStrongSeparator : null,
          separatorTone === "none" ? styles.itemRowNoSeparator : null,
          isDark ? styles.itemRowDark : null,
          isDark && separatorTone === "strong" ? styles.itemRowStrongSeparatorDark : null,
          isDark ? styles.listSectionBodyFrameDark : null,
          isLastRow ? styles.listSectionBodyFrameLast : null,
          isLastRow && isDark ? styles.listSectionBodyFrameLastDark : null,
          isActive ? styles.reorderDragGhost : null,
          isActive && isDark ? styles.reorderDragGhostDark : null
        ]}
        onPress={() => onEditPlan?.(row)}
        onLongPress={movable ? drag : () => showMoveBlockedAlert(row)}
        delayLongPress={180}
      >
        <View style={[styles.itemLeftCol, isFirstRow ? styles.itemLeftColFirst : null, isDark ? styles.itemLeftColDark : null]}>
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
        <View style={[styles.itemMainCol, isFirstRow ? styles.itemMainColFirst : null]}>
          <View style={styles.itemTopRow}>
            <View style={styles.itemPrimaryRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isTaskDone }}
                hitSlop={6}
                onPress={(event) => {
                  event?.stopPropagation?.()
                  onToggleTask?.(row)
                }}
                style={[
                  styles.itemTaskToggle,
                  isDark ? styles.itemTaskToggleDark : null,
                  isTaskDone ? styles.itemTaskToggleChecked : null,
                  isTaskDone && isDark ? styles.itemTaskToggleCheckedDark : null,
                  { borderColor: categoryColor },
                  isTaskDone ? { backgroundColor: colorWithAlpha(categoryColor, 0.16), borderColor: categoryColor } : null
                ]}
              >
                {renderTaskMarkerContent(row, isTaskDone, isDark)}
              </Pressable>
              <Text
                style={[
                  styles.itemTitle,
                  { fontSize: fs(14) },
                  isDark ? styles.textDark : null,
                  isTaskDone ? styles.itemTitleTaskDone : null
                ]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {content}
              </Text>
            </View>
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
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        subtitle={headerSubtitle}
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        onTasks={onTasks}
        tasksCount={tasksCount}
        todayLabel={todayLabel}
        onToday={goToday}
        onFilter={activeTabId === "all" ? () => setListFilterVisible(true) : null}
        filterActive={!isAllListFiltersSelected}
        tone={tone}
        showLogo={false}
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
        fontScale={tabFontScale}
      />
      <View style={[styles.listMonthBar, isDark ? styles.listMonthBarDark : null]}>
        <View style={styles.listMonthLeftGroup}>
          <TouchableOpacity
            style={[styles.listMonthMiniNavButton, isDark ? styles.listMonthMiniNavButtonDark : null]}
            onPress={goPrevMonth}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.listMonthMiniNavText, isDark ? styles.listMonthMiniNavTextDark : null]}>{"<"}</Text>
          </TouchableOpacity>
          <Text style={[styles.listMonthText, { fontSize: fs(16) }, isDark ? styles.textDark : null]}>{monthLabel}</Text>
          <TouchableOpacity
            style={[styles.listMonthMiniNavButton, isDark ? styles.listMonthMiniNavButtonDark : null]}
            onPress={goNextMonth}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.listMonthMiniNavText, isDark ? styles.listMonthMiniNavTextDark : null]}>{">"}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.listMonthRightGroup}>
          <View style={styles.listAddSpacer} />
        </View>
      </View>
      <View
        style={[styles.card, styles.listCard, isDark ? styles.cardDark : null, isDark ? styles.listCardDark : null]}
      >
        {loading ? <ActivityIndicator size="small" color="#3b82f6" /> : null}
        <DraggableFlatList
          key={visibleFlatListKey}
          ref={listRef}
          data={visibleFlatRows}
          keyExtractor={(row) => String(row?.id ?? "")}
          extraData={listDragRefreshKey}
          activationDistance={6}
          dragItemOverflow
          animationConfig={{ damping: 20, stiffness: 220, mass: 0.35 }}
          onDragBegin={(index) => {
            const row = visibleFlatRows?.[index]
            if (row?.__planRow) {
              const id = String(row?.plan?.id ?? "__drag__")
              flatDragItemIdRef.current = id
              setDraggingId(id)
            }
          }}
          onDragEnd={handleFlatListDragEnd}
          renderItem={renderFlatListRow}
          onScroll={(event) => {
            listScrollOffsetRef.current = Math.max(0, Number(event?.nativeEvent?.contentOffset?.y ?? 0) || 0)
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            !loading ? (
              <Pressable style={styles.listEmptyWrap} onPress={() => onAddPlan?.(defaultAddDateKey)}>
                <View style={[styles.listEmptyCard, isDark ? styles.listEmptyCardDark : null]}>
                  <Text style={[styles.listEmptyTitle, isDark ? styles.textDark : null]}>일정이 비어 있어요</Text>
                  <Text style={[styles.listEmptySub, isDark ? styles.textMutedDark : null]}>
                    + 버튼을 누르거나 여기를 눌러 바로 추가하세요.
                  </Text>
                </View>
              </Pressable>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex?.({
                index,
                viewPosition: 0,
                viewOffset: 6
              })
            }, 250)
          }}
        />
        {false ? (
        <SectionList
          ref={listRef}
          sections={visibleSections}
          keyExtractor={(item) => item.id ?? `${item.date}-${item.content}`}
          stickySectionHeadersEnabled={false}
          scrollEnabled={!draggingId}
          SectionSeparatorComponent={({ leadingItem }) => leadingItem ? <View style={styles.listSectionSpacer} /> : null}
          renderItem={({ item, section, index }) => {
            const sectionData = Array.isArray(section?.data) ? section.data : []
            const isFirstRow = index === 0
            const isLastRow = index === sectionData.length - 1
            const nextItem = sectionData[index + 1] ?? null
            const separatorTone = isLastRow ? "none" : getListSectionSeparatorTone(item, nextItem)
            if (item?.__reorder) {
              return (
                <View
                  style={[
                    styles.reorderInlineCard,
                    styles.listSectionBodyFrame,
                    isFirstRow ? styles.listSectionBodyFrameFirst : null,
                    isDark ? styles.reorderInlineCardDark : null,
                    isDark ? styles.listSectionBodyFrameDark : null,
                    isLastRow ? styles.listSectionBodyFrameLast : null,
                    isLastRow && isDark ? styles.listSectionBodyFrameLastDark : null
                  ]}
                >
                  {reorderItems.length ? (
                    <View style={styles.reorderBucketWrap}>
                      <DraggableFlatList
                        data={reorderItems}
                        keyExtractor={(row, idx) => String(row?.id ?? `${row?.date}-${row?.content}-${idx}`)}
                        scrollEnabled={false}
                        activationDistance={10}
                        animationConfig={{ damping: 20, stiffness: 220, mass: 0.35 }}
                        containerStyle={styles.reorderNoTimeList}
                        onDragBegin={(index) => {
                          const row = reorderItemsRef.current?.[index]
                          setDraggingId(String(row?.id ?? "__drag__"))
                        }}
                        onDragEnd={({ data }) => {
                          reorderItemsRef.current = data
                          setReorderItems(data)
                          setDraggingId(null)
                        }}
                        renderItem={({ item: row, drag, isActive }) => {
                          const movable = isMovableNoTimePlanRow(row)
                          const canDelete = movable && !isRecurringPlanRowForMove(row)
                          return renderReorderRow(row, {
                            rowKey: String(row?.id ?? `${row?.date}-${row?.content}`),
                            draggable: movable,
                            isActive,
                            onLongPress: movable ? drag : () => showMoveBlockedAlert(row),
                            onDelete: canDelete ? () => quickDeleteFromReorder(row) : undefined
                          })
                        }}
                      />
                    </View>
                  ) : (
                    <View style={styles.reorderEmpty}>
                      <Text style={[styles.reorderEmptyText, isDark ? styles.textMutedDark : null]}>
                        항목이 없습니다.
                      </Text>
                    </View>
                  )}
                </View>
              )
            }
            if (item?.__taskDivider) {
              return (
                <View
                  style={[
                    styles.itemTaskDividerRow,
                    styles.listSectionBodyFrame,
                    isFirstRow ? styles.listSectionBodyFrameFirst : null,
                    isDark ? styles.listSectionBodyFrameDark : null,
                    isLastRow ? styles.listSectionBodyFrameLast : null,
                    isLastRow && isDark ? styles.listSectionBodyFrameLastDark : null
                  ]}
                >
                  <View style={[styles.itemTaskDividerLine, isDark ? styles.itemTaskDividerLineDark : null]} />
                </View>
              )
            }
            if (item?.__bucketDivider) {
              return (
                <View
                  style={[
                    styles.itemBucketDividerRow,
                    styles.listSectionBodyFrame,
                    isFirstRow ? styles.listSectionBodyFrameFirst : null,
                    isDark ? styles.listSectionBodyFrameDark : null,
                    isLastRow ? styles.listSectionBodyFrameLast : null,
                    isLastRow && isDark ? styles.listSectionBodyFrameLastDark : null
                  ]}
                >
                  <View style={[styles.itemBucketDividerLine, isDark ? styles.itemBucketDividerLineDark : null]} />
                </View>
              )
            }
            const time = buildPlanTimeTextFromRow(item)
            const content = getPlanDisplayText(item)
            const entryMeta = getPlanEntryMeta(item?.content)
            const isTaskRow = entryMeta.entryType === "task"
            const isTaskDone = Boolean(entryMeta.taskCompleted)
            const category = String(item?.category_id ?? "").trim()
            const isGeneral = !category || category === "__general__"
            const categoryColor = colorByTitle.get(category) || "#94a3b8"
            const dateKey = String(section?.title ?? item?.date ?? "")
            const itemId = String(item?.id ?? "").trim()
            const listDragResponder = createListDragHandlers(item, dateKey)
            return (
              <View
                ref={(node) => measureListRow(dateKey, itemId, node)}
                style={[
                  styles.itemRow,
                  styles.listSectionBodyFrame,
                  isFirstRow ? styles.listSectionBodyFrameFirst : null,
                  isFirstRow ? styles.itemRowFirst : null,
                  isFirstRow && isDark ? styles.itemRowFirstDark : null,
                  separatorTone === "strong" ? styles.itemRowStrongSeparator : null,
                  separatorTone === "none" ? styles.itemRowNoSeparator : null,
                  isDark ? styles.itemRowDark : null,
                  isDark && separatorTone === "strong" ? styles.itemRowStrongSeparatorDark : null,
                  isDark ? styles.listSectionBodyFrameDark : null,
                  isLastRow ? styles.listSectionBodyFrameLast : null,
                  isLastRow && isDark ? styles.listSectionBodyFrameLastDark : null,
                  draggingId === itemId ? styles.dragMovingRow : null,
                  draggingId === itemId && isDark ? styles.dragMovingRowDark : null
                ]}
                {...(listDragResponder?.panHandlers ?? {})}
              >
                <View
                  style={[
                    styles.itemLeftCol,
                    isFirstRow ? styles.itemLeftColFirst : null,
                    isDark ? styles.itemLeftColDark : null
                  ]}
                >
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
                <View style={[styles.itemMainCol, isFirstRow ? styles.itemMainColFirst : null]}>
                  <View style={styles.itemTopRow}>
                    <View style={styles.itemPrimaryRow}>
                      {isTaskRow ? (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isTaskDone }}
                          hitSlop={6}
                          onPress={(event) => {
                            event?.stopPropagation?.()
                            onToggleTask?.(item)
                          }}
                style={[
                  styles.itemTaskToggle,
                  isDark ? styles.itemTaskToggleDark : null,
                  isTaskDone ? styles.itemTaskToggleChecked : null,
                  isTaskDone && isDark ? styles.itemTaskToggleCheckedDark : null,
                  { borderColor: categoryColor },
                  isTaskDone ? { backgroundColor: colorWithAlpha(categoryColor, 0.16), borderColor: categoryColor } : null
                ]}
                        >
                          {renderTaskMarkerContent(item, isTaskDone, isDark)}
                        </Pressable>
                      ) : null}
                      <Text
                        style={[
                          styles.itemTitle,
                          { fontSize: fs(14) },
                          isDark ? styles.textDark : null,
                          isTaskDone ? styles.itemTitleTaskDone : null
                        ]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                      >
                        {content}
                      </Text>
                    </View>
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
              </View>
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
	              <View
                  ref={(node) => measureListSection(key, node)}
                  style={styles.sectionHeaderWrap}
                >
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
                </View>
            )
          }}
          ListEmptyComponent={
            !loading ? (
              <Pressable style={styles.listEmptyWrap} onPress={() => onAddPlan?.(defaultAddDateKey)}>
                <View style={[styles.listEmptyCard, isDark ? styles.listEmptyCardDark : null]}>
                  <Text style={[styles.listEmptyTitle, isDark ? styles.textDark : null]}>일정이 비어 있어요</Text>
                  <Text style={[styles.listEmptySub, isDark ? styles.textMutedDark : null]}>
                    + 버튼을 누르거나 여기를 눌러 바로 추가하세요.
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
        ) : null}
      </View>

      <Pressable onPress={() => onAddPlan?.(defaultAddDateKey)} style={styles.memoSingleFab}>
        <Text style={styles.memoSingleFabText}>+</Text>
      </Pressable>

      {dragPreview ? (
        <View pointerEvents="none" style={styles.dragPreviewLayer}>
          <View
            style={[
              styles.dragPreviewCard,
              isDark ? styles.dragPreviewCardDark : null,
              { left: dragPreview.x, top: dragPreview.y, width: dragPreview.width }
            ]}
          >
            <View style={[styles.dragPreviewDot, { backgroundColor: dragPreview.color }]} />
            {dragPreview.time ? <Text style={[styles.dragPreviewTime, isDark ? styles.textMutedDark : null]}>{dragPreview.time}</Text> : null}
            <Text style={[styles.dragPreviewTitle, isDark ? styles.textDark : null]} numberOfLines={1}>
              {dragPreview.title}
            </Text>
          </View>
        </View>
      ) : null}

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
  memoFontScale = UI_FONT_SCALE_DEFAULT,
  tabFontScale = UI_FONT_SCALE_DEFAULT,
  windows,
  rightMemos,
  activeTabId,
  onSelectTab,
  onAddWindow,
  onRenameWindow,
  onDeleteWindow,
  onChangeWindowColor,
  onReorderWindows,
  onSaveMemo,
  onStageMemo,
  onTasks,
  tasksCount = 0
}) {
  const isDark = tone === "dark"
  const headerSubtitle = formatTodayHeaderText(new Date())
  const scale = useMemo(() => {
    return clampUiFontScale(memoFontScale)
  }, [memoFontScale])
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
  const [allMemoWindowId, setAllMemoWindowId] = useState(null)
  const [allMemoWindowMenuOpen, setAllMemoWindowMenuOpen] = useState(false)
  const [singleMemoDocId, setSingleMemoDocId] = useState(null)
  const [singleMemoSearch, setSingleMemoSearch] = useState("")
  const [singleMemoSelectMode, setSingleMemoSelectMode] = useState(false)
  const [singleMemoSelectedIds, setSingleMemoSelectedIds] = useState([])
  const [memoCardDocIds, setMemoCardDocIds] = useState({})
  const draftRef = useRef("")
  const dirtyRef = useRef(false)
  const inputRef = useRef(null)
  const singleTitleInputRef = useRef(null)
  const memoTitleInputRefs = useRef({})
  const memoInputRefs = useRef({})
  const memoAllScrollRef = useRef(null)
  const memoScrollYRef = useRef(0)
  const memoDocTabsScrollRefs = useRef({})
  const singleMemoDocTabsScrollRef = useRef(null)
  const memoCardFocusFieldRef = useRef({})
  const singleMemoFocusFieldRef = useRef("content")
  const memoActiveInputRef = useRef(null)
  const memoSaveQueueRef = useRef({})
  const memoEditDraftsRef = useRef(memoEditDrafts ?? {})
  const rightMemosRef = useRef(rightMemos ?? {})
  const activeTabIdRef = useRef(activeTabId)
  const memoEditingIdRef = useRef(memoEditingId)
  const isEditingRef = useRef(isEditing)
  const keyboardHeightRef = useRef(0)
  const pendingMemoLineRevealRef = useRef(null)
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
      keyboardHeightRef.current = nextHeight
      setKeyboardHeight(nextHeight)
      const pending = pendingMemoLineRevealRef.current
      if (pending) {
        scheduleMemoPressedLineReveal(pending.targetGetter, pending.locationY, pending.options)
      }
    })
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      keyboardHeightRef.current = 0
      pendingMemoLineRevealRef.current = null
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
    const latestRightMemos = rightMemos ?? {}
    rightMemosRef.current = latestRightMemos
    setMemoEditDrafts((prev) => {
      const current = prev ?? {}
      let changed = false
      const next = {}
      for (const [key, value] of Object.entries(current)) {
        if (String(value ?? "") === String(latestRightMemos?.[key] ?? "")) {
          changed = true
          continue
        }
        next[key] = value
      }
      if (!changed) return prev
      memoEditDraftsRef.current = next
      return next
    })
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
    onStageMemo?.(key, payload)
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
      if (String(prevId) !== "all") {
        const optimisticDocId = buildRightMemoDocView(contentToSave, singleMemoDocId).activeDocId ?? null
        setMemoEditDrafts((prev) => {
          const next = { ...(prev ?? {}), [String(prevId)]: contentToSave }
          memoEditDraftsRef.current = next
          return next
        })
        if (optimisticDocId) {
          setMemoCardDocIds((prev) => ({ ...(prev ?? {}), [String(prevId)]: optimisticDocId }))
        }
      }
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

    const activeKey = String(activeTabId ?? "")
    const draftMap = memoEditDraftsRef.current ?? {}
    const hasOptimisticText =
      activeKey && activeKey !== "all" && Object.prototype.hasOwnProperty.call(draftMap, activeKey)
    const nextText = String(hasOptimisticText ? draftMap[activeKey] : memoText ?? "")
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
    setAllMemoWindowMenuOpen(false)
  }, [activeTabId])

  useEffect(() => {
    if (activeTabId === "all") return
    if (!singleMemoDocId) return
    const nextDocId = buildRightMemoDocView(draft, singleMemoDocId).activeDocId ?? null
    if (nextDocId !== singleMemoDocId) setSingleMemoDocId(nextDocId)
  }, [activeTabId, draft, singleMemoDocId])

  useEffect(() => {
    setSingleMemoSearch("")
    setSingleMemoSelectMode(false)
    setSingleMemoSelectedIds([])
    setSingleMemoDocId(null)
    memoActiveInputRef.current = null
  }, [activeTabId])

  useEffect(() => {
    if (isEditing) {
      setSingleMemoSelectMode(false)
      setSingleMemoSelectedIds([])
    } else {
      singleMemoFocusFieldRef.current = "content"
    }
  }, [isEditing])

  useEffect(() => {
    if (!memoEditingId) {
      memoActiveInputRef.current = null
    }
  }, [memoEditingId])

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
    return ""
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
  const selectedAllMemoWindow = useMemo(() => {
    if (activeTabId !== "all") return null
    const currentId = String(allMemoWindowId ?? "").trim()
    if (currentId) {
      const matched = filteredMemoWindows.find((w) => String(w?.id ?? "").trim() === currentId)
      if (matched) return matched
    }
    return filteredMemoWindows[0] ?? null
  }, [activeTabId, filteredMemoWindows, allMemoWindowId])
  const singleMemoDocView = useMemo(
    () => buildRightMemoDocView(draft, singleMemoDocId),
    [draft, singleMemoDocId]
  )
  const singleMemoListItems = useMemo(() => {
    return (singleMemoDocView?.docs ?? []).map((doc, index) => {
      const rawTitle = String(doc?.title ?? "").trim()
      const fallbackTitle = getRightMemoDocDisplayTitle(rawTitle, index)
      const content = String(doc?.content ?? "")
      const contentLines = content
        .split(/\r?\n/)
        .map((line) => String(line ?? "").trim())
        .filter(Boolean)
      const preview = contentLines.join(" ").trim()
      return {
        id: doc?.id,
        title: fallbackTitle,
        preview,
        rawContent: content,
        isActive: doc?.id === singleMemoDocView?.activeDocId
      }
    })
  }, [singleMemoDocView])
  const filteredSingleMemoItems = useMemo(() => {
    const query = String(singleMemoSearch ?? "").trim().toLowerCase()
    if (!query) return singleMemoListItems
    return singleMemoListItems.filter((item) => {
      const title = String(item?.title ?? "").toLowerCase()
      const preview = String(item?.preview ?? "").toLowerCase()
      const raw = String(item?.rawContent ?? "").toLowerCase()
      return title.includes(query) || preview.includes(query) || raw.includes(query)
    })
  }, [singleMemoListItems, singleMemoSearch])
  const canManageSingleMemoDocs = (singleMemoDocView?.docs?.length ?? 0) > 1
  const singleMemoSelectableIds = useMemo(
    () => (canManageSingleMemoDocs ? filteredSingleMemoItems.map((item) => String(item?.id ?? "").trim()).filter(Boolean) : []),
    [canManageSingleMemoDocs, filteredSingleMemoItems]
  )
  const singleMemoSelectedCount = singleMemoSelectedIds.length
  const areAllSingleMemosSelected =
    singleMemoSelectableIds.length > 0 && singleMemoSelectableIds.every((id) => singleMemoSelectedIds.includes(id))
  const showSingleMemoViewer = activeTabId !== "all" && !isEditing && !singleMemoSelectMode && Boolean(singleMemoDocId)

  useEffect(() => {
    if (activeTabId !== "all") return
    const nextId = String(selectedAllMemoWindow?.id ?? "").trim() || null
    if (nextId !== allMemoWindowId) setAllMemoWindowId(nextId)
  }, [activeTabId, selectedAllMemoWindow, allMemoWindowId])

  useEffect(() => {
    const validIds = new Set((singleMemoDocView?.docs ?? []).map((doc) => String(doc?.id ?? "").trim()).filter(Boolean))
    setSingleMemoSelectedIds((prev) => {
      const next = prev.filter((id) => validIds.has(String(id ?? "").trim()))
      return next.length === prev.length ? prev : next
    })
  }, [singleMemoDocView])

  useEffect(() => {
    if (canManageSingleMemoDocs) return
    if (singleMemoSelectMode) setSingleMemoSelectMode(false)
    setSingleMemoSelectedIds([])
  }, [canManageSingleMemoDocs, singleMemoSelectMode])

  function updateMemoEditDraftRaw(windowId, updater) {
    const key = String(windowId ?? "")
    if (!key) return
    const currentRaw = String(memoEditDraftsRef.current?.[key] ?? rightMemosRef.current?.[key] ?? "")
    const nextRaw = String(updater?.(currentRaw) ?? currentRaw)
    onStageMemo?.(key, nextRaw)
    setMemoEditDrafts((prev) => {
      const next = { ...(prev ?? {}), [key]: nextRaw }
      memoEditDraftsRef.current = next
      return next
    })
  }

  function setMemoEditDraftRaw(windowId, nextRaw) {
    const key = String(windowId ?? "")
    if (!key) return
    const raw = String(nextRaw ?? "")
    onStageMemo?.(key, raw)
    setMemoEditDrafts((prev) => {
      const next = { ...(prev ?? {}), [key]: raw }
      memoEditDraftsRef.current = next
      return next
    })
  }

  function markSingleDraftDirty(nextRaw) {
    const raw = String(nextRaw ?? "")
    const wasDirty = dirtyRef.current
    const key = String(activeTabIdRef.current ?? activeTabId ?? "").trim()
    draftRef.current = raw
    dirtyRef.current = true
    setDraft(raw)
    if (key && key !== "all") {
      setMemoEditDrafts((prev) => {
        const next = { ...(prev ?? {}), [key]: raw }
        memoEditDraftsRef.current = next
        return next
      })
      onStageMemo?.(key, raw)
    }
    if (!wasDirty) setDirty(true)
    scheduleSave(raw)
  }

  function setMemoCardActiveDoc(windowId, docId) {
    const key = String(windowId ?? "")
    if (!key || !docId) return
    setMemoCardDocIds((prev) => ({ ...(prev ?? {}), [key]: docId }))
  }

  function updateMemoCardDocContent(windowId, docId, nextContent) {
    const key = String(windowId ?? "")
    if (!key || !docId) return
    setMemoCardActiveDoc(key, docId)
    updateMemoEditDraftRaw(key, (currentRaw) => updateRightMemoRawForDocContent(currentRaw, docId, nextContent))
  }

  function updateMemoCardDocTitle(windowId, docId, nextTitle) {
    const key = String(windowId ?? "")
    if (!key || !docId) return
    setMemoCardActiveDoc(key, docId)
    updateMemoEditDraftRaw(key, (currentRaw) => updateRightMemoRawForDocTitle(currentRaw, docId, nextTitle))
  }

  function addMemoCardDoc(windowId) {
    const key = String(windowId ?? "")
    if (!key) return
    const currentRaw = String(memoEditDraftsRef.current?.[key] ?? rightMemosRef.current?.[key] ?? "")
    const result = addRightMemoDocToRaw(currentRaw)
    const nextDocId = result.docId
    setMemoEditDraftRaw(key, result.raw)
    if (nextDocId) {
      setMemoCardActiveDoc(key, nextDocId)
      setMemoExpandedMap((prev) => ({ ...(prev ?? {}), [key]: true }))
      setMemoEditingId(key)
      scrollMemoDocTabsToEnd(memoDocTabsScrollRefs.current?.[key])
    }
    Promise.resolve(saveForTab(key, result.raw)).catch((_e) => {
      // ignore (onSaveMemo handles alerting)
    })
  }

  function removeMemoCardDoc(windowId, docId) {
    const key = String(windowId ?? "")
    if (!key || !docId) return
    const currentRaw = String(memoEditDraftsRef.current?.[key] ?? rightMemosRef.current?.[key] ?? "")
    const result = removeRightMemoDocFromRaw(currentRaw, docId)
    if (!result.removed) return
    setMemoEditDraftRaw(key, result.raw)
    setMemoCardDocIds((prev) => ({ ...(prev ?? {}), [key]: result.docId }))
    Promise.resolve(saveForTab(key, result.raw)).catch((_e) => {
      // ignore (onSaveMemo handles alerting)
    })
  }

  function updateSingleMemoDocContent(nextContent) {
    const docId = singleMemoDocView.activeDocId
    if (!docId) return
    setSingleMemoDocId(docId)
    markSingleDraftDirty(updateRightMemoRawForDocContent(draftRef.current, docId, nextContent))
  }

  function updateSingleMemoDocTitle(nextTitle) {
    const docId = singleMemoDocView.activeDocId
    if (!docId) return
    setSingleMemoDocId(docId)
    markSingleDraftDirty(updateRightMemoRawForDocTitle(draftRef.current, docId, nextTitle))
  }

  function addSingleMemoDoc() {
    const result = addRightMemoDocToRaw(draftRef.current)
    setSingleMemoDocId(result.docId)
    setIsEditing(true)
    markSingleDraftDirty(result.raw)
    setTimeout(() => {
      singleMemoDocTabsScrollRef.current?.scrollToEnd?.({ animated: true })
    }, 80)
  }

  function toggleSingleMemoSelectMode() {
    if (!canManageSingleMemoDocs) return
    setSingleMemoSelectMode((prev) => {
      if (prev) setSingleMemoSelectedIds([])
      return !prev
    })
  }

  function toggleSingleMemoSelection(docId) {
    const targetDocId = String(docId ?? "").trim()
    if (!targetDocId) return
    setSingleMemoSelectedIds((prev) => {
      const exists = prev.includes(targetDocId)
      if (exists) return prev.filter((id) => id !== targetDocId)
      return [...prev, targetDocId]
    })
  }

  function toggleSelectAllSingleMemos() {
    if (!singleMemoSelectableIds.length) return
    setSingleMemoSelectedIds((prev) => {
      const allSelected = singleMemoSelectableIds.every((id) => prev.includes(id))
      if (allSelected) return prev.filter((id) => !singleMemoSelectableIds.includes(id))
      const next = new Set(prev)
      singleMemoSelectableIds.forEach((id) => next.add(id))
      return [...next]
    })
  }

  function removeSingleMemoDocsByIds(docIds) {
    if (!canManageSingleMemoDocs) return
    const targets = [...new Set((docIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (!targets.length) return
    let nextRaw = String(draftRef.current ?? "")
    let nextDocId = singleMemoDocView.activeDocId ?? null
    let removed = false
    for (const targetDocId of targets) {
      const result = removeRightMemoDocFromRaw(nextRaw, targetDocId)
      nextRaw = result.raw
      nextDocId = result.docId ?? nextDocId
      removed = removed || result.removed
    }
    if (!removed) return
    setSingleMemoDocId(nextDocId ?? null)
    setSingleMemoSelectedIds([])
    setSingleMemoSelectMode(false)
    markSingleDraftDirty(nextRaw)
  }

  function confirmDeleteSelectedSingleMemos() {
    if (!canManageSingleMemoDocs) return
    if (!singleMemoSelectedCount) return
    const onlyOne = singleMemoSelectedCount === 1
    Alert.alert(
      onlyOne ? "메모 삭제" : "메모 여러 개 삭제",
      onlyOne
        ? "선택한 메모를 삭제할까요?"
        : `선택한 메모 ${singleMemoSelectedCount}개를 삭제할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => removeSingleMemoDocsByIds(singleMemoSelectedIds)
        }
      ]
    )
  }

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
    const optimisticDocId = buildRightMemoDocView(nextText, singleMemoDocId).activeDocId ?? null
    setMemoEditDrafts((prev) => {
      const next = { ...(prev ?? {}), [key]: nextText }
      memoEditDraftsRef.current = next
      return next
    })
    if (optimisticDocId) {
      setMemoCardDocIds((prev) => ({ ...(prev ?? {}), [key]: optimisticDocId }))
    }
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
    if (activeTabId === "all" || isEditing || memoEditingId) return Math.max(72, keyboardHeight + 84)
    return 48
  }, [activeTabId, isEditing, memoEditingId, keyboardHeight])
  const memoAllPreviewMinHeight = useMemo(() => {
    const windowHeight = Dimensions.get("window").height
    return Math.max(360, Math.round(windowHeight * 0.56))
  }, [])

  function setMemoCardFocusField(id, field = "content") {
    const key = String(id ?? "")
    if (!key) return
    memoCardFocusFieldRef.current = {
      ...(memoCardFocusFieldRef.current ?? {}),
      [key]: field === "title" ? "title" : "content"
    }
  }

  function setActiveMemoInput(target) {
    memoActiveInputRef.current = target
  }

  function handleMemoCardFieldFocus(key, field) {
    const normalizedKey = String(key ?? "")
    if (!normalizedKey) return
    const normalizedField = field === "title" ? "title" : "content"
    setMemoCardFocusField(normalizedKey, normalizedField)
    setActiveMemoInput({ scope: "all", key: normalizedKey, field: normalizedField })
    if (normalizedField === "title") {
      const target = getMemoCardEditorTarget(normalizedKey, normalizedField)
      revealMemoEditor(target, {
        preferredTop: 156,
        bottomGap: 36
      })
    }
  }

  function handleMemoCardFieldBlur(key, field) {
    const normalizedKey = String(key ?? "")
    if (!normalizedKey) return
    const normalizedField = field === "title" ? "title" : "content"
    const currentFocus = memoActiveInputRef.current
    if (
      currentFocus?.scope === "all" &&
      currentFocus?.key === normalizedKey &&
      currentFocus?.field === normalizedField
    ) {
      memoActiveInputRef.current = null
    }
    setTimeout(() => {
      const nextFocus = memoActiveInputRef.current
      if (nextFocus?.scope === "all" && nextFocus?.key === normalizedKey) return
      autoSaveMemoEditIfNeeded(normalizedKey)
      setMemoEditingId((prev) => (String(prev ?? "") === normalizedKey ? null : prev))
    }, 80)
  }

  function handleSingleMemoFieldFocus(field) {
    const normalizedField = field === "title" ? "title" : "content"
    singleMemoFocusFieldRef.current = normalizedField
    setActiveMemoInput({ scope: "single", field: normalizedField })
    if (normalizedField === "title") {
      const target = singleTitleInputRef.current
      revealMemoEditor(target, {
        preferredTop: 156,
        bottomGap: 36
      })
    }
  }

  function handleSingleMemoFieldBlur(field) {
    const normalizedField = field === "title" ? "title" : "content"
    const currentFocus = memoActiveInputRef.current
    if (currentFocus?.scope === "single" && currentFocus?.field === normalizedField) {
      memoActiveInputRef.current = null
    }
    setTimeout(() => {
      const nextFocus = memoActiveInputRef.current
      if (nextFocus?.scope === "single") return
      const currentTabId = String(activeTabIdRef.current ?? activeTabId ?? "")
      if (!currentTabId || currentTabId === "all") return
      finishSingleEdit(currentTabId, true)
    }, 80)
  }

  function getMemoCardEditorTarget(id, field = "content") {
    const key = String(id ?? "")
    if (!key) return null
    return field === "title" ? memoTitleInputRefs.current?.[key] : memoInputRefs.current?.[key]
  }

  const revealMemoEditor = useCallback((target = null, { preferredTop = 168, bottomGap = 28 } = {}) => {
    const scrollRef = memoAllScrollRef.current
    if (!scrollRef) return
    if (target && typeof target?.measureInWindow === "function") {
      requestAnimationFrame(() => {
        setTimeout(() => {
          target.measureInWindow?.((_x, y, _w, h) => {
            const windowHeight = Dimensions.get("window").height
            const keyboardTop = keyboardHeight > 0 ? windowHeight - keyboardHeight : windowHeight
            const visibleBottom = keyboardTop - bottomGap
            let nextY = memoScrollYRef.current
            if (y < preferredTop) nextY -= preferredTop - y
            if (y + h > visibleBottom) nextY += y + h - visibleBottom
            nextY = Math.max(0, nextY)
            if (Math.abs(nextY - memoScrollYRef.current) > 1) {
              scrollRef?.scrollTo?.({ y: nextY, animated: true })
            }
          })
        }, 16)
      })
      return
    }
    const nodeHandle = target ? findNodeHandle(target) : null
    const scrollToKeyboard = scrollRef?.scrollResponderScrollNativeHandleToKeyboard
    if (nodeHandle && typeof scrollToKeyboard === "function") {
      requestAnimationFrame(() => {
        scrollToKeyboard(nodeHandle, 80, true)
      })
      return
    }
    requestAnimationFrame(() => {
      scrollRef?.scrollToEnd?.({ animated: true })
    })
  }, [keyboardHeight])

  function applyTextInputSelection(target, selectionIndex) {
    const index = Number(selectionIndex)
    if (!Number.isFinite(index) || index < 0) return
    const selection = { start: index, end: index }
    target?.setNativeProps?.({ selection })
  }

  function getMemoSelectionIndexForLine(text, lineIndex) {
    const value = String(text ?? "")
    const targetLine = Math.max(0, Number(lineIndex) || 0)
    if (targetLine <= 0) return 0
    let index = 0
    for (let line = 0; line < targetLine; line += 1) {
      const nextBreak = value.indexOf("\n", index)
      if (nextBreak === -1) return value.length
      index = nextBreak + 1
    }
    return index
  }

  function getMemoSelectionIndexFromPress(event, text, verticalPadding = 0) {
    const y = Number(event?.nativeEvent?.locationY)
    if (!Number.isFinite(y)) return null
    const lineHeight = Math.max(1, Number(memoLineHeight) || 20)
    const lineIndex = Math.max(0, Math.floor(Math.max(0, y - verticalPadding) / lineHeight))
    return getMemoSelectionIndexForLine(text, lineIndex)
  }

  function revealMemoPressedLine(target, locationY, options = {}) {
    const scrollRef = memoAllScrollRef.current
    const yInInput = Number(locationY)
    if (!scrollRef || !Number.isFinite(yInInput) || !target || typeof target?.measureInWindow !== "function") return
    requestAnimationFrame(() => {
      setTimeout(() => {
        target.measureInWindow?.((_x, y, _w, _h) => {
          const windowHeight = Dimensions.get("window").height
          const keyboardTop =
            keyboardHeightRef.current > 0 ? windowHeight - keyboardHeightRef.current : windowHeight
          const visibleBottom = keyboardTop - Math.max(10, Number(options?.bottomGap ?? 18) || 18)
          const preferredTop = Math.max(90, Number(options?.preferredTop ?? 156) || 156)
          const lineHeight = Math.max(18, Number(memoLineHeight) || 20)
          const lineTop = y + Math.max(0, yInInput)
          const lineBottom = lineTop + lineHeight
          let nextY = memoScrollYRef.current
          if (lineTop < preferredTop) {
            nextY -= preferredTop - lineTop
          } else if (lineBottom > visibleBottom) {
            nextY += lineBottom - visibleBottom
          }
          nextY = Math.max(0, nextY)
          if (Math.abs(nextY - memoScrollYRef.current) > 1) {
            scrollRef?.scrollTo?.({ y: nextY, animated: true })
          }
        })
      }, 16)
    })
  }

  function scheduleMemoPressedLineReveal(targetGetter, locationY, options = {}) {
    const y = Number(locationY)
    if (!Number.isFinite(y)) return
    const delays = keyboardHeightRef.current > 0 ? [24, 120, 260] : [220, 440, 720, 1020]
    delays.forEach((delay) => {
      setTimeout(() => revealMemoPressedLine(targetGetter?.(), y, options), delay)
    })
  }

  function revealMemoPressedLineSoon(targetGetter, locationY, options = {}) {
    const y = Number(locationY)
    if (!Number.isFinite(y)) return
    pendingMemoLineRevealRef.current = { targetGetter, locationY: y, options }
    scheduleMemoPressedLineReveal(targetGetter, y, options)
  }

  function focusMemoEditorTarget(targetGetter, field = "content", attempts = 0, options = {}) {
    const target = targetGetter?.()
    if (!target) {
      if (attempts < 6) {
        setTimeout(() => focusMemoEditorTarget(targetGetter, field, attempts + 1, options), 40)
      }
      return
    }
    if (field === "title" || options?.reveal === true) {
      revealMemoEditor(target, {
        preferredTop: field === "title" ? 156 : 220,
        bottomGap: field === "title" ? 36 : 28
      })
    }
    setTimeout(() => {
      target?.focus?.()
      if (options?.selectionIndex != null) {
        setTimeout(() => applyTextInputSelection(target, options.selectionIndex), 32)
      }
    }, 24)
  }

  useEffect(() => {
    if (keyboardHeight <= 0) return
    if (!isEditing && !memoEditingId) return
    const timer = setTimeout(() => {
      if (activeTabId === "all") {
        const editingKey = String(memoEditingId ?? "")
        const field = memoCardFocusFieldRef.current?.[editingKey] === "title" ? "title" : "content"
        if (field !== "title") return
        const target = getMemoCardEditorTarget(editingKey, field)
        revealMemoEditor(target, {
          preferredTop: 156,
          bottomGap: 36
        })
        return
      }
      if (singleMemoFocusFieldRef.current !== "title") return
      const target = singleMemoFocusFieldRef.current === "title" ? singleTitleInputRef.current : inputRef.current
      revealMemoEditor(target, {
        preferredTop: 156,
        bottomGap: 36
      })
    }, 90)
    return () => clearTimeout(timer)
  }, [keyboardHeight, isEditing, memoEditingId, activeTabId, revealMemoEditor])

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
    const nextText = String(memoEditDraftsRef.current?.[key] ?? rightMemosRef.current?.[key] ?? "")
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

  function scrollMemoDocTabsToEnd(target, delay = 80) {
    setTimeout(() => {
      target?.scrollToEnd?.({ animated: true })
    }, delay)
  }

  function syncMemoEditorViewport(scope, key = "", field = "content") {
    if (scope === "all") {
      const normalizedKey = String(key ?? "").trim()
      if (!normalizedKey || memoEditingIdRef.current !== normalizedKey) return
      const normalizedField = field === "title" ? "title" : "content"
      if (normalizedField !== "title") return
      const target = getMemoCardEditorTarget(normalizedKey, normalizedField)
      revealMemoEditor(target, {
        preferredTop: 156,
        bottomGap: 36
      })
      return
    }
    if (!isEditingRef.current) return
    const normalizedField = field === "title" ? "title" : "content"
    if (normalizedField !== "title") return
    const target = normalizedField === "title" ? singleTitleInputRef.current : inputRef.current
    revealMemoEditor(target, {
      preferredTop: 156,
      bottomGap: 36
    })
  }

  function beginMemoEdit(id, focusField = "content", options = {}) {
    const key = String(id ?? "")
    if (!key) return
    setAllMemoWindowMenuOpen(false)
    const prevKey = String(memoEditingId ?? "")
    if (prevKey && prevKey !== key) autoSaveMemoEditIfNeeded(prevKey)
    const current = String(rightMemosRef.current?.[key] ?? rightMemosRef.current?.[id] ?? "")
    const currentView = buildRightMemoDocView(current, memoCardDocIds?.[key])
    setMemoCardFocusField(key, focusField)
    setMemoEditingId(key)
    setMemoExpandedMap((prev) => ({ ...(prev ?? {}), [key]: true }))
    setMemoCardDocIds((prev) => ({ ...(prev ?? {}), [key]: currentView.activeDocId ?? null }))
    setMemoEditDrafts((prev) => {
      const next = { ...(prev ?? {}), [key]: current }
      memoEditDraftsRef.current = next
      return next
    })
    if (options?.focus !== false) {
      setTimeout(() => {
        focusMemoEditorTarget(() => getMemoCardEditorTarget(key, focusField), focusField, 0, {
          selectionIndex: options?.selectionIndex
        })
      }, 80)
    }
    // Enter edit mode. Keep behavior simple and stable for editing.
  }

  function beginMemoEditFromTap(id, focusField = "content", event = null, textForSelection = "") {
    const selectionIndex =
      focusField === "content" ? getMemoSelectionIndexFromPress(event, textForSelection, 11) : null
    beginMemoEdit(id, focusField, { selectionIndex })
  }

  function beginSingleMemoEdit() {
    if (activeTabId === "all") return
    setSingleMemoDocId(singleMemoDocView.activeDocId ?? null)
    setIsEditing(true)
    singleMemoFocusFieldRef.current = "content"
    setTimeout(() => {
      focusMemoEditorTarget(() => inputRef.current, "content")
    }, 80)
    // Enter edit mode. Keep behavior simple and stable for editing.
  }

  function beginSingleMemoEditFromTap(event = null) {
    if (activeTabId === "all") return
    const content = String(singleMemoDocView.activeDoc?.content ?? "")
    const locationY = Number(event?.nativeEvent?.locationY)
    const selectionIndex = getMemoSelectionIndexFromPress(event, content, 0)
    setSingleMemoDocId(singleMemoDocView.activeDocId ?? null)
    setIsEditing(true)
    singleMemoFocusFieldRef.current = "content"
    setTimeout(() => {
      focusMemoEditorTarget(() => inputRef.current, "content", 0, { selectionIndex })
      revealMemoPressedLineSoon(() => inputRef.current, locationY, { preferredTop: 156, bottomGap: 18 })
    }, 80)
  }

  function openSingleMemoDoc(docId) {
    const nextDocId = String(docId ?? "").trim()
    if (!nextDocId || activeTabId === "all") return
    setSingleMemoDocId(nextDocId)
    setIsEditing(false)
    setSingleMemoSelectMode(false)
    setSingleMemoSelectedIds([])
    Keyboard.dismiss()
  }

  function closeSingleMemoDoc() {
    setSingleMemoDocId(null)
    setIsEditing(false)
    setSingleMemoSearch("")
    Keyboard.dismiss()
  }

  async function commitMemoEdit(id) {
    const key = String(id ?? "")
    if (!key) return
    const text = String(memoEditDraftsRef.current?.[key] ?? rightMemosRef.current?.[key] ?? "")
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

  function renderMemoDocTabs(docView, { onSelect, onAdd, onDelete, tabsRef } = {}) {
    if (!docView?.docs?.length) return null
    return (
      <View style={styles.memoDocTabsRow}>
        <ScrollView
          ref={tabsRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.memoDocTabs}
          style={styles.memoDocTabsScroll}
        >
          {docView.docs.map((doc, index) => {
            const active = doc.id === docView.activeDocId
            const canDeleteDoc = index > 0 && docView.docs.length > 1
            return (
              <View
                key={doc.id}
                style={[
                  styles.memoDocTab,
                  canDeleteDoc ? styles.memoDocTabWithDelete : styles.memoDocTabCentered,
                  active ? styles.memoDocTabActive : null,
                  isDark ? styles.memoDocTabDark : null,
                  active && isDark ? styles.memoDocTabActiveDark : null
                ]}
              >
                <Pressable onPress={() => onSelect?.(doc.id)} style={styles.memoDocTabPressable}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.memoDocTabText,
                      active ? styles.memoDocTabTextActive : null,
                      isDark ? styles.memoDocTabTextDark : null,
                      active && isDark ? styles.memoDocTabTextActiveDark : null
                    ]}
                  >
                    {getRightMemoDocDisplayTitle(doc.title, index)}
                  </Text>
                </Pressable>
                {canDeleteDoc ? (
                  <Pressable
                    onPress={() => {
                      const title = getRightMemoDocDisplayTitle(doc.title, index)
                      Alert.alert("메모 삭제", `"${title}"를 삭제할까요?`, [
                        { text: "취소", style: "cancel" },
                        {
                          text: "삭제",
                          style: "destructive",
                          onPress: () => onDelete?.(doc.id)
                        }
                      ])
                    }}
                    hitSlop={6}
                    style={[styles.memoDocTabDeleteBtn, active ? styles.memoDocTabDeleteBtnActive : null]}
                  >
                    <Text
                      style={[
                        styles.memoDocTabDeleteText,
                        active ? styles.memoDocTabDeleteTextActive : null,
                        isDark ? styles.memoDocTabDeleteTextDark : null
                      ]}
                    >
                      ×
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )
          })}
        </ScrollView>
        <Pressable
          onPress={onAdd}
          style={[styles.memoDocActionBtn, isDark ? styles.memoDocActionBtnDark : null]}
        >
          <Text style={[styles.memoDocActionText, isDark ? styles.memoDocActionTextDark : null]}>+</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.container, styles.listFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        subtitle={headerSubtitle}
        loading={loading}
        onRefresh={() => runOutsideContent(onRefresh)}
        onSignOut={() => runOutsideContent(onSignOut)}
        onTasks={onTasks ? () => runOutsideContent(onTasks) : null}
        tasksCount={tasksCount}
        onFilter={activeTabId === "all" ? () => setMemoFilterVisible(true) : null}
        filterActive={activeTabId === "all" ? !isAllMemoFiltersSelected : false}
        tone={tone}
        showLogo={false}
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
        fontScale={tabFontScale}
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
            onScroll={(event) => {
              memoScrollYRef.current = event?.nativeEvent?.contentOffset?.y ?? 0
            }}
            scrollEventThrottle={16}
          >
            {activeTabId === "all" ? (
              <View style={styles.memoAllList}>
                {filteredMemoWindows.length === 0 ? (
                  <View style={[styles.memoAllEmptyCard, isDark ? styles.memoAllEmptyCardDark : null]}>
                    <Text style={[styles.memoAllEmptyTitle, isDark ? styles.textDark : null]}>메모탭이 없습니다</Text>
                    <Text style={[styles.memoAllEmptyText, isDark ? styles.textMutedDark : null]}>
                      +버튼을 눌러 새 탭을 만들어보세요
                    </Text>
                  </View>
                ) : null}
                {[selectedAllMemoWindow].filter(Boolean).map((w) => {
                    const key = String(w.id ?? "")
                    const rawBody = String(rightMemos?.[key] ?? rightMemos?.[w.id] ?? "")
                    const isExpanded = true
                    const isEditingCard = memoEditingId === key
                    const draftValue = memoEditDrafts?.[key] ?? rawBody
                    const cardDocView = buildRightMemoDocView(draftValue, memoCardDocIds?.[key])
                    const cardBody = String(cardDocView.activeDoc?.content ?? "")
                    const activeDocTitle = getRightMemoDocDisplayTitle(cardDocView.activeDoc?.title, cardDocView.activeIndex)
                    const previewText = cardBody.trim() || "내용 없음"
                    return (
                      <View
                        key={w.id}
                        style={[
                          styles.memoAllCard,
                          isDark ? styles.cardDark : null,
                          { borderLeftWidth: 4, borderLeftColor: w.color || "#94a3b8" }
                        ]}
                      >
                        <View style={styles.memoAllHeader}>
                          <Pressable
                            style={styles.memoAllHeaderLeft}
                            onPress={() => setAllMemoWindowMenuOpen((prev) => !prev)}
                          >
                            <View style={[styles.memoAllDot, { backgroundColor: w.color || "#94a3b8" }]} />
                            <View style={styles.memoAllHeaderTextWrap}>
                              <View style={styles.memoAllTitleRow}>
                                <Text style={[styles.memoAllTitle, isDark ? styles.textDark : null]}>{w.title}</Text>
                                <Text style={[styles.memoAllHeaderDropdownChevron, isDark ? styles.textMutedDark : null]}>
                                  {allMemoWindowMenuOpen ? "▴" : "▾"}
                                </Text>
                              </View>
                            </View>
                          </Pressable>
                          <View style={styles.memoAllHeaderRight}>
                            {isEditingCard && (
                              <Pressable
                                onPress={() => commitMemoEdit(w.id)}
                                style={[styles.memoAllEditBtn, isDark ? styles.listPillDark : null]}
                              >
                                <Text style={[styles.memoAllEditBtnText, isDark ? styles.textDark : null]}>완료</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                        {allMemoWindowMenuOpen ? (
                          <View style={[styles.memoAllWindowMenu, isDark ? styles.memoAllWindowMenuDark : null]}>
                            <ScrollView
                              nestedScrollEnabled
                              showsVerticalScrollIndicator
                              style={styles.memoAllWindowMenuScroll}
                            >
                              {filteredMemoWindows.map((windowItem, index) => {
                                const active =
                                  String(windowItem?.id ?? "").trim() === String(selectedAllMemoWindow?.id ?? "").trim()
                                return (
                                  <Pressable
                                    key={windowItem.id}
                                    onPress={() => {
                                      setAllMemoWindowId(String(windowItem?.id ?? "").trim() || null)
                                      setAllMemoWindowMenuOpen(false)
                                    }}
                                    style={[
                                      styles.memoAllWindowMenuItem,
                                      index === 0 ? styles.memoAllWindowMenuItemFirst : null,
                                      active ? styles.memoAllWindowMenuItemActive : null,
                                      isDark ? styles.memoAllWindowMenuItemDark : null,
                                      active && isDark ? styles.memoAllWindowMenuItemActiveDark : null
                                    ]}
                                  >
                                    <View style={styles.memoAllWindowMenuItemLeft}>
                                      <View style={[styles.memoAllDot, { backgroundColor: windowItem.color || "#94a3b8" }]} />
                                      <Text
                                        numberOfLines={1}
                                        style={[
                                          styles.memoAllWindowMenuItemText,
                                          active ? styles.memoAllWindowMenuItemTextActive : null,
                                          isDark ? styles.textDark : null
                                        ]}
                                      >
                                        {windowItem.title}
                                      </Text>
                                    </View>
                                    {active ? <Text style={styles.memoAllWindowMenuCheck}>✓</Text> : null}
                                  </Pressable>
                                )
                              })}
                            </ScrollView>
                          </View>
                        ) : null}
                        {isExpanded ? (
                          <>
                            {renderMemoDocTabs(cardDocView, {
                              onSelect: (docId) => setMemoCardActiveDoc(key, docId),
                              onAdd: () => addMemoCardDoc(key),
                              onDelete: (docId) => removeMemoCardDoc(key, docId),
                              tabsRef: (ref) => {
                                memoDocTabsScrollRefs.current[key] = ref
                              }
                            })}
                            <View style={styles.memoAllMetaRow}>
                              {isEditingCard ? (
                                <TextInput
                                  ref={(ref) => {
                                    if (ref) memoTitleInputRefs.current[key] = ref
                                  }}
                                  value={String(cardDocView.activeDoc?.title ?? "")}
                                  onFocus={() => handleMemoCardFieldFocus(key, "title")}
                                  onBlur={() => handleMemoCardFieldBlur(key, "title")}
                                  onChangeText={(t) => updateMemoCardDocTitle(key, cardDocView.activeDocId, t)}
                                  placeholder={getRightMemoFallbackTitle(cardDocView.activeIndex)}
                                  placeholderTextColor="#9aa3b2"
                                  style={[styles.memoAllDocTitleInput, isDark ? styles.memoAllDocTitleInputDark : null]}
                                />
                              ) : (
                                <Pressable
                                  onPress={() => beginMemoEditFromTap(w.id, "title")}
                                  style={[styles.memoAllDocBadge, isDark ? styles.memoAllDocBadgeDark : null]}
                                >
                                  <Text style={[styles.memoAllDocBadgeText, isDark ? styles.textDark : null]} numberOfLines={1}>
                                    {activeDocTitle}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                            <TextInput
                              ref={(ref) => {
                                if (ref) memoInputRefs.current[key] = ref
                              }}
                              value={cardBody}
                              autoFocus={false}
                              onFocus={() => {
                                if (!isEditingCard) beginMemoEdit(w.id, "content", { focus: false })
                                handleMemoCardFieldFocus(key, "content")
                              }}
                              onPressIn={(event) => {
                                const locationY = Number(event?.nativeEvent?.locationY)
                                revealMemoPressedLineSoon(
                                  () => getMemoCardEditorTarget(key, "content"),
                                  locationY,
                                  { preferredTop: 156, bottomGap: 18 }
                                )
                              }}
                              onBlur={() => handleMemoCardFieldBlur(key, "content")}
                              onChangeText={(t) => updateMemoCardDocContent(key, cardDocView.activeDocId, t)}
                              placeholder="내용 없음"
                              placeholderTextColor="#9aa3b2"
                              multiline
                              scrollEnabled={false}
                              onContentSizeChange={() => syncMemoEditorViewport("all", key, "content")}
                              underlineColorAndroid="transparent"
                              textAlignVertical="top"
                              style={[
                                styles.memoAllInput,
                                styles.memoAllInputPreview,
                                { minHeight: memoAllPreviewMinHeight },
                                { fontSize: memoFontSize, lineHeight: memoLineHeight },
                                isDark ? styles.inputDark : null,
                                !isEditingCard && isDark ? styles.memoAllInputPreviewDark : null
                              ]}
                            />
                          </>
                        ) : (
                          <Pressable
                            onPress={(event) => beginMemoEditFromTap(w.id, "content", event, cardBody)}
                            style={[styles.memoAllPreviewCard, isDark ? styles.memoAllPreviewCardDark : null]}
                          >
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.memoAllBody,
                                { fontSize: memoFontSize, lineHeight: memoLineHeight },
                                isDark ? styles.textMutedDark : null
                              ]}
                            >
                              {previewText}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )
                  })}
              </View>
            ) : (
              <View style={styles.memoSinglePane}>
                <View style={[styles.memoSingleHeader, isDark ? styles.memoSingleHeaderDark : null]}>
                  <View style={styles.memoSingleHeaderLeft}>
                    <View style={[styles.memoAllDot, { backgroundColor: activeWindow?.color || "#94a3b8" }]} />
                    <View style={styles.memoSingleHeaderTextWrap}>
                      <Text style={[styles.memoSingleTitle, isDark ? styles.textDark : null]}>
                        {activeWindow?.title || "\uBA54\uBAA8"}
                      </Text>
                      {isEditing ? (
                        <Text style={[styles.memoSingleSubtitle, isDark ? styles.textMutedDark : null]}>
                          {"\uC81C\uBAA9\uACFC \uB0B4\uC6A9\uC744 \uB530\uB85C \uC815\uB9AC\uD558\uB294 \uBA54\uBAA8"}
                        </Text>
                      ) : singleMemoSelectMode ? (
                        <Text style={[styles.memoSingleSubtitle, isDark ? styles.textMutedDark : null]}>
                          {singleMemoSelectedCount > 0
                            ? `${singleMemoSelectedCount}\uAC1C \uC120\uD0DD\uB428`
                            : "\uC0AD\uC81C\uD560 \uBA54\uBAA8\uB97C \uC120\uD0DD\uD558\uC138\uC694"}
                        </Text>
                      ) : showSingleMemoViewer ? (
                        <Text style={[styles.memoSingleSubtitle, isDark ? styles.textMutedDark : null]}>
                          {getRightMemoDocDisplayTitle(singleMemoDocView.activeDoc?.title, singleMemoDocView.activeIndex)}
                        </Text>
                      ) : (singleMemoDocView?.docs?.length ?? 0) > 0 ? (
                        <Text style={[styles.memoSingleSubtitle, isDark ? styles.textMutedDark : null]}>
                          {`${singleMemoDocView.docs.length}개 메모`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {isEditing ? (
                    <View style={styles.memoSingleActionRow}>
                      <Pressable
                        onPress={() => {
                          finishSingleEdit(activeTabId, true)
                          Keyboard.dismiss()
                        }}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnPrimary,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnPrimaryDark : null
                        ]}
                      >
                        <Text style={styles.memoSingleActionBtnPrimaryText}>완료</Text>
                      </Pressable>
                    </View>
                  ) : singleMemoSelectMode ? (
                    <View style={styles.memoSingleActionRow}>
                      <Pressable
                        onPress={toggleSelectAllSingleMemos}
                        disabled={singleMemoSelectableIds.length === 0}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnNeutral,
                          singleMemoSelectableIds.length === 0 ? styles.memoSingleActionBtnDisabled : null,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnNeutralDark : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.memoSingleActionBtnNeutralText,
                            singleMemoSelectableIds.length === 0 ? styles.memoSingleActionBtnDisabledText : null
                          ]}
                        >
                          {areAllSingleMemosSelected ? "전체 해제" : "모두 선택"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={confirmDeleteSelectedSingleMemos}
                        disabled={singleMemoSelectedCount === 0}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnTextual,
                          styles.memoSingleActionBtnDangerWide,
                          singleMemoSelectedCount === 0 ? styles.memoSingleActionBtnDisabled : null,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnDangerDark : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.memoSingleActionBtnDangerText,
                            singleMemoSelectedCount === 0 ? styles.memoSingleActionBtnDisabledText : null
                          ]}
                        >
                          삭제
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={toggleSingleMemoSelectMode}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnPrimary,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnPrimaryDark : null
                        ]}
                      >
                        <Text style={styles.memoSingleActionBtnPrimaryText}>완료</Text>
                      </Pressable>
                    </View>
                  ) : showSingleMemoViewer ? (
                    <View style={styles.memoSingleActionRow}>
                      <Pressable
                        onPress={closeSingleMemoDoc}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnNeutral,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnNeutralDark : null
                        ]}
                      >
                        <Text style={styles.memoSingleActionBtnNeutralText}>목록</Text>
                      </Pressable>
                      <Pressable
                        onPress={beginSingleMemoEdit}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnPrimary,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnPrimaryDark : null
                        ]}
                      >
                        <Text style={styles.memoSingleActionBtnPrimaryText}>편집</Text>
                      </Pressable>
                    </View>
                  ) : canManageSingleMemoDocs ? (
                    <View style={styles.memoSingleActionRow}>
                      <Pressable
                        onPress={toggleSingleMemoSelectMode}
                        style={[
                          styles.memoSingleActionBtn,
                          styles.memoSingleActionBtnCompact,
                          styles.memoSingleActionBtnPrimary,
                          isDark ? styles.memoSingleActionBtnDark : null,
                          isDark ? styles.memoSingleActionBtnPrimaryDark : null
                        ]}
                      >
                        <Text style={styles.memoSingleActionBtnPrimaryText}>선택</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {singleMemoDocView?.docs?.length > 0 && (isEditing || showSingleMemoViewer) ? (
                  renderMemoDocTabs(singleMemoDocView, {
                    tabsRef: singleMemoDocTabsScrollRef,
                    onSelect: (docId) => {
                      if (isEditing) finishSingleEdit(activeTabId, true)
                      openSingleMemoDoc(docId)
                    },
                    onAdd: addSingleMemoDoc,
                    onDelete: (docId) => removeSingleMemoDocsByIds([docId])
                  })
                ) : null}

                {isEditing ? (
                  <View style={[styles.memoSingleEditorCard, isDark ? styles.memoSingleEditorCardDark : null]}>
                    <View style={styles.memoSingleFieldBlock}>
                      <Text style={[styles.memoSingleFieldLabel, isDark ? styles.textMutedDark : null]}>제목</Text>
                      <TextInput
                        ref={singleTitleInputRef}
                        value={String(singleMemoDocView.activeDoc?.title ?? "")}
                        onFocus={() => handleSingleMemoFieldFocus("title")}
                        onBlur={() => handleSingleMemoFieldBlur("title")}
                        onChangeText={updateSingleMemoDocTitle}
                        placeholder={getRightMemoFallbackTitle(singleMemoDocView.activeIndex)}
                        placeholderTextColor="#9aa3b2"
                        style={[styles.memoSingleTitleInput, isDark ? styles.memoSingleFieldDark : null, isDark ? styles.textDark : null]}
                      />
                    </View>
                    <View style={styles.memoSingleFieldBlock}>
                      <Text style={[styles.memoSingleFieldLabel, isDark ? styles.textMutedDark : null]}>내용</Text>
                      <View style={[styles.memoSingleContentField, isDark ? styles.memoSingleFieldDark : null]}>
                        <TextInput
                          ref={inputRef}
                          value={String(singleMemoDocView.activeDoc?.content ?? "")}
                          autoFocus={false}
                          onFocus={() => handleSingleMemoFieldFocus("content")}
                          onBlur={() => handleSingleMemoFieldBlur("content")}
                          onChangeText={updateSingleMemoDocContent}
                          placeholder={placeholder}
                          multiline
                          scrollEnabled={false}
                          onContentSizeChange={() => syncMemoEditorViewport("single", "", "content")}
                          disableFullscreenUI
                          underlineColorAndroid="transparent"
                          textAlignVertical="top"
                          style={[
                            styles.memoSingleBodyInput,
                            {
                              fontSize: memoFontSize,
                              lineHeight: memoLineHeight
                            },
                            isDark ? styles.textDark : null
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                ) : showSingleMemoViewer ? (
                  <View
                    style={[styles.memoSingleCard, isDark ? styles.memoSingleCardDark : null]}
                  >
                    <Text style={[styles.memoSingleFieldLabel, isDark ? styles.textMutedDark : null]}>제목</Text>
                    <Text style={[styles.memoSingleReadTitle, isDark ? styles.textDark : null]}>
                      {getRightMemoDocDisplayTitle(singleMemoDocView.activeDoc?.title, singleMemoDocView.activeIndex)}
                    </Text>
                    <View style={[styles.memoSingleReadDivider, isDark ? styles.memoSingleReadDividerDark : null]} />
                    <Text style={[styles.memoSingleFieldLabel, isDark ? styles.textMutedDark : null]}>내용</Text>
                    <Pressable onPress={beginSingleMemoEditFromTap}>
                      <Text
                        style={[
                          styles.memoSingleReadBody,
                          { fontSize: memoFontSize, lineHeight: memoLineHeight },
                          isDark ? styles.textDark : null,
                          !String(singleMemoDocView.activeDoc?.content ?? "").trim() ? styles.textMutedDark : null
                        ]}
                      >
                        {String(singleMemoDocView.activeDoc?.content ?? "").trim() || "내용이 없습니다. 눌러서 바로 적어보세요."}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={[styles.memoSingleSearchRow, isDark ? styles.memoSingleSearchRowDark : null]}>
                      <TextInput
                        value={singleMemoSearch}
                        onChangeText={setSingleMemoSearch}
                        placeholder="검색"
                        placeholderTextColor="#9aa3b2"
                        style={[styles.memoSingleSearchInput, isDark ? styles.textDark : null]}
                      />
                      <Text style={[styles.memoSingleSearchIcon, isDark ? styles.textMutedDark : null]}>⌕</Text>
                    </View>

                    <View style={styles.memoSingleList}>
                      {filteredSingleMemoItems.map((item) => (
                        <View
                          key={item.id}
                          style={[
                            styles.memoSingleItem,
                            isDark ? styles.memoSingleItemDark : null,
                            singleMemoSelectedIds.includes(item.id) ? styles.memoSingleItemSelected : null,
                            isDark && singleMemoSelectedIds.includes(item.id) ? styles.memoSingleItemSelectedDark : null
                          ]}
                        >
                          {singleMemoSelectMode ? (
                            <Pressable
                              onPress={() => toggleSingleMemoSelection(item.id)}
                              style={[
                                styles.memoSingleSelectDot,
                                singleMemoSelectedIds.includes(item.id) ? styles.memoSingleSelectDotActive : null
                              ]}
                              hitSlop={8}
                            >
                              {singleMemoSelectedIds.includes(item.id) ? (
                                <Text style={styles.memoSingleSelectDotActiveText}>✓</Text>
                              ) : null}
                            </Pressable>
                          ) : null}
                          <Pressable
                            onPress={() => {
                              if (singleMemoSelectMode) {
                                toggleSingleMemoSelection(item.id)
                                return
                              }
                              openSingleMemoDoc(item.id)
                            }}
                            style={styles.memoSingleItemPressable}
                          >
                            <View style={styles.memoSingleItemMain}>
                              <Text numberOfLines={1} style={[styles.memoSingleItemTitle, isDark ? styles.textDark : null]}>
                                {item.title || "\uC81C\uBAA9 \uC5C6\uC74C"}
                              </Text>
                              <Text
                                numberOfLines={2}
                                style={[
                                  styles.memoSingleItemPreview,
                                  { fontSize: memoFontSize, lineHeight: memoLineHeight },
                                  isDark ? styles.textMutedDark : null
                                ]}
                              >
                                {item.preview || "\uB0B4\uC6A9 \uC5C6\uC74C"}
                              </Text>
                            </View>
                          </Pressable>
                        </View>
                      ))}
                      {filteredSingleMemoItems.length === 0 ? (
                        <View style={[styles.memoSingleEmpty, isDark ? styles.memoSingleEmptyDark : null]}>
                          <Text style={[styles.memoSingleEmptyTitle, isDark ? styles.textDark : null]}>표시할 메모가 없습니다.</Text>
                          <Text style={[styles.memoSingleEmptyText, isDark ? styles.textMutedDark : null]}>
                            검색어를 바꾸거나 새 메모를 추가하세요.
                          </Text>
                        </View>
                      ) : null}
                    </View>

                  </>
                )}
              </View>
            )}
          </ScrollView>
          {activeTabId !== "all" && !isEditing && !singleMemoSelectMode ? (
            <Pressable onPress={addSingleMemoDoc} style={styles.memoSingleFab}>
              <Text style={styles.memoSingleFabText}>+</Text>
            </Pressable>
          ) : null}
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
  const editorScrollRef = useRef(null)
  const contentDraftRef = useRef("")
  const [initialSnapshot, setInitialSnapshot] = useState(null)
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [content, setContent] = useState("")
  const [entryType, setEntryType] = useState("task")
  const [taskCompleted, setTaskCompleted] = useState(false)
  const [category, setCategory] = useState("__general__")
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [alarmLeadMinutes, setAlarmLeadMinutes] = useState(0)
  const [repeatType, setRepeatType] = useState("none")
  const [repeatInterval, setRepeatInterval] = useState(1)
  const [repeatDays, setRepeatDays] = useState([])
  const [repeatUntil, setRepeatUntil] = useState("")
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [keyboardScreenY, setKeyboardScreenY] = useState(0)
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
  const [weekDaySheetVisible, setWeekDaySheetVisible] = useState(false)
  const [categorySheetVisible, setCategorySheetVisible] = useState(false)

  useEffect(() => {
    if (!visible) {
      setInitialSnapshot(null)
      return
    }
    const repeatMeta = normalizeRepeatMeta(draft ?? {})
    const draftTimeRange = normalizePlanTimeRange(draft ?? {})
    const entryMeta = getPlanEntryMeta(draft?.content)
    const initialEntryType = "task"
    const initialTaskCompleted =
      draft?.taskCompleted ?? draft?.task_completed ?? entryMeta.taskCompleted
    const initialState = buildPlanEditorSnapshot({
      date: String(draft?.date ?? ""),
      time: draftTimeRange.time,
      endTime: draftTimeRange.endTime,
      content: entryMeta.text,
      entryType: initialEntryType,
      taskCompleted: initialTaskCompleted,
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
    contentDraftRef.current = initialState.content
    setEntryType(initialState.entryType)
    setTaskCompleted(initialState.taskCompleted)
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
    setWeekDaySheetVisible(false)
    setCategorySheetVisible(false)
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
      setKeyboardScreenY(Number.isFinite(e?.endCoordinates?.screenY) ? e.endCoordinates.screenY : 0)
    })
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0)
      setKeyboardScreenY(0)
    })
    return () => {
      showSub?.remove?.()
      hideSub?.remove?.()
      setKeyboardHeight(0)
      setKeyboardScreenY(0)
    }
  }, [visible])

  const isKeyboardOpen = keyboardHeight > 0
  const safeBottomInset = useMemo(
    () => Math.max(insets.bottom, Platform.OS === "android" ? 34 : 12),
    [insets.bottom]
  )
  const keyboardCoveredHeight = useMemo(() => {
    if (!isKeyboardOpen) return 0
    const screenHeight = Dimensions.get("screen").height
    const screenBased = keyboardScreenY > 0 ? Math.max(0, screenHeight - keyboardScreenY) : 0
    return Math.max(keyboardHeight, screenBased)
  }, [isKeyboardOpen, keyboardHeight, keyboardScreenY])
  const editorBodyBottomPadding = useMemo(
    () => (isKeyboardOpen ? keyboardCoveredHeight + 28 : 8),
    [isKeyboardOpen, keyboardCoveredHeight]
  )
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
    const items = [{ key: "__general__", label: "없음" }]
    for (const w of windows ?? []) {
      if (!w || w.id === "all") continue
      items.push({ key: String(w.title), label: String(w.title), color: w.color || "#94a3b8" })
    }
    return items
  }, [windows])
  const selectedCategoryOption = useMemo(
    () => options.find((opt) => String(opt?.key ?? "") === String(category ?? "")) ?? options[0],
    [options, category]
  )

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
  const isRepeatUntilActive = isRecurring || Boolean(repeatUntil)
  const shouldShowEditorMeta = !isKeyboardOpen
  const hasSavedDraft = draft?.id != null && String(draft.id).trim() !== ""
  const repeatWeekLabels = useMemo(() => ["일", "월", "화", "수", "목", "금", "토"], [])
  const repeatWeekSummary = useMemo(() => {
    const days = normalizeRepeatDays(repeatDays)
    if (days.length === 0) return "요일 선택"
    return days.map((day) => repeatWeekLabels[day] ?? "").filter(Boolean).join(" ")
  }, [repeatDays, repeatWeekLabels])
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
        entryType,
        taskCompleted,
        category,
        alarmEnabled,
        alarmLeadMinutes,
        repeatType,
        repeatInterval,
        repeatDays,
        repeatUntil
      }),
    [
      date,
      time,
      endTime,
      content,
      entryType,
      taskCompleted,
      category,
      alarmEnabled,
      alarmLeadMinutes,
      repeatType,
      repeatInterval,
      repeatDays,
      repeatUntil
    ]
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

  function applyRepeatUntilDate(nextDateKey) {
    const key = String(nextDateKey ?? "").trim()
    if (!key) return
    setRepeatUntil(key)
    if (repeatType === "none") {
      setRepeatType("daily")
      setRepeatInterval(1)
      setRepeatDays([])
    }
  }

  function applyOpenEndedRepeat() {
    setRepeatUntil("")
    if (repeatType === "none") {
      setRepeatType("daily")
      setRepeatInterval(1)
      setRepeatDays([])
    }
  }

  function clearRepeatUntilDate() {
    setRepeatUntil("")
    setRepeatType("none")
    setRepeatInterval(1)
    setRepeatDays([])
  }

  function handleSave() {
    const latestContent = String(contentDraftRef.current ?? content ?? "")
    if (!date) return
    if (!latestContent.trim()) return
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
    const nextContent = buildPlanContentWithMeta(latestContent, "task", taskCompleted)
    const payload = {
      ...(draft ?? {}),
      date,
      time: normalizedTime,
      end_time: normalizedEndTime || null,
      content: nextContent,
      category_id: category,
      alarm_enabled: Boolean(normalizedTime) ? Boolean(alarmEnabled) : false,
      alarm_lead_minutes: Boolean(normalizedTime) && Boolean(alarmEnabled) ? normalizeAlarmLeadMinutes(alarmLeadMinutes) : 0,
      repeat_type: repeatType,
      repeat_interval: repeatType === "none" ? 1 : normalizeRepeatInterval(repeatInterval),
      repeat_days: repeatType === "weekly" ? normalizeRepeatDays(repeatDays) : null,
      repeat_until: repeatType === "none" ? null : String(repeatUntil ?? "").trim() || null,
      original_repeat_type: String(draft?.repeat_type ?? "none"),
      original_repeat_interval: draft?.original_repeat_interval ?? draft?.repeat_interval ?? 1,
      original_repeat_days: draft?.original_repeat_days ?? draft?.repeat_days ?? null,
      original_repeat_until: draft?.original_repeat_until ?? draft?.repeat_until ?? null,
      original_series_id: String(draft?.series_id ?? "")
    }
    if (hasSavedDraft && (hasSeriesSource || isRecurring)) {
      Alert.alert("반복 일정 수정", "'이번만'을 선택하면 해당 날짜의 항목만 일반 일정/Task로 바뀝니다.", [
        { text: "취소", style: "cancel" },
        { text: "이번만", onPress: () => onSave?.({ ...payload, edit_scope: "single" }) },
        { text: "이후", onPress: () => onSave?.({ ...payload, edit_scope: "future" }) },
        { text: "전체", onPress: () => onSave?.({ ...payload, edit_scope: "all" }) }
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
    if (!hasSavedDraft) {
      onClose?.()
      return
    }
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
        },
        {
          text: "전체",
          style: "destructive",
          onPress: () => onDelete?.({ ...(draft ?? {}), delete_scope: "all" })
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
              marginBottom: safeBottomInset
            }
          ]}
        >
          <View style={styles.editorHeader}>
            <View style={styles.editorHeaderMain}>
              <Pressable
                onPress={() => setCategorySheetVisible(true)}
                style={[styles.editorHeaderCategoryBtn, isDark ? styles.editorHeaderCategoryBtnDark : null]}
              >
                {selectedCategoryOption?.key !== "__general__" ? (
                  <View style={[styles.tabDot, { backgroundColor: selectedCategoryOption?.color || "#94a3b8" }]} />
                ) : null}
                <Text
                  numberOfLines={1}
                  style={[styles.editorHeaderCategoryText, isDark ? styles.textDark : null]}
                >
                  {selectedCategoryOption?.label || "없음"}
                </Text>
                <Text style={[styles.editorHeaderCategoryChevron, isDark ? styles.textMutedDark : null]}>⌄</Text>
              </Pressable>
            </View>
            <View style={styles.editorHeaderActions}>
              <Pressable onPress={requestClose} style={[styles.editorCloseIconBtn, isDark ? styles.editorCloseBtnDark : null]}>
                <Text style={[styles.editorCloseIconText, isDark ? styles.textDark : null]}>×</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            ref={editorScrollRef}
            style={styles.editorBody}
            contentContainerStyle={[styles.editorBodyContent, { paddingBottom: editorBodyBottomPadding }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.editorMetaRow, styles.editorSectionGapLarge]}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>내용</Text>
              <View style={[styles.editorTextareaWrap, isDark ? styles.editorTextareaWrapDark : null]}>
                <TextInput
                  value={content}
                  onChangeText={(nextText) => {
                    contentDraftRef.current = nextText
                    setContent(nextText)
                  }}
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

            {shouldShowEditorMeta ? (
              <View style={styles.editorMetaRow}>
                <View style={[styles.editorMetaLabelRow, styles.editorMetaLabelRowTight]}>
                  <Text style={[styles.editorMetaLabel, styles.editorMetaLabelInline, isDark ? styles.textMutedDark : null]}>
                    일정
                  </Text>
                </View>
                <View style={styles.editorInlinePair}>
                  <Pressable
                    style={[styles.editorPickerRow, styles.editorInlineHalf, isDark ? styles.editorPickerRowDark : null]}
                    accessibilityRole="button"
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
                      <Text numberOfLines={1} style={[styles.editorPickerValue, isDark ? styles.textDark : null]}>
                        {formatDateWithWeekday(date)}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={[styles.editorPickerRow, styles.editorInlineHalf, isDark ? styles.editorPickerRowDark : null]}
                    accessibilityRole="button"
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
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.editorPickerValue,
                          !isRepeatUntilActive ? styles.editorPickerValueMuted : null,
                          isDark ? styles.textDark : null,
                          !isRepeatUntilActive && isDark ? styles.textMutedDark : null
                        ]}
                      >
                        {isRecurring && !repeatUntil
                          ? "계속 반복"
                          : isRepeatUntilActive && repeatUntil
                            ? formatDateWithWeekday(repeatUntil)
                            : "종료일 없음"}
                      </Text>
                      <Pressable
                        onPress={(event) => {
                          event?.stopPropagation?.()
                          applyOpenEndedRepeat()
                        }}
                        style={[
                          styles.editorPickerClearPill,
                          isDark ? styles.editorPickerClearPillDark : null,
                          isRecurring && !repeatUntil ? styles.editorPickerContinuePillActive : null
                        ]}
                        hitSlop={8}
                      >
                        <Text
                          style={[
                            styles.editorPickerClearText,
                            isDark ? styles.textDark : null,
                            isRecurring && !repeatUntil ? styles.editorPickerContinueTextActive : null
                          ]}
                        >
                          계속
                        </Text>
                      </Pressable>
                      {isRepeatUntilActive ? (
                        <Pressable
                          onPress={(event) => {
                            event?.stopPropagation?.()
                            clearRepeatUntilDate()
                          }}
                          style={[styles.editorPickerClearPill, isDark ? styles.editorPickerClearPillDark : null]}
                          hitSlop={8}
                        >
                          <Text style={[styles.editorPickerClearText, isDark ? styles.textDark : null]}>없음</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {isRepeatUntilActive ? (
              <View style={[styles.editorMetaRow, styles.editorRepeatMetaRow]}>
                <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>반복</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorCategoryRow}>
                  {repeatTypeOptions.map((opt) => {
                    const active = opt.key === repeatType
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => {
                          setRepeatType(opt.key)
                          if (opt.key === "none") {
                            clearRepeatUntilDate()
                            return
                          }
                          if (!repeatUntil) setRepeatUntil(date)
                        }}
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
                      {repeatType === "weekly" ? (
                        <Pressable
                          style={[styles.editorRepeatInlineChoice, isDark ? styles.editorRepeatInlineChoiceDark : null]}
                          onPress={() => setWeekDaySheetVisible(true)}
                        >
                          {normalizeRepeatDays(repeatDays).length > 0 ? (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.editorRepeatInlineChoiceText,
                                isDark ? styles.textDark : null
                              ]}
                            >
                              {normalizeRepeatDays(repeatDays).map((dayIndex, index) => (
                                <Text
                                  key={`repeat-inline-day-${dayIndex}`}
                                  style={[
                                    dayIndex === 0 ? styles.editorRepeatInlineSunday : null,
                                    dayIndex === 6 ? styles.editorRepeatInlineSaturday : null
                                  ]}
                                >
                                  {index > 0 ? " " : ""}
                                  {repeatWeekLabels[dayIndex] ?? ""}
                                </Text>
                              ))}
                            </Text>
                          ) : (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.editorRepeatInlineChoiceText,
                                isDark ? styles.textDark : null
                              ]}
                            >
                              {repeatWeekSummary}
                            </Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.editorMetaRow, styles.editorSectionGapLarge]}>
              <View style={[styles.editorMetaLabelRow, styles.editorMetaLabelRowTight]}>
                <Text style={[styles.editorMetaLabel, styles.editorMetaLabelInline, isDark ? styles.textMutedDark : null]}>시간</Text>
              </View>
              <Pressable
                onPress={() => {
                  if (time) {
                    setTime("")
                    setEndTime("")
                    setAlarmEnabled(false)
                    return
                  }
                  setTime("09:00")
                  setEndTime("10:00")
                  setAlarmEnabled(true)
                }}
                style={[styles.editorTimeSettingRow, isDark ? styles.editorTimeSettingRowDark : null]}
              >
                <View
                  style={[
                    styles.editorTimeSettingCheck,
                    isDark ? styles.editorTimeSettingCheckDark : null,
                    time ? styles.editorTimeSettingCheckActive : null
                  ]}
                >
                  {time ? <Text style={styles.editorTimeSettingCheckText}>✓</Text> : null}
                </View>
                <Text style={[styles.editorTimeSettingText, isDark ? styles.textDark : null]}>시간 설정</Text>
              </Pressable>
              {time ? (
              <View style={[styles.editorInlinePair, styles.editorTimeFieldsRow]}>
                <Pressable
                  style={[styles.editorPickerRow, styles.editorInlineTimeStart, isDark ? styles.editorPickerRowDark : null]}
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
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.editorPickerValue,
                        !time ? styles.editorPickerValueMuted : null,
                        isDark ? styles.textDark : null,
                        !time && isDark ? styles.textMutedDark : null
                      ]}
                    >
                      {time ? timeDisplay : "시간 선택 안함"}
                    </Text>
                    {time ? (
                      <Pressable
                        onPress={(event) => {
                          event?.stopPropagation?.()
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
                  </View>
                </Pressable>
                <Pressable
                  style={[
                    styles.editorPickerRow,
                    styles.editorInlineTimeEnd,
                    !time ? styles.editorPickerRowDisabled : null,
                    isDark ? styles.editorPickerRowDark : null
                  ]}
                  onPress={() => {
                    if (!time) {
                      Alert.alert("입력 안내", "종료시간을 쓰려면 시작시간을 먼저 선택해주세요.")
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
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.editorPickerValue,
                        !endTime ? styles.editorPickerValueMuted : null,
                        isDark ? styles.textDark : null,
                        !endTime && isDark ? styles.textMutedDark : null
                      ]}
                    >
                      {endTime ? endTimeDisplay : "종료시간 없음"}
                    </Text>
                    {endTime ? (
                      <Pressable
                        onPress={(event) => {
                          event?.stopPropagation?.()
                          setEndTime("")
                        }}
                        style={[styles.editorPickerClearPill, isDark ? styles.editorPickerClearPillDark : null]}
                        hitSlop={8}
                      >
                        <Text style={[styles.editorPickerClearText, isDark ? styles.textDark : null]}>없음</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              </View>
              ) : null}
            </View>

            {time ? (
            <View style={[styles.editorMetaRow, styles.editorSectionGapLarge]}>
              <Text style={[styles.editorMetaLabel, isDark ? styles.textMutedDark : null]}>알림</Text>
              <View style={[styles.editorAlarmLeadRow, !time ? styles.editorAlarmLeadRowDisabled : null]}>
                <Pressable
                  disabled={!time}
                  onPress={() => {
                    if (!time) return
                    setAlarmEnabled(false)
                  }}
                  style={[
                    styles.editorAlarmLeadPill,
                    isDark ? styles.editorAlarmLeadPillDark : null,
                    time && !alarmEnabled ? (isDark ? styles.editorAlarmLeadPillActiveDark : styles.editorAlarmLeadPillActive) : null
                  ]}
                >
                  <Text
                    style={[
                      styles.editorAlarmLeadText,
                      isDark ? styles.textDark : null,
                      time && !alarmEnabled ? styles.editorAlarmLeadTextActive : null,
                      !time ? styles.editorAlarmLeadTextDisabled : null
                    ]}
                  >
                    알림 없음
                  </Text>
                </Pressable>
                {alarmLeadOptions.map((opt) => {
                  const active = Boolean(time) && alarmEnabled && normalizeAlarmLeadMinutes(alarmLeadMinutes) === opt.key
                  return (
                    <Pressable
                      key={`editor-alarm-lead-${opt.key}`}
                      disabled={!time}
                      onPress={() => {
                        if (!time) return
                        setAlarmEnabled(true)
                        setAlarmLeadMinutes(opt.key)
                      }}
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
                          active ? styles.editorAlarmLeadTextActive : null,
                          !time ? styles.editorAlarmLeadTextDisabled : null
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
            ) : null}

            <View style={[styles.editorActions, isKeyboardOpen ? styles.editorActionsCompact : null]}>
              <Pressable onPress={confirmDelete} style={styles.editorDangerBtn}>
                <Text style={styles.editorDangerText}>삭제</Text>
              </Pressable>
              <Pressable onPress={handleSave} style={styles.editorSaveBtn}>
                <Text style={styles.editorSaveText}>저장</Text>
              </Pressable>
            </View>
          </ScrollView>
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
          applyRepeatUntilDate(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
        }}
      />
      <OptionSelectSheet
        visible={categorySheetVisible}
        title="탭 선택"
        options={options}
        selectedKey={category}
        tone={tone}
        onSelect={(key) => {
          setCategory(String(key ?? "__general__") || "__general__")
          setCategorySheetVisible(false)
        }}
        onClose={() => setCategorySheetVisible(false)}
      />
      <WeekdaySelectSheet
        visible={weekDaySheetVisible}
        title="반복 요일"
        labels={repeatWeekLabels}
        values={normalizeRepeatDays(repeatDays)}
        tone={tone}
        onToggle={toggleRepeatDay}
        onClose={() => setWeekDaySheetVisible(false)}
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
            applyRepeatUntilDate(dateToKey(selected.getFullYear(), selected.getMonth() + 1, selected.getDate()))
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

function OptionSelectSheet({ visible, title, options = [], selectedKey, tone = "light", onSelect, onClose }) {
  const isDark = tone === "dark"
  if (!visible) return null
  return (
    <Modal transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetCard, styles.choiceSheetCard, isDark ? styles.sheetCardDark : null]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>{title}</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onClose} style={[styles.sheetBtnGhost, isDark ? styles.sheetBtnGhostDark : null]}>
                <Text style={[styles.sheetBtnGhostText, isDark ? styles.textDark : null]}>닫기</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.choiceSheetList}>
            {options.map((opt) => {
              const active = String(opt?.key) === String(selectedKey)
              return (
                <Pressable
                  key={`choice-${opt?.key}`}
                  onPress={() => onSelect?.(opt?.key)}
                  style={[
                    styles.choiceSheetItem,
                    isDark ? styles.choiceSheetItemDark : null,
                    active ? styles.choiceSheetItemActive : null,
                    active && isDark ? styles.choiceSheetItemActiveDark : null
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceSheetItemText,
                      isDark ? styles.textDark : null,
                      active ? styles.choiceSheetItemTextActive : null
                    ]}
                  >
                    {opt?.label}
                  </Text>
                  {active ? <Text style={styles.choiceSheetCheck}>✓</Text> : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function WeekdaySelectSheet({ visible, title, labels = [], values = [], tone = "light", onToggle, onClose }) {
  const isDark = tone === "dark"
  const selected = useMemo(() => new Set(normalizeRepeatDays(values)), [values])
  if (!visible) return null
  return (
    <Modal transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetCard, styles.choiceSheetCard, isDark ? styles.sheetCardDark : null]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, isDark ? styles.textDark : null]}>{title}</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onClose} style={[styles.sheetBtnPrimary, styles.choiceSheetDoneBtn]}>
                <Text style={styles.sheetBtnPrimaryText}>완료</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.weekdayChoiceGrid}>
            {labels.map((label, dayIndex) => {
              const active = selected.has(dayIndex)
              return (
                <Pressable
                  key={`weekday-choice-${dayIndex}`}
                  onPress={() => onToggle?.(dayIndex)}
                  style={[
                    styles.weekdayChoiceItem,
                    isDark ? styles.weekdayChoiceItemDark : null,
                    active ? styles.weekdayChoiceItemActive : null,
                    active && isDark ? styles.weekdayChoiceItemActiveDark : null
                  ]}
                >
                  <Text
                    style={[
                      styles.weekdayChoiceText,
                      isDark ? styles.textDark : null,
                      active ? styles.weekdayChoiceTextActive : null
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
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
  calendarFontScale = UI_FONT_SCALE_DEFAULT,
  tabFontScale = UI_FONT_SCALE_DEFAULT,
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
  onMovePlan,
  onQuickDeletePlan,
  onSelectDateKey,
  onTasks,
  tasksCount = 0,
  onToggleTask
}) {
  const isDark = tone === "dark"
  const calendarScale = useMemo(() => clampUiFontScale(calendarFontScale), [calendarFontScale])
  const calendarTitleTextStyle = useMemo(
    () => ({
      fontSize: scaleFontSize(16, calendarScale),
      lineHeight: scaleFontSize(18, calendarScale)
    }),
    [calendarScale]
  )
  const weekHeaderTextSizeStyle = useMemo(
    () => ({
      fontSize: scaleFontSize(10, calendarScale),
      lineHeight: scaleFontSize(12, calendarScale)
    }),
    [calendarScale]
  )
  const calendarDayTextStyle = useMemo(
    () => ({ fontSize: scaleFontSize(10, calendarScale) }),
    [calendarScale]
  )
  const calendarHolidayTextSizeStyle = useMemo(
    () => ({
      fontSize: scaleFontSize(8, calendarScale),
      lineHeight: scaleFontSize(10, calendarScale)
    }),
    [calendarScale]
  )
  const calendarTaskMarkerTextSizeStyle = useMemo(
    () => ({
      fontSize: scaleFontSize(7.4, calendarScale),
      lineHeight: scaleFontSize(7.4, calendarScale)
    }),
    [calendarScale]
  )
  const calendarLabelTextSizeStyle = useMemo(
    () => ({
      fontSize: scaleFontSize(9.8, calendarScale),
      lineHeight: scaleFontSize(11.8, calendarScale)
    }),
    [calendarScale]
  )
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
  const daySuppressPressRef = useRef(false)
  const calendarCellNodesRef = useRef({})
  const calendarItemNodesRef = useRef({})
  const calendarWeekRowNodesRef = useRef({})
  const calendarCellLayoutsRef = useRef({})
  const calendarItemLayoutsRef = useRef({})
  const calendarWeekRowLayoutsRef = useRef({})
  const calendarDragStateRef = useRef(null)
  const calendarDragPreviewRef = useRef(null)
  const calendarDragPositionRef = useRef(new Animated.ValueXY({ x: 0, y: 0 }))
  const calendarRootNodeRef = useRef(null)
  const calendarRootLayoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const calendarDropHintRef = useRef(null)
  const [calendarDraggingId, setCalendarDraggingId] = useState(null)
  const [calendarDragPreview, setCalendarDragPreview] = useState(null)
  const [calendarDropHint, setCalendarDropHint] = useState(null)

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
  const headerSubtitle = formatTodayHeaderText(today)
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
      const list = (Array.isArray(items) ? items : []).filter((item) => isVisibleSchedulePlanRow(item))
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
  const cells = []
  for (let i = 0; i < startDay; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d)
  while (cells.length < weeks * 7) cells.push(null)

  const weekRows = Array.from({ length: safeWeeks }, (_row, rowIndex) => cells.slice(rowIndex * 7, rowIndex * 7 + 7))
  const calendarRowHeights = weekRows.map((week) => {
    let maxSlots = 1
    for (const day of week) {
      if (!day) continue
      const key = dateToKey(viewYear, viewMonth, day)
      const itemCount = buildTaskOrderedRows(applyCalendarFilter(itemsByDate.get(key) ?? [])).length
      const holidaySlots = holidaysByDate?.get?.(key) ? 1 : 0
      maxSlots = Math.max(maxSlots, itemCount + holidaySlots, 1)
    }
    return Math.round(34 + maxSlots * scaleFontSize(19, calendarScale))
  })
  const dayItems = selectedDateKey ? applyCalendarFilter(itemsByDate.get(selectedDateKey) ?? []) : []
  const dayModalItems = useMemo(
    () => (dayReorderMode ? dayReorderItems : buildTaskGroupedListRows(sortItemsByTimeAndOrder(dayItems), selectedDateKey)),
    [dayItems, dayReorderItems, dayReorderMode, selectedDateKey]
  )
  const selectedDateLabel = useMemo(() => {
    if (!selectedDateKey) return ""
    const dt = parseDateKey(selectedDateKey)
    if (!dt) return selectedDateKey
    const dayName = weekdayLabel(selectedDateKey)
    const [y, m, d] = String(selectedDateKey).split("-")
    return `${y}.${m}.${d}${dayName ? ` (${dayName})` : ""}`
  }, [selectedDateKey])
  const dayModalCount = dayReorderMode ? dayReorderItems.length : dayItems.length

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
    setDayDraggingId(null)
    setDayReorderSaving(false)
    daySuppressPressRef.current = false
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

  function openDayReorder(sourceItems = null) {
    if (!onReorderNoTime) return
    const dateKey = String(selectedDateKey ?? "").trim()
    if (!dateKey) return
    const rawItems = Array.isArray(sourceItems) ? sourceItems : dayItems
    const items = buildTaskOrderedRows(sortItemsByTimeAndOrder(rawItems))
    const ids = items.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
    if (ids.length === 0) return
    setDayReorderMode(true)
    setDayReorderItems(items)
    dayReorderItemsRef.current = items
    dayReorderOriginalIdsRef.current = ids
    setDayDraggingId(null)
    setDayReorderSaving(false)
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
          if (dayDraggingId && String(dayDraggingId) === id) setDayDraggingId(null)
          if (next.length === 0) closeDayReorderMode()
        }
      }
    ])
  }

  function showDayMoveBlockedAlert(item) {
    Alert.alert("이동할 수 없어요", getPlanMoveBlockedMessage(item))
  }

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

  function measureCalendarCell(dateKey, node) {
    const key = String(dateKey ?? "").trim()
    if (!key || !node || typeof node.measureInWindow !== "function") return
    calendarCellNodesRef.current[key] = node
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        calendarCellLayoutsRef.current[key] = { x, y, width, height }
      })
    })
  }

  function measureCalendarItem(dateKey, itemId, node) {
    const key = String(dateKey ?? "").trim()
    const id = String(itemId ?? "").trim()
    if (!key || !id || !node || typeof node.measureInWindow !== "function") return
    calendarItemNodesRef.current[id] = { node, dateKey: key }
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        calendarItemLayoutsRef.current[id] = { id, dateKey: key, x, y, width, height }
      })
    })
  }

  function refreshCalendarItemLayout(itemId, options = {}) {
    const id = String(itemId ?? "").trim()
    const entry = id ? calendarItemNodesRef.current?.[id] : null
    const node = entry?.node
    if (!id || !node || typeof node.measureInWindow !== "function") return null
    node.measureInWindow((x, y, width, height) => {
      const layout = { id, dateKey: entry?.dateKey, x, y, width, height }
      calendarItemLayoutsRef.current[id] = layout
      if (options?.patchDragState) {
        const state = calendarDragStateRef.current
        if (state && String(state.id ?? "") === id && (!state.activated || !state.sourceLayout)) {
          calendarDragStateRef.current = { ...state, sourceLayout: layout }
        }
      }
    })
    return calendarItemLayoutsRef.current?.[id] ?? null
  }

  function measureCalendarWeekRow(rowIndex, node) {
    const key = String(rowIndex ?? "").trim()
    if (!key) return
    if (!node || typeof node.measureInWindow !== "function") {
      delete calendarWeekRowNodesRef.current[key]
      delete calendarWeekRowLayoutsRef.current[key]
      return
    }
    calendarWeekRowNodesRef.current[key] = node
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        calendarWeekRowLayoutsRef.current[key] = { x, y, width, height }
      })
    })
  }

  function measureCalendarRoot(node) {
    if (!node || typeof node.measureInWindow !== "function") return
    calendarRootNodeRef.current = node
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        calendarRootLayoutRef.current = { x, y, width, height }
      })
    })
  }

  function measureCalendarNodeInWindow(node) {
    return new Promise((resolve) => {
      if (!node || typeof node.measureInWindow !== "function") {
        resolve(null)
        return
      }
      node.measureInWindow((x, y, width, height) => {
        resolve({ x, y, width, height })
      })
    })
  }

  async function measureCalendarLayoutsNow() {
    const cellEntries = Object.entries(calendarCellNodesRef.current ?? {})
    const itemEntries = Object.entries(calendarItemNodesRef.current ?? {})
    const weekRowEntries = Object.entries(calendarWeekRowNodesRef.current ?? {})
    const rootLayout = await measureCalendarNodeInWindow(calendarRootNodeRef.current)
    if (rootLayout) calendarRootLayoutRef.current = rootLayout
    await Promise.all(
      weekRowEntries.map(async ([key, node]) => {
        const layout = await measureCalendarNodeInWindow(node)
        if (layout) calendarWeekRowLayoutsRef.current[key] = layout
      })
    )
    await Promise.all(
      cellEntries.map(async ([key, node]) => {
        const layout = await measureCalendarNodeInWindow(node)
        if (layout) calendarCellLayoutsRef.current[key] = layout
      })
    )
    await Promise.all(
      itemEntries.map(async ([id, entry]) => {
        const layout = await measureCalendarNodeInWindow(entry?.node)
        if (layout) calendarItemLayoutsRef.current[id] = { id, dateKey: entry?.dateKey, ...layout }
      })
    )
  }

  function getNearestCalendarDayFromWeek(week, col) {
    const list = Array.isArray(week) ? week : []
    const safeCol = Math.max(0, Math.min(6, Math.round(Number(col) || 0)))
    if (list[safeCol]) return list[safeCol]
    let best = null
    let bestDistance = Infinity
    for (let idx = 0; idx < list.length; idx += 1) {
      if (!list[idx]) continue
      const distance = Math.abs(idx - safeCol)
      if (distance < bestDistance) {
        best = list[idx]
        bestDistance = distance
      }
    }
    return best
  }

  function findCalendarDropDateFromWeekRows(moveX, moveY, fallbackDateKey) {
    const fallback = String(fallbackDateKey ?? "").trim()
    const rows = Object.entries(calendarWeekRowLayoutsRef.current ?? {})
      .map(([rowIndex, layout]) => ({
        rowIndex: Number(rowIndex),
        layout
      }))
      .filter(({ rowIndex, layout }) => Number.isFinite(rowIndex) && layout?.width > 0 && layout?.height > 0)
      .sort((a, b) => a.rowIndex - b.rowIndex)
    if (!rows.length) return ""
    const containing = rows.find(({ layout }) => moveY >= layout.y && moveY <= layout.y + layout.height)
    const targetRow =
      containing ??
      rows.reduce((best, row) => {
        if (!best) return row
        const centerY = row.layout.y + row.layout.height / 2
        const bestCenterY = best.layout.y + best.layout.height / 2
        return Math.abs(moveY - centerY) < Math.abs(moveY - bestCenterY) ? row : best
      }, null)
    if (!targetRow) return ""
    const colWidth = targetRow.layout.width / 7
    if (!Number.isFinite(colWidth) || colWidth <= 0) return ""
    const rawCol = Math.floor((moveX - targetRow.layout.x) / colWidth)
    const col = Math.max(0, Math.min(6, rawCol))
    const day = getNearestCalendarDayFromWeek(weekRows[targetRow.rowIndex], col)
    return day ? dateToKey(viewYear, viewMonth, day) : ""
  }

  function getCalendarDropInsertIndex(dateKey, moveY, movingId = "") {
    const key = String(dateKey ?? "").trim()
    if (!key) return 0
    const rows = Object.values(calendarItemLayoutsRef.current ?? {})
      .filter((layout) => layout?.dateKey === key && String(layout?.id ?? "") !== String(movingId ?? ""))
      .sort((a, b) => a.y - b.y)
    if (rows.length > 0) {
      let index = 0
      for (const layout of rows) {
        if (moveY > layout.y + layout.height / 2) index += 1
      }
      return index
    }
    const items = buildTaskOrderedRows(applyCalendarFilter(itemsByDate.get(key) ?? [])).filter(
      (row) => String(row?.id ?? "").trim() !== String(movingId ?? "")
    )
    return items.length
  }

  function getCalendarDropIndicatorTop(dateKey, index, movingId = "") {
    const key = String(dateKey ?? "").trim()
    const fallbackTop = 24 + Math.max(0, Math.round(Number(index) || 0)) * scaleFontSize(19, calendarScale)
    if (!key) return fallbackTop
    const cell = calendarCellLayoutsRef.current?.[key]
    const rows = Object.values(calendarItemLayoutsRef.current ?? {})
      .filter((layout) => layout?.dateKey === key && String(layout?.id ?? "") !== String(movingId ?? ""))
      .sort((a, b) => a.y - b.y)
    if (!cell || !Number.isFinite(cell.y) || !Number.isFinite(cell.height) || rows.length === 0) {
      return fallbackTop
    }
    const safeIndex = clamp(Math.round(Number(index) || 0), 0, rows.length)
    let top = fallbackTop
    if (safeIndex <= 0) {
      top = rows[0].y - cell.y - 3
    } else if (safeIndex >= rows.length) {
      const last = rows[rows.length - 1]
      top = last.y + last.height - cell.y + 3
    } else {
      const prev = rows[safeIndex - 1]
      const next = rows[safeIndex]
      top = (prev.y + prev.height + next.y) / 2 - cell.y
    }
    return clamp(top, 18, Math.max(18, cell.height - 4))
  }

  function findCalendarDropTarget(moveX, moveY, fallbackDateKey, movingId = "") {
    const fallback = String(fallbackDateKey ?? "").trim()
    const rowDateKey = findCalendarDropDateFromWeekRows(moveX, moveY, fallback)
    if (rowDateKey) {
      return { dateKey: rowDateKey, index: getCalendarDropInsertIndex(rowDateKey, moveY, movingId) }
    }
    const cellEntries = Object.entries(calendarCellLayoutsRef.current ?? {})
    if (!cellEntries.length) return fallback ? { dateKey: fallback, index: 0 } : null
    const containing = cellEntries.find(([_key, layout]) => {
      if (!layout) return false
      return moveX >= layout.x && moveX <= layout.x + layout.width && moveY >= layout.y && moveY <= layout.y + layout.height
    })
    const targetEntry =
      containing ??
      cellEntries.reduce((best, entry) => {
        const layout = entry?.[1]
        if (!layout) return best
        if (!best) return entry
        const centerX = layout.x + layout.width / 2
        const centerY = layout.y + layout.height / 2
        const bestLayout = best?.[1]
        const bestCenterX = bestLayout.x + bestLayout.width / 2
        const bestCenterY = bestLayout.y + bestLayout.height / 2
        const distance = Math.abs(moveX - centerX) + Math.abs(moveY - centerY)
        const bestDistance = Math.abs(moveX - bestCenterX) + Math.abs(moveY - bestCenterY)
        return distance < bestDistance ? entry : best
      }, null)
    const dateKey = String(targetEntry?.[0] ?? fallback).trim()
    if (!dateKey) return null
    return { dateKey, index: getCalendarDropInsertIndex(dateKey, moveY, movingId) }
  }

  function buildCalendarBlockDragPreview(item, point, state = {}) {
    const id = String(item?.id ?? "").trim()
    const screen = Dimensions.get("window")
    const rootLayout = calendarRootLayoutRef.current ?? {}
    const rootX = Number(rootLayout?.x) || 0
    const rootY = Number(rootLayout?.y) || 0
    const rootWidth = Number(rootLayout?.width) || screen.width
    const rootHeight = Number(rootLayout?.height) || screen.height
    const sourceLayout = state?.sourceLayout ?? calendarItemLayoutsRef.current?.[id] ?? {}
    const width = clamp(Number(sourceLayout?.width) || Math.round(screen.width / 7) - 4, 36, Math.max(36, screen.width - 12))
    const height = clamp(Number(sourceLayout?.height) || 18, 14, 34)
    const startPoint = state?.startPoint ?? point
    const pointX = Number(point?.pageX) || 0
    const pointY = Number(point?.pageY) || 0
    const startX = Number(startPoint?.pageX) || pointX
    const startY = Number(startPoint?.pageY) || pointY
    const hasSourceLayout =
      Number.isFinite(Number(sourceLayout?.x)) &&
      Number.isFinite(Number(sourceLayout?.y)) &&
      Number(sourceLayout?.width) > 0 &&
      Number(sourceLayout?.height) > 0
    const x = hasSourceLayout
      ? Number(sourceLayout.x) + (pointX - startX) - rootX
      : pointX - width / 2 - rootX
    const y = hasSourceLayout
      ? Number(sourceLayout.y) + (pointY - startY) - rootY
      : pointY - height / 2 - rootY
    return {
      id,
      item,
      block: true,
      x: clamp(x, 4, Math.max(4, rootWidth - width - 4)),
      y: clamp(y, 4, Math.max(4, rootHeight - height - 4)),
      width,
      height
    }
  }

  function showCalendarBlockDragPreview(item, point, state = {}, force = false) {
    const preview = buildCalendarBlockDragPreview(item, point, state)
    calendarDragPositionRef.current.setValue({ x: preview.x, y: preview.y })
    const prev = calendarDragPreviewRef.current
    if (force || !prev || prev.id !== preview.id || prev.width !== preview.width || prev.height !== preview.height) {
      calendarDragPreviewRef.current = preview
      setCalendarDragPreview(preview)
    }
    return preview
  }

  function hideCalendarBlockDragPreview() {
    calendarDragPreviewRef.current = null
    setCalendarDragPreview(null)
  }

  function getCalendarDropPointFromPreview(preview) {
    if (!preview) return null
    const rootLayout = calendarRootLayoutRef.current ?? {}
    const rootX = Number(rootLayout?.x) || 0
    const rootY = Number(rootLayout?.y) || 0
    return {
      pageX: rootX + Number(preview.x) + Number(preview.width) / 2,
      pageY: rootY + Number(preview.y) + Number(preview.height) / 2
    }
  }

  function getCalendarVisualDropPoint(item, point, state = {}) {
    return getCalendarDropPointFromPreview(buildCalendarBlockDragPreview(item, point, state))
  }

  function setCalendarDropHintIfChanged(nextHint) {
    const normalized = nextHint?.dateKey
      ? {
          dateKey: String(nextHint.dateKey),
          index: Math.max(0, Math.round(Number(nextHint.index) || 0))
        }
      : null
    const prev = calendarDropHintRef.current
    if (
      (!prev && !normalized) ||
      (prev && normalized && prev.dateKey === normalized.dateKey && prev.index === normalized.index)
    ) {
      return
    }
    calendarDropHintRef.current = normalized
    setCalendarDropHint(normalized)
  }

  function updateCalendarDropHint(point, fallbackDateKey, movingId) {
    if (!point?.pageX && !point?.pageY) return
    const target = findCalendarDropTarget(point.pageX, point.pageY, fallbackDateKey, movingId)
    setCalendarDropHintIfChanged(target)
  }

  function clearCalendarDropHint() {
    setCalendarDropHintIfChanged(null)
  }

  function createCalendarDragHandlers(item, dateKey) {
    const id = String(item?.id ?? "").trim()
    if (!id || !onMovePlan) return null
    let longPressTimer = null
    const clearLongPressTimer = () => {
      if (!longPressTimer) return
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    const getDragState = () => {
      const state = calendarDragStateRef.current
      if (!state || String(state.id ?? "") !== id) return null
      return state
    }
    const patchDragState = (patch) => {
      const current = getDragState()
      if (!current) return null
      const next = { ...current, ...(patch ?? {}) }
      calendarDragStateRef.current = next
      return next
    }
    const activateDrag = (evt, gesture = {}) => {
      const current = getDragState()
      if (current?.activated) return current
      const blocked = !isMovableNoTimePlanRow(item)
      daySuppressPressRef.current = true
      const activatedState = patchDragState({ activated: true, blocked })
      if (blocked) return activatedState
      void measureCalendarLayoutsNow()
      const point = getResponderScreenPoint(evt, gesture, { preferGesture: true })
      const fallbackStart = activatedState?.startPoint ?? current?.startPoint
      const latestPoint =
        point.pageX || point.pageY
          ? point
          : {
              pageX: Number(fallbackStart?.pageX) || 0,
              pageY: Number(fallbackStart?.pageY) || 0
            }
      const sourceLayout =
        activatedState?.sourceLayout ??
        refreshCalendarItemLayout(id, { patchDragState: true }) ??
        calendarItemLayoutsRef.current?.[id] ??
        null
      const nextState = patchDragState({ latestPoint, sourceLayout })
      setCalendarDraggingId(id)
      const preview = showCalendarBlockDragPreview(item, latestPoint, nextState, true)
      updateCalendarDropHint(getCalendarDropPointFromPreview(preview), dateKey, id)
      return getDragState()
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        return Boolean(getDragState()?.activated) || distance > 4
      },
      onMoveShouldSetPanResponderCapture: (_evt, gesture) => {
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        return Boolean(getDragState()?.activated) || distance > 4
      },
      onPanResponderGrant: (evt) => {
        const startPoint = getResponderScreenPoint(evt)
        void measureCalendarLayoutsNow()
        const sourceLayout = calendarItemLayoutsRef.current?.[id] ?? null
        calendarDragStateRef.current = {
          id,
          item,
          dateKey,
          activated: false,
          didMove: false,
          blocked: false,
          startPoint,
          latestPoint: startPoint,
          sourceLayout
        }
        refreshCalendarItemLayout(id, { patchDragState: true })
        clearLongPressTimer()
        longPressTimer = setTimeout(() => {
          activateDrag(null)
        }, 180)
      },
      onPanResponderMove: (evt, gesture) => {
        const point = getResponderScreenPoint(evt, gesture, { preferGesture: true })
        if (point.pageX || point.pageY) patchDragState({ latestPoint: point })
        const current = getDragState()
        const distance = Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy))
        if (!current?.activated && distance > 6) {
          clearLongPressTimer()
          activateDrag(evt, gesture)
        }
        const activeState = getDragState()
        if (!activeState?.activated) return
        const latestPoint = activeState.latestPoint ?? point
        const startPoint = activeState.startPoint ?? latestPoint
        const pointDistance = Math.max(
          Math.abs((latestPoint?.pageX ?? 0) - (startPoint?.pageX ?? 0)),
          Math.abs((latestPoint?.pageY ?? 0) - (startPoint?.pageY ?? 0))
        )
        if (distance > 2 || pointDistance > 2) {
          patchDragState({ didMove: true })
          if (!activeState.blocked) {
            setCalendarDraggingId(id)
            const preview = showCalendarBlockDragPreview(item, latestPoint, getDragState())
            updateCalendarDropHint(getCalendarDropPointFromPreview(preview), dateKey, id)
          }
        }
      },
      onPanResponderRelease: async (evt, gesture) => {
        const releasePoint = getResponderScreenPoint(evt, gesture, { preferGesture: true })
        if (releasePoint.pageX || releasePoint.pageY) patchDragState({ latestPoint: releasePoint })
        clearLongPressTimer()
        const releaseState = getDragState()
        const finalDropHint = calendarDropHintRef.current
        const gestureDistance = Math.max(Math.abs(Number(gesture?.dx) || 0), Math.abs(Number(gesture?.dy) || 0))
        const shouldTreatAsDrag = Boolean(releaseState?.activated || releaseState?.didMove || calendarDraggingId === id)
        setCalendarDraggingId(null)
        hideCalendarBlockDragPreview()
        clearCalendarDropHint()
        if (!shouldTreatAsDrag) {
          daySuppressPressRef.current = true
          onEditPlan?.(item)
          calendarDragStateRef.current = null
          setTimeout(() => {
            daySuppressPressRef.current = false
          }, 120)
          return
        }
        if (releaseState?.blocked) {
          showDayMoveBlockedAlert(item)
          calendarDragStateRef.current = null
          setTimeout(() => {
            daySuppressPressRef.current = false
          }, 180)
          return
        }
        if (!releaseState?.didMove && gestureDistance <= 2) {
          calendarDragStateRef.current = null
          setTimeout(() => {
            daySuppressPressRef.current = false
          }, 120)
          return
        }
        const latestPoint = releaseState?.latestPoint ?? releasePoint
        const dropPoint = getCalendarVisualDropPoint(item, latestPoint, releaseState) ?? latestPoint
        const target = finalDropHint?.dateKey
          ? finalDropHint
          : findCalendarDropTarget(dropPoint?.pageX ?? gesture.moveX, dropPoint?.pageY ?? gesture.moveY, dateKey, id)
        if (target?.dateKey) {
          void Promise.resolve(onMovePlan?.(item, target.dateKey, target.index)).catch(() => {})
        }
        calendarDragStateRef.current = null
        setTimeout(() => {
          daySuppressPressRef.current = false
        }, 120)
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer()
        setCalendarDraggingId(null)
        hideCalendarBlockDragPreview()
        clearCalendarDropHint()
        calendarDragStateRef.current = null
        setTimeout(() => {
          daySuppressPressRef.current = false
        }, 120)
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true
    })
  }

  function openDate(day) {
    if (!day) return
    const key = dateToKey(viewYear, viewMonth, day)
    onSelectDateKey?.(key)
    onAddPlan?.(key)
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
    if (item?.__bucketDivider) {
      return (
        <View key={options?.rowKey ?? String(item?.id ?? "__bucket-divider__")} style={styles.dayModalDividerRow}>
          <View style={[styles.dayModalDividerLine, isDark ? styles.dayModalDividerLineDark : null]} />
        </View>
      )
    }
    if (item?.__taskDivider) {
      return (
        <View key={options?.rowKey ?? String(item?.id ?? "__task-divider__")} style={styles.dayModalDividerRow}>
          <View style={[styles.dayModalDividerLine, isDark ? styles.dayModalDividerLineDark : null]} />
        </View>
      )
    }
    const { rowKey, onPress, onLongPress, onDelete, draggable = false, isActive = false } = options
    const time = buildPlanTimeTextFromRow(item)
    const content = getPlanDisplayText(item)
    const entryMeta = getPlanEntryMeta(item?.content)
    const isTaskRow = entryMeta.entryType === "task"
    const isTaskDone = Boolean(entryMeta.taskCompleted)
    const category = String(item?.category_id ?? "").trim()
    const isGeneral = !category || category === "__general__"
    const categoryColor = colorByTitle.get(category) || "#94a3b8"
    const canLongPress = typeof onLongPress === "function"
    const canPress = typeof onPress === "function"
    const isPressable = canPress || canLongPress || draggable
    const showDelete = draggable && typeof onDelete === "function"
    const Container = isPressable ? Pressable : View
    return (
      <Container
        key={rowKey}
        onPress={canPress ? onPress : undefined}
        onLongPress={canLongPress ? onLongPress : undefined}
        delayLongPress={canLongPress ? 220 : undefined}
        style={[
          styles.dayModalItemRow,
          draggable ? styles.dayModalItemRowEditing : null,
          isDark ? styles.dayModalItemRowDark : null,
          isDark && draggable ? styles.dayModalItemRowEditingDark : null,
          isActive ? styles.reorderDragGhost : null,
          isActive && isDark ? styles.reorderDragGhostDark : null
        ]}
      >
        {time ? (
          <Text style={[styles.dayModalItemTime, isDark ? styles.textMutedDark : null]}>{time}</Text>
        ) : (
          <Text style={styles.dayModalItemTimeEmpty}>{"\u00A0"}</Text>
        )}
        <View style={styles.dayModalItemMain}>
          <View style={styles.dayModalItemPrimary}>
            {isTaskRow ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isTaskDone }}
                hitSlop={6}
                onPress={(event) => {
                  daySuppressPressRef.current = true
                  event?.stopPropagation?.()
                  onToggleTask?.(item)
                }}
              style={[
                styles.itemTaskToggle,
                isDark ? styles.itemTaskToggleDark : null,
                isTaskDone ? styles.itemTaskToggleChecked : null,
                isTaskDone && isDark ? styles.itemTaskToggleCheckedDark : null,
                { borderColor: categoryColor },
                isTaskDone ? { backgroundColor: colorWithAlpha(categoryColor, 0.16), borderColor: categoryColor } : null
              ]}
              >
                {renderTaskMarkerContent(item, isTaskDone, isDark)}
              </Pressable>
            ) : null}
            <Text
              style={[
                styles.dayModalItemText,
                isDark ? styles.textDark : null,
                isTaskDone ? styles.itemTitleTaskDone : null
              ]}
            >
              {content}
            </Text>
          </View>
          {!isGeneral ? (
            <View style={[styles.itemCategoryBadge, isDark ? styles.badgeDark : null]}>
              <View style={[styles.itemCategoryDot, { backgroundColor: categoryColor }]} />
              <Text style={[styles.itemCategoryText, isDark ? styles.textMutedDark : null]} numberOfLines={1}>
                {category}
              </Text>
            </View>
          ) : null}
        </View>
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
    <SafeAreaView
      ref={measureCalendarRoot}
      edges={["top", "left", "right"]}
      style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}
    >
      <Header
        title="Planner"
        subtitle={headerSubtitle}
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        onTasks={onTasks}
        tasksCount={tasksCount}
        todayLabel={todayLabel}
        onToday={goToday}
        onFilter={activeTabId === "all" ? () => setCalendarFilterVisible(true) : null}
        filterActive={!isAllFiltersSelected}
        tone={tone}
        showLogo={false}
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
        fontScale={tabFontScale}
      />
	      <View
          style={[styles.card, styles.calendarCard, isDark ? styles.cardDark : null, isDark ? styles.calendarCardDark : null]}
        >
	          <View style={[styles.calendarHeaderWrap, isDark ? styles.calendarHeaderWrapDark : null]}>
	            <View style={[styles.calendarHeader, isDark ? styles.calendarHeaderDark : null]}>
	              <View style={styles.calendarHeaderLeft}>
                <TouchableOpacity
                  style={[styles.calendarNavButton, isDark ? styles.calendarNavButtonDark : null]}
                  onPress={goPrevMonth}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                >
	                  <Text style={[styles.calendarNavText, isDark ? styles.calendarNavTextDark : null]}>{"<"}</Text>
	                </TouchableOpacity>
	              </View>
	              <Text
                  pointerEvents="none"
                  style={[styles.calendarTitleCentered, calendarTitleTextStyle, isDark ? styles.textDark : null]}
                >
                  {monthLabel}
                </Text>
	              <View style={styles.calendarHeaderRight}>
                <TouchableOpacity
                  style={[styles.calendarNavButton, styles.calendarNavButtonRight, isDark ? styles.calendarNavButtonDark : null]}
                  onPress={goNextMonth}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
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
                      weekHeaderTextSizeStyle,
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
	          <ScrollView
              style={styles.calendarGridScroll}
              contentContainerStyle={[styles.calendarGrid, isDark ? styles.calendarGridDark : null]}
              scrollEnabled={!calendarDraggingId}
            >
	            {weekRows.map((week, row) => {
                const rowHeight = calendarRowHeights[row] ?? 54
                const isLastRow = row === weekRows.length - 1
                return (
                  <View
                    key={`week-${row}`}
                    ref={(node) => measureCalendarWeekRow(row, node)}
                    style={[styles.calendarWeekRow, isLastRow ? styles.calendarWeekRowLast : null]}
                  >
                    {week.map((day, col) => {
                      const key = day ? dateToKey(viewYear, viewMonth, day) : null
                      const rawItems = key ? itemsByDate.get(key) ?? [] : []
                      const items = buildTaskOrderedRows(applyCalendarFilter(rawItems))
                      const holidayName = key ? holidaysByDate?.get?.(key) ?? "" : ""
                      const holidayLabel = holidayName ? String(holidayName).trim() : ""
                      const isHoliday = Boolean(holidayName)
                      const isSunday = col === 0
                      const isSaturday = col === 6
                      const isLastCol = col === 6
                      const isToday = key === todayKey
                      const isSelected = key && key === selectedDateKey
                      const isDropTarget = Boolean(calendarDraggingId && key && calendarDropHint?.dateKey === key)
                      const dropBaseCount = isDropTarget
                        ? items.filter((row) => String(row?.id ?? "").trim() !== String(calendarDraggingId ?? "")).length
                        : 0
                      const dropIndex = isDropTarget
                        ? clamp(Math.round(Number(calendarDropHint?.index) || 0), 0, dropBaseCount)
                        : -1
                      const dropLineTop = isDropTarget ? getCalendarDropIndicatorTop(key, dropIndex, calendarDraggingId) : 0
                      return (
                        <Pressable
                          key={`${row}-${col}-${day ?? "x"}`}
                          ref={(node) => (key ? measureCalendarCell(key, node) : null)}
                          style={[
                            styles.calendarCell,
                            isDark ? styles.calendarCellDark : null,
                            { minHeight: rowHeight },
                            isLastCol ? styles.calendarCellLastCol : null,
                            isLastRow ? styles.calendarCellLastRow : null,
                            isToday ? (isDark ? styles.calendarCellTodayDark : styles.calendarCellToday) : null,
                            isSelected ? (isDark ? styles.calendarCellSelectedDark : styles.calendarCellSelected) : null,
                            isDropTarget ? (isDark ? styles.calendarCellDropTargetDark : styles.calendarCellDropTarget) : null
                          ]}
                          onPress={() => {
                            if (daySuppressPressRef.current) {
                              daySuppressPressRef.current = false
                              return
                            }
                            openDate(day)
                          }}
                        >
                          {isToday ? <View style={[styles.calendarTodayOutline, isDark ? styles.calendarTodayOutlineDark : null]} /> : null}
                          {isDropTarget ? (
                            <View
                              pointerEvents="none"
                              style={[
                                styles.calendarDropIndicator,
                                isDark ? styles.calendarDropIndicatorDark : null,
                                { top: dropLineTop }
                              ]}
                            />
                          ) : null}
                          <View style={styles.calendarCellHeader}>
                            <Text
                              style={[
                                styles.calendarDay,
                                calendarDayTextStyle,
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
                            {holidayLabel ? (
                              <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[
                                  styles.calendarHolidayText,
                                  calendarHolidayTextSizeStyle,
                                  isDark ? styles.calendarHolidayTextDark : null
                                ]}
                              >
                                {holidayLabel}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.calendarLineStack}>
                            {items.map((item) => {
                              const line = formatLine(item)
                              const entryMeta = getPlanEntryMeta(item?.content)
                              const isTaskLine = entryMeta.entryType === "task"
                              const isTaskDone = Boolean(entryMeta.taskCompleted)
                              const category = String(item?.category_id ?? "").trim()
                              const dotColor =
                                category && category !== "__general__"
                                  ? colorByTitle.get(category) || "#94a3b8"
                                  : "#9aa3b2"
                              const calendarAccentColor = getMutedCalendarPillColor(dotColor, isDark)
                              const calendarTaskBorderColor = isDark ? colorWithAlpha(dotColor, 0.92) : dotColor
                              const calendarLabelTextColor = isTaskLine ? null : "#ffffff"
                              const itemId = String(item?.id ?? `${item.date}-${item.content}`).trim()
                              const dragResponder = createCalendarDragHandlers(item, key)
                              return (
                                <View
                                  key={itemId}
                                  ref={(node) => measureCalendarItem(key, itemId, node)}
                                  style={[
                                    styles.calendarLine,
                                    calendarDraggingId === itemId ? styles.dragMovingRow : null,
                                    calendarDraggingId === itemId && isDark ? styles.dragMovingRowDark : null
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.calendarLabel,
                                      isTaskLine ? styles.calendarLabelTaskPlain : null,
                                      isTaskDone ? styles.calendarLabelTaskDone : null,
                                      { backgroundColor: isTaskLine ? "transparent" : calendarAccentColor },
                                      isDark ? styles.calendarLabelDark : null
                                    ]}
                                  >
                                    <View style={styles.calendarLabelRow}>
                                      {isTaskLine ? (
                                        <Pressable
                                          accessibilityRole="checkbox"
                                          accessibilityState={{ checked: isTaskDone }}
                                          hitSlop={6}
                                          onPress={(event) => {
                                            event?.stopPropagation?.()
                                            daySuppressPressRef.current = true
                                            onToggleTask?.(item)
                                            setTimeout(() => {
                                              daySuppressPressRef.current = false
                                            }, 120)
                                          }}
                                          style={[
                                            styles.calendarTaskMarker,
                                            isTaskDone ? styles.calendarTaskMarkerDone : null,
                                            isDark ? styles.calendarTaskMarkerDark : null,
                                            isTaskDone && isDark ? styles.calendarTaskMarkerDoneDark : null,
                                            { borderColor: calendarTaskBorderColor },
                                            isTaskDone ? { backgroundColor: calendarTaskBorderColor } : null
                                          ]}
                                        >
                                          {renderTaskMarkerContent(item, isTaskDone, isDark, "calendar")}
                                        </Pressable>
                                      ) : null}
                                      <View style={styles.calendarLabelBody} {...(dragResponder?.panHandlers ?? {})}>
                                        <Text
                                          numberOfLines={1}
                                          ellipsizeMode="clip"
                                          style={[
                                            styles.calendarLabelText,
                                            calendarLabelTextSizeStyle,
                                            !isTaskLine ? styles.calendarLabelTextSingle : null,
                                            isDark ? styles.calendarLabelTextDark : null,
                                            isTaskLine ? (isDark ? styles.calendarLabelTextTaskDark : styles.calendarLabelTextTask) : null,
                                            !isTaskLine && calendarLabelTextColor ? { color: calendarLabelTextColor } : null,
                                            isTaskDone ? styles.calendarLabelTextTaskDone : null
                                          ]}
                                        >
                                          {line.text}
                                        </Text>
                                      </View>
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
                )
              })}
	        </ScrollView>
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

      {calendarDragPreview ? (() => {
        const previewItem = calendarDragPreview.item ?? {}
        const line = formatLine(previewItem)
        const entryMeta = getPlanEntryMeta(previewItem?.content)
        const isTaskLine = entryMeta.entryType === "task"
        const isTaskDone = Boolean(entryMeta.taskCompleted)
        const category = String(previewItem?.category_id ?? "").trim()
        const dotColor =
          category && category !== "__general__"
            ? colorByTitle.get(category) || "#94a3b8"
            : "#9aa3b2"
        const calendarAccentColor = getMutedCalendarPillColor(dotColor, isDark)
        const calendarTaskBorderColor = isDark ? colorWithAlpha(dotColor, 0.92) : dotColor
        const calendarLabelTextColor = isTaskLine ? null : "#ffffff"
        return (
          <View pointerEvents="none" style={styles.dragPreviewLayer}>
            <Animated.View
              style={[
                styles.calendarDragBlockPreview,
                isDark ? styles.calendarDragBlockPreviewDark : null,
                {
                  width: calendarDragPreview.width,
                  minHeight: calendarDragPreview.height,
                  transform: calendarDragPositionRef.current.getTranslateTransform()
                }
              ]}
            >
              <View
                style={[
                  styles.calendarLabel,
                  styles.calendarDragBlockLabel,
                  isTaskLine ? styles.calendarLabelTaskPlain : null,
                  isTaskDone ? styles.calendarLabelTaskDone : null,
                  { backgroundColor: isTaskLine ? (isDark ? DARK_SURFACE_2 : "#ffffff") : calendarAccentColor },
                  isDark ? styles.calendarLabelDark : null
                ]}
              >
                <View style={styles.calendarLabelRow}>
                  {isTaskLine ? (
                    <View
                      style={[
                        styles.calendarTaskMarker,
                        isTaskDone ? styles.calendarTaskMarkerDone : null,
                        isDark ? styles.calendarTaskMarkerDark : null,
                        isTaskDone && isDark ? styles.calendarTaskMarkerDoneDark : null,
                        { borderColor: calendarTaskBorderColor },
                        isTaskDone ? { backgroundColor: calendarTaskBorderColor } : null
                      ]}
                    >
                      {renderTaskMarkerContent(previewItem, isTaskDone, isDark, "calendar")}
                    </View>
                  ) : null}
                  <View style={styles.calendarLabelBody}>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="clip"
                      style={[
                        styles.calendarLabelText,
                        calendarLabelTextSizeStyle,
                        !isTaskLine ? styles.calendarLabelTextSingle : null,
                        isDark ? styles.calendarLabelTextDark : null,
                        isTaskLine ? (isDark ? styles.calendarLabelTextTaskDark : styles.calendarLabelTextTask) : null,
                        !isTaskLine && calendarLabelTextColor ? { color: calendarLabelTextColor } : null,
                        isTaskDone ? styles.calendarLabelTextTaskDone : null
                      ]}
                    >
                      {line.text}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          </View>
        )
      })() : null}
    
      <Modal
        visible={Boolean(selectedDateKey)}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={closeDayModal}
      >
        <GestureHandlerRootView style={styles.dayModalOverlay}>
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
                    {onReorderNoTime && dayItems.length > 1 && dayItems.some((item) => isMovableNoTimePlanRow(item)) ? (
                      <Pressable
                        onPress={() => openDayReorder(dayItems)}
                        style={[styles.dayModalAddBtn, isDark ? styles.dayModalAddBtnDark : null]}
                      >
                        <Text style={styles.dayModalAddText}>정렬</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={closeDayModal} style={[styles.dayModalCloseBtn, isDark ? styles.dayModalCloseBtnDark : null]}>
                      <Text style={[styles.dayModalCloseX, isDark ? styles.textDark : null]}>닫기</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
            {dayReorderMode ? (
              dayReorderItems.length === 0 ? (
                <View style={styles.dayModalEmpty}>
                  <Text style={[styles.dayModalEmptyTitle, isDark ? styles.textDark : null]}>할 일이 없어요</Text>
                  <Text style={[styles.dayModalEmptySub, isDark ? styles.textMutedDark : null]}>이 날짜에 등록된 일정이 없습니다.</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={styles.dayModalList} scrollEnabled={!dayDraggingId}>
                  <DraggableFlatList
                    data={dayReorderItems}
                    keyExtractor={(row, idx) => String(row?.id ?? `${row?.date}-${row?.content}-${idx}`)}
                    activationDistance={6}
                    scrollEnabled={false}
                    nestedScrollEnabled={false}
                    containerStyle={styles.reorderNoTimeList}
                    animationConfig={{ damping: 20, stiffness: 220, mass: 0.35 }}
                    onDragBegin={(index) => {
                      const row = dayReorderItemsRef.current?.[index]
                      setDayDraggingId(String(row?.id ?? "__drag__"))
                    }}
                    onDragEnd={({ data }) => {
                      const next = enforceTimedPlanOrderInSlots(Array.isArray(data) ? data : [])
                      dayReorderItemsRef.current = next
                      setDayReorderItems(next)
                      setDayDraggingId(null)
                    }}
                    renderItem={({ item, drag, isActive }) => {
                      const movable = isMovableNoTimePlanRow(item)
                      const canDelete = movable && !isRecurringPlanRowForMove(item)
                      return renderDayModalRow(item, {
                        rowKey: String(item?.id ?? `${item?.date}-${item?.content}`),
                        draggable: movable,
                        isActive,
                        onLongPress: movable ? drag : () => showDayMoveBlockedAlert(item),
                        onDelete: canDelete ? () => quickDeleteFromDayReorder(item) : undefined
                      })
                    }}
                  />
                </ScrollView>
              )
            ) : (
              <ScrollView contentContainerStyle={styles.dayModalList} scrollEnabled={!dayDraggingId}>
                {dayItems.length === 0 ? (
                  <View style={styles.dayModalEmpty}>
                    <Text style={[styles.dayModalEmptyTitle, isDark ? styles.textDark : null]}>할 일이 없어요</Text>
                    <Text style={[styles.dayModalEmptySub, isDark ? styles.textMutedDark : null]}>이 날짜에 등록된 일정이 없습니다.</Text>
                  </View>
                ) : (
                  dayModalItems.map((item) => {
                    const itemId = String(item?.id ?? "").trim()
                    const canReorder = !item?.__taskDivider && !item?.__bucketDivider && Boolean(onReorderNoTime && itemId)
                    const handlePress = () => {
                      if (daySuppressPressRef.current) {
                        daySuppressPressRef.current = false
                        return
                      }
                      if (item?.__taskDivider || item?.__bucketDivider) return
                      onEditPlan?.(item)
                    }
                    const handleLongPress = () => {
                      if (!canReorder) return
                      daySuppressPressRef.current = true
                      if (!isMovableNoTimePlanRow(item)) {
                        showDayMoveBlockedAlert(item)
                        setTimeout(() => {
                          daySuppressPressRef.current = false
                        }, 350)
                        return
                      }
                      openDayReorder(dayItems)
                    }
                    return renderDayModalRow(item, {
                      rowKey: item.id ?? `${item.date}-${item.content}-${item?.__taskDivider ? "divider" : "row"}`,
                      onPress: handlePress,
                      onLongPress: canReorder ? handleLongPress : undefined
                    })
                  })
                )}
              </ScrollView>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </SafeAreaView>
  )
}

function AppInner() {
  const insets = useSafeAreaInsets()
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [tasksVisible, setTasksVisible] = useState(false)
  const [themeMode, setThemeMode] = useState("light") // "light" | "dark"
  const [listFontScale, setListFontScale] = useState(UI_FONT_SCALE_DEFAULT)
  const [memoFontScale, setMemoFontScale] = useState(UI_FONT_SCALE_DEFAULT)
  const [calendarFontScale, setCalendarFontScale] = useState(UI_FONT_SCALE_DEFAULT)
  const [tabFontScale, setTabFontScale] = useState(UI_FONT_SCALE_DEFAULT)

  const safeBottomInset = useMemo(
    () => Math.max(Number(insets.bottom) || 0, Platform.OS === "android" ? 10 : 12),
    [insets.bottom]
  )
  const tabBarVisibleHeight = 58
  const bottomTabLabelStyle = useMemo(
    () =>
      StyleSheet.flatten([
        styles.tabLabel,
        {
          fontSize: scaleFontSize(11, clampUiFontScale(tabFontScale))
        }
      ]),
    [tabFontScale]
  )

  const tabBarStyle = useMemo(() => {
    const isDark = themeMode === "dark"
    return [
      styles.tabBar,
      isDark ? styles.tabBarDark : null,
      {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: tabBarVisibleHeight + safeBottomInset,
        paddingTop: 0,
        paddingBottom: 0
      }
    ]
  }, [safeBottomInset, tabBarVisibleHeight, themeMode])

  const tabBarItemStyle = useMemo(
    () => [
      styles.tabItem,
      {
        height: tabBarVisibleHeight,
        paddingTop: 0,
        paddingBottom: 0
      }
    ],
    [tabBarVisibleHeight]
  )

  const sceneBottomInset = useMemo(
    () => tabBarVisibleHeight + safeBottomInset,
    [safeBottomInset, tabBarVisibleHeight]
  )

  const fabBottom = useMemo(() => tabBarVisibleHeight + safeBottomInset + 18, [safeBottomInset, tabBarVisibleHeight])

  const [session, setSession] = useState(null)
  const [clientId, setClientId] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState("")
  const [authMessageTone, setAuthMessageTone] = useState("error")
  const [authMode, setAuthMode] = useState("signin")
  const [rememberCreds, setRememberCreds] = useState(false)
  const [signupTermsAgreed, setSignupTermsAgreed] = useState(false)
  const [signupPrivacyAgreed, setSignupPrivacyAgreed] = useState(false)
  const [signupUpdatesAgreed, setSignupUpdatesAgreed] = useState(false)
  const [signupDetailsOpen, setSignupDetailsOpen] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false)
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
  const notificationScheduleFingerprintRef = useRef("")
  const notificationScheduleIdsRef = useRef({})
  const notificationScheduleStateUserRef = useRef("")
  const notificationScheduleQueueRef = useRef(Promise.resolve())
  const plansLoadSeqRef = useRef(0)
  const visiblePlansLoadSeqRef = useRef(0)
  const returnToTasksAfterEditorRef = useRef(false)
  const openEndedRecurringSyncRef = useRef(false)
  const windowsLoadSeqRef = useRef(0)
  const rightMemosLoadSeqRef = useRef(0)
  const rightMemoMetaColumnsSupportedRef = useRef(true)
  const pendingRightMemoWritesRef = useRef({})
  const appStateRef = useRef(AppState.currentState)
  const plansRef = useRef([])

  const memoYear = new Date().getFullYear()

  useEffect(() => {
    setTasksVisible(false)
  }, [activeTabId, activeScreen])

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

  function notificationScheduleIdsStorageKey(userId) {
    return `${PLAN_NOTIFICATION_SCHEDULE_IDS_KEY}.${userId}`
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
    const targetIds = new Set(normalized)
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
    setPlans((prev) =>
      (prev ?? []).map((row) => {
        const rowId = String(row?.id ?? "").trim()
        if (!rowId || !targetIds.has(rowId)) return row
        return {
          ...row,
          alarm_enabled: Boolean(enabled)
        }
      })
    )
    if (snapshot) await persistAlarmPrefs(userId, snapshot)
  }

  async function setAlarmLeadMinutesForIds(userId, ids, leadMinutes) {
    const normalized = [...new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (!userId || normalized.length === 0) return
    const safeLead = normalizeAlarmLeadMinutes(leadMinutes)
    const targetIds = new Set(normalized)
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
    setPlans((prev) =>
      (prev ?? []).map((row) => {
        const rowId = String(row?.id ?? "").trim()
        if (!rowId || !targetIds.has(rowId)) return row
        return {
          ...row,
          alarm_lead_minutes: safeLead
        }
      })
    )
    if (snapshot) await persistAlarmLeadPrefs(userId, snapshot)
  }

  function isNotificationPermissionGranted(status) {
    if (status?.granted) return true
    const provisional = Notifications?.IosAuthorizationStatus?.PROVISIONAL
    if (provisional != null && status?.ios?.status === provisional) return true
    return false
  }

  async function loadNotificationScheduleIds(userId) {
    const normalizedUserId = String(userId ?? "").trim()
    if (!normalizedUserId) return {}
    if (notificationScheduleStateUserRef.current === normalizedUserId) {
      return { ...(notificationScheduleIdsRef.current ?? {}) }
    }
    let next = {}
    try {
      const raw = await AsyncStorage.getItem(notificationScheduleIdsStorageKey(normalizedUserId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          next = Object.fromEntries(
            Object.entries(parsed)
              .map(([key, identifier]) => [String(key ?? "").trim(), String(identifier ?? "").trim()])
              .filter(([key, identifier]) => key && identifier)
          )
        }
      }
    } catch (_e) {
      next = {}
    }
    notificationScheduleStateUserRef.current = normalizedUserId
    notificationScheduleIdsRef.current = next
    return { ...next }
  }

  async function persistNotificationScheduleIds(userId, map) {
    const normalizedUserId = String(userId ?? "").trim()
    if (!normalizedUserId) return
    const safe = {}
    for (const [key, identifier] of Object.entries(map ?? {})) {
      const normalizedKey = String(key ?? "").trim()
      const normalizedIdentifier = String(identifier ?? "").trim()
      if (!normalizedKey || !normalizedIdentifier) continue
      safe[normalizedKey] = normalizedIdentifier
    }
    notificationScheduleStateUserRef.current = normalizedUserId
    notificationScheduleIdsRef.current = safe
    try {
      await AsyncStorage.setItem(notificationScheduleIdsStorageKey(normalizedUserId), JSON.stringify(safe))
    } catch (_e) {
      // ignore
    }
  }

  async function clearNotificationScheduleIds(userId) {
    const normalizedUserId = String(userId ?? "").trim()
    if (!normalizedUserId) return
    if (notificationScheduleStateUserRef.current === normalizedUserId) {
      notificationScheduleStateUserRef.current = ""
      notificationScheduleIdsRef.current = {}
    }
    try {
      await AsyncStorage.removeItem(notificationScheduleIdsStorageKey(normalizedUserId))
    } catch (_e) {
      // ignore
    }
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

  function buildPlanNotificationCategoryLabel(row) {
    const rawCategory = String(row?.category_id ?? "").trim()
    return !rawCategory || rawCategory === "__general__" ? "통합" : rawCategory
  }

  function buildPlanNotificationKey(row, when, phase = "start") {
    const rowId = String(row?.id ?? "").trim()
    const leadMinutes = rowId ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[rowId] ?? 0) : 0
    const triggerAtMs = Number.isFinite(when?.getTime?.()) ? when.getTime() - leadMinutes * 60 * 1000 : NaN
    return [
      rowId || `${String(row?.date ?? "").trim()}::${getPlanDisplayText(row)}`,
      phase,
      String(row?.date ?? "").trim(),
      buildPlanTimeTextFromRow(row),
      String(row?.category_id ?? "").trim(),
      String(getPlanDisplayText(row) ?? "").trim(),
      String(triggerAtMs)
    ].join("::")
  }

  function buildStandardPlanNotificationEntry(row, when, phase = "start") {
    if (!row || !when || !Number.isFinite(when.getTime())) return null
    const rowId = String(row?.id ?? "").trim()
    const leadMinutes = rowId ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[rowId] ?? 0) : 0
    const triggerAt = new Date(when.getTime() - leadMinutes * 60 * 1000)
    if (!Number.isFinite(triggerAt.getTime())) return null
    const key = buildPlanNotificationKey(row, when, phase)
    const rawCategory = buildPlanNotificationCategoryLabel(row)
    const contentText = getPlanDisplayText(row) || "내용 없음"
    const timeRange = normalizePlanTimeRange(row)
    const timeText = phase === "end" ? formatTimeForDisplay(timeRange.endTime) : formatPlanTimeForDisplay(row)
    const title = phase === "end" ? "종료 알림" : "일정 알림"
    return {
      key,
      triggerAt,
      content: {
        title,
        body: `${timeText || "시간 없음"} · ${rawCategory} · ${contentText}`,
        sound: "default",
        data: { planId: String(row?.id ?? ""), date: String(row?.date ?? ""), phase },
        ...(Platform.OS === "android" ? { channelId: PLAN_NOTIFICATION_CHANNEL_ID } : {})
      }
    }
  }

  async function syncPlanNotifications(userId, planRows, syncId = 0) {
    notificationScheduleQueueRef.current = notificationScheduleQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (syncId && syncId !== notificationSyncSeqRef.current) return
        if (Platform.OS === "web") return
        if (!userId) {
          const previousUserId = notificationScheduleStateUserRef.current
          notificationPermissionCheckedRef.current = false
          notificationPermissionGrantedRef.current = false
          if (Object.keys(notificationScheduleIdsRef.current ?? {}).length > 0 || notificationScheduleFingerprintRef.current) {
            await Notifications.cancelAllScheduledNotificationsAsync()
          }
          if (previousUserId) {
            await clearNotificationScheduleIds(previousUserId)
          }
          notificationScheduleFingerprintRef.current = ""
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
          .flatMap((row) => {
            if (!row) return []
            const rowId = String(row?.id ?? "").trim()
            const alarmDisabled = rowId ? Boolean(alarmDisabledByPlanId?.[rowId]) : false
            const alarmEnabled = alarmDisabled ? false : row?.alarm_enabled == null ? true : Boolean(row?.alarm_enabled)
            if (!alarmEnabled) return []
            const startWhen = planDateTimeFromRow(row)
            return [buildStandardPlanNotificationEntry(row, startWhen, "start")].filter(Boolean)
          })
          .filter((entry) => {
            const triggerTimeMs = Number(entry?.triggerAt?.getTime?.())
            if (!Number.isFinite(triggerTimeMs)) return false
            return triggerTimeMs > now + 3000 && triggerTimeMs <= lookahead
          })
          .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
          .slice(0, PLAN_NOTIFICATION_MAX_COUNT)

        const nextFingerprint = (candidates ?? []).map((entry) => entry.key).join("||")
        if (syncId && syncId !== notificationSyncSeqRef.current) return
        if (nextFingerprint === notificationScheduleFingerprintRef.current) return

        let nextIdsByKey = await loadNotificationScheduleIds(userId)
        const desiredEntries = candidates.map((entry) => ({ ...entry }))
        const desiredKeys = new Set(desiredEntries.map((entry) => entry.key))

        for (const { content, key, triggerAt } of desiredEntries) {
          if (nextIdsByKey[key]) continue
          if (!Number.isFinite(triggerAt.getTime())) continue
          try {
            const androidDateTriggerType = Notifications?.SchedulableTriggerInputTypes?.DATE
            const identifier = await Notifications.scheduleNotificationAsync({
              content,
              trigger:
                Platform.OS === "android" && androidDateTriggerType
                  ? { type: androidDateTriggerType, date: triggerAt }
                  : triggerAt
            })
            if (identifier) {
              nextIdsByKey = { ...nextIdsByKey, [key]: identifier }
              notificationScheduleIdsRef.current = nextIdsByKey
            }
          } catch (_e) {
            // ignore individual schedule errors
          }
        }

        for (const [key, identifier] of Object.entries(nextIdsByKey)) {
          if (desiredKeys.has(key)) continue
          try {
            await Notifications.cancelScheduledNotificationAsync(identifier)
          } catch (_e) {
            // ignore stale notification cleanup failures
          }
          const next = { ...nextIdsByKey }
          delete next[key]
          nextIdsByKey = next
          notificationScheduleIdsRef.current = next
        }

        await persistNotificationScheduleIds(userId, nextIdsByKey)
        if (!syncId || syncId === notificationSyncSeqRef.current) {
          notificationScheduleFingerprintRef.current = nextFingerprint
        }
      })
    return notificationScheduleQueueRef.current
  }

  function requestPlanNotificationSync(userId, rows, { force = false, delayMs = 0 } = {}) {
    if (Platform.OS === "web") return null
    const syncId = notificationSyncSeqRef.current + 1
    notificationSyncSeqRef.current = syncId
    if (force) notificationScheduleFingerprintRef.current = ""
    const run = () => {
      syncPlanNotifications(userId, rows, syncId).catch(() => {})
    }
    if (delayMs > 0) {
      return setTimeout(run, delayMs)
    }
    run()
    return null
  }

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!mounted) return
        if (error) throw error
        setSession(data.session ?? null)
      } catch (error) {
        if (!mounted) return
        if (isInvalidRefreshTokenError(error)) {
          await clearBrokenAuthSession("저장된 로그인 세션이 만료되어 다시 로그인해 주세요.")
          return
        }
        setSession(null)
      }
    })()
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
  }, [session?.user?.id, memoYear])

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
  }, [session?.user?.id, memoYear])

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
        (payload) => {
          const eventType = String(payload?.eventType ?? "").toUpperCase()
          const incomingClientId = String(payload?.new?.client_id ?? payload?.old?.client_id ?? "").trim()
          if (incomingClientId && clientId && incomingClientId === String(clientId)) return
          if (eventType === "DELETE" || payload?.new?.deleted_at) {
            const deletedId = String(payload?.old?.id ?? payload?.new?.id ?? "").trim()
            if (deletedId) {
              setPlans((prev) => (prev ?? []).filter((row) => String(row?.id ?? "").trim() !== deletedId))
            }
            schedule("plans", () => loadPlans(userId, { silent: true }), 120)
            return
          }
          const incoming = payload?.new
          if (incoming?.id) {
            const normalized = {
              ...incoming,
              category_id: String(incoming?.category_id ?? "__general__").trim() || "__general__"
            }
            setPlans((prev) => {
              const list = prev ?? []
              const index = list.findIndex((row) => String(row?.id ?? "").trim() === String(normalized.id))
              if (index >= 0) {
                const next = [...list]
                next[index] = { ...list[index], ...normalized }
                return dedupeRowsById(next)
              }
              return dedupeRowsById([...list, normalized])
            })
          }
          schedule("plans", () => loadPlans(userId, { silent: true }), 120)
        }
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
        (payload) => {
          const changedYear = Number(payload?.new?.year ?? payload?.old?.year ?? NaN)
          if (Number.isFinite(changedYear) && changedYear !== memoYear) return
          const incomingClientId = String(payload?.new?.client_id ?? payload?.old?.client_id ?? "").trim()
          if (incomingClientId && clientId && incomingClientId === String(clientId)) return
          const targetWindowId = String(payload?.new?.window_id ?? payload?.old?.window_id ?? "").trim()
          if (targetWindowId && targetWindowId !== "all") {
            const eventType = String(payload?.eventType ?? "").toUpperCase()
            if (eventType === "DELETE") {
              setRightMemos((prev) => {
                const current = prev ?? {}
                if (!Object.prototype.hasOwnProperty.call(current, targetWindowId)) return current
                const next = { ...current }
                delete next[targetWindowId]
                return next
              })
            } else {
              const nextContent = String(payload?.new?.content ?? "")
              setRightMemos((prev) => {
                const current = prev ?? {}
                if (String(current[targetWindowId] ?? "") === nextContent) return current
                return { ...current, [targetWindowId]: nextContent }
              })
            }
          }
          schedule("right_memos", () => loadRightMemos(userId, memoYear), 120)
        }
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
  }, [session?.user?.id, memoYear, clientId])

  useEffect(() => {
    ensureHolidayYear?.(new Date().getFullYear())
  }, [ensureHolidayYear])

  useEffect(() => {
    plansRef.current = Array.isArray(plans) ? plans : []
  }, [plans])

  useEffect(() => {
    if (Platform.OS === "web") return
    const userId = session?.user?.id ?? null
    const rows = plans ?? []
    const timer = requestPlanNotificationSync(userId, rows, { delayMs: 140 })
    return () => {
      if (timer) clearTimeout(timer)
    }
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
        const [rawTheme, legacyFont, rawListFont, rawMemoFont, rawCalendarFont, rawTabFont] = await Promise.all([
          AsyncStorage.getItem(UI_THEME_KEY),
          AsyncStorage.getItem(LEGACY_UI_FONT_SCALE_KEY),
          AsyncStorage.getItem(UI_LIST_FONT_SCALE_KEY),
          AsyncStorage.getItem(UI_MEMO_FONT_SCALE_KEY),
          AsyncStorage.getItem(UI_CALENDAR_FONT_SCALE_KEY),
          AsyncStorage.getItem(UI_TAB_FONT_SCALE_KEY)
        ])
        if (!mounted) return
        if (rawTheme === "dark" || rawTheme === "light") setThemeMode(rawTheme)
        const legacyScale = parseStoredUiFontScale(legacyFont, UI_FONT_SCALE_DEFAULT)
        setListFontScale(parseStoredUiFontScale(rawListFont, legacyScale))
        setMemoFontScale(parseStoredUiFontScale(rawMemoFont, legacyScale))
        setCalendarFontScale(parseStoredUiFontScale(rawCalendarFont, legacyScale))
        setTabFontScale(parseStoredUiFontScale(rawTabFont, legacyScale))
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

  const persistUiFontScale = useCallback(async (storageKey, next) => {
    if (!storageKey) return
    try {
      await AsyncStorage.setItem(storageKey, String(normalizeUiFontPresetScale(next)))
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
      await AsyncStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          remember: true,
          email: String(next?.email ?? "").trim()
        })
      )
    } catch (_err) {
      // ignore
    }
  }

  async function clearBrokenAuthSession(message = "저장된 로그인 세션이 만료되어 다시 로그인해 주세요.") {
    if (!supabase) return
    try {
      await supabase.auth.signOut({ scope: "local" })
    } catch (_e) {
      // ignore and fall back to raw storage cleanup
    }
    try {
      const authKeys = getSupabaseAuthStorageKeys()
      if (authKeys.length) {
        await AsyncStorage.multiRemove(authKeys)
      }
    } catch (_e) {
      // ignore
    }
    setSession(null)
    setAuthLoading(false)
    if (message) {
      setAuthMessageTone("error")
      setAuthMessage(message)
    }
  }

  useEffect(() => {
    if (!authReady) return
    if (!rememberCreds) return
    if (authDraftTimerRef.current) clearTimeout(authDraftTimerRef.current)
    authDraftTimerRef.current = setTimeout(() => {
      persistAuthDraft({ remember: true, email })
    }, 250)
    return () => {
      if (authDraftTimerRef.current) clearTimeout(authDraftTimerRef.current)
    }
  }, [email, rememberCreds, authReady])

  useEffect(() => {
    if (!supabase || !session?.user?.id) return
    loadPlans(session.user.id)
    loadWindows(session.user.id)
    loadRightMemos(session.user.id, memoYear)
  }, [session?.user?.id])

  useEffect(() => {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    const sub = AppState.addEventListener("change", (nextState) => {
      const prevState = String(appStateRef.current ?? "")
      appStateRef.current = nextState
      const becameActive = prevState.match(/inactive|background/) && nextState === "active"
      if (!becameActive) return
      requestPlanNotificationSync(userId, plansRef.current, { force: true })
      loadPlans(userId, { silent: true }).catch(() => {})
      loadWindows(userId).catch(() => {})
      loadRightMemos(userId, memoYear).catch(() => {})
    })
    return () => {
      try {
        sub.remove()
      } catch (_e) {
        // ignore
      }
    }
  }, [session?.user?.id, memoYear, supabase])

  async function loadPlans(userId, options = {}) {
    if (!supabase || !userId) return
    const requestSeq = plansLoadSeqRef.current + 1
    plansLoadSeqRef.current = requestSeq
    const silent = Boolean(options?.silent)
    if (!silent) {
      visiblePlansLoadSeqRef.current = requestSeq
      setLoading(true)
    }
    try {
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
      if (requestSeq !== plansLoadSeqRef.current) return
      if (error) {
        setAuthMessage(error.message || "Load failed.")
        setPlans([])
      } else {
        const normalizedRows = dedupeRowsById(data ?? [])
        setPlans(normalizedRows)
        await backfillSortOrderFromLegacy(userId, normalizedRows)
        ensureOpenEndedRecurringCoverage(userId, normalizedRows)
          .then((changed) => {
            if (!changed) return
            loadPlans(userId, { silent: true }).catch(() => {})
          })
          .catch(() => {})
      }
    } finally {
      if (!silent && visiblePlansLoadSeqRef.current === requestSeq) {
        visiblePlansLoadSeqRef.current = 0
        setLoading(false)
      }
    }
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
    const requestSeq = windowsLoadSeqRef.current + 1
    windowsLoadSeqRef.current = requestSeq
    const { data, error } = await supabase
      .from("windows")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
    if (error) return
    if (requestSeq !== windowsLoadSeqRef.current) return
    const normalized = (data ?? [])
      .filter((row) => row && row.title)
      .map((row) => ({
        id: row.id,
        title: normalizeWindowTitle(row.title),
        color: normalizeWindowColor(typeof row.color === "string" ? row.color : "#3b82f6") || "#3b82f6",
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
        .map((w) => normalizeWindowColor(w?.color))
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
    const requestedColor = normalizeWindowColor(color)
    const normalizedColor = WINDOW_COLORS.includes(requestedColor) ? requestedColor : pickNextWindowColor(windows)
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
    const requestedColor = normalizeWindowColor(nextColor)
    const normalizedColor = WINDOW_COLORS.includes(requestedColor) ? requestedColor : pickNextWindowColor(windows)
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
    const requestSeq = rightMemosLoadSeqRef.current + 1
    rightMemosLoadSeqRef.current = requestSeq
    const { data, error } = await supabase
      .from("right_memos")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
    if (error) return
    if (requestSeq !== rightMemosLoadSeqRef.current) return
    const map = {}
    for (const row of data ?? []) {
      if (!row?.window_id) continue
      map[row.window_id] = String(row?.content ?? "")
    }
    const now = Date.now()
    const pending = { ...(pendingRightMemoWritesRef.current ?? {}) }
    let pendingChanged = false
    for (const [id, entry] of Object.entries(pending)) {
      const key = String(id ?? "").trim()
      if (!key || !entry || typeof entry !== "object") {
        delete pending[key]
        pendingChanged = true
        continue
      }
      const expiresAt = Number(entry.expiresAt ?? 0)
      const value = String(entry.value ?? "")
      const loadedValue = String(map[key] ?? "")
      if (loadedValue === value || (expiresAt > 0 && now >= expiresAt)) {
        delete pending[key]
        pendingChanged = true
        continue
      }
      map[key] = value
    }
    if (pendingChanged) pendingRightMemoWritesRef.current = pending
    setRightMemos(map)
  }

  function stageRightMemoWrite(windowId, content) {
    const id = String(windowId ?? "").trim()
    if (!id || id === "all") return
    const text = String(content ?? "")
    pendingRightMemoWritesRef.current = {
      ...(pendingRightMemoWritesRef.current ?? {}),
      [id]: { value: text, expiresAt: Date.now() + 5000 }
    }
    setRightMemos((prev) => ({ ...(prev ?? {}), [id]: text }))
  }

  async function saveRightMemo(windowId, content) {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    const id = String(windowId ?? "").trim()
    if (!id || id === "all") return
    const text = String(content ?? "")
    stageRightMemoWrite(id, text)
    const basePayload = {
      user_id: userId,
      year: memoYear,
      window_id: id,
      content: text
    }
    let error = null
    if (rightMemoMetaColumnsSupportedRef.current) {
      const result = await supabase.from("right_memos").upsert(
        {
          ...basePayload,
          updated_at: new Date().toISOString(),
          client_id: clientId || null
        },
        { onConflict: "user_id,year,window_id" }
      )
      error = result?.error ?? null
      if (error && isRightMemoMetaColumnError(error)) {
        rightMemoMetaColumnsSupportedRef.current = false
        error = null
      } else if (!error) {
        return
      }
    }
    if (!error) {
      const result = await supabase.from("right_memos").upsert(basePayload, {
        onConflict: "user_id,year,window_id"
      })
      error = result?.error ?? null
    }
    if (error) {
      const nextPending = { ...(pendingRightMemoWritesRef.current ?? {}) }
      delete nextPending[id]
      pendingRightMemoWritesRef.current = nextPending
      Alert.alert("오류", error.message || "메모 저장 실패")
      await loadRightMemos(userId, memoYear)
      return
    }
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

  function comparePlanRowsForDefaultInsert(a, b) {
    const orderA = parseSortOrderValue(a?.sort_order ?? a?.sortOrder ?? a?.order)
    const orderB = parseSortOrderValue(b?.sort_order ?? b?.sortOrder ?? b?.order)
    if (orderA != null || orderB != null) {
      if (orderA == null) return 1
      if (orderB == null) return -1
      if (orderA !== orderB) return orderA - orderB
    }
    const timeA = normalizePlanTimeRange(a).time
    const timeB = normalizePlanTimeRange(b).time
    if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
    if (timeA && !timeB) return -1
    if (!timeA && timeB) return 1
    const createdA = parseTimestampMs(a?.created_at ?? a?.createdAt)
    const createdB = parseTimestampMs(b?.created_at ?? b?.createdAt)
    if (createdA != null || createdB != null) {
      if (createdA == null) return 1
      if (createdB == null) return -1
      if (createdA !== createdB) return createdA - createdB
    }
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "en")
  }

  function buildDefaultInsertSortPlan(dateKey, planRows, nextRow) {
    if (!sortOrderSupportedRef.current) return null
    const key = String(dateKey ?? "").trim()
    if (!key) return null
    const rows = sortItemsByTimeAndOrder(
      (planRows ?? []).filter((row) => {
        if (!row || row?.deleted_at || !isVisibleSchedulePlanRow(row)) return false
        return String(row?.date ?? "").trim() === key
      })
    )
    const nextTime = normalizePlanTimeRange(nextRow).time
    let insertIndex = rows.length
    if (nextTime) {
      const earlierTimedIndex = rows.findIndex((row) => {
        const rowTime = normalizePlanTimeRange(row).time
        return rowTime && rowTime.localeCompare(nextTime) > 0
      })
      if (earlierTimedIndex >= 0) {
        insertIndex = earlierTimedIndex
      } else {
        const lastTimedIndex = rows.reduce((last, row, idx) => (normalizePlanTimeRange(row).time ? idx : last), -1)
        insertIndex = lastTimedIndex >= 0 ? lastTimedIndex + 1 : 0
      }
    }
    const updates = rows
      .map((row, index) => {
        const rowId = String(row?.id ?? "").trim()
        if (!rowId) return null
        const order = index >= insertIndex ? index + 1 : index
        return { id: rowId, order }
      })
      .filter(Boolean)
    return { sortOrder: insertIndex, updates }
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

  function stripSortOrderColumns(row) {
    const next = { ...(row ?? {}) }
    delete next.sort_order
    return next
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

function isRightMemoMetaColumnError(error) {
  const msg = String(error?.message ?? "").toLowerCase()
  if (!msg) return false
  return (
    msg.includes("right_memos") &&
    (msg.includes("client_id") || msg.includes("updated_at") || (msg.includes("column") && msg.includes("memo")))
  )
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
    setAuthMessage("정렬 순서 컬럼(sort_order)이 없어 일정 순서가 기기 간에 완전히 동기화되지 않을 수 있습니다.")
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
      repeatUntilKey: repeatMeta.repeatUntil,
      spanDays: repeatMeta.repeatUntil ? REPEAT_DEFAULT_SPAN_DAYS : getOpenEndedRepeatSpanDays(dateKey)
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

  function buildOpenEndedRecurringAppendRows(userId, planRows) {
    if (!repeatColumnsSupportedRef.current) return []
    const rows = Array.isArray(planRows) ? planRows.filter((row) => row && !row?.deleted_at) : []
    if (rows.length === 0) return []

    const horizonKey = dateKeyFromDate(getOpenEndedRepeatHorizonDate())
    const horizonMs = keyToTime(horizonKey)
    const groups = new Map()

    for (const row of rows) {
      const repeatMeta = normalizeRepeatMeta(row)
      const seriesId = String(repeatMeta.seriesId ?? "").trim()
      const dateKey = String(row?.date ?? "").trim()
      if (!seriesId || !dateKey) continue
      if (repeatMeta.repeatType === "none" || repeatMeta.repeatUntil) continue
      const current = groups.get(seriesId)
      if (!current) {
        groups.set(seriesId, {
          seriesId,
          repeatMeta,
          startDateKey: dateKey,
          latestDateKey: dateKey,
          sampleRow: row
        })
        continue
      }
      if (keyToTime(dateKey) < keyToTime(current.startDateKey)) {
        current.startDateKey = dateKey
        current.sampleRow = row
      }
      if (keyToTime(dateKey) > keyToTime(current.latestDateKey)) {
        current.latestDateKey = dateKey
      }
    }

    const nextRows = []
    const mergedRows = [...rows]

    for (const group of groups.values()) {
      const latestMs = keyToTime(group.latestDateKey)
      if (!Number.isFinite(latestMs) || latestMs >= horizonMs) continue
      const desiredKeys = generateRecurringDateKeys({
        startDateKey: group.startDateKey,
        repeatType: group.repeatMeta.repeatType,
        repeatInterval: group.repeatMeta.repeatInterval,
        repeatDays: group.repeatMeta.repeatDays ?? [],
        repeatUntilKey: null,
        spanDays: getOpenEndedRepeatSpanDays(group.startDateKey)
      }).filter((key) => keyToTime(key) > latestMs && keyToTime(key) <= horizonMs)

      for (const nextDateKey of desiredKeys) {
        const sortOrderOverride = sortOrderSupportedRef.current ? getNextSortOrderForDate(nextDateKey, mergedRows) : null
        const nextRow = buildSinglePlanPayload(userId, group.sampleRow, {
          seriesIdOverride: group.seriesId,
          dateOverride: nextDateKey,
          sortOrderOverride
        })
        nextRows.push(nextRow)
        mergedRows.push(nextRow)
      }
    }

    return nextRows
  }

  async function ensureOpenEndedRecurringCoverage(userId, planRows) {
    if (!supabase || !userId || openEndedRecurringSyncRef.current) return false
    const appendRows = buildOpenEndedRecurringAppendRows(userId, planRows)
    if (appendRows.length === 0) return false

    openEndedRecurringSyncRef.current = true
    try {
      await insertPlansInChunks(appendRows)
      return true
    } catch (error) {
      if (!isDuplicateConflictError(error)) {
        console.warn("mobile open-ended recurring sync", error)
      }
      return false
    } finally {
      openEndedRecurringSyncRef.current = false
    }
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
    if (error && isSortOrderColumnError(error)) {
      markSortOrderFallbackNotice()
      const retry = await supabase.from("plans").update(stripSortOrderColumns(payload)).eq("id", id).eq("user_id", userId)
      error = retry.error
    }
    if (error) throw error
  }

  async function updateRecurringSeriesRows(userId, next, { futureOnly = false } = {}) {
    const sourceSeriesId = String(next?.original_series_id ?? next?.series_id ?? "").trim()
    if (!supabase || !userId || !sourceSeriesId) return []

    const updatedAt = new Date().toISOString()
    const normalizedTime = normalizeClockTime(next?.time)
    let normalizedEndTime = normalizeClockTime(next?.end_time ?? next?.endTime)
    if (!normalizedTime || !normalizedEndTime || normalizedEndTime === normalizedTime) normalizedEndTime = ""

    const payload = {
      content: String(next?.content ?? "").trim(),
      category_id: String(next?.category_id ?? "__general__").trim() || "__general__",
      time: normalizedTime || null,
      updated_at: updatedAt,
      client_id: clientId || null
    }
    if (endTimeColumnSupportedRef.current) payload.end_time = normalizedEndTime || null

    let query = supabase
      .from("plans")
      .update(payload)
      .select("id")
      .eq("user_id", userId)
      .eq("series_id", sourceSeriesId)
      .is("deleted_at", null)

    if (futureOnly) {
      const futureFrom = String(next?.original_date ?? next?.date ?? "").trim() || String(next?.date ?? "").trim()
      query = query.gte("date", futureFrom)
    }

    let { data, error } = await query
    if (error && isEndTimeColumnError(error)) {
      markEndTimeFallbackNotice()
      let retry = supabase
        .from("plans")
        .update(stripEndTimeColumns(payload))
        .select("id")
        .eq("user_id", userId)
        .eq("series_id", sourceSeriesId)
        .is("deleted_at", null)
      if (futureOnly) {
        const futureFrom = String(next?.original_date ?? next?.date ?? "").trim() || String(next?.date ?? "").trim()
        retry = retry.gte("date", futureFrom)
      }
      const retryResult = await retry
      data = retryResult.data
      error = retryResult.error
    }
    if (error) throw error
    return [...new Set((data ?? []).map((row) => String(row?.id ?? "").trim()).filter(Boolean))]
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

    try {
      let affectedPlanIds = []
      const originalDate = String(next?.original_date ?? "").trim()
      const requestedEditScope = String(next?.edit_scope ?? "single")
      const editScope = resolveRecurringEditScope({
        requestedScope: requestedEditScope,
        originalDate,
        nextDate: dateKey
      })
      if (requestedEditScope === "future" && editScope === "all" && originalDate && dateKey && dateKey < originalDate) {
        setAuthMessageTone("info")
        setAuthMessage("반복 일정의 날짜를 앞당긴 경우에는 꼬임을 막기 위해 전체 범위로 저장했어요.")
      }
      const nextRepeatType = normalizeRepeatType(next?.repeat_type)
      const sourceSeriesId = repeatColumnsSupportedRef.current
        ? String(next?.original_series_id ?? next?.series_id ?? "").trim()
        : ""
      const sourceRepeatType = normalizeRepeatType(next?.original_repeat_type ?? next?.repeat_type)
      const nextRepeatInterval = normalizeRepeatInterval(next?.repeat_interval)
      const sourceRepeatInterval = normalizeRepeatInterval(next?.original_repeat_interval ?? next?.repeat_interval)
      const nextRepeatDays = normalizeRepeatDays(next?.repeat_days)
      const sourceRepeatDays = normalizeRepeatDays(next?.original_repeat_days ?? next?.repeat_days)
      const resolvedNextRepeatDays = resolveFutureRecurringRepeatDays({
        editScope,
        originalDate,
        nextDate: dateKey,
        sourceRepeatType,
        nextRepeatType,
        sourceRepeatDays,
        nextRepeatDays
      })
      const effectiveNext = sameRepeatDays(resolvedNextRepeatDays, next?.repeat_days)
        ? next
        : { ...(next ?? {}), repeat_days: resolvedNextRepeatDays }
      const nextRepeatUntil = String(next?.repeat_until ?? "").trim()
      const sourceRepeatUntil = String(next?.original_repeat_until ?? next?.repeat_until ?? "").trim()
      const legacySeriesIds = [...new Set((next?.legacy_series_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
      const legacyFutureIds = [...new Set((next?.legacy_future_ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
      const sourceIsRecurring = Boolean(sourceSeriesId) || sourceRepeatType !== "none"
      const shouldDetachSingleOccurrence = Boolean(next?.id) && sourceIsRecurring && editScope === "single"
      const enableRecurringFromSingle = Boolean(next?.id) && !sourceIsRecurring && nextRepeatType !== "none"
      const shouldRegenerate = Boolean(next?.id) && (editScope === "future" || editScope === "all" || enableRecurringFromSingle)
      const canUpdateRecurringInPlace =
        Boolean(next?.id) &&
        sourceIsRecurring &&
        (editScope === "future" || editScope === "all") &&
        Boolean(sourceSeriesId) &&
        nextRepeatType === sourceRepeatType &&
        nextRepeatInterval === sourceRepeatInterval &&
        sameRepeatDays(resolvedNextRepeatDays, sourceRepeatDays) &&
        nextRepeatUntil === sourceRepeatUntil &&
        String(effectiveNext?.date ?? "").trim() === originalDate

      if (effectiveNext?.id && !shouldRegenerate) {
        const nextDate = String(effectiveNext?.date ?? "").trim()
        const nextTime = normalizeClockTime(effectiveNext?.time)
        const originalTime = normalizeClockTime(effectiveNext?.original_time)
        const dateChanged = originalDate && nextDate && nextDate !== originalDate
        const becameNoTime = Boolean(originalTime) && !nextTime
        const shouldAssignSortOrder =
          sortOrderSupportedRef.current && !nextTime && (dateChanged || becameNoTime)
        const sortOrderOverride = shouldAssignSortOrder ? getNextSortOrderForDate(nextDate, plans) : null
        const singlePayloadSource = shouldDetachSingleOccurrence
          ? {
              ...(effectiveNext ?? {}),
              repeat_type: "none",
              repeat_interval: 1,
              repeat_days: null,
              repeat_until: null
            }
          : effectiveNext
        const payload = buildSinglePlanPayload(userId, singlePayloadSource, {
          seriesIdOverride: shouldDetachSingleOccurrence ? null : nextRepeatType === "none" ? null : sourceSeriesId || null,
          sortOrderOverride
        })
        await updatePlanRow(userId, effectiveNext.id, payload)
        affectedPlanIds = [String(effectiveNext.id)]
      } else if (canUpdateRecurringInPlace) {
        affectedPlanIds = await updateRecurringSeriesRows(userId, effectiveNext, { futureOnly: editScope === "future" })
      } else if (effectiveNext?.id && shouldRegenerate) {
        // Pre-calculate legacy ids so we can still delete old rows if repeat-column fallback happens mid-save.
        const useLegacyRange = Boolean(effectiveNext?.has_recurrence_hint) && (editScope === "future" || editScope === "all")
        let legacyDeleteIds = []
        if (useLegacyRange) {
          if (editScope === "all" && legacySeriesIds.length > 0) {
            legacyDeleteIds = legacySeriesIds
          } else if (editScope === "future" && legacyFutureIds.length > 0) {
            legacyDeleteIds = legacyFutureIds
          } else if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
            legacyDeleteIds = await fetchLegacySeriesIds(userId, effectiveNext, { futureOnly: editScope === "future" })
          } else {
            legacyDeleteIds = [effectiveNext.id]
          }
        } else {
          legacyDeleteIds = [effectiveNext.id]
        }

        const rows = buildRecurringRows(userId, effectiveNext, {
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
              const futureFrom = String(effectiveNext?.original_date ?? dateKey).trim() || dateKey
              query = query.gte("date", futureFrom)
            }
            const { error } = await query
            if (error && isRepeatColumnError(error)) {
              markRepeatFallbackNotice()
              if (legacyDeleteIds.length === 0) {
                if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
                  legacyDeleteIds = await fetchLegacySeriesIds(userId, effectiveNext, { futureOnly: editScope === "future" })
                } else {
                  legacyDeleteIds = [effectiveNext.id]
                }
              }
              await softDeletePlansByIds(userId, legacyDeleteIds, deletedAt)
            } else if (error) {
              throw error
            }
          } else {
            if (legacyDeleteIds.length === 0) {
              if (ENABLE_LEGACY_BROAD_DELETE_FALLBACK) {
                legacyDeleteIds = await fetchLegacySeriesIds(userId, effectiveNext, { futureOnly: editScope === "future" })
              } else {
                legacyDeleteIds = [effectiveNext.id]
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
        if (!effectiveNext?.id && nextRepeatType === "none") {
          const sortPlan = sortOrderSupportedRef.current ? buildDefaultInsertSortPlan(dateKey, plans, effectiveNext) : null
          const rows = [
            buildSinglePlanPayload(userId, effectiveNext, {
              seriesIdOverride: null,
              dateOverride: dateKey,
              sortOrderOverride: sortPlan?.sortOrder ?? getNextSortOrderForDate(dateKey, plans)
            })
          ]
          affectedPlanIds = await insertPlansInChunks(rows)
          if (sortPlan?.updates?.length) {
            await updatePlanSortOrders(userId, sortPlan.updates, Date.now())
          }
        } else {
          const rows = buildRecurringRows(userId, effectiveNext, {
            seriesIdOverride: nextRepeatType === "none" ? null : genSeriesId(),
            forceSortOrder: true
          })
          affectedPlanIds = await insertPlansInChunks(rows)
        }
      }

      Promise.all([
        setAlarmEnabledForIds(userId, affectedPlanIds, nextAlarmEnabled),
        setAlarmLeadMinutesForIds(userId, affectedPlanIds, nextAlarmLeadMinutes)
      ]).catch(() => {})
      await loadPlans(userId, { silent: true })
      return true
    } catch (error) {
      const message = error?.message || "Save failed."
      setAuthMessage(message)
      Alert.alert("저장 실패", message)
      return false
    }
  }

  async function reorderNoTimePlans(dateKey, orderedItems) {
    const key = String(dateKey ?? "").trim()
    if (!key) return
    const list = enforceTimedPlanOrderInSlots(Array.isArray(orderedItems) ? orderedItems : [])
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

  function buildPlanDragMoveState(planRows, movingRow, targetDateKey, targetIndex = 0) {
    const rowId = String(movingRow?.id ?? "").trim()
    const nextDate = String(targetDateKey ?? "").trim()
    const sourceDate = String(movingRow?.date ?? "").trim()
    if (!rowId || !nextDate || !sourceDate) return null
    const rows = Array.isArray(planRows) ? planRows : []
    const sourceRows = sortItemsByTimeAndOrder(
      rows.filter((row) => isVisibleSchedulePlanRow(row) && String(row?.date ?? "").trim() === sourceDate)
    )
    const targetRowsRaw =
      sourceDate === nextDate
        ? sourceRows
        : sortItemsByTimeAndOrder(
            rows.filter((row) => isVisibleSchedulePlanRow(row) && String(row?.date ?? "").trim() === nextDate)
          )
    const sourceAfter = enforceTimedPlanOrderInSlots(sourceRows.filter((row) => String(row?.id ?? "").trim() !== rowId))
    const targetBase = targetRowsRaw.filter((row) => String(row?.id ?? "").trim() !== rowId)
    const insertIndex = clamp(Math.round(Number(targetIndex) || 0), 0, targetBase.length)
    const movingNext = { ...(movingRow ?? {}), date: nextDate }
    const targetAfterRaw = [...targetBase]
    targetAfterRaw.splice(insertIndex, 0, movingNext)
    const targetAfter = enforceTimedPlanOrderInSlots(targetAfterRaw)

    const orderById = new Map()
    const dateById = new Map()
    if (sourceDate !== nextDate) {
      sourceAfter.forEach((row, index) => {
        const id = String(row?.id ?? "").trim()
        if (!id) return
        orderById.set(id, index)
        dateById.set(id, sourceDate)
      })
    }
    targetAfter.forEach((row, index) => {
      const id = String(row?.id ?? "").trim()
      if (!id) return
      orderById.set(id, index)
      dateById.set(id, nextDate)
    })

    const updates = [...orderById.entries()].map(([id, order]) => ({
      id,
      date: dateById.get(id) ?? nextDate,
      order
    }))
    const movedUpdate = updates.find((item) => item.id === rowId) ?? { id: rowId, date: nextDate, order: insertIndex }
    const changed =
      sourceDate !== nextDate ||
      sourceRows.findIndex((row) => String(row?.id ?? "").trim() === rowId) !==
        targetAfter.findIndex((row) => String(row?.id ?? "").trim() === rowId)

    return {
      rowId,
      sourceDate,
      targetDate: nextDate,
      changed,
      movedUpdate,
      updates
    }
  }

  async function movePlanByDrag(item, targetDateKey, targetIndex = 0) {
    const rowId = String(item?.id ?? "").trim()
    if (!rowId) return
    const currentRow = (plansRef.current ?? []).find((row) => String(row?.id ?? "").trim() === rowId) ?? item
    if (!isMovableNoTimePlanRow(currentRow)) {
      Alert.alert("이동할 수 없어요", getPlanMoveBlockedMessage(currentRow))
      return
    }
    const currentDate = String(currentRow?.date ?? "").trim()
    const nextDate = String(targetDateKey ?? "").trim()
    if (isRecurringPlanRowForMove(currentRow) && currentDate && nextDate && currentDate !== nextDate) {
      Alert.alert("이동할 수 없어요", "반복 일정은 같은 날짜 안에서만 순서를 바꿀 수 있어요.")
      return
    }
    const moveState = buildPlanDragMoveState(plansRef.current, currentRow, targetDateKey, targetIndex)
    if (!moveState) return
    if ((moveState.updates?.length ?? 0) === 0) {
      setPlans((prev) => [...(prev ?? [])])
      return
    }

    const baseMs = Date.now()
    const orderMap = new Map(moveState.updates.map((update) => [update.id, update]))
    setPlans((prev) =>
      (prev ?? []).map((row) => {
        const id = String(row?.id ?? "").trim()
        const update = orderMap.get(id)
        if (!update) return row
        return {
          ...row,
          date: update.date,
          sort_order: update.order,
          updated_at: new Date(baseMs + update.order).toISOString()
        }
      })
    )

    const userId = session?.user?.id
    if (!supabase || !userId) return
    try {
      const movedPayload = {
        date: moveState.targetDate,
        sort_order: moveState.movedUpdate.order,
        updated_at: new Date(baseMs + moveState.movedUpdate.order).toISOString(),
        client_id: clientId || null
      }
      await updatePlanRow(userId, rowId, movedPayload)
      await updatePlanSortOrders(
        userId,
        moveState.updates.map((update) => ({ id: update.id, order: update.order })),
        baseMs
      )
    } catch (error) {
      const message = error?.message || "Save failed."
      Alert.alert("이동 저장 실패", message)
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

      await loadPlans(userId, { silent: true })
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
    const resolvedAuth = resolveAuthIdentifier(email)
    if (!resolvedAuth.email || !password) {
      setAuthMessage("아이디 또는 이메일과 비밀번호를 입력해 주세요.")
      setAuthMessageTone("error")
      return
    }
    setAuthMessage("")
    setAuthMessageTone("error")
    setAuthLoading(true)
    let result = await supabase.auth.signInWithPassword({ email: resolvedAuth.email, password })
    if (result?.error && isInvalidRefreshTokenError(result.error)) {
      await clearBrokenAuthSession("")
      result = await supabase.auth.signInWithPassword({ email: resolvedAuth.email, password })
    }
    if (result?.error) {
      setAuthMessage(result.error.message)
    } else {
      await persistAuthDraft({ remember: rememberCreds, email })
    }
    setAuthLoading(false)
  }

  async function handleSignUp() {
    if (!supabase) return
    const resolvedAuth = resolveAuthIdentifier(email)
    if (!resolvedAuth.email || !password) {
      setAuthMessage("아이디 또는 이메일과 비밀번호를 입력해 주세요.")
      setAuthMessageTone("error")
      return
    }
    if (password.length < AUTH_MIN_PASSWORD_LENGTH) {
      setAuthMessage(`비밀번호는 ${AUTH_MIN_PASSWORD_LENGTH}자 이상으로 입력해 주세요.`)
      setAuthMessageTone("error")
      return
    }
    if (!signupTermsAgreed || !signupPrivacyAgreed) {
      setAuthMessage("이용약관과 개인정보 수집·이용에 동의해 주세요.")
      setAuthMessageTone("error")
      return
    }
    setAuthMessage("")
    setAuthMessageTone("error")
    setAuthLoading(true)
    const result = await supabase.auth.signUp({
      email: resolvedAuth.email,
      password,
      options: {
        data: {
          login_id: resolvedAuth.input,
          login_kind: resolvedAuth.isEmail ? "email" : "id",
          terms_agreed: true,
          privacy_agreed: true,
          updates_agreed: Boolean(signupUpdatesAgreed)
        }
      }
    })
    if (result?.error) {
      setAuthMessage(result.error.message)
    } else {
      await persistAuthDraft({ remember: rememberCreds, email })
      setAuthMessageTone("info")
      setAuthMessage(
        resolvedAuth.isEmail
          ? "가입이 완료됐어요. 설정에 따라 이메일 인증이 필요할 수 있어요."
          : "가입이 완료됐어요. 이제 아이디로 로그인해 주세요."
      )
      setSignupTermsAgreed(false)
      setSignupPrivacyAgreed(false)
      setSignupUpdatesAgreed(false)
      setSignupDetailsOpen(false)
      setAuthMode("signin")
      setPassword("")
    }
    setAuthLoading(false)
  }

  async function handleSignOut() {
    if (!supabase) return
    await supabase.auth.signOut({ scope: "local" })
  }

  async function runDeleteAccount() {
    if (!supabase || !session?.user?.id || deleteAccountLoading) return
    const accessToken = String(session?.access_token ?? "").trim()
    if (!accessToken) {
      setAuthMessageTone("error")
      setAuthMessage("로그인 세션을 확인하지 못했습니다. 다시 로그인 후 시도해 주세요.")
      return
    }
    setDeleteAccountLoading(true)
    setAuthMessage("")
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: { confirm: true }
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))

      try {
        await persistAuthDraft({ remember: false })
      } catch (_e) {
        // ignore
      }
      setRememberCreds(false)
      setEmail("")
      setPassword("")
      setPlans([])
      setWindows(DEFAULT_WINDOWS)
      setRightMemos({})
      setActiveTabId("all")
      setSettingsVisible(false)
      await clearBrokenAuthSession("")
      setAuthMessageTone("info")
      setAuthMessage("계정 탈퇴가 완료됐습니다.")
    } catch (error) {
      const message = String(error?.message ?? "계정 탈퇴에 실패했습니다.")
      setAuthMessageTone("error")
      setAuthMessage(message)
      Alert.alert("계정 탈퇴 실패", message)
    } finally {
      setDeleteAccountLoading(false)
    }
  }

  function handleDeleteAccount() {
    if (deleteAccountLoading) return
    Alert.alert("계정 탈퇴", "모든 일정, 메모, 설정이 삭제되고 되돌릴 수 없습니다.", [
      { text: "취소", style: "cancel" },
      {
        text: "계속",
        style: "destructive",
        onPress: () => {
          Alert.alert("한 번 더 확인", "정말 계정을 탈퇴할까요?", [
            { text: "취소", style: "cancel" },
            { text: "탈퇴", style: "destructive", onPress: runDeleteAccount }
          ])
        }
      }
    ])
  }

  const activeTitle = useMemo(() => {
    if (activeTabId === "all") return null
    return windows.find((w) => w.id === activeTabId)?.title ?? null
  }, [windows, activeTabId])

  function getDefaultCreateDateKey() {
    const today = new Date()
    const todayKey = dateToKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
    if (activeScreen === "Calendar") return lastCalendarDateKeyRef.current || todayKey
    return todayKey
  }

  function openNewPlan(dateKey, overrides = {}, options = {}) {
    returnToTasksAfterEditorRef.current = Boolean(options?.returnToTasks)
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
      has_recurrence_hint: false,
      ...(overrides ?? {})
    })
    setPlanEditorVisible(true)
  }

  function openNewTask(dateKey, options = {}) {
    openNewPlan(dateKey, {
      entryType: "task",
      taskCompleted: false
    }, options)
  }

  function openEditPlan(item, options = {}) {
    if (!item) return
    returnToTasksAfterEditorRef.current = Boolean(options?.returnToTasks)
    const baseDate = String(item.date ?? "")
    const repeatMeta = normalizeRepeatMeta(item ?? {})
    const seriesKey = String(repeatMeta.seriesId ?? "").trim()
    const sameSeriesCount = seriesKey
      ? (plans ?? []).filter((row) => !row?.deleted_at && String(row?.series_id ?? row?.seriesId ?? "").trim() === seriesKey).length
      : 0
    const isSingleOccurrenceRepeat =
      repeatMeta.repeatType !== "none" &&
      Boolean(repeatMeta.repeatUntil) &&
      keyToTime(repeatMeta.repeatUntil) <= keyToTime(baseDate) &&
      (!seriesKey || sameSeriesCount <= 1)
    const explicitRepeatMeta = isSingleOccurrenceRepeat
      ? { repeatType: "none", repeatInterval: 1, repeatDays: null, repeatUntil: null, seriesId: null }
      : repeatMeta
    const shouldInferLegacyRepeat = explicitRepeatMeta.repeatType === "none" && Boolean(item?.has_recurrence_hint)
    const inferredRepeatMeta = shouldInferLegacyRepeat ? inferLegacyRepeatMetaForItem(plans, item) : null
    const effectiveRepeatType =
      explicitRepeatMeta.repeatType !== "none" ? explicitRepeatMeta.repeatType : inferredRepeatMeta?.repeatType ?? "none"
    const effectiveRepeatInterval =
      explicitRepeatMeta.repeatType !== "none" ? explicitRepeatMeta.repeatInterval : inferredRepeatMeta?.repeatInterval ?? 1
    const effectiveRepeatDays =
      explicitRepeatMeta.repeatType !== "none" ? explicitRepeatMeta.repeatDays : inferredRepeatMeta?.repeatDays ?? null
    const effectiveRepeatUntil =
      explicitRepeatMeta.repeatType !== "none" ? explicitRepeatMeta.repeatUntil : inferredRepeatMeta?.repeatUntil ?? null
    const baseCategory = String(item.category_id ?? "__general__").trim() || "__general__"
    const baseContent = String(item.content ?? "").trim()
    const baseTimeRange = normalizePlanTimeRange(item)
    const baseTime = baseTimeRange.time
    const baseEndTime = baseTimeRange.endTime
    const itemId = String(item?.id ?? "").trim()
    const alarmDisabled = itemId ? Boolean(alarmDisabledByPlanId?.[itemId]) : false
    const alarmEnabledByRow = item?.alarm_enabled == null ? true : Boolean(item?.alarm_enabled)
    const effectiveAlarmEnabled = Boolean(baseTime) ? alarmEnabledByRow && !alarmDisabled : false
    const effectiveAlarmLeadMinutes = itemId
      ? normalizeAlarmLeadMinutes(alarmLeadByPlanId?.[itemId] ?? item?.alarm_lead_minutes ?? 0)
      : normalizeAlarmLeadMinutes(item?.alarm_lead_minutes ?? 0)
    const legacyMatches = inferredRepeatMeta?.hasHint
      ? (plans ?? [])
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
      : []
    const legacySeriesIds = [...new Set(legacyMatches.map((row) => row?.id).filter(Boolean).map((id) => String(id)))]
    const legacyFutureIds = legacyMatches
      .filter((row) => String(row?.date ?? "") >= baseDate)
      .map((row) => row?.id)
      .filter(Boolean)
      .map((id) => String(id))
    const hasSeries = Boolean(String(explicitRepeatMeta.seriesId ?? "").trim()) || explicitRepeatMeta.repeatType !== "none"
    const hasRecurrenceHint = hasSeries || Boolean(inferredRepeatMeta?.hasHint)
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
      series_id: explicitRepeatMeta.seriesId,
      original_repeat_type: effectiveRepeatType,
      original_repeat_interval: effectiveRepeatInterval,
      original_repeat_days: effectiveRepeatDays,
      original_repeat_until: effectiveRepeatUntil,
      original_series_id: explicitRepeatMeta.seriesId,
      has_recurrence_hint: hasRecurrenceHint,
      legacy_series_ids: legacySeriesIds,
      legacy_future_ids: legacyFutureIds
    })
    setPlanEditorVisible(true)
  }

  function openTaskItem(item) {
    const row = item?.row ?? item
    if (!row) return
    setTasksVisible(false)
    setTimeout(() => {
      openEditPlan(row, { returnToTasks: true })
    }, 80)
  }

  async function toggleTaskCompletion(item) {
    const row = item?.row ?? item
    const userId = session?.user?.id
    const rowId = String(row?.id ?? "").trim()
    if (!userId || !rowId) return

    const parsed = parsePlanMetaSuffixes(row?.content)
    if (!parsed.baseRaw) return

    const nextCompleted = parsed.completed == null ? true : !Boolean(parsed.completed)
    const nextContent = buildPlanContentWithMeta(parsed.baseRaw, "task", nextCompleted)
    const updatedAt = new Date().toISOString()

    setPlans((prev) =>
      (prev ?? []).map((current) =>
        String(current?.id ?? "").trim() === rowId
          ? { ...current, content: nextContent, updated_at: updatedAt, client_id: clientId || current?.client_id || null }
          : current
      )
    )

    try {
      await updatePlanRow(userId, rowId, {
        content: nextContent,
        updated_at: updatedAt,
        client_id: clientId || null
      })
    } catch (error) {
      Alert.alert("Task 저장 실패", error?.message || "상태 변경에 실패했습니다.")
      await loadPlans(userId)
    }
  }

  function deleteCompletedTaskItem(item) {
    const row = item?.row ?? item
    const rowId = String(row?.id ?? "").trim()
    if (!rowId) return
    Alert.alert("Task 삭제", "이 Task를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "x",
        style: "destructive",
        onPress: async () => {
          await softDeletePlan(session?.user?.id, { ...row, delete_scope: "single" })
        }
      }
    ])
  }

  function restoreTasksSheetIfNeeded() {
    if (!returnToTasksAfterEditorRef.current) return
    setTasksVisible(true)
  }

  function closeTasksSheet() {
    returnToTasksAfterEditorRef.current = false
    setTasksVisible(false)
  }

  const filteredPlans = useMemo(() => {
    if (!activeTitle) return plans
    return (plans ?? []).filter((row) => String(row?.category_id ?? "").trim() === activeTitle)
  }, [plans, activeTitle])

  const todayForTasks = new Date()
  const taskTodayKey = dateToKey(todayForTasks.getFullYear(), todayForTasks.getMonth() + 1, todayForTasks.getDate())

  const taskItems = useMemo(() => extractTaskItemsFromPlanRows(filteredPlans), [filteredPlans])

  const taskCount = useMemo(() => {
    const ids = new Set()
    for (const item of taskItems ?? []) {
      if (item?.completed) continue
      const key = String(item?.planId ?? item?.id ?? "").trim()
      if (key) ids.add(key)
    }
    return ids.size
  }, [taskItems])

  const sections = useMemo(() => {
    const map = new Map()
    for (const row of filteredPlans ?? []) {
      if (!isVisibleSchedulePlanRow(row)) continue
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
      if (!isVisibleSchedulePlanRow(row)) continue
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
      if (!isVisibleSchedulePlanRow(row)) continue
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
      <SafeAreaView edges={["top", "bottom", "left", "right"]} style={styles.container}>
        <Text style={styles.title}>Planner Mobile</Text>
        <Text style={styles.errorText}>Supabase config missing.</Text>
        <Text style={styles.helpText}>Set supabaseUrl and supabaseAnonKey in app.json.</Text>
      </SafeAreaView>
    )
  }

  if (!session) {
    return (
      <SafeAreaView edges={["top", "bottom", "left", "right"]} style={[styles.container, styles.authScreen]}>
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
                  onPress={() => {
                    setAuthMode("signin")
                    setSignupDetailsOpen(false)
                  }}
                  style={[styles.authModePill, authMode === "signin" ? styles.authModePillActive : null]}
                >
                  <Text style={[styles.authModeText, authMode === "signin" ? styles.authModeTextActive : null]}>
                    로그인
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setAuthMode("signup")
                    setSignupDetailsOpen(true)
                  }}
                  style={[styles.authModePill, authMode === "signup" ? styles.authModePillActive : null]}
                >
                  <Text style={[styles.authModeText, authMode === "signup" ? styles.authModeTextActive : null]}>
                    가입
                  </Text>
                </Pressable>
              </View>

              <View style={styles.authField}>
                <Text style={styles.authLabel}>아이디 / 이메일</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="default"
                  placeholder="아이디 또는 이메일"
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
                  placeholder={authMode === "signup" ? `비밀번호 (${AUTH_MIN_PASSWORD_LENGTH}자 이상)` : "비밀번호"}
                  placeholderTextColor="#9aa3b2"
                  style={[styles.input, styles.authInput]}
                />
              </View>

              {authMode === "signup" ? (
                <View style={styles.authConsentCard}>
                  <View style={styles.authConsentHeader}>
                    <View style={styles.authConsentHeaderMain}>
                      <Text style={styles.authConsentTitle}>가입 안내 및 동의</Text>
                      <Text style={styles.authConsentHint}>일정 동기화용 계정을 만들기 전에 필수 안내를 확인해 주세요.</Text>
                    </View>
                    <Pressable
                      onPress={() => setSignupDetailsOpen((prev) => !prev)}
                      style={styles.authConsentToggle}
                    >
                      <Text style={styles.authConsentToggleText}>{signupDetailsOpen ? "닫기" : "자세히"}</Text>
                    </Pressable>
                  </View>

                  {signupDetailsOpen ? (
                    <View style={styles.authConsentBody}>
                      <Text style={styles.authConsentBodyText}>수집 항목: 아이디 또는 이메일, 비밀번호</Text>
                      <Text style={styles.authConsentBodyText}>이용 목적: 로그인, 일정 동기화, 계정 식별</Text>
                      <Text style={styles.authConsentBodyText}>보관 기간: 회원 탈퇴 시까지</Text>
                      <Text style={styles.authConsentBodyText}>거부 시: 회원가입과 동기화 기능을 사용할 수 없습니다.</Text>
                    </View>
                  ) : null}

                  <Pressable style={styles.rememberRow} onPress={() => setSignupTermsAgreed((prev) => !prev)}>
                    <View style={[styles.checkbox, signupTermsAgreed ? styles.checkboxChecked : null]}>
                      {signupTermsAgreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <Text style={styles.rememberText}>[필수] 이용약관 동의</Text>
                  </Pressable>
                  <Pressable style={styles.rememberRow} onPress={() => setSignupPrivacyAgreed((prev) => !prev)}>
                    <View style={[styles.checkbox, signupPrivacyAgreed ? styles.checkboxChecked : null]}>
                      {signupPrivacyAgreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <Text style={styles.rememberText}>[필수] 개인정보 수집·이용 동의</Text>
                  </Pressable>
                  <Pressable style={styles.rememberRow} onPress={() => setSignupUpdatesAgreed((prev) => !prev)}>
                    <View style={[styles.checkbox, signupUpdatesAgreed ? styles.checkboxChecked : null]}>
                      {signupUpdatesAgreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <Text style={styles.rememberText}>[선택] 업데이트 안내 수신</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                style={styles.rememberRow}
                onPress={() => {
                  const next = !rememberCreds
                  setRememberCreds(next)
                  if (next) persistAuthDraft({ remember: true, email })
                  else persistAuthDraft({ remember: false })
                }}
                disabled={!authReady}
              >
                <View style={[styles.checkbox, rememberCreds ? styles.checkboxChecked : null]}>
                  {rememberCreds ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.rememberText}>아이디 기억</Text>
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
                  onPress={() => {
                    const nextMode = authMode === "signup" ? "signin" : "signup"
                    setAuthMode(nextMode)
                    setSignupDetailsOpen(nextMode === "signup")
                  }}
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

            <Text style={styles.authFooterNote}>로그인 상태는 앱 세션으로 유지되고, 기억한 정보는 아이디만 보관됩니다.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <>
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} translucent backgroundColor="transparent" />
      <NavigationContainer>
      <SettingsSheet
        visible={settingsVisible}
        themeMode={themeMode}
        listFontScale={listFontScale}
        memoFontScale={memoFontScale}
        calendarFontScale={calendarFontScale}
        tabFontScale={tabFontScale}
        onChangeTheme={(next) => {
          const mode = next === "dark" ? "dark" : "light"
          setThemeMode(mode)
          persistTheme(mode)
        }}
        onChangeListFontScale={(next) => {
          const normalized = normalizeUiFontPresetScale(next)
          setListFontScale(normalized)
          persistUiFontScale(UI_LIST_FONT_SCALE_KEY, normalized)
        }}
        onChangeMemoFontScale={(next) => {
          const normalized = normalizeUiFontPresetScale(next)
          setMemoFontScale(normalized)
          persistUiFontScale(UI_MEMO_FONT_SCALE_KEY, normalized)
        }}
        onChangeCalendarFontScale={(next) => {
          const normalized = normalizeUiFontPresetScale(next)
          setCalendarFontScale(normalized)
          persistUiFontScale(UI_CALENDAR_FONT_SCALE_KEY, normalized)
        }}
        onChangeTabFontScale={(next) => {
          const normalized = normalizeUiFontPresetScale(next)
          setTabFontScale(normalized)
          persistUiFontScale(UI_TAB_FONT_SCALE_KEY, normalized)
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
        onDeleteAccount={session ? handleDeleteAccount : null}
        deleteAccountLoading={deleteAccountLoading}
        onClose={() => setSettingsVisible(false)}
      />
      <TasksSheet
        visible={tasksVisible}
        tone={tone}
        tasks={taskItems}
        onToggleTask={toggleTaskCompletion}
        onOpenTask={openTaskItem}
        onDeleteTask={deleteCompletedTaskItem}
        onAddTask={() => {
          setTasksVisible(false)
          openNewTask(taskTodayKey, { returnToTasks: true })
        }}
        onClose={closeTasksSheet}
      />
      <PlanEditorModal
        visible={planEditorVisible}
        draft={planDraft}
        windows={windows}
        tone={tone}
        onClose={() => {
          setPlanEditorVisible(false)
          restoreTasksSheetIfNeeded()
        }}
        onSave={(next) => {
          const nextDraft = { ...(next ?? {}) }
          setPlanDraft(nextDraft)
          setPlanEditorVisible(false)
          ;(async () => {
            const ok = await upsertPlan(session?.user?.id, nextDraft)
            if (!ok) {
              setPlanDraft(nextDraft)
              setPlanEditorVisible(true)
              return
            }
            restoreTasksSheetIfNeeded()
          })()
        }}
        onDelete={async (target) => {
          const ok = await softDeletePlan(session?.user?.id, target)
          if (ok) {
            setPlanEditorVisible(false)
            restoreTasksSheetIfNeeded()
          }
        }}
      />
      {activeScreen === "Calendar" ? (
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
          tabBarLabelStyle: bottomTabLabelStyle,
          tabBarItemStyle,
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
              onMovePlan={movePlanByDrag}
              onQuickDeletePlan={async (item) => {
                await softDeletePlan(session?.user?.id, { ...(item ?? {}), delete_scope: "single" })
              }}
              onTasks={() => setTasksVisible(true)}
              tasksCount={taskCount}
              onToggleTask={toggleTaskCompletion}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
              listFontScale={listFontScale}
              tabFontScale={tabFontScale}
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
              onStageMemo={stageRightMemoWrite}
              onTasks={() => setTasksVisible(true)}
              tasksCount={taskCount}
              onToggleTask={toggleTaskCompletion}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
              memoFontScale={memoFontScale}
              tabFontScale={tabFontScale}
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
              onMovePlan={movePlanByDrag}
              onQuickDeletePlan={async (item) => {
                await softDeletePlan(session?.user?.id, { ...(item ?? {}), delete_scope: "single" })
              }}
              onSelectDateKey={(key) => {
                lastCalendarDateKeyRef.current = key
              }}
              onTasks={() => setTasksVisible(true)}
              tasksCount={taskCount}
              onToggleTask={toggleTaskCompletion}
              onRefresh={() => {
                loadPlans(session?.user?.id)
                loadWindows(session?.user?.id)
                loadRightMemos(session?.user?.id, memoYear)
              }}
              onSignOut={() => setSettingsVisible(true)}
              tone={tone}
              calendarFontScale={calendarFontScale}
              tabFontScale={tabFontScale}
            />
          )}
        </Tab.Screen>
      </Tab.Navigator>
      </NavigationContainer>
    </>
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppInner />
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
    backgroundColor: "#f5f7fb",
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
    backgroundColor: "#f5f7fb"
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
    paddingTop: 0,
    paddingBottom: 8,
    justifyContent: "center",
    alignItems: "center"
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: -3
  },
  tabIcon: {
    fontSize: 18,
    fontWeight: "800",
    color: "#94a3b8",
    transform: [{ translateY: -2 }]
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
  authConsentCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbe3f0",
    backgroundColor: "#f8fbff",
    padding: 12,
    marginTop: 2,
    marginBottom: 10
  },
  authConsentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  authConsentHeaderMain: {
    flex: 1
  },
  authConsentTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a"
  },
  authConsentHint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: "#64748b"
  },
  authConsentToggle: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6dbe6",
    alignItems: "center",
    justifyContent: "center"
  },
  authConsentToggleText: {
    fontSize: 11,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  authConsentBody: {
    marginTop: 10,
    marginBottom: 2,
    gap: 3
  },
  authConsentBodyText: {
    fontSize: 11,
    lineHeight: 16,
    color: "#475569"
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
  headerLeftPressable: {
    borderRadius: 14
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
    width: "100%",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 12,
    letterSpacing: -0.2,
    textAlign: "center",
    includeFontPadding: false,
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
  headerMoreButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(43, 103, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  headerMoreText: {
    fontSize: 22,
    lineHeight: 22,
    marginTop: -6,
    fontWeight: "900",
    color: ACCENT_BLUE
  },
  headerTasksButton: {
    width: 38,
    height: 38,
    paddingHorizontal: 0,
    borderRadius: 14,
    backgroundColor: "rgba(43, 103, 199, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  headerTasksButtonActive: {
    backgroundColor: "#eef4ff",
    borderColor: "#bfd5fb"
  },
  headerTasksButtonActiveDark: {
    backgroundColor: "rgba(59, 130, 246, 0.18)",
    borderColor: "rgba(125, 211, 252, 0.28)"
  },
  headerTasksText: {
    fontSize: 11,
    fontWeight: "900",
    color: ACCENT_BLUE
  },
  headerTasksIconText: {
    fontSize: 18,
    lineHeight: 18,
    marginTop: -1
  },
  headerTasksBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  headerTasksBadgeDark: {
    backgroundColor: "#60a5fa"
  },
  headerTasksBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#ffffff"
  },
  headerQuickSheetCard: {
    maxHeight: "56%"
  },
  headerQuickActions: {
    gap: 10,
    paddingTop: 6,
    paddingBottom: 4
  },
  headerQuickAction: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: "#f8fbff",
    borderWidth: 1,
    borderColor: "#d8e5f6",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  headerQuickActionDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  headerQuickActionDanger: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3"
  },
  headerQuickActionCopy: {
    flex: 1,
    gap: 4
  },
  headerQuickActionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  headerQuickActionTitleDanger: {
    color: "#e11d48"
  },
  headerQuickActionHint: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    lineHeight: 17
  },
  headerQuickActionBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "#e7efff",
    alignItems: "center",
    justifyContent: "center"
  },
  headerQuickActionBadgeDark: {
    backgroundColor: "rgba(96, 165, 250, 0.18)"
  },
  headerQuickActionBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: ACCENT_BLUE
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
    gap: 5,
    paddingVertical: 0,
    paddingHorizontal: 1,
    paddingLeft: 6,
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
    backgroundColor: "#f7faff",
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
    gap: 9,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 12,
    padding: 0
  },
  listMonthMiniNavButton: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  listMonthMiniNavButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  listMonthMiniNavText: {
    fontSize: 13,
    lineHeight: 13,
    fontWeight: "800",
    color: ACCENT_BLUE,
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  listMonthMiniNavTextDark: {
    color: DARK_TEXT
  },
  listMonthNavButton: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9e4f2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  listMonthNavButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    shadowOpacity: 0
  },
  listMonthNavText: {
    fontSize: 20,
    fontWeight: "900",
    color: "#5f77a8",
    includeFontPadding: false,
    textAlign: "center",
    lineHeight: 20,
    transform: [{ translateY: -0.5 }]
  },
  listMonthNavTextDark: {
    color: DARK_TEXT
  },
  listMonthRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  listAddSpacer: {
    width: 32,
    height: 32
  },
  listMonthText: {
    marginHorizontal: 3,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 19,
    color: "#0f172a"
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
    width: 32,
    borderRadius: 9,
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateX: -2 }]
  },
  listAddButtonDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  listPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  listAddText: {
    fontSize: 18,
    fontWeight: "900",
    color: ACCENT_BLUE,
    marginTop: -1
  },
  listAddTextDark: {
    color: "#8fb4ff"
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
    backgroundColor: "#f8fbff",
    borderWidth: 1,
    borderColor: "#d7e3f4"
  },
  tabPillAll: {
    minWidth: 72,
    justifyContent: "center",
    paddingHorizontal: 6
  },
  tabPillActive: {
    backgroundColor: "#eef4ff",
    borderColor: "#bfd4fb",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  tabPillDark: {
    backgroundColor: "rgba(148, 163, 184, 0.10)",
    borderColor: "rgba(148, 163, 184, 0.24)"
  },
  tabPillActiveDark: {
    backgroundColor: "rgba(59, 130, 246, 0.18)",
    borderColor: "rgba(125, 211, 252, 0.28)"
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
    color: "#475569"
  },
  tabTextAll: {
    textAlign: "center"
  },
  tabTextActive: {
    color: "#1d4ed8"
  },
  tabTextDark: {
    color: "rgba(226, 232, 240, 0.82)"
  },
  tabTextActiveDark: {
    color: "#e0f2fe"
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
  sectionHeaderWrap: {
    marginHorizontal: 10
  },
  sectionHeaderWrapSpaced: {
    marginTop: 12
  },
  sectionHeader: {
    minHeight: 34,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 12,
    backgroundColor: "#f4f8ff",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#c6d4e5",
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    justifyContent: "center"
  },
  sectionHeaderDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: "rgba(255, 255, 255, 0.12)"
  },
  sectionHeaderToday: {
    backgroundColor: "#eaf3ff",
    borderColor: "#c6d4e5"
  },
  sectionHeaderTodayDark: {
    backgroundColor: "rgba(59, 130, 246, 0.14)",
    borderColor: "rgba(255, 255, 255, 0.12)"
  },
  sectionHeaderDateText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a",
    marginLeft: 4,
    lineHeight: 17,
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  sectionHeaderDateDowInline: {
    fontWeight: "400",
    opacity: 0.9
  },
  sectionHeaderTodayPill: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 7,
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
    gap: 10,
    minHeight: 0
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
    paddingBottom: 14,
    paddingHorizontal: 0,
    paddingTop: 10
  },
  listSectionSpacer: {
    height: 14
  },
  listSectionBodyFrame: {
    marginHorizontal: 10,
    backgroundColor: "#ffffff",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: "#c6d4e5",
    borderRightColor: "#c6d4e5"
  },
  listSectionBodyFrameFirst: {
    marginTop: -1
  },
  listSectionBodyFrameDark: {
    backgroundColor: DARK_SURFACE,
    borderLeftColor: "rgba(255, 255, 255, 0.12)",
    borderRightColor: "rgba(255, 255, 255, 0.12)"
  },
  listSectionBodyFrameLast: {
    borderBottomWidth: 1,
    borderBottomColor: "#c6d4e5",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12
  },
  listSectionBodyFrameLastDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.12)"
  },
  listEmptyWrap: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
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
    borderBottomWidth: 1,
    borderBottomColor: "#edf3f8"
  },
  itemRowDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.05)"
  },
  itemRowFirst: {
    paddingTop: 9,
    paddingBottom: 9,
    borderTopWidth: 1,
    borderTopColor: "#edf3f8"
  },
  itemRowFirstDark: {
    borderTopColor: "rgba(255, 255, 255, 0.05)"
  },
  itemRowBeforeGroupDivider: {
    borderBottomWidth: 0
  },
  itemRowStrongSeparator: {
    borderBottomColor: "#d4dfec"
  },
  itemRowStrongSeparatorDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.16)"
  },
  itemRowNoSeparator: {
    borderBottomWidth: 0
  },
  itemLeftCol: {
    width: 47,
    alignSelf: "stretch",
    marginVertical: -1.5,
    paddingTop: 0,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 7.5,
    marginRight: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#edf3f8"
  },
  itemLeftColDark: {
    borderRightColor: "rgba(255, 255, 255, 0.05)"
  },
  itemLeftColFirst: {
    justifyContent: "center",
    paddingTop: 0
  },
  itemTimeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155",
    textAlign: "right",
    includeFontPadding: false,
    textAlignVertical: "center",
    transform: [{ translateX: 1.5 }, { translateY: 0.5 }]
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
  itemMainColFirst: {
    justifyContent: "center"
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  itemTaskDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 0,
    paddingHorizontal: 0
  },
  itemTaskDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#d4dfec"
  },
  itemTaskDividerLineDark: {
    backgroundColor: "rgba(255, 255, 255, 0.16)"
  },
  itemBucketDividerRow: {
    height: 0,
    paddingHorizontal: 0
  },
  itemBucketDividerLine: {
    height: 1,
    backgroundColor: "#d4dfec"
  },
  itemBucketDividerLineDark: {
    backgroundColor: "rgba(255, 255, 255, 0.16)"
  },
  itemPrimaryRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  itemTaskToggle: {
    width: 19,
    height: 19,
    borderRadius: 4,
    borderWidth: 1.7,
    borderColor: "#9fb2ca",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    position: "relative"
  },
  itemTaskToggleDark: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(191, 219, 254, 0.42)"
  },
  itemTaskToggleChecked: {
    backgroundColor: "rgba(59, 130, 246, 0.14)",
    borderColor: "rgba(59, 130, 246, 0.72)"
  },
  itemTaskToggleCheckedDark: {
    backgroundColor: "rgba(125, 211, 252, 0.12)",
    borderColor: "rgba(125, 211, 252, 0.56)"
  },
  itemTaskToggleTick: {
    color: "#5375b6",
    fontSize: 11,
    fontWeight: "900",
    marginTop: -1
  },
  itemTaskRepeatIcon: {
    fontSize: 10,
    lineHeight: 11,
    fontWeight: "900",
    color: "#64748b",
    includeFontPadding: false,
    transform: [{ translateY: -0.3 }]
  },
  itemTaskRepeatIconDark: {
    color: "#cbd5e1"
  },
  itemTaskTimeClock: {
    width: 9.4,
    height: 9.4,
    borderRadius: 999,
    borderWidth: 1.15,
    borderColor: "#64748b",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  itemTaskTimeClockDark: {
    borderColor: "#cbd5e1"
  },
  itemTaskTimeClockHour: {
    position: "absolute",
    width: 1,
    height: 3.4,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 1.85,
    left: 3.55
  },
  itemTaskTimeClockMinute: {
    position: "absolute",
    width: 3.1,
    height: 1,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 4.45,
    left: 3.55
  },
  itemTaskTimeCorner: {
    position: "absolute",
    right: 2.2,
    bottom: 2.2,
    width: 4.2,
    height: 4.2,
    borderRightWidth: 1.35,
    borderBottomWidth: 1.35,
    borderColor: "#64748b",
    borderBottomRightRadius: 1,
    opacity: 0.82
  },
  itemTaskTimeCornerDark: {
    borderColor: "#cbd5e1",
    opacity: 0.9
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    transform: [{ translateY: -1 }]
  },
  itemTitleTaskDone: {
    color: "#94a3b8",
    opacity: 0.78,
    textDecorationLine: "line-through",
    textDecorationColor: "#64748b"
  },
  itemCategoryBadge: {
    flexShrink: 0,
    maxWidth: "100%",
    height: 20,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#f8fbff",
    borderWidth: 1,
    borderColor: "#d7e3f4",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  badgeDark: {
    backgroundColor: "rgba(148, 163, 184, 0.10)",
    borderColor: "rgba(148, 163, 184, 0.24)"
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
    color: "#334155"
  },
  memoContent: {
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 16
  },
  memoAllList: {
    flexGrow: 1,
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 0,
    gap: 10
  },
  memoAllEmptyCard: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  memoAllEmptyCardDark: {
    backgroundColor: DARK_SURFACE,
    borderColor: DARK_BORDER
  },
  memoAllEmptyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoAllEmptyText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    color: "#64748b",
    textAlign: "center"
  },
  memoAllCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14
  },
  memoAllHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  memoAllHeaderLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    flex: 1
  },
  memoAllHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  memoAllDot: {
    width: 12,
    height: 12,
    borderRadius: 999
  },
  memoAllHeaderTextWrap: {
    flex: 1,
    gap: 4
  },
  memoAllTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8
  },
  memoAllTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoAllHeaderDropdownChevron: {
    fontSize: 14,
    fontWeight: "900",
    color: "#64748b"
  },
  memoAllMetaText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b"
  },
  memoAllWindowMenu: {
    marginTop: 10,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#ffffff",
    overflow: "hidden",
    maxHeight: 220
  },
  memoAllWindowMenuDark: {
    backgroundColor: DARK_SURFACE,
    borderColor: DARK_BORDER
  },
  memoAllWindowMenuScroll: {
    maxHeight: 220
  },
  memoAllWindowMenuItem: {
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#eef3f8"
  },
  memoAllWindowMenuItemFirst: {
    borderTopWidth: 0
  },
  memoAllWindowMenuItemDark: {
    borderTopColor: "rgba(255, 255, 255, 0.06)"
  },
  memoAllWindowMenuItemActive: {
    backgroundColor: "#f8fbff"
  },
  memoAllWindowMenuItemActiveDark: {
    backgroundColor: "rgba(59, 130, 246, 0.12)"
  },
  memoAllWindowMenuItemLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  memoAllWindowMenuItemText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: "#334155"
  },
  memoAllWindowMenuItemTextActive: {
    color: "#1d4ed8"
  },
  memoAllWindowMenuCheck: {
    fontSize: 13,
    fontWeight: "900",
    color: "#2563eb"
  },
  memoAllMetaRow: {
    marginTop: 2,
    marginBottom: 7
  },
  memoAllDocTitleInput: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#f8fbff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "800",
    color: "#334155"
  },
  memoAllDocTitleInputDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER,
    color: DARK_TEXT
  },
  memoAllDocBadge: {
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#f8fbff",
    paddingHorizontal: 12,
    alignItems: "flex-start",
    justifyContent: "center"
  },
  memoAllDocBadgeDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoAllDocBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#334155"
  },
  memoAllBody: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoAllInput: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 156,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoAllInputPreview: {
    borderRadius: 8,
    backgroundColor: "#fbfdff"
  },
  memoAllInputPreviewDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoAllEditBtn: {
    height: 30,
    minWidth: 52,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#eef4ff",
    alignItems: "center",
    justifyContent: "center"
  },
  memoAllEditBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1d4ed8"
  },
  memoDocTabsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
    marginBottom: 7
  },
  memoDocTabsScroll: {
    flex: 1
  },
  memoDocTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 4
  },
  memoDocTab: {
    minHeight: 28,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#f8fafc",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  memoDocTabCentered: {
    justifyContent: "center",
    paddingRight: 12
  },
  memoDocTabWithDelete: {
    justifyContent: "flex-start",
    paddingRight: 4
  },
  memoDocTabDark: {
    borderColor: DARK_BORDER,
    backgroundColor: DARK_SURFACE
  },
  memoDocTabActive: {
    backgroundColor: "#eef4ff",
    borderColor: "#bfd7ff"
  },
  memoDocTabActiveDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: "rgba(96, 165, 250, 0.45)"
  },
  memoDocTabText: {
    fontSize: 12,
    lineHeight: 12,
    fontWeight: "800",
    color: "#475569",
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  memoDocTabTextDark: {
    color: DARK_MUTED
  },
  memoDocTabTextActive: {
    color: "#1d4ed8"
  },
  memoDocTabTextActiveDark: {
    color: DARK_TEXT
  },
  memoDocTabPressable: {
    minWidth: 0,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  memoDocTabDeleteBtn: {
    width: 16,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent"
  },
  memoDocTabDeleteBtnActive: {
    backgroundColor: "transparent"
  },
  memoDocTabDeleteText: {
    fontSize: 13,
    lineHeight: 13,
    fontWeight: "700",
    color: "#e11d48",
    includeFontPadding: false,
    textAlignVertical: "center",
    transform: [{ translateY: 0.75 }]
  },
  memoDocTabDeleteTextActive: {
    color: "#e11d48"
  },
  memoDocTabDeleteTextDark: {
    color: "#f43f5e"
  },
  memoDocActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7e3f4",
    backgroundColor: "#eef4ff",
    alignItems: "center",
    justifyContent: "center"
  },
  memoDocActionBtnDark: {
    borderColor: DARK_BORDER,
    backgroundColor: DARK_SURFACE
  },
  memoDocActionText: {
    fontSize: 16,
    lineHeight: 16,
    fontWeight: "800",
    color: "#1d4ed8"
  },
  memoDocActionTextDark: {
    color: DARK_TEXT
  },
  memoAllChevronBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  memoAllChevronBtnDark: {
    backgroundColor: DARK_SURFACE_2
  },
  memoAllChevron: {
    fontSize: 16,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoAllPreviewCard: {
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fbfdff",
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  memoAllPreviewCardDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoAllEmpty: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoSinglePane: {
    paddingTop: 10,
    paddingBottom: 14,
    minHeight: 520
  },
  memoSingleHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    gap: 12,
    marginBottom: 14
  },
  memoSingleHeaderDark: {
    borderColor: DARK_BORDER
  },
  memoSingleHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1
  },
  memoSingleHeaderTextWrap: {
    flex: 1,
    gap: 2
  },
  memoSingleTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoSingleSubtitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoSingleActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  memoSingleActionBtn: {
    height: 36,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  memoSingleActionBtnCompact: {
    height: 32,
    borderRadius: 12
  },
  memoSingleActionBtnTextual: {
    minWidth: 58,
    paddingHorizontal: 10
  },
  memoSingleActionBtnDark: {
    borderColor: DARK_BORDER
  },
  memoSingleActionBtnNeutral: {
    minWidth: 68,
    paddingHorizontal: 10,
    borderColor: "#d7e3f4",
    backgroundColor: "#ffffff"
  },
  memoSingleActionBtnNeutralDark: {
    borderColor: DARK_BORDER,
    backgroundColor: DARK_SURFACE
  },
  memoSingleActionBtnNeutralText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#475569"
  },
  memoSingleActionBtnDanger: {
    width: 36,
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2"
  },
  memoSingleActionBtnDangerDark: {
    borderColor: "rgba(248, 113, 113, 0.35)",
    backgroundColor: "rgba(225, 29, 72, 0.14)"
  },
  memoSingleActionBtnDangerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#e11d48"
  },
  memoSingleActionBtnDangerWide: {
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2"
  },
  memoSingleActionBtnPrimary: {
    minWidth: 52,
    paddingHorizontal: 10,
    borderColor: "#bfd7ff",
    backgroundColor: "#eef4ff"
  },
  memoSingleActionBtnPrimaryDark: {
    borderColor: "rgba(96, 165, 250, 0.45)",
    backgroundColor: "rgba(59, 130, 246, 0.16)"
  },
  memoSingleActionBtnPrimaryText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1d4ed8"
  },
  memoSingleActionBtnDisabled: {
    borderColor: "#e5e7eb",
    backgroundColor: "#f8fafc"
  },
  memoSingleActionBtnDisabledText: {
    color: "#cbd5e1"
  },
  memoSingleSearchRow: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingLeft: 14,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12
  },
  memoSingleSearchRowDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoSingleSearchInput: {
    flex: 1,
    padding: 0,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a"
  },
  memoSingleSearchIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoSingleList: {
    gap: 8,
    paddingBottom: 90
  },
  memoSingleItem: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  memoSingleItemDark: {
    backgroundColor: DARK_SURFACE,
    borderColor: DARK_BORDER
  },
  memoSingleItemSelected: {
    borderColor: "#bfd7ff",
    backgroundColor: "#f8fbff"
  },
  memoSingleItemSelectedDark: {
    borderColor: "rgba(96, 165, 250, 0.45)",
    backgroundColor: "rgba(59, 130, 246, 0.12)"
  },
  memoSingleItemPressable: {
    flex: 1
  },
  memoSingleSelectDot: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center"
  },
  memoSingleSelectDotActive: {
    borderColor: "#3b82f6",
    backgroundColor: "#3b82f6"
  },
  memoSingleSelectDotActiveText: {
    fontSize: 13,
    lineHeight: 13,
    fontWeight: "900",
    color: "#ffffff"
  },
  memoSingleItemMain: {
    gap: 6
  },
  memoSingleItemTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoSingleItemPreview: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#64748b"
  },
  memoSingleItemDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
    alignItems: "center",
    justifyContent: "center"
  },
  memoSingleItemDeleteBtnDark: {
    backgroundColor: "rgba(220, 38, 38, 0.14)",
    borderColor: "rgba(248, 113, 113, 0.28)"
  },
  memoSingleItemDeleteText: {
    fontSize: 15,
    lineHeight: 15,
    fontWeight: "900",
    color: "#e11d48"
  },
  memoSingleEmpty: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  memoSingleEmptyDark: {
    backgroundColor: DARK_SURFACE,
    borderColor: DARK_BORDER
  },
  memoSingleEmptyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoSingleEmptyText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textAlign: "center"
  },
  memoSingleFab: {
    position: "absolute",
    right: 12,
    bottom: 16,
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#4b5f78",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10
  },
  memoSingleFabText: {
    fontSize: 32,
    lineHeight: 32,
    fontWeight: "700",
    color: "#ffffff",
    marginTop: -2
  },
  memoSingleEditorCard: {
    paddingTop: 2,
    paddingBottom: 4,
    paddingHorizontal: 0,
    gap: 14,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  memoSingleEditorCardDark: {
    backgroundColor: "transparent",
    borderColor: "transparent"
  },
  memoSingleFieldBlock: {
    gap: 8
  },
  memoSingleFieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b"
  },
  memoSingleReadTitle: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoSingleReadDivider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 14
  },
  memoSingleReadDividerDark: {
    backgroundColor: DARK_BORDER
  },
  memoSingleReadBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoSingleTitleInput: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbe5f1",
    backgroundColor: "#f8fbff",
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoSingleFieldDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  memoSingleContentField: {
    minHeight: 300,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#dbe5f1",
    backgroundColor: "#fbfdff",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  memoSingleBodyInput: {
    padding: 0,
    minHeight: 274,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    borderRadius: 0,
    fontWeight: "600",
    color: "#0f172a"
  },
  memoEditorWrap: {
    position: "relative",
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
    height: 42,
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
    left: 8,
    top: 0,
    bottom: 0,
    width: 40,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingLeft: 0,
    zIndex: 2
  },
  calendarTitleCentered: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
    color: "#0f172a",
    includeFontPadding: false,
    textAlignVertical: "center"
  },
  calendarHeaderRight: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    width: 40,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 0
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
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    backgroundColor: "#f5f7fb"
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
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  calendarNavButtonRight: {
  },
  calendarNavButtonDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  calendarNavText: {
    fontSize: 13,
    lineHeight: 13,
    fontWeight: "800",
    color: ACCENT_BLUE,
    includeFontPadding: false,
    textAlign: "center",
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
  calendarGridScroll: {
    flex: 1
  },
  calendarGrid: {
    flexGrow: 1,
    borderWidth: 0.8,
    borderColor: "#dfe7f3",
    borderTopWidth: 0,
    overflow: "visible"
  },
  calendarGridDark: {
    borderColor: DARK_BORDER
  },
  calendarWeekRow: {
    width: "100%",
    flexDirection: "row"
  },
  calendarWeekRowLast: {
    borderBottomWidth: 0
  },
  calendarCell: {
    width: "14.285714%",
    borderRightWidth: 0.8,
    borderBottomWidth: 0.8,
    borderColor: "#e1e8f2",
    paddingTop: 4,
    paddingHorizontal: 0,
    paddingBottom: 6,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    overflow: "visible"
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
  calendarCellDropTarget: {
    backgroundColor: "#f3faff"
  },
  calendarCellDropTargetDark: {
    backgroundColor: "rgba(14, 165, 233, 0.16)"
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
    justifyContent: "flex-start",
    paddingRight: 2,
    overflow: "hidden"
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
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
    marginTop: -2,
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
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 2,
    overflow: "hidden",
    position: "relative"
  },
  calendarDropIndicator: {
    position: "absolute",
    left: 1,
    right: 1,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#2563eb",
    zIndex: 30,
    shadowColor: "#2563eb",
    shadowOpacity: 0.24,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 5
  },
  calendarDropIndicatorDark: {
    backgroundColor: "#7dd3fc",
    shadowOpacity: 0
  },
  calendarLine: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    overflow: "hidden"
  },
  calendarDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    flexShrink: 0,
    marginRight: 2
  },
  calendarDotWithTime: {
    alignSelf: "center"
  },
  calendarDotStandalone: {
    alignSelf: "center"
  },
  calendarLabel: {
    width: "100%",
    paddingLeft: 1,
    paddingRight: 2,
    minHeight: 16,
    paddingVertical: 1,
    borderRadius: 3,
    alignItems: "flex-start",
    justifyContent: "center",
    overflow: "hidden"
  },
  calendarLabelRange: {
    minHeight: 20
  },
  calendarLabelTaskPlain: {
    paddingLeft: 0,
    paddingRight: 0,
    borderRadius: 0
  },
  calendarLabelTaskDone: {
    opacity: 0.8
  },
  calendarLabelRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    overflow: "hidden"
  },
  calendarLabelBody: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    overflow: "hidden"
  },
  calendarMetaIndicatorWrap: {
    minWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    flexShrink: 0
  },
  calendarTimedIndicator: {
    width: 4,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#60a5fa"
  },
  calendarTimedIndicatorDark: {
    backgroundColor: "#93c5fd"
  },
  calendarRepeatIndicator: {
    width: 5,
    height: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#7c3aed",
    backgroundColor: "transparent"
  },
  calendarRepeatIndicatorDark: {
    borderColor: "#c4b5fd"
  },
  calendarLabelRowSingle: {
    minHeight: 10.5,
    alignItems: "center"
  },
  calendarLabelTimeCol: {
    minWidth: 17,
    width: 17,
    marginRight: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    alignSelf: "center",
    flexShrink: 0
  },
  calendarLabelTimeColRange: {
    minWidth: 18,
    width: 18,
    justifyContent: "center"
  },
  calendarLabelTimeSingleSlot: {
    minWidth: 17,
    width: 17,
    marginRight: 1,
    alignSelf: "center",
    textAlign: "left"
  },
  calendarLabelDark: {
    borderWidth: 0
  },
  calendarLabelTime: {
    fontSize: 6.1,
    lineHeight: 7.1,
    color: "#475569",
    fontWeight: "800",
    includeFontPadding: false,
    textAlignVertical: "center",
    marginRight: 0
  },
  calendarLabelTimeSingle: {
    lineHeight: 8.2
  },
  calendarLabelTimeSingleAligned: {
    lineHeight: 10,
    textAlignVertical: "center"
  },
  calendarLabelTimeFallback: {
    fontSize: 6,
    opacity: 0.78
  },
  calendarLabelTimeHidden: {
    opacity: 0,
    fontSize: 1,
    lineHeight: 1
  },
  calendarLabelTimeDark: {
    color: "rgba(255, 255, 255, 0.92)"
  },
  calendarLabelTimeTask: {
    color: "#0f172a"
  },
  calendarLabelTimeTaskDark: {
    color: "#f8fafc"
  },
  calendarTaskMarker: {
    width: 13,
    height: 13,
    borderRadius: 3,
    borderWidth: 1.6,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 0,
    flexShrink: 0,
    alignSelf: "center",
    position: "relative"
  },
  calendarTaskMarkerSingle: {
    alignSelf: "center"
  },
  calendarTaskMarkerDark: {
    borderColor: "#cbd5e1"
  },
  calendarTaskMarkerDone: {
    backgroundColor: "#94a3b8"
  },
  calendarTaskMarkerDoneDark: {
    backgroundColor: "#cbd5e1"
  },
  calendarTaskMarkerText: {
    fontSize: 7.4,
    lineHeight: 7.4,
    fontWeight: "900",
    color: "#ffffff",
    includeFontPadding: false,
    transform: [{ translateY: -0.4 }]
  },
  calendarTaskMarkerTextDark: {
    color: "#ffffff"
  },
  calendarTaskRepeatIcon: {
    fontSize: 7.6,
    lineHeight: 8,
    fontWeight: "900",
    color: "#64748b",
    includeFontPadding: false,
    transform: [{ translateY: -0.1 }]
  },
  calendarTaskRepeatIconDark: {
    color: "#cbd5e1"
  },
  calendarTaskTimeClock: {
    width: 7.8,
    height: 7.8,
    borderRadius: 999,
    borderWidth: 1.1,
    borderColor: "#64748b",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  calendarTaskTimeClockDark: {
    borderColor: "#cbd5e1"
  },
  calendarTaskTimeClockCompact: {
    position: "absolute",
    right: 0.6,
    bottom: 0.6,
    width: 5,
    height: 5,
    borderWidth: 0.8,
    backgroundColor: "#ffffff"
  },
  calendarTaskTimeClockCompactDark: {
    backgroundColor: DARK_SURFACE_2
  },
  calendarTaskTimeClockHour: {
    position: "absolute",
    width: 0.9,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 1.6,
    left: 3.15
  },
  calendarTaskTimeClockMinute: {
    position: "absolute",
    width: 2.8,
    height: 0.9,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 3.8,
    left: 3.15
  },
  calendarTaskTimeClockHourCompact: {
    width: 0.7,
    height: 1.8,
    top: 1.05,
    left: 1.92
  },
  calendarTaskTimeClockMinuteCompact: {
    width: 1.65,
    height: 0.7,
    top: 2.55,
    left: 1.92
  },
  calendarTaskTimeClockHandDark: {
    backgroundColor: "#cbd5e1"
  },
  calendarTaskTimeCorner: {
    position: "absolute",
    right: 1.15,
    bottom: 1.15,
    width: 3.2,
    height: 3.2,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#64748b",
    borderBottomRightRadius: 0.8,
    opacity: 0.78
  },
  calendarTaskTimeCornerDark: {
    borderColor: "#cbd5e1",
    opacity: 0.88
  },
  calendarLabelText: {
    fontSize: 9.8,
    lineHeight: 11.8,
    color: "#0f172a",
    fontWeight: "700",
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    textAlign: "left",
    alignSelf: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
    paddingRight: 0,
    marginLeft: 0
  },
  calendarLabelTextSingle: {
    marginTop: 0
  },
  calendarLabelTextSingleAligned: {
    alignSelf: "center"
  },
  calendarLabelTextRange: {
    alignSelf: "center"
  },
  calendarLabelTextDark: {
    color: "#ffffff"
  },
  calendarLabelTextTask: {
    color: "#0f172a",
    alignSelf: "center"
  },
  calendarLabelTextTaskDark: {
    color: "#ffffff",
    alignSelf: "center"
  },
  calendarLabelTextTaskDone: {
    color: "#94a3b8",
    opacity: 0.78,
    textDecorationLine: "line-through",
    textDecorationColor: "#64748b"
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
    width: "94%",
    alignSelf: "center",
    maxWidth: 760,
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
    borderBottomColor: "#edf3f8"
  },
  dayModalItemRowDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.05)"
  },
  dayModalItemRowEditing: {
    borderBottomColor: "#e0e8f2"
  },
  dayModalItemRowEditingDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.09)"
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
  dayModalItemMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  dayModalItemPrimary: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  dayModalItemText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "#0f172a"
  },
  dayModalDividerRow: {
    paddingHorizontal: 0
  },
  dayModalDividerLine: {
    height: 1,
    backgroundColor: "#d4dfec"
  },
  dayModalDividerLineDark: {
    backgroundColor: "rgba(255, 255, 255, 0.16)"
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
  reorderBucketWrap: {
    gap: 0
  },
  reorderSection: {
    marginTop: 0
  },
  reorderSectionFirst: {
    marginTop: 0
  },
  reorderSectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#334155",
    marginBottom: 8,
    paddingLeft: 8
  },
  reorderNoTimeList: {
    position: "relative"
  },
  reorderItemRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 42,
    paddingVertical: 7,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e8f2"
  },
  reorderItemRowDark: {
    borderBottomColor: "rgba(255, 255, 255, 0.09)"
  },
  reorderItemLeftCol: {
    borderRightColor: "#e0e8f2"
  },
  reorderItemLeftColDark: {
    borderRightColor: "rgba(255, 255, 255, 0.09)"
  },
  reorderDividerLine: {
    backgroundColor: "#d4dfec"
  },
  reorderDividerLineDark: {
    backgroundColor: "rgba(255, 255, 255, 0.16)"
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
  dragMovingRow: {
    opacity: 0.54,
    transform: [{ scale: 0.985 }]
  },
  dragMovingRowDark: {
    opacity: 0.62
  },
  dragPreviewLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000
  },
  calendarDragBlockPreview: {
    position: "absolute",
    left: 0,
    top: 0,
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 11
  },
  calendarDragBlockPreviewDark: {
    shadowOpacity: 0,
    elevation: 11
  },
  calendarDragBlockLabel: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.42)"
  },
  dragPreviewCard: {
    position: "absolute",
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    shadowColor: "#0f172a",
    shadowOpacity: 0.20,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12
  },
  dragPreviewCardCompact: {
    minHeight: 26,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 5,
    gap: 4,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 9
  },
  dragPreviewCardDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: "rgba(147, 197, 253, 0.35)",
    shadowOpacity: 0,
    elevation: 12
  },
  dragPreviewDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    flexShrink: 0
  },
  dragPreviewDotCompact: {
    width: 6,
    height: 6
  },
  dragPreviewTime: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    color: "#475569",
    includeFontPadding: false
  },
  dragPreviewTimeCompact: {
    fontSize: 9,
    lineHeight: 10.5
  },
  dragPreviewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false
  },
  dragPreviewTitleCompact: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "800"
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
    width: "94%",
    maxWidth: 760,
    maxHeight: "82%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
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
    gap: 12,
    marginBottom: 8
  },
  editorHeaderMain: {
    flex: 1,
    minWidth: 0
  },
  editorHeaderCategoryBtn: {
    height: 40,
    maxWidth: 210,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc"
  },
  editorHeaderCategoryBtnDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorHeaderCategoryText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "900",
    color: "#0f172a"
  },
  editorHeaderCategoryChevron: {
    marginTop: -2,
    fontSize: 15,
    fontWeight: "900",
    color: "#64748b"
  },
  editorHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorCloseIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  editorCloseIconText: {
    fontSize: 25,
    lineHeight: 27,
    fontWeight: "500",
    color: "#334155"
  },
  editorHeaderSaveBtn: {
    height: 40,
    paddingHorizontal: 15,
    borderRadius: 12,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  editorHeaderSaveText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#ffffff"
  },
  editorHeaderLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#475569",
    marginBottom: 8
  },
  editorTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    color: "#0f172a"
  },
  editorHeaderTypeScroll: {
    maxHeight: 34
  },
  editorHeaderTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8
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
    marginTop: 8
  },
  editorRepeatMetaRow: {
    marginTop: 12
  },
  editorSectionGapLarge: {
    marginTop: 14
  },
  editorBody: {
    flexGrow: 0
  },
  editorBodyContent: {
    paddingBottom: 4
  },
  editorMetaLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#475569",
    marginBottom: 8
  },
  editorMetaLabelInline: {
    marginBottom: 0
  },
  editorMetaLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8
  },
  editorMetaLabelRowTight: {
    marginBottom: 8
  },
  editorInlinePair: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorTimeSettingRow: {
    minHeight: 38,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4
  },
  editorTimeSettingRowDark: {
    backgroundColor: "transparent"
  },
  editorTimeSettingCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#93a4ba",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center"
  },
  editorTimeSettingCheckDark: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(226, 232, 240, 0.44)"
  },
  editorTimeSettingCheckActive: {
    backgroundColor: ACCENT_BLUE,
    borderColor: ACCENT_BLUE
  },
  editorTimeSettingCheckText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 14
  },
  editorTimeSettingText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a"
  },
  editorTimeFieldsRow: {
    marginTop: 8,
    alignSelf: "stretch",
    width: "100%"
  },
  editorInlineHalf: {
    flex: 1,
    minWidth: 0
  },
  editorInlineTimeStart: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingHorizontal: 10
  },
  editorInlineTimeEnd: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingHorizontal: 10
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
  editorAnniversaryWrap: {
    gap: 8
  },
  editorAnniversarySection: {
    gap: 0
  },
  editorAnniversarySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  editorAnniversaryActionBtn: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fbff",
    alignItems: "center",
    justifyContent: "center"
  },
  editorAnniversaryActionBtnDark: {
    borderColor: DARK_BORDER,
    backgroundColor: "rgba(30, 41, 59, 0.9)"
  },
  editorAnniversaryActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  editorAnniversaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  editorAnniversaryField: {
    width: "47%"
  },
  editorAnniversaryInput: {
    marginBottom: 0,
    backgroundColor: "#ffffff"
  },
  editorAnniversaryListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorAnniversaryListInput: {
    flex: 1,
    marginBottom: 0,
    backgroundColor: "#ffffff"
  },
  editorAnniversaryListSuffix: {
    minWidth: 42,
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b"
  },
  editorAnniversaryRemoveBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorAnniversaryRemoveBtnDark: {
    borderColor: DARK_BORDER,
    backgroundColor: "rgba(30, 41, 59, 0.9)"
  },
  editorAnniversaryRemoveText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b"
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
  editorRepeatInlineChoice: {
    marginLeft: "auto",
    minHeight: 26,
    maxWidth: 120,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorRepeatInlineChoiceDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorRepeatInlineChoiceText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  editorRepeatInlineSunday: {
    color: "#ef4444"
  },
  editorRepeatInlineSaturday: {
    color: "#2563eb"
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
  editorDateEndRow: {
    marginTop: 8
  },
  editorRepeatChoiceRow: {
    marginTop: 0,
    height: 38
  },
  editorRepeatHint: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    lineHeight: 17
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
  editorFloatingActions: {
    position: "absolute",
    left: "4%",
    right: "4%",
    alignItems: "center",
    zIndex: 30
  },
  editorActionsFloating: {
    width: "92%",
    maxWidth: 520,
    marginTop: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10
  },
  editorActionsFloatingDark: {
    backgroundColor: DARK_SURFACE,
    borderWidth: 1,
    borderColor: DARK_BORDER,
    shadowOpacity: 0,
    elevation: 0
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
  editorPickerRowDisabled: {
    opacity: 0.54
  },
  editorRangeRow: {
    marginTop: 8
  },
  editorPickerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0
  },
  editorPickerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0
  },
  editorPickerIcon: {
    fontSize: 14
  },
  editorPickerIconSpacer: {
    width: 16,
    height: 16
  },
  editorPickerValue: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a"
  },
  editorPickerValueMuted: {
    color: "#8b95a5"
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
  editorPickerContinuePillActive: {
    backgroundColor: "rgba(43, 103, 199, 0.14)",
    borderColor: ACCENT_BLUE
  },
  editorPickerClearText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  editorPickerContinueTextActive: {
    color: ACCENT_BLUE
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
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8
  },
  editorAlarmLeadRowDisabled: {
    opacity: 0.58
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
  editorAlarmLeadTextDisabled: {
    color: "#94a3b8"
  },
  editorTaskStatusRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  editorTaskStatusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  editorTaskStatusPill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d6dbe6",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  editorTaskStatusPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  editorTaskStatusPillActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorTaskStatusPillActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.24)",
    borderColor: "rgba(125, 211, 252, 0.42)"
  },
  editorTaskStatusText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  editorTaskStatusTextActive: {
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
  choiceSheetCard: {
    paddingBottom: 18
  },
  choiceSheetList: {
    gap: 8
  },
  choiceSheetItem: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  choiceSheetItemDark: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: DARK_BORDER
  },
  choiceSheetItemActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  choiceSheetItemActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.22)",
    borderColor: "rgba(125, 211, 252, 0.38)"
  },
  choiceSheetItemText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#334155"
  },
  choiceSheetItemTextActive: {
    color: ACCENT_BLUE
  },
  choiceSheetCheck: {
    fontSize: 15,
    fontWeight: "900",
    color: ACCENT_BLUE
  },
  choiceSheetDoneBtn: {
    minWidth: 58
  },
  weekdayChoiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  weekdayChoiceItem: {
    width: 44,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  weekdayChoiceItemDark: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: DARK_BORDER
  },
  weekdayChoiceItemActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  weekdayChoiceItemActiveDark: {
    backgroundColor: "rgba(43, 103, 199, 0.22)",
    borderColor: "rgba(125, 211, 252, 0.38)"
  },
  weekdayChoiceText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#334155"
  },
  weekdayChoiceTextActive: {
    color: ACCENT_BLUE
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
  settingsRowStack: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 10
  },
  settingsLabelBlock: {
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
  settingsValue: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748b"
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
  settingsScaleScroll: {
    flexGrow: 0
  },
  settingsScaleScrollContent: {
    paddingRight: 4
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
  settingsDeleteAccountBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    alignItems: "center",
    justifyContent: "center"
  },
  settingsDeleteAccountBtnDisabled: {
    opacity: 0.6
  },
  settingsDeleteAccountText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#b91c1c"
  },
  tasksSheetCard: {
    maxHeight: "82%"
  },
  tasksSheetHeaderCopy: {
    flex: 1,
    paddingRight: 12
  },
  tasksSheetHint: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    lineHeight: 17
  },
  tasksSheetScroll: {
    maxHeight: "100%"
  },
  tasksSheetContent: {
    paddingTop: 4,
    paddingBottom: 8,
    gap: 14
  },
  tasksSheetSection: {
    gap: 8
  },
  tasksSheetSectionHeader: {
    paddingTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  tasksSheetSectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  tasksSheetSectionCount: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b"
  },
  tasksSheetItemWrap: {
    borderRadius: 16,
    overflow: "hidden"
  },
  tasksSheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff"
  },
  tasksSheetItemDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: DARK_BORDER
  },
  tasksSheetCheck: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.7,
    borderColor: "#60a5fa",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  tasksSheetCheckDark: {
    backgroundColor: DARK_SURFACE,
    borderColor: "#7dd3fc"
  },
  tasksSheetCheckActive: {
    backgroundColor: "rgba(59, 130, 246, 0.14)",
    borderColor: "rgba(59, 130, 246, 0.72)"
  },
  tasksSheetCheckActiveDark: {
    backgroundColor: "rgba(125, 211, 252, 0.12)",
    borderColor: "rgba(125, 211, 252, 0.56)"
  },
  tasksSheetCheckText: {
    fontSize: 12,
    fontWeight: "900",
    color: "transparent",
    includeFontPadding: false
  },
  tasksSheetCheckTextActive: {
    color: "#5375b6"
  },
  tasksSheetTimeClock: {
    width: 10.6,
    height: 10.6,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: "#64748b",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  tasksSheetTimeClockDark: {
    borderColor: "#cbd5e1"
  },
  tasksSheetTimeClockHour: {
    position: "absolute",
    width: 1.05,
    height: 3.8,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 2.1,
    left: 4.1
  },
  tasksSheetTimeClockMinute: {
    position: "absolute",
    width: 3.5,
    height: 1.05,
    borderRadius: 999,
    backgroundColor: "#64748b",
    top: 5,
    left: 4.1
  },
  tasksSheetTimeCorner: {
    position: "absolute",
    right: 2.6,
    bottom: 2.6,
    width: 4.8,
    height: 4.8,
    borderRightWidth: 1.45,
    borderBottomWidth: 1.45,
    borderColor: "#64748b",
    borderBottomRightRadius: 1,
    opacity: 0.84
  },
  tasksSheetTimeCornerDark: {
    borderColor: "#cbd5e1",
    opacity: 0.92
  },
  tasksSheetDeleteSwipeAction: {
    width: 56,
    marginLeft: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ef4444"
  },
  tasksSheetDeleteSwipeActionDark: {
    backgroundColor: "#dc2626"
  },
  tasksSheetDeleteSwipeText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#ffffff"
  },
  tasksSheetItemBody: {
    flex: 1,
    gap: 6
  },
  tasksSheetDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  tasksSheetDeleteBtnDark: {
    borderColor: "rgba(248, 113, 113, 0.28)",
    backgroundColor: "rgba(127, 29, 29, 0.32)"
  },
  tasksSheetDeleteBtnText: {
    fontSize: 17,
    fontWeight: "900",
    color: "#dc2626"
  },
  tasksSheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6
  },
  tasksSheetItemTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a"
  },
  tasksSheetItemTitleDone: {
    textDecorationLine: "line-through",
    textDecorationColor: "#64748b",
    color: "#94a3b8",
    opacity: 0.78
  },
  tasksSheetMetaPill: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center"
  },
  tasksSheetMetaPillDark: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: DARK_BORDER
  },
  tasksSheetMetaPillText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#475569"
  },
  tasksSheetMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8
  },
  tasksSheetMetaText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b"
  },
  tasksSheetEmpty: {
    marginTop: 2,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc"
  },
  tasksSheetEmptyDark: {
    backgroundColor: DARK_SURFACE_2,
    borderColor: "rgba(148, 163, 184, 0.28)"
  },
  tasksSheetEmptyTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  tasksSheetEmptyText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    color: "#64748b"
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
