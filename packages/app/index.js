/**
 * @format
 */

import { AppRegistry } from 'react-native'

// Ordering is load-bearing. The bootstrap patches the runtime, and App pulls
// in matrix-js-sdk, which reaches for crypto.getRandomValues while it is being
// constructed. `require` rather than `import` for App because ES imports are
// hoisted: written as an import it would be evaluated before this line.
import './src/runtime/bootstrap'

import { name as appName } from './app.json'

const { App } = require('./App')

AppRegistry.registerComponent(appName, () => App)
