/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  testTimeout: 180000,
  maxWorkers: 1,
  // L'ORDRE DES FICHIERS EST UNE EXIGENCE, PAS UN EFFET DE LEUR TAILLE.
  // Sans ceci, Jest les trie par nombre d'octets et le banc dépendait de
  // deux nombres que personne ne lisait. `sequencer.js` dit lequel, et
  // pourquoi.
  testSequencer: '<rootDir>/e2e/sequencer.js',
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/e2e/tsconfig.json' }],
  },
  verbose: true,
}
