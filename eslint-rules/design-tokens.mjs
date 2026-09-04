// A lint that makes interface invariant 11 a rule rather than a sentence:
// no colour, spacing, radius, elevation, duration or type value may appear in
// this application unless it came from design/tokens.json.
//
// # Why literals are refused rather than checked
//
// It is tempting to allow a literal that happens to equal a token -- `24` is
// `space.xl` after all. That check passes today and rots tomorrow: the token
// moves, the literal does not, and nothing connects them. Worse, it teaches
// that the number is the truth when the name is. So the rule is about
// provenance, not equality, which is also what the token file asks for in as
// many words: "Le lint rejette les littéraux."
//
// # Why the floors are not re-checked here
//
// They are checked where a violation could enter, which is generation: a
// token below its own floor never reaches this file. Requiring provenance
// here is what makes that check binding on the application. The one floor
// that cannot work that way is `touchTargetMin`, because a touch target's
// height is geometry rather than a token -- it is exported from the
// generated module so a component can assert it.

/** Every property whose value carries a colour. */
const COLOUR = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'shadowColor',
  'textShadowColor',
  'tintColor',
  'overlayColor',
  'placeholderTextColor',
])

/** Every property whose value is a distance from the spacing scale. */
const SPACING = new Set([
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginHorizontal',
  'marginVertical',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingHorizontal',
  'paddingVertical',
  'gap',
  'rowGap',
  'columnGap',
])

const RADIUS = new Set([
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
])

const TYPE = new Set([
  'fontSize',
  'lineHeight',
  'fontWeight',
  'letterSpacing',
  'textTransform',
])

/**
 * Stroke widths. A border is a design value like any other, and the token
 * file has a family for it -- a `borderWidth: 1` written in place looked
 * innocent enough to slip past the first version of this rule.
 */
const STROKE = new Set([
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
])

const ELEVATION = new Set([
  'shadowOpacity',
  'shadowRadius',
  'shadowOffset',
  'elevation',
])

const FAMILIES = [
  [COLOUR, 'color', 'a colour'],
  [SPACING, 'space', 'a spacing value'],
  [RADIUS, 'radius', 'a corner radius'],
  [TYPE, 'type', 'a type value'],
  [STROKE, 'stroke', 'a stroke width'],
  [ELEVATION, 'elevation', 'an elevation'],
]

const familyFor = name => FAMILIES.find(([props]) => props.has(name))

/**
 * A value is allowed when it can be traced back to the generated module: a
 * member expression (`space.xl`, `type.body.fontSize`), a spread of one, or
 * an identifier bound to one. Anything spelled out in place is not.
 *
 * `undefined` and `null` pass: clearing a property inherited from another
 * style is not a design value.
 */
function isLiteralValue(node) {
  if (node === null || node === undefined) return false
  if (node.type === 'Literal') return node.value !== null
  if (node.type === 'UnaryExpression' && node.argument.type === 'Literal') {
    // `-4` parses as a negation of a literal, not as a literal.
    return true
  }
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0
  if (node.type === 'ObjectExpression') {
    // `shadowOffset: { width: 0, height: 1 }` -- a shape, not a token.
    return true
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require design values to come from the generated token module',
    },
    schema: [],
    messages: {
      literal:
        '{{what}} written in place. Interface invariant 11 allows only values from design/tokens.json: import `{{family}}` from the generated token module and name the one you mean.',
    },
  },

  create(context) {
    /**
     * Style objects are reached from the two places a style can be written:
     * `StyleSheet.create` and a `style` prop. Recognising them by their
     * position rather than by a variable named `styles`, which is a
     * convention and not a guarantee.
     */
    function checkObject(node) {
      for (const property of node.properties) {
        if (property.type !== 'Property') continue
        const name =
          property.key.type === 'Identifier'
            ? property.key.name
            : property.key.type === 'Literal'
              ? String(property.key.value)
              : null
        if (name === null) continue

        const family = familyFor(name)
        if (family !== undefined && isLiteralValue(property.value)) {
          context.report({
            node: property.value,
            messageId: 'literal',
            data: { what: family[2], family: family[1] },
          })
          continue
        }

        // A nested object is either a named style inside StyleSheet.create or
        // a shape like shadowOffset; recursing covers both, and the shape's
        // own properties are not in any family.
        if (
          property.value.type === 'ObjectExpression' &&
          family === undefined
        ) {
          checkObject(property.value)
        }
      }
    }

    return {
      // StyleSheet.create({ ... })
      'CallExpression[callee.object.name="StyleSheet"][callee.property.name="create"]'(
        node,
      ) {
        const [argument] = node.arguments
        if (argument?.type === 'ObjectExpression') {
          checkObject(argument)
        }
      },

      // style={{ ... }} and style={[a, { ... }]}
      'JSXAttribute[name.name="style"]'(node) {
        const expression = node.value?.expression
        if (expression === undefined) return
        if (expression.type === 'ObjectExpression') {
          checkObject(expression)
        } else if (expression.type === 'ArrayExpression') {
          for (const element of expression.elements) {
            if (element?.type === 'ObjectExpression') checkObject(element)
          }
        }
      },
    }
  },
}

export default { rules: { 'tokens-only': rule } }
