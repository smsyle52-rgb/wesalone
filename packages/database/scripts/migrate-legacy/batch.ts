// Split a large array into fixed-size chunks so bulk rows go to the DB as a
// handful of multi-row INSERTs instead of thousands of single-row round-trips
// over the (occasionally flaky) Cloud SQL proxy tunnel — far faster and far
// less exposed to a mid-run connection drop.
export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export const BATCH_SIZE = 500
