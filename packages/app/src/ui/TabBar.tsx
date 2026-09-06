import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'
import { TabIcon, type TabGlyph } from './TabIcon'

/**
 * The four tabs.
 *
 * # Why Appels is here before calls are
 *
 * Its own screen says it: *« L'onglet est réservé dès la V1 pour ne pas
 * déplacer la barre plus tard. »* That is a different rule from the one
 * `Settings` follows, and the two must not be confused. A switch that toggles
 * nothing lies about a capability. A reserved tab that says it is reserved is
 * a promise with a date on it, and it buys something real: a navigation bar
 * that does not move under people's thumbs the day calls arrive.
 *
 * # Green, and the one place it is a judgement call
 *
 * `green500`'s own token says what it is for: *"Humain et vérifié. Action
 * principale, accusé de lecture, marque."* The active tab is the brand and
 * the floating action is the principal action, so both are squarely inside
 * it. The unread badge is the one that is not obviously any of the four, and
 * it is green because the mockup draws it green — recorded here rather than
 * smuggled, so that whoever revisits invariant 3 knows where to look.
 */

export type Tab = 'chat' | 'community' | 'calls' | 'settings'

const TABS: readonly {
  readonly tab: Tab
  readonly glyph: TabGlyph
  readonly label: CopyKey
}[] = [
  { tab: 'chat', glyph: 'chat', label: 'tab_discussions' },
  { tab: 'community', glyph: 'community', label: 'tab_communities' },
  { tab: 'calls', glyph: 'calls', label: 'tab_calls' },
  { tab: 'settings', glyph: 'settings', label: 'tab_settings' },
]

export interface TabBarProps {
  readonly current: Tab
  readonly onSelect: (tab: Tab) => void
  /** Unread conversations, shown as a count on the first tab. */
  readonly unread?: number
  /** Something waiting under Communautés, shown as a dot rather than a count. */
  readonly communityWaiting?: boolean
}

export function TabBar({
  current,
  onSelect,
  unread = 0,
  communityWaiting = false,
}: TabBarProps) {
  return (
    <View style={styles.bar} testID="tab-bar">
      {TABS.map(({ tab, glyph, label }) => {
        const active = tab === current
        const tint = active ? color.brand.green700 : color.neutral['600']
        return (
          <Pressable
            key={tab}
            testID={`tab-${tab}`}
            onPress={() => onSelect(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(label)}
            style={styles.tab}>
            <View style={[styles.pill, active && styles.pillActive]}>
              <TabIcon glyph={glyph} tint={tint} />
              {tab === 'chat' && unread > 0 && (
                <View style={styles.badge} testID="tab-unread">
                  <Text style={styles.badgeCount}>{unread}</Text>
                </View>
              )}
              {tab === 'community' && communityWaiting && (
                // A dot, not a count. Nothing here counts anything yet, and a
                // number invented to fill a shape is worse than a mark that
                // only says "something".
                <View style={styles.dot} testID="tab-community-dot" />
              )}
            </View>
            <Text style={[styles.label, { color: tint }]}>{t(label)}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.surface.paper,
    paddingTop: space.s,
    paddingBottom: space.s,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    // The glyph is 20 and the target is 44: the size of the glyph is never
    // the size of the button, which is the icon token's own rule.
    minHeight: floors.touchTargetMin,
    gap: space.xs,
  },
  pill: {
    paddingHorizontal: space.l,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  pillActive: {
    backgroundColor: color.brand.green100,
  },
  label: type.caption,
  badge: {
    position: 'absolute',
    top: 0,
    right: space.s,
    minWidth: space.l,
    height: space.l,
    borderRadius: radius.pill,
    backgroundColor: color.brand.green500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: {
    ...type.monoLabel,
    color: color.brand.ink900,
  },
  dot: {
    position: 'absolute',
    top: space.xs,
    right: space.m,
    width: space.s,
    height: space.s,
    borderRadius: radius.pill,
    backgroundColor: color.brand.green500,
  },
})
