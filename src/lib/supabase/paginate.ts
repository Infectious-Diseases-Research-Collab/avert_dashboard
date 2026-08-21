export type PageResult<Row> =
  | { data: Row[]; error: null }
  | { data: null; error: { message: string } };

/**
 * Page through a Supabase/PostgREST query with `.range()`.
 *
 * PostgREST enforces a server-side "Max Rows" cap (this project's is ~1,000)
 * on every response regardless of a client-side `.limit()` — a `.limit(20000)`
 * still comes back truncated at the server cap. The only reliable way to get
 * every row is to request it in `.range()`-sized pages, same as fetchVillages
 * originally worked around for the villages table.
 *
 * `buildQuery(from, to)` must return a fresh query each call (query builders
 * are single-use) with `.range(from, to)` applied.
 */
export async function fetchAllRows<Row>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize = 1000,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
