import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Constants from "expo-constants"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient } from "@supabase/supabase-js"
import DateTimePicker from "@react-native-community/datetimepicker"
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { NavigationContainer } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"

const ACCENT_BLUE = "#2b67c7"
const ACCENT_RED = "#d04b4b"
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

const DEFAULT_WINDOWS = [{ id: "all", title: "통합", color: ACCENT_BLUE, fixed: true }]
const AUTH_STORAGE_KEY = "plannerMobile.auth.v1"
const CLIENT_ID_KEY = "plannerMobile.clientId.v1"
const UI_THEME_KEY = "plannerMobile.ui.theme.v1"
const UI_FONT_SCALE_KEY = "plannerMobile.ui.fontScale.v1"

function pad2(value) {
  return String(value).padStart(2, "0")
}

function dateToKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
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
  if (!dt) return isDark ? "#e5e7eb" : "#0f172a"
  const dow = dt.getDay()
  if (dow === 0) return ACCENT_RED
  if (dow === 6) return ACCENT_BLUE
  return isDark ? "#e5e7eb" : "#0f172a"
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

function formatTimeForDisplay(timeText) {
  const match = String(timeText ?? "").trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ""
  const hour24 = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  const ampmLabel = hour24 >= 12 ? "오후" : "오전"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${ampmLabel} ${pad2(hour12)}:${pad2(minute)}`
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
  const time = item?.time ? String(item.time).trim() : ""
  const text = String(item?.content ?? "").trim()
  const category = String(item?.category_id ?? "").trim()
  const prefix = category && category !== "__general__" ? `[${category}] ` : ""
  return { time, text: `${prefix}${text}`.trim() }
}

function normalizeWindowTitle(value) {
  return String(value ?? "").trim()
}

function timeToMinutes(value) {
  const trimmed = String(value ?? "").trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1]) * 60 + Number(match[2])
}

function sortItems(a, b) {
  const ta = timeToMinutes(a?.time)
  const tb = timeToMinutes(b?.time)
  if (ta !== tb) return ta - tb
  const ca = String(a?.category_id ?? "")
  const cb = String(b?.category_id ?? "")
  if (ca !== cb) return ca.localeCompare(cb, "ko")
  const at = String(a?.content ?? "").trim()
  const bt = String(b?.content ?? "").trim()
  const aNum = /^\d+$/.test(at) ? Number(at) : null
  const bNum = /^\d+$/.test(bt) ? Number(bt) : null
  if (aNum != null && bNum != null) return aNum - bNum
  return at.localeCompare(bt, "ko")
}

function Header({
  title,
  subtitle,
  loading,
  onRefresh,
  onSignOut,
  tone = "light",
  titleStyle,
  buttonsStyle
}) {
  const isDark = tone === "dark"
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={[styles.headerLogo, isDark ? styles.headerLogoDark : null]}>
          <Text style={styles.headerLogoText}>P</Text>
        </View>
        <View>
          <Text style={[styles.title, isDark ? styles.titleDark : null, titleStyle]}>{title}</Text>
          <Text style={[styles.subtitle, isDark ? styles.subtitleDark : null]}>
            {subtitle ?? "for users who like typing"}
          </Text>
        </View>
      </View>
      <View style={[styles.headerButtons, buttonsStyle]}>
        {onRefresh ? (
          <TouchableOpacity
            style={[styles.ghostButton, isDark ? styles.ghostButtonDark : null]}
            onPress={onRefresh}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={loading ? "Refreshing" : "Refresh"}
          >
            <Text
              style={[
                styles.ghostButtonText,
                isDark ? styles.ghostButtonTextDark : null,
                loading ? styles.ghostButtonTextDisabled : null
              ]}
            >
              ⟳
            </Text>
          </TouchableOpacity>
        ) : null}
        {onSignOut ? (
          <TouchableOpacity
            style={[styles.ghostButton, isDark ? styles.ghostButtonDark : null]}
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={[styles.ghostButtonText, isDark ? styles.ghostButtonTextDark : null]}>⚙</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function SettingsSheet({ visible, themeMode, fontScale, onChangeTheme, onChangeFontScale, onLogout, onClose }) {
  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>설정</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onClose} style={styles.sheetBtnGhost}>
                <Text style={styles.sheetBtnGhostText}>닫기</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.settingsList}>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>테마</Text>
              <View style={styles.settingsSegment}>
                <Pressable
                  onPress={() => onChangeTheme?.("light")}
                  style={[styles.settingsSegBtn, themeMode === "light" ? styles.settingsSegBtnActive : null]}
                >
                  <Text
                    style={[styles.settingsSegText, themeMode === "light" ? styles.settingsSegTextActive : null]}
                  >
                    라이트
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onChangeTheme?.("dark")}
                  style={[styles.settingsSegBtn, themeMode === "dark" ? styles.settingsSegBtnActive : null]}
                >
                  <Text
                    style={[styles.settingsSegText, themeMode === "dark" ? styles.settingsSegTextActive : null]}
                  >
                    다크
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>글씨 크기</Text>
              <View style={styles.settingsSegment}>
                {[0.9, 1, 1.1].map((scale) => {
                  const active = Math.abs((fontScale ?? 1) - scale) < 0.001
                  const label = scale === 0.9 ? "작게" : scale === 1 ? "보통" : "크게"
                  return (
                    <Pressable
                      key={String(scale)}
                      onPress={() => onChangeFontScale?.(scale)}
                      style={[styles.settingsSegBtn, active ? styles.settingsSegBtnActive : null]}
                    >
                      <Text style={[styles.settingsSegText, active ? styles.settingsSegTextActive : null]}>
                        {label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

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
  tone = "light"
}) {
  const isDark = tone === "dark"
  const [menuWindow, setMenuWindow] = useState(null)
  const [menuVisible, setMenuVisible] = useState(false)
  const [addVisible, setAddVisible] = useState(false)
  const [renameVisible, setRenameVisible] = useState(false)
  const [colorVisible, setColorVisible] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftColor, setDraftColor] = useState(ACCENT_BLUE)

  const palette = useMemo(
    () => WINDOW_COLORS,
    []
  )

  const nextDefaultColor = useMemo(() => {
    const used = new Set((windows ?? []).map((w) => String(w?.color ?? "").toLowerCase()).filter(Boolean))
    const available = palette.find((c) => !used.has(String(c).toLowerCase()))
    return available ?? palette[(windows?.length ?? 1) % palette.length] ?? palette[0]
  }, [palette, windows])

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

  return (
    <View style={[styles.tabBarWrap, isDark ? styles.tabBarWrapDark : null]}>
      <View style={styles.tabBarInner}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabScroll, isDark ? styles.tabScrollDark : null]}
          contentContainerStyle={[
            styles.tabRow,
            isDark ? styles.tabRowDark : null,
            { paddingRight: 64 }
          ]}
        >
          {windows.map((w) => {
            const active = w.id === activeId
            const label = w.id === "all" ? "통합" : w.title
            return (
              <TouchableOpacity
                key={w.id}
                style={[
                  styles.tabPill,
                  isDark ? styles.tabPillDark : null,
                  active ? (isDark ? styles.tabPillActiveDark : styles.tabPillActive) : null
                ]}
                onPress={() => onSelect(w.id)}
                activeOpacity={0.9}
              >
                {w.id !== "all" ? (
                  <View style={[styles.tabDot, { backgroundColor: w.color || "#3b82f6" }]} />
                ) : null}
                <Text
                  style={[
                    styles.tabText,
                    isDark ? styles.tabTextDark : null,
                    active ? (isDark ? styles.tabTextActiveDark : styles.tabTextActive) : null
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
                {w.id !== "all" ? (
                  <Pressable
                    onPress={(e) => {
                      e?.stopPropagation?.()
                      openMenu(w)
                    }}
                    hitSlop={10}
                    style={styles.tabMenuBtn}
                  >
                    <Text style={styles.tabMenuIcon}>⋮</Text>
                  </Pressable>
                ) : null}
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        <View pointerEvents="none" style={[styles.tabAddMask, isDark ? styles.tabAddMaskDark : null]} />
        <Pressable onPress={openAdd} style={styles.tabAddBtn} hitSlop={10}>
          <Text style={styles.tabAddText}>＋</Text>
        </Pressable>
      </View>

      <Modal transparent animationType="fade" visible={addVisible} statusBarTranslucent>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeAll} />
          <View style={styles.sheetCard}>
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
          <View style={styles.sheetCard}>
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
          <View style={styles.sheetCard}>
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
          <View style={styles.sheetCard}>
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
  holidaysByDate,
  ensureHolidayYear,
  onAddPlan,
  onEditPlan
}) {
  const scale = useMemo(() => {
    const n = Number(fontScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.85, Math.min(1.25, n))
  }, [fontScale])
  const fs = useCallback((n) => Math.round(n * scale), [scale])
  const isDark = tone === "dark"
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1)
  const monthLabel = `${viewYear}-${pad2(viewMonth)}`
  const todayKey = dateToKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const listRef = useRef(null)
  const pendingScrollRef = useRef(false)
  const [scrollToken, setScrollToken] = useState(0)

  const colorByTitle = useMemo(() => {
    const map = new Map()
    for (const w of windows ?? []) {
      if (!w?.title) continue
      map.set(String(w.title), w.color || "#94a3b8")
    }
    return map
  }, [windows])

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

  const visibleSections = useMemo(() => {
    const prefix = `${viewYear}-${pad2(viewMonth)}-`
    return (sections ?? []).filter((section) => String(section.title ?? "").startsWith(prefix))
  }, [sections, viewYear, viewMonth])

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
        tone={tone}
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
        tone={tone}
      />
      <View style={styles.listMonthBar}>
        <View style={styles.listMonthLeftGroup}>
          <TouchableOpacity style={styles.listMonthNavButton} onPress={goPrevMonth}>
            <Text style={[styles.listMonthNavText, isDark ? styles.textDark : null]}>{"‹"}</Text>
          </TouchableOpacity>
          <Text style={[styles.listMonthText, isDark ? styles.textDark : null]}>{monthLabel}</Text>
          <TouchableOpacity style={styles.listMonthNavButton} onPress={goNextMonth}>
            <Text style={[styles.listMonthNavText, isDark ? styles.textDark : null]}>{"›"}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.listMonthRightGroup}>
          <TouchableOpacity
            style={[styles.listAddButton, isDark ? styles.listPillDark : null]}
            onPress={() => {
              const key =
                viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1
                  ? todayKey
                  : dateToKey(viewYear, viewMonth, 1)
              onAddPlan?.(key)
            }}
          >
            <Text style={[styles.listAddText, isDark ? styles.textDark : null]}>+ Add</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.listTodayButton, isDark ? styles.listPillDark : null]} onPress={goToday}>
            <Text style={[styles.listTodayText, isDark ? styles.textDark : null]}>Today</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={[styles.card, styles.listCard, isDark ? styles.cardDark : null]}>
        {loading ? <ActivityIndicator size="small" color="#3b82f6" /> : null}
        <SectionList
          ref={listRef}
          sections={visibleSections}
          keyExtractor={(item) => item.id ?? `${item.date}-${item.content}`}
          stickySectionHeadersEnabled={false}
	          renderItem={({ item }) => {
	            const time = item?.time ? String(item.time).trim() : ""
	            const content = String(item?.content ?? "").trim()
	            const category = String(item?.category_id ?? "").trim()
	            const isGeneral = !category || category === "__general__"
	            const categoryColor = colorByTitle.get(category) || "#94a3b8"
	            return (
	              <Pressable style={[styles.itemRow, isDark ? styles.itemRowDark : null]} onPress={() => onEditPlan?.(item)}>
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
	                    <Text style={[styles.itemTitle, { fontSize: fs(14) }, isDark ? styles.textDark : null]} numberOfLines={1}>
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
	            const holidayName = holidaysByDate?.get?.(key) ?? ""
	            const isHoliday = Boolean(holidayName)
	            const color = weekdayColor(key, { isHoliday, isDark })
	            const dow = weekdayLabel(key)
	            return (
	              <Pressable
	                style={[
                  styles.sectionHeader,
                  isDark ? styles.sectionHeaderDark : null,
                  section.title === todayKey ? (isDark ? styles.sectionHeaderTodayDark : styles.sectionHeaderToday) : null
                ]}
                onPress={() => onAddPlan?.(key)}
              >
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionHeaderLeft}>
                    <Text style={[styles.sectionHeaderDateText, { color, fontSize: fs(14) }]}>{formatDateMD(key)}</Text>
                    {dow ? (
                      <View
                        style={[
                          styles.sectionHeaderDowBadge,
                          isHoliday ? styles.sectionHeaderDowBadgeHoliday : null,
                          !isHoliday && dow === "토" ? styles.sectionHeaderDowBadgeSat : null,
                          !isHoliday && dow === "일" ? styles.sectionHeaderDowBadgeSun : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.sectionHeaderDowBadgeText,
                            isHoliday ? styles.sectionHeaderDowBadgeTextHoliday : null,
                            !isHoliday && dow === "토" ? styles.sectionHeaderDowBadgeTextSat : null,
                            !isHoliday && dow === "일" ? styles.sectionHeaderDowBadgeTextSun : null
                          ]}
                        >
                          {dow}
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
            )
          }}
          ListEmptyComponent={!loading ? <Text style={styles.helpText}>No items yet.</Text> : null}
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
  onSaveMemo
}) {
  const insets = useSafeAreaInsets()
  const isDark = tone === "dark"
  const scale = useMemo(() => {
    const n = Number(fontScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.85, Math.min(1.25, n))
  }, [fontScale])
  const [draft, setDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const draftRef = useRef("")
  const dirtyRef = useRef(false)
  const inputRef = useRef(null)
  const prevTabRef = useRef(activeTabId)
  const lastAppliedTabRef = useRef(activeTabId)
  const saveTimerRef = useRef(null)
  const saveSeqRef = useRef(0)

  useEffect(() => {
    setIsEditing(false)
    Keyboard.dismiss()
  }, [activeTabId])

  async function saveForTab(tabId, text) {
    if (!tabId || tabId === "all") return
    await onSaveMemo?.(tabId, text)
  }

  async function saveForAll(text) {
    const { windowTexts } = splitCombinedMemoText(text, windows)
    const targets = (windows ?? []).filter((w) => w && w.id !== "all")
    for (const w of targets) {
      const id = String(w.id ?? "")
      if (!id) continue
      await onSaveMemo?.(id, windowTexts?.[id] ?? "")
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

  return (
    <SafeAreaView style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        tone={tone}
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
        tone={tone}
      />
      <View style={[styles.card, styles.memoCard, isDark ? styles.cardDark : null]}>
        {loading ? <ActivityIndicator size="small" color="#3b82f6" /> : null}
        <View style={styles.memoEditorWrap}>
          <View style={styles.memoEditorBar}>
            <Text style={[styles.memoEditorTitle, isDark ? styles.textDark : null]}>
              {activeTabId === "all" ? "통합 메모" : "메모"}
            </Text>
            <Pressable
              style={[styles.memoEditBtn, isDark ? styles.listPillDark : null]}
              onPress={() => {
                const next = !isEditing
                setIsEditing(next)
                if (next) setTimeout(() => inputRef.current?.focus?.(), 50)
                else Keyboard.dismiss()
              }}
            >
              <Text style={[styles.memoEditBtnText, isDark ? styles.textDark : null]}>{isEditing ? "완료" : "편집"}</Text>
            </Pressable>
          </View>

          {!isEditing ? (
            <ScrollView
              style={[styles.memoPaper, isDark ? styles.paperDark : null]}
              contentContainerStyle={styles.memoPaperContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {String(draft ?? "").trim() ? (
                <Text
                  selectable
                  style={[
                    styles.memoText,
                    { fontSize: Math.round(14 * scale), lineHeight: Math.round(20 * scale) },
                    isDark ? styles.textDark : null
                  ]}
                >
                  {draft}
                </Text>
              ) : (
                <View style={styles.memoEmpty}>
                  <Text style={[styles.memoEmptyTitle, isDark ? styles.textDark : null]}>메모</Text>
                  <Text style={[styles.memoEmptySub, isDark ? styles.textMutedDark : null]}>오른쪽 상단 ‘편집’으로 작성하세요.</Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
            >
              <TextInput
                ref={inputRef}
                value={draft}
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
                  styles.memoInput,
                  {
                    fontSize: Math.round(14 * scale),
                    lineHeight: Math.round(20 * scale),
                    paddingBottom: Math.max(16, insets.bottom + 12)
                  },
                  isDark ? styles.inputDark : null
                ]}
              />
            </KeyboardAvoidingView>
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}

function PlanEditorModal({ visible, draft, windows, onClose, onSave, onDelete }) {
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [content, setContent] = useState("")
  const [category, setCategory] = useState("__general__")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [iosDateSheetVisible, setIosDateSheetVisible] = useState(false)
  const [iosTempDate, setIosTempDate] = useState(new Date())
  const [iosTimeSheetVisible, setIosTimeSheetVisible] = useState(false)
  const [iosTempTime, setIosTempTime] = useState(new Date())

  useEffect(() => {
    if (!visible) return
    setDate(String(draft?.date ?? ""))
    setTime(String(draft?.time ?? ""))
    setContent(String(draft?.content ?? ""))
    setCategory(String(draft?.category_id ?? "__general__") || "__general__")
    setShowDatePicker(false)
    setShowTimePicker(false)
    setIosDateSheetVisible(false)
    setIosTimeSheetVisible(false)
  }, [visible, draft])

  const title = draft?.id ? "일정 수정" : "일정 추가"
  const dateValue = useMemo(() => parseDateKey(date) ?? new Date(), [date])
  const timeValue = useMemo(() => {
    if (!time) return new Date()
    const parts = String(time).split(":")
    const h = Number(parts[0] ?? 0)
    const m = Number(parts[1] ?? 0)
    const next = new Date()
    next.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
    return next
  }, [time])
  const timeDisplay = useMemo(() => (time ? formatTimeForDisplay(time) : ""), [time])

  const options = useMemo(() => {
    const items = [{ key: "__general__", label: "통합" }]
    for (const w of windows ?? []) {
      if (!w || w.id === "all") continue
      items.push({ key: String(w.title), label: String(w.title), color: w.color || "#94a3b8" })
    }
    return items
  }, [windows])

  function handleSave() {
    if (!date) return
    if (!content.trim()) return
    onSave?.({
      ...(draft ?? {}),
      date,
      time: String(time ?? "").trim(),
      content: String(content ?? "").trim(),
      category_id: category
    })
  }

  function confirmDelete() {
    if (!draft?.id) return
    Alert.alert("삭제", "이 일정을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => onDelete?.(draft.id) }
    ])
  }

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="fade">
      <View style={styles.dayModalOverlay}>
        <Pressable style={styles.dayModalBackdrop} onPress={onClose} />
        <View style={styles.editorCard}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.editorCloseBtn}>
              <Text style={styles.editorCloseText}>닫기</Text>
            </Pressable>
          </View>

          <View style={styles.editorMetaRow}>
            <Text style={styles.editorMetaLabel}>날짜</Text>
            <Pressable
              style={styles.editorPickerRow}
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
                <View style={styles.editorPickerIconSpacer} />
                <Text style={styles.editorPickerValue}>
                  {date} {weekdayLabel(date)}
                </Text>
              </View>
              <Text style={styles.editorPickerHint}>변경</Text>
            </Pressable>
          </View>

          <View style={styles.editorMetaRow}>
            <Text style={styles.editorMetaLabel}>카테고리</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorCategoryRow}>
              {options.map((opt) => {
                const active = opt.key === category
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setCategory(opt.key)}
                    style={[styles.editorCategoryPill, active ? styles.editorCategoryPillActive : null]}
                  >
                    {opt.key !== "__general__" ? (
                      <View style={[styles.tabDot, { backgroundColor: opt.color || "#94a3b8" }]} />
                    ) : null}
                    <Text style={[styles.editorCategoryText, active ? styles.editorCategoryTextActive : null]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>

          <View style={styles.editorMetaRow}>
            <Text style={styles.editorMetaLabel}>시간</Text>
            <Pressable
              style={styles.editorPickerRow}
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
                <View style={styles.editorPickerIconSpacer} />
                <Text style={styles.editorPickerValue}>{time ? timeDisplay : "시간 선택 안함"}</Text>
              </View>
              <View style={styles.editorPickerRight}>
                {time ? (
                  <Pressable
                    onPress={() => setTime("")}
                    style={styles.editorPickerClearPill}
                    hitSlop={8}
                  >
                    <Text style={styles.editorPickerClearText}>없음</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.editorPickerHint}>선택</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.editorMetaRow}>
            <Text style={styles.editorMetaLabel}>내용</Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="할 일을 입력하세요"
              placeholderTextColor="#9aa3b2"
              style={[styles.input, styles.editorTextarea]}
              multiline
              scrollEnabled
              disableFullscreenUI
              underlineColorAndroid="transparent"
            />
          </View>

          <View style={styles.editorActions}>
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
        onCancel={() => setIosTimeSheetVisible(false)}
        onConfirm={(selected) => {
          setIosTimeSheetVisible(false)
          if (!selected) return
          setTime(`${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`)
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
      {Platform.OS === "android" && showTimePicker ? (
        <DateTimePicker
          value={timeValue}
          mode="time"
          display="clock"
          is24Hour={false}
          onChange={(_event, selected) => {
            setShowTimePicker(false)
            if (!selected) return
            setTime(`${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`)
          }}
        />
      ) : null}
    </Modal>
  )
}

function PickerSheet({ visible, title, value, mode, is24Hour = true, onCancel, onConfirm }) {
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
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <View style={styles.sheetHeaderRight}>
              <Pressable onPress={onCancel} style={styles.sheetBtnGhost}>
                <Text style={styles.sheetBtnGhostText}>취소</Text>
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
  holidaysByDate,
  ensureHolidayYear,
  onAddPlan,
  onEditPlan,
  onSelectDateKey
}) {
  const isDark = tone === "dark"
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1)
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const maxItemsPerDay = 6
  const [gridHeight, setGridHeight] = useState(0)

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
  const first = new Date(viewYear, viewMonth - 1, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
  const totalCells = startDay + daysInMonth
  const weeks = Math.ceil(totalCells / 7)
  const cells = []
  for (let i = 0; i < startDay; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d)
  while (cells.length < weeks * 7) cells.push(null)

  const cellHeight = gridHeight ? gridHeight / weeks : undefined
  const dayItems = selectedDateKey ? itemsByDate.get(selectedDateKey) ?? [] : []
  const selectedDateLabel = useMemo(() => {
    if (!selectedDateKey) return ""
    const dt = parseDateKey(selectedDateKey)
    if (!dt) return selectedDateKey
    const dayName = weekdayLabel(selectedDateKey)
    const [y, m, d] = String(selectedDateKey).split("-")
    return `${y}.${m}.${d}${dayName ? ` (${dayName})` : ""}`
  }, [selectedDateKey])

  useEffect(() => {
    ensureHolidayYear?.(viewYear)
  }, [viewYear, ensureHolidayYear])


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

  return (
    <SafeAreaView style={[styles.container, styles.calendarFill, isDark ? styles.containerDark : null]}>
      <Header
        title="Planner"
        loading={loading}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        tone={tone}
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
        tone={tone}
      />
	      <View style={[styles.card, styles.calendarCard, isDark ? styles.cardDark : null]}>
	          <View style={[styles.calendarHeaderWrap, isDark ? styles.calendarHeaderWrapDark : null]}>
	            <View style={styles.calendarHeader}>
	              <TouchableOpacity
	                style={[styles.calendarNavButton, isDark ? styles.calendarNavButtonDark : null, styles.calendarHeaderLeft]}
	                onPress={goPrevMonth}
	              >
	                <Text style={[styles.calendarNavText, isDark ? styles.calendarNavTextDark : null]}>{"<"}</Text>
	              </TouchableOpacity>
	              <Text style={[styles.calendarTitleCentered, isDark ? styles.textDark : null]}>{monthLabel}</Text>
	              <View style={styles.calendarHeaderRight}>
	                <TouchableOpacity style={[styles.listTodayButton, isDark ? styles.listPillDark : null]} onPress={goToday}>
	                  <Text style={[styles.listTodayText, isDark ? styles.textDark : null]}>Today</Text>
	                </TouchableOpacity>
	                <TouchableOpacity style={[styles.calendarNavButton, isDark ? styles.calendarNavButtonDark : null]} onPress={goNextMonth}>
	                  <Text style={[styles.calendarNavText, isDark ? styles.calendarNavTextDark : null]}>{">"}</Text>
	                </TouchableOpacity>
	              </View>
	            </View>
	            <View style={[styles.weekHeaderRow, isDark ? styles.weekHeaderRowDark : null]}>
	              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, idx) => (
	                <Text key={d + idx} style={[styles.weekHeaderText, isDark ? styles.textMutedDark : null]}>
	                  {d}
	                </Text>
	              ))}
	            </View>
	          </View>
	          <View style={[styles.calendarGrid, isDark ? styles.calendarGridDark : null]} onLayout={(e) => setGridHeight(e.nativeEvent.layout.height)}>
	            {cells.map((day, idx) => {
	              const key = day ? dateToKey(viewYear, viewMonth, day) : null
	              const items = key ? itemsByDate.get(key) ?? [] : []
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
	                  cellHeight ? { height: cellHeight } : null,
	                  isLastCol ? styles.calendarCellLastCol : null,
	                  isLastRow ? styles.calendarCellLastRow : null,
	                  isToday ? (isDark ? styles.calendarCellTodayDark : styles.calendarCellToday) : null,
	                  isSelected ? (isDark ? styles.calendarCellSelectedDark : styles.calendarCellSelected) : null
	                ]}
	                onPress={() => openDate(day)}
	              >
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
                    const category = String(item?.category_id ?? "").trim()
                    const dotColor =
                      category && category !== "__general__"
                        ? colorByTitle.get(category) || "#94a3b8"
                        : "#9aa3b2"
	                    return (
	                      <View key={item.id ?? `${item.date}-${item.content}`} style={styles.calendarLine}>
	                        <View style={[styles.calendarDot, { backgroundColor: dotColor }]} />
	                        <Text numberOfLines={1} style={[styles.calendarLineText, isDark ? styles.calendarLineTextDark : null]}>
	                          {line.text}
	                        </Text>
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
        visible={Boolean(selectedDateKey)}
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setSelectedDateKey(null)}
      >
        <View style={styles.dayModalOverlay}>
          <Pressable style={styles.dayModalBackdrop} onPress={() => setSelectedDateKey(null)} />
          <View style={[styles.dayModalCard, isDark ? styles.dayModalCardDark : null]}>
            <View style={styles.dayModalHeader}>
              <View style={styles.dayModalHeaderLeft}>
                <Text style={[styles.dayModalTitle, isDark ? styles.textDark : null]}>{selectedDateLabel || selectedDateKey}</Text>
                <View style={[styles.dayModalCountPill, isDark ? styles.dayModalCountPillDark : null]}>
                  <Text style={styles.dayModalCountText}>{dayItems.length}개</Text>
                </View>
              </View>
              <View style={styles.dayModalHeaderRight}>
                <Pressable
                  onPress={() => {
                    if (!selectedDateKey) return
                    onAddPlan?.(selectedDateKey)
                  }}
                  style={[styles.dayModalAddBtn, isDark ? styles.dayModalAddBtnDark : null]}
                >
                  <Text style={styles.dayModalAddText}>+ 추가</Text>
                </Pressable>
                <Pressable onPress={() => setSelectedDateKey(null)} style={[styles.dayModalCloseBtn, isDark ? styles.dayModalCloseBtnDark : null]}>
                  <Text style={[styles.dayModalCloseX, isDark ? styles.textDark : null]}>닫기</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.dayModalList}>
              {dayItems.length === 0 ? (
                <View style={styles.dayModalEmpty}>
                  <Text style={[styles.dayModalEmptyTitle, isDark ? styles.textDark : null]}>할 일이 없어요</Text>
                  <Text style={[styles.dayModalEmptySub, isDark ? styles.textMutedDark : null]}>이 날짜에 등록된 일정이 없습니다.</Text>
                </View>
              ) : (
                dayItems.map((item) => {
                  const line = formatLine(item)
                  const time = item?.time ? String(item.time).trim() : ""
                  return (
                    <Pressable
                      key={item.id ?? `${item.date}-${item.content}`}
                      style={[styles.dayModalItemRow, isDark ? styles.dayModalItemRowDark : null]}
                      onPress={() => onEditPlan?.(item)}
                    >
                      {time ? (
                        <Text style={[styles.dayModalItemTime, isDark ? styles.textMutedDark : null]}>{time}</Text>
                      ) : (
                        <Text style={styles.dayModalItemTimeEmpty}>{"\u00A0"}</Text>
                      )}
                      <Text style={[styles.dayModalItemText, isDark ? styles.textDark : null]}>{line.text}</Text>
                    </Pressable>
                  )
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

  const tabBarStyle = useMemo(() => {
    const isDark = themeMode === "dark"
    return [
      styles.tabBar,
      isDark ? styles.tabBarDark : null,
      {
        height: 50 + insets.bottom,
        paddingBottom: Math.max(insets.bottom, 6)
      }
    ]
  }, [insets.bottom, themeMode])

  const fabBottom = useMemo(() => 50 + insets.bottom + 18, [insets.bottom])

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

  async function loadPlans(userId) {
    if (!supabase || !userId) return
    setLoading(true)
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("date", { ascending: true })
      .order("time", { ascending: true })
    if (error) {
      setAuthMessage(error.message || "Load failed.")
      setPlans([])
    } else {
      setPlans(data ?? [])
    }
    setLoading(false)
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

  async function upsertPlan(userId, next) {
    if (!supabase || !userId) return
    const payload = {
      user_id: userId,
      date: String(next?.date ?? "").trim(),
      time: String(next?.time ?? "").trim() || null,
      content: String(next?.content ?? "").trim(),
      category_id: String(next?.category_id ?? "__general__").trim() || "__general__",
      client_id: clientId || null,
      updated_at: new Date().toISOString()
    }
    if (!payload.date || !payload.content) return

    setLoading(true)
    if (next?.id) {
      const { error } = await supabase.from("plans").update(payload).eq("id", next.id).eq("user_id", userId)
      if (error) setAuthMessage(error.message || "Save failed.")
    } else {
      const { error } = await supabase.from("plans").insert(payload)
      if (error) setAuthMessage(error.message || "Save failed.")
    }
    await loadPlans(userId)
    setLoading(false)
  }

  async function softDeletePlan(userId, planId) {
    if (!supabase || !userId || !planId) return
    setLoading(true)
    const { error } = await supabase
      .from("plans")
      .update({ deleted_at: new Date().toISOString(), client_id: clientId || null, updated_at: new Date().toISOString() })
      .eq("id", planId)
      .eq("user_id", userId)
    if (error) setAuthMessage(error.message || "Delete failed.")
    await loadPlans(userId)
    setLoading(false)
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
      content: "",
      category_id: defaultCategory
    })
    setPlanEditorVisible(true)
  }

  function openEditPlan(item) {
    if (!item) return
    setPlanDraft({
      id: item.id,
      date: String(item.date ?? ""),
      time: String(item.time ?? ""),
      content: String(item.content ?? ""),
      category_id: String(item.category_id ?? "__general__")
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
      data: [...(map.get(key) ?? [])].sort(sortItems)
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
      map.set(key, [...items].sort(sortItems))
    }
    return map
  }, [filteredPlans])

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
              <View style={styles.authLogo}>
                <Text style={styles.authLogoText}>P</Text>
              </View>
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
        onClose={() => setPlanEditorVisible(false)}
        onSave={async (next) => {
          await upsertPlan(session?.user?.id, next)
          setPlanEditorVisible(false)
        }}
        onDelete={async (id) => {
          await softDeletePlan(session?.user?.id, id)
          setPlanEditorVisible(false)
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
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
          tabBarActiveTintColor: ACCENT_BLUE,
          tabBarInactiveTintColor: "#94a3b8",
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ focused }) => {
            const glyph = route.name === "List" ? "≡" : route.name === "Memo" ? "✎" : "▦"
            return <Text style={[styles.tabIcon, focused ? styles.tabIconActive : null]}>{glyph}</Text>
          }
        })}
      >
        <Tab.Screen name="List">
          {() => (
            <ListScreen
              sections={sections}
              loading={loading}
              windows={windows}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddWindow={addWindow}
              onRenameWindow={renameWindow}
              onDeleteWindow={deleteWindow}
              onChangeWindowColor={changeWindowColor}
              holidaysByDate={holidaysByDate}
              ensureHolidayYear={ensureHolidayYear}
              onAddPlan={openNewPlan}
              onEditPlan={openEditPlan}
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
              itemsByDate={itemsByDate}
              loading={loading}
              windows={windows}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onAddWindow={addWindow}
              onRenameWindow={renameWindow}
              onDeleteWindow={deleteWindow}
              onChangeWindowColor={changeWindowColor}
              holidaysByDate={holidaysByDate}
              ensureHolidayYear={ensureHolidayYear}
              onAddPlan={openNewPlan}
              onEditPlan={openEditPlan}
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
    backgroundColor: "#0b1220"
  },
  tabBar: {
    paddingTop: 2,
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
    backgroundColor: "#0b1220",
    shadowOpacity: 0
  },
  textDark: {
    color: "#f8fafc"
  },
  textMutedDark: {
    color: "#cbd5e1"
  },
  tabItem: {
    paddingVertical: 2
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: -2
  },
  tabIcon: {
    fontSize: 18,
    fontWeight: "800",
    color: "#94a3b8"
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
    paddingVertical: 22
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
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  headerLogo: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: ACCENT_BLUE,
    alignItems: "center",
    justifyContent: "center"
  },
  headerLogoDark: {
    backgroundColor: "#1d4ed8"
  },
  headerLogoText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 16,
    includeFontPadding: false
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 14
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
  titleDark: {
    color: "#f8fafc"
  },
  subtitleDark: {
    color: "#9aa0aa"
  },
  tabBarWrap: {
    marginTop: 4,
    marginBottom: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: "#eef2f7",
    borderWidth: 0
  },
  tabBarInner: {
    position: "relative",
    height: 44,
    overflow: "hidden"
  },
  tabAddMask: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 52,
    backgroundColor: "#eef2f7"
  },
  tabAddMaskDark: {
    backgroundColor: "#1f2937"
  },
  tabBarWrapDark: {
    backgroundColor: "#1f2937",
    borderWidth: 0
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 1,
    paddingHorizontal: 1
  },
  tabScroll: {
    maxHeight: 44
  },
  tabRowDark: {},
  tabScrollDark: {
    maxHeight: 44
  },
  tabAddBtn: {
    position: "absolute",
    right: 4,
    top: 5,
    height: 34,
    width: 34,
    borderRadius: 10,
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    alignItems: "center",
    justifyContent: "center"
  },
  tabAddText: {
    fontSize: 18,
    fontWeight: "900",
    color: ACCENT_BLUE,
    marginTop: -1
  },
  tabMenuBtn: {
    marginLeft: 8,
    height: 22,
    width: 20,
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
    marginTop: 0,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    height: 34
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
    borderRadius: 12,
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
    lineHeight: 24
  },
  listMonthRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  listMonthText: {
    fontSize: 17,
    fontWeight: "900",
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
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#eaf2ff",
    borderWidth: 1,
    borderColor: "rgba(43, 103, 199, 0.20)",
    alignItems: "center",
    justifyContent: "center"
  },
  listPillDark: {
    backgroundColor: "#111827",
    borderColor: "rgba(148, 163, 184, 0.20)"
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
    gap: 6,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)"
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
    backgroundColor: "transparent"
  },
  tabPillActiveDark: {
    backgroundColor: "#111827"
  },
  tabText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#64748b"
  },
  tabTextActive: {
    color: "#0f172a"
  },
  tabTextDark: {
    color: "#9ca3af"
  },
  tabTextActiveDark: {
    color: "#f8fafc"
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
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    shadowOpacity: 0,
    elevation: 0
  },
  listCard: {
    padding: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  memoCard: {
    padding: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
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
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center"
  },
  ghostButtonText: {
    color: ACCENT_BLUE,
    fontWeight: "900",
    fontSize: 24,
    includeFontPadding: false,
    textAlign: "center",
    lineHeight: 24,
    marginTop: -1
  },
  ghostButtonTextDisabled: {
    opacity: 0.55
  },
  ghostButtonDark: {
    backgroundColor: "#22252b"
  },
  ghostButtonTextDark: {
    color: "#e5e7eb"
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f8fafc",
    borderTopWidth: 1,
    borderTopColor: "#eef2f7",
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7"
  },
  sectionHeaderDark: {
    backgroundColor: "#0b1220",
    borderTopColor: "rgba(148, 163, 184, 0.14)",
    borderBottomColor: "rgba(148, 163, 184, 0.14)"
  },
  sectionHeaderToday: {
    backgroundColor: "#eef2ff"
  },
  sectionHeaderTodayDark: {
    backgroundColor: "#111827"
  },
  sectionHeaderDateText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a",
    marginLeft: 6
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
  sectionHeaderDowBadgeSun: {
    backgroundColor: "rgba(220, 38, 38, 0.10)"
  },
  sectionHeaderDowBadgeSat: {
    backgroundColor: "rgba(37, 99, 235, 0.10)"
  },
  sectionHeaderDowBadgeHoliday: {
    backgroundColor: "rgba(220, 38, 38, 0.10)"
  },
  sectionHeaderDowBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
  },
  sectionHeaderDowBadgeTextSun: {
    color: ACCENT_RED
  },
  sectionHeaderDowBadgeTextSat: {
    color: "#2563eb"
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
  listContent: {
    paddingBottom: 12,
    paddingHorizontal: 0,
    paddingTop: 0
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 9,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7"
  },
  itemRowDark: {
    borderBottomColor: "rgba(148, 163, 184, 0.14)"
  },
  itemLeftCol: {
    width: 54,
    paddingTop: 1,
    alignItems: "flex-end",
    paddingRight: 5
  },
  itemTimeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155",
    textAlign: "right"
  },
  itemTimeTextDark: {
    color: "#9ca3af"
  },
  itemTimeTextEmpty: {
    fontSize: 12,
    fontWeight: "900",
    color: "#94a3b8",
    textAlign: "right",
    opacity: 0
  },
  itemMainCol: {
    flex: 1
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
    fontWeight: "800",
    color: "#0f172a"
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
    backgroundColor: "#111827",
    borderColor: "rgba(148, 163, 184, 0.18)"
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
    paddingHorizontal: 14,
    gap: 12
  },
  memoAllCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14
  },
  memoAllHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8
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
  memoAllEmpty: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8"
  },
  memoEditorWrap: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 16
  },
  memoEditorBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  memoEditorTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0f172a"
  },
  memoEditBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  memoEditBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: ACCENT_BLUE
  },
  memoInput: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 14,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a"
  },
  inputDark: {
    backgroundColor: "#0b1220",
    borderColor: "rgba(148, 163, 184, 0.18)",
    color: "#f8fafc"
  },
  memoPaper: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eef2f7",
    padding: 14,
    minHeight: 240
  },
  paperDark: {
    backgroundColor: "#0b1220",
    borderColor: "rgba(148, 163, 184, 0.18)"
  },
  memoPaperContent: {
    flexGrow: 1
  },
  memoText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a"
  },
  memoEmpty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center"
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
    marginBottom: 8,
    position: "relative",
    width: "100%",
    height: 34
  },
  calendarHeaderLeft: {
    position: "absolute",
    left: 0,
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
    color: "#0f172a"
  },
  calendarHeaderRight: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  calendarCard: {
    flex: 1,
    marginBottom: 0,
    padding: 0,
    overflow: "hidden",
    borderColor: "#cbd5f5",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  calendarHeaderWrap: {
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 0,
    backgroundColor: "#ffffff"
  },
  calendarHeaderWrapDark: {
    backgroundColor: "#0f172a"
  },
  calendarFill: {
    paddingTop: 2,
    paddingHorizontal: 2,
    paddingBottom: 0
  },
  calendarButtonsOffset: {
    marginTop: 28
  },
  calendarTitleOffset: {
    marginTop: 28,
    marginLeft: 10,
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
    justifyContent: "center"
  },
  calendarNavButtonDark: {
    backgroundColor: "#111827",
    borderColor: "rgba(148, 163, 184, 0.20)"
  },
  calendarNavText: {
    fontSize: 18,
    fontWeight: "700",
    color: ACCENT_BLUE
  },
  calendarNavTextDark: {
    color: "#e5e7eb"
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  weekHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
    marginTop: 2,
    paddingVertical: 2,
    backgroundColor: "#f8fafc",
    borderRadius: 6
  },
  weekHeaderRowDark: {
    backgroundColor: "#111827"
  },
  weekHeaderText: {
    width: "14.285%",
    textAlign: "center",
    fontSize: 11,
    color: "#64748b",
    fontWeight: "600"
  },
  calendarGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: "#dbe3f0",
    borderTopWidth: 0
  },
  calendarGridDark: {
    borderColor: "rgba(148, 163, 184, 0.18)"
  },
  calendarCell: {
    width: "14.285%",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    padding: 4,
    alignItems: "flex-start",
    justifyContent: "flex-start"
  },
  calendarCellDark: {
    borderColor: "rgba(148, 163, 184, 0.14)"
  },
  calendarCellToday: {
    backgroundColor: "#eef2ff"
  },
  calendarCellTodayDark: {
    backgroundColor: "rgba(59, 130, 246, 0.14)"
  },
  calendarCellSelected: {
    backgroundColor: "#dbeafe"
  },
  calendarCellSelectedDark: {
    backgroundColor: "rgba(59, 130, 246, 0.22)"
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
    justifyContent: "space-between"
  },
  calendarDay: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0f172a"
  },
  calendarDayDark: {
    color: "#e5e7eb"
  },
  calendarDayToday: {
    color: ACCENT_BLUE
  },
  calendarDayTodayDark: {
    color: "#93c5fd"
  },
  calendarDaySelected: {
    color: "#1e40af"
  },
  calendarDaySelectedDark: {
    color: "#bfdbfe"
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
    marginTop: 2,
    fontSize: 8,
    fontWeight: "800",
    color: ACCENT_RED,
    lineHeight: 10,
    textAlign: "left"
  },
  calendarHolidayTextDark: {
    color: "#fca5a5"
  },
  calendarLineStack: {
    width: "100%",
    gap: 1,
    marginTop: 4
  },
  calendarLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  calendarDot: {
    width: 6,
    height: 6,
    borderRadius: 999
  },
  calendarLineText: {
    flex: 1,
    fontSize: 8,
    lineHeight: 10,
    color: "#1f2937"
  },
  calendarLineTextDark: {
    color: "#cbd5e1"
  },
  calendarMoreBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff"
  },
  calendarMoreBadgeDark: {
    borderColor: "rgba(148, 163, 184, 0.22)",
    backgroundColor: "rgba(148, 163, 184, 0.10)"
  },
  calendarMoreText: {
    fontSize: 8,
    fontWeight: "700",
    color: ACCENT_BLUE
  },
  calendarMoreTextDark: {
    color: "#e5e7eb"
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
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
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
    backgroundColor: "#2563eb"
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
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderColor: "rgba(148, 163, 184, 0.20)"
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
    backgroundColor: "rgba(148, 163, 184, 0.16)"
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
    borderBottomColor: "rgba(148, 163, 184, 0.14)"
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
    elevation: 8
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
  editorCloseText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#334155"
  },
  editorMetaRow: {
    marginTop: 10
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
  editorCategoryPillActive: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe"
  },
  editorCategoryText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#334155"
  },
  editorCategoryTextActive: {
    color: ACCENT_BLUE
  },
  editorInput: {
    marginBottom: 0
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
  editorPickerClearText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#475569"
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
  settingsSegText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748b"
  },
  settingsSegTextActive: {
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

