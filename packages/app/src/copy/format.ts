/**
 * Substituting into a catalogue string.
 *
 * The placeholders are the previous product's, because the strings are: `%@`
 * for the next argument, `%1$@` and `%1$d` for a numbered one. Numbering is
 * what lets a translator reorder a sentence without the caller knowing --
 * `date_separator` is "%1$d %2$@ %3$d" in French and a different order in
 * German -- so it has to survive the conversion rather than be flattened
 * into interpolation at the call site.
 */
export function formatCopy(
  template: string,
  args: readonly (string | number)[],
): string {
  let next = 0
  return template.replace(
    /%(?:(\d+)\$)?([@d])/g,
    (whole, position: string | undefined) => {
      const index = position === undefined ? next++ : Number(position) - 1
      const value = args[index]
      // A gap left visible rather than filled with "undefined". A missing
      // argument is a defect, and a person reading the sentence should be able
      // to see that something is wrong rather than read a plausible lie.
      return value === undefined ? whole : String(value)
    },
  )
}
