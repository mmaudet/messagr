// ESLint for the whole workspace, in one flat config.
//
// One config rather than one per package: two would drift apart with nothing
// checking that they had not, and the packages here are all React Native code
// or tooling around it.
import reactNative from '@react-native/eslint-config/flat'
import prettier from 'eslint-config-prettier'

// @react-native/eslint-config parses `**/*.js` with @babel/eslint-parser and
// runs eslint-plugin-ft-flow over the result, because the React Native
// template's .js files are Flow. This workspace has none: it is TypeScript
// throughout, and its .js files are CommonJS tool configs.
//
// The entry has to be removed rather than quietened. eslint-plugin-ft-flow
// 2.0.3 declares a peer of eslint ^8.1.0 and means it: under ESLint 9 it stops
// hard on the first .js file with `TypeError: context.getAllComments is not a
// function`. Matched on the plugin rather than an array index, so a React
// Native upgrade that reorders its config cannot silently reinstate it.
const withoutFlow = reactNative.filter(entry => !entry.plugins?.['ft-flow'])

export default [
  {
    // An object carrying `ignores` and nothing else sets the global ignore
    // list. Any other key would make it an ordinary per-file override, and
    // these paths would still be linted.
    ignores: [
      'node_modules/',
      '**/node_modules/',

      // The React Native template's native projects and build outputs.
      'packages/app/ios/',
      'packages/app/android/',
      '**/build/',
      '**/Pods/',

      // The designer's export. Generated rendering engines with no
      // specification value, and prototypes that are not source.
      'design/',
    ],
  },

  ...withoutFlow,

  // eslint-config-prettier last, deliberately. @react-native/eslint-config
  // applies it too, but as the first element of its array, so any stylistic
  // rule its later entries switch back on would be live again.
  prettier,
]
