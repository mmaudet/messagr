import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Colocated unit tests only. The end-to-end suite under e2e/ runs on a
    // device through Detox and Jest; picked up here it would be collected,
    // fail for want of a device, and say nothing useful.
    include: ['src/**/*.spec.ts'],
  },
})
