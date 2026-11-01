/** The snapshot is resent on every stage change, so only a new set of problems gets a toast. */
export function createPipelinesConfigToastFilter(): (
  issues: ReadonlyArray<string> | null,
) => ReadonlyArray<string> | null {
  let lastKey: string | null = null;
  return (issues) => {
    if (issues === null) return null;
    const key = issues.join("\n");
    if (key === lastKey) return null;
    lastKey = key;
    return issues.length > 0 ? issues : null;
  };
}
