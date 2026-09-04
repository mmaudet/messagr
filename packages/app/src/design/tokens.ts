// GENERATED FROM design/tokens.json -- DO NOT EDIT.
//
// Regenerate with `yarn tokens`. Continuous integration runs
// `yarn tokens:check`, so a stale copy of this file fails the build rather
// than drifting quietly away from the design it claims to carry.
//
// Source: Messagr Prototype V3.dc.html, tokens v3.1.0

/**
 * The spacing scale. Every margin, padding and gap comes from here.
 *
 * Aucune valeur intermédiaire (6, 10, 14, 18, 20, 28). Un besoin non couvert est une erreur de composition, pas un token manquant.
 */
export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
} as const

/**
 * Palette normative. Aucune couleur hors de cette liste ne doit apparaître dans le produit.
 */
export const color = {
  brand: {
    green500: '#12b76a', // Humain et vérifié. Action principale, accusé de lecture, marque.
    green700: '#0e8f63', // Même sémantique sur fond clair : texte, bordure, lien.
    green100: '#eef8f2', // Surface vérifiée : fond d'étiquette, bulle sortante claire.
    ink900: '#0c1f19', // Fond des frontières de sécurité, texte fort.
  },
  agent: {
    '100': '#efeae0', // Surface agent, fiche de capacités.
    '400': '#918a7c', // Agent sur fond sombre, contraste 4.6:1 sur ink900 (WCAG AA texte).
    '700': '#3a3630', // Encre agent sur fond clair.
    border: '#b0a99b', // Pointillé agent. Jamais un état désactivé. Géométrie : voir stroke.agentDotted.
  },
  wait: {
    '100': '#faf1d8', // Surface : bandeau hors ligne, brouillon d'agent.
    '200': '#ecdcae', // Bordure.
    '500': '#c9a94a', // Marqueur, point d'état, envoi différé.
    '700': '#8a6d1f', // Texte : en attente d'un geste humain ou du réseau.
  },
  deny: {
    '100': '#faeded', // Surface de mesure.
    '200': '#e6c3c3', // Bordure de mesure.
    '500': '#a13b3b', // Action de mesure. Jamais un avertissement.
    '700': '#7d3434', // Texte de mesure : suspension, révocation, refus.
  },
  neutral: {
    '200': '#e4dfd4', // Séparateur, bordure de liste, plaque inerte (voir state.disabled).
    '300': '#d5cfc3', // Contrôle inactif. Seul gris de désactivation autorisé.
    '400': '#a8a196', // Texte tertiaire, placeholder.
    '600': '#6b665c', // Texte secondaire.
    '900': '#1b1a19', // Texte principal.
  },
  surface: {
    paper: '#fbf8f3', // Fond d'écran clair par défaut.
    sunk: '#f2efe8', // Fond de conversation.
    raised: '#ffffff', // Bulle entrante, champ de saisie.
  },
  dark: {
    brand: undefined,
    agent: undefined,
    wait: undefined,
    deny: undefined,
    neutral: undefined,
    surface: undefined,
  },
} as const

/**
 * The type ramp, as React Native styles rather than as design values:
 * spread one into a style and the size, leading, weight and tracking travel
 * together. Splitting them is how a line-height floor gets broken.
 */
export const type = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.9,
  },
  titleLg: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    letterSpacing: -0.44,
  },
  titleMd: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  body: {
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '400',
  },
  bodySm: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },
  caption: {
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '400',
  },
  monoLabel: {
    fontSize: 9.5,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 1.33,
    textTransform: 'uppercase',
  },
  monoId: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '400',
  },
} as const

/**
 * Corner radii.
 */
export const radius = {
  bubble: 16,
  bubbleAuthorCorner: 4,
  pill: 26,
  avatar: '50%',
} as const

/**
 * Épaisseurs de trait. Échelle fine : le produit se tient par les valeurs de surface et les séparateurs, pas par des contours épais.
 */
export const stroke = {
  hairline: {
    value: 1,
    unit: 'px',
    color: '#e4dfd4',
  },
  base: 1,
  accent: 1.5,
  agentDotted: {
    width: 1.5,
    unit: 'px',
    color: '#b0a99b',
    dash: 3,
    gap: 3,
    linecap: 'butt',
    css: '1.5px dashed',
    svg: 'stroke-width:1.5; stroke-dasharray:3 3',
    reactNative:
      "borderWidth: 1.5, borderStyle: 'dashed' — le motif natif n'est pas paramétrable : dessiner la bordure en SVG dès que le rendu doit être exact.",
  },
} as const

/**
 * SVG monochrome sur grille 24, currentColor. Aucune icône ne porte de couleur propre.
 */
export const icon = {
  grid: 24,
  strokeWidth: 1.5,
  linecap: 'round',
  linejoin: 'round',
  size: {
    sm: 16,
    md: 20,
    lg: 24,
  },
} as const

/**
 * Entaille à 45°, accent réservé aux boutons, cartes et marqueurs d'agent.
 */
export const notch = {
  button: {
    size: 16,
    corner: 'top-right',
  },
  card: {
    size: 22,
    corner: 'top-right',
  },
  agent: {
    size: '32%',
    corner: 'bottom-right',
  },
} as const

/**
 * Shadows, translated from CSS into the four properties React Native
 * wants plus the Android depth.
 *
 * En sombre, l'ombre ne porte plus la hiérarchie : garder elevation.modal (l'assombrissement reste lisible) et remplacer 1 et 2 par un trait hairline en dark.neutral.200 plus la valeur de surface supérieure.
 */
export const elevation = {
  '1': {
    shadowColor: '#0c1f19',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowRadius: 1,
    shadowOpacity: 0.07,
    elevation: 1,
  },
  '2': {
    shadowColor: '#0c1f19',
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowRadius: 28,
    shadowOpacity: 0.06,
    elevation: 7,
  },
  modal: {
    shadowColor: '#0c1f19',
    shadowOffset: {
      width: 0,
      height: 30,
    },
    shadowRadius: 70,
    shadowOpacity: 0.32,
    elevation: 18,
  },
} as const

/**
 * Ordre d'empilement unique. Un seul calque par palier — deux surfaces au même niveau est un défaut de composition.
 */
export const zIndex = {
  base: 0,
  drawer: 10,
  sheet: 20,
  modal: 30,
  call: 40,
  toast: 50,
} as const

/**
 * Durations and easings.
 */
export const motion = {
  enter: {
    duration: 450,
    easing: 'ease-out',
    translateY: 8,
  },
  toggle: {
    duration: 180,
    easing: 'ease',
  },
  scan: {
    duration: 1900,
    easing: 'ease-in-out',
    direction: 'alternate',
  },
} as const

/**
 * Layout geometry, with $refs resolved.
 */
export const layout = {
  mobileMax: 430,
  touchTargetMin: 44,
  screenGutter: 16,
  desktopBase: {
    width: 900,
    height: 600,
  },
  desktopWide: {
    min: 1180,
  },
  desktopNarrow: {
    max: 780,
  },
  tablet: {
    status: 'non traité en V1',
  },
} as const

/**
 * The contractual minimums, checked against the tokens above when this
 * module is generated. They are exported so a component can assert one it
 * cannot inherit -- a touch target's height is geometry, not a token.
 */
export const floors = {
  bodySizeMin: 11.5,
  monoSizeMin: 9.5,
  lineHeightRatioMin: 1.35,
  titleLineHeightRatioMin: 1.2,
  touchTargetMin: 44,
  spaceScaleOnly: true,
} as const
