// Ce qu'il faut pour charger un module de l'application sous Node.
//
// Les outils de l'exploitant ne recopient ni le HPKE de l'application ni le
// format d'un signalement : ils chargent `hpke.ts`, `reportFormat.ts` et
// `operatorKey.ts` tels quels, et Node 22.22 retire lui-même les types. Ces
// trois fichiers n'importent rien sans son extension, ce que Node ne résout
// pas : c'est pour ça qu'ils sont écrits ainsi.
//
// # L'avertissement qui ne dit pas vrai ici
//
// `packages/app/package.json` ne déclare pas de `type`, et Node prévient à
// chaque chargement qu'il relit ces fichiers comme des modules ES, en
// conseillant d'y ajouter `"type": "module"`. Le suivre casserait la
// configuration de Metro et de Babel de l'application, qui sont en CommonJS.
// Ce seul avertissement-là se tait donc ; tous les autres passent.
//
// Il doit se taire AVANT que le module ne soit chargé, ce qui impose aux
// outils d'importer leur bibliothèque par `await import(...)` après l'appel :
// un import statique est résolu avant que la moindre ligne ne s'exécute.

/** Tait l'avertissement des modules sans `type`, et lui seul. */
export function quietAboutTypelessModules() {
  const printers = process.listeners('warning')
  process.removeAllListeners('warning')
  process.on('warning', warning => {
    if (warning.code === 'MODULE_TYPELESS_PACKAGE_JSON') return
    for (const print of printers) print(warning)
  })
}
