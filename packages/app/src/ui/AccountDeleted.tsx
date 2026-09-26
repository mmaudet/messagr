import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, layout, space, type } from '../design/tokens'

/**
 * The whole screen once the account is deleted, and nothing beside it. #382.
 *
 * Its server has deactivated it, so nothing underneath can be used: a list
 * drawn from that account is a list of conversations nobody can open any
 * more. What this device keeps of it is forgotten at the next cold launch,
 * because the crypto library does not release a running machine -- hence the
 * one thing left to do, which the second sentence asks for. The application
 * does not close itself.
 */
export function AccountDeleted() {
  return (
    <SafeAreaView style={styles.ground} testID="account-deleted">
      <View style={styles.content}>
        <Text style={styles.title}>{t('deleted_title')}</Text>
        <Text style={styles.body}>{t('deleted_body')}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: color.surface.paper },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    gap: space.m,
  },
  title: { ...type.titleLg, color: color.neutral['900'] },
  body: { ...type.body, color: color.neutral['600'] },
})
