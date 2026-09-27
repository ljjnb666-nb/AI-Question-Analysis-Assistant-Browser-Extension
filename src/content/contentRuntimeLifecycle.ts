/** Runtime-local authority shared by asynchronous content-script continuations. */
export type ContentRuntimeGeneration = {
  generation: number;
  isCurrent: () => boolean;
  invalidate: () => boolean;
};

let nextGeneration = 0;
let activeGeneration = 0;

export function beginContentRuntimeGeneration(): ContentRuntimeGeneration {
  const generation = ++nextGeneration;
  let invalidated = false;
  activeGeneration = generation;

  return {
    generation,
    isCurrent: () => !invalidated && activeGeneration === generation,
    invalidate: () => {
      if (invalidated) return false;
      invalidated = true;
      if (activeGeneration === generation) activeGeneration = 0;
      return true;
    },
  };
}

/** Read-only lifecycle seam for deterministic tests. */
export function activeContentRuntimeGeneration(): number | null {
  return activeGeneration || null;
}
