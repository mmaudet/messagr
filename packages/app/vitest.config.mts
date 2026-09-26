import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Colocated unit tests only. The end-to-end suite under e2e/ runs on a
    // device through Detox and Jest; picked up here it would be collected,
    // fail for want of a device, and say nothing useful.
    //
    // LE HARNAIS LUI-MÊME EST DU CODE, ET IL S'ÉPROUVE ICI.
    //
    // La coupure n'est pas le répertoire, c'est le suffixe. Detox ne ramasse
    // que `e2e/**/*.test.ts` : un `.spec.ts` posé à côté ne demande aucun
    // appareil, et c'est là que vivent les gardes du banc qu'on veut avoir vu
    // rougir avant de les confier à un émulateur. #276 est né d'une garde que
    // personne n'avait vue échouer.
    include: ['src/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  },
})
