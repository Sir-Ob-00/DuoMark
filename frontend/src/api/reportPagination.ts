export interface PageMetadata { page: number; limit: number; total: number; totalPages: number }
export interface ItemPage<T> { items: T[]; pagination: PageMetadata }

// CSV creation must happen only after this resolves. Never export a visible page
// as "all rows", silently deduplicate shifting pages, or ignore failed pages.
export async function collectAllAuthorizedPages<T extends { id: string | number }>(loadPage: (page: number) => Promise<ItemPage<T>>): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string | number>();
  let expected: PageMetadata | undefined;
  for (let page = 1; ; page++) {
    const result = await loadPage(page);
    const meta = result.pagination;
    if (!meta || !Array.isArray(result.items) || ![meta.page, meta.limit, meta.total, meta.totalPages].every(Number.isSafeInteger) ||
        meta.page !== page || meta.limit < 1 || meta.total < 0 || meta.totalPages !== Math.ceil(meta.total / meta.limit) || meta.totalPages > 10000) {
      throw new Error('Invalid report pagination; CSV was not created.')
    }
    if (expected && (meta.total !== expected.total || meta.totalPages !== expected.totalPages || meta.limit !== expected.limit)) {
      throw new Error('The report changed while loading. Refresh and retry the export.')
    }
    expected ??= meta;
    const expectedCount = Math.max(0, Math.min(meta.limit, meta.total - (page - 1) * meta.limit));
    if (result.items.length !== expectedCount) throw new Error('Incomplete report page; CSV was not created.')
    for (const row of result.items) {
      if (!row || (typeof row.id !== 'string' && typeof row.id !== 'number') || seen.has(row.id)) throw new Error('Report pages shifted or repeated. Refresh and retry the export.')
      seen.add(row.id);
      rows.push(row);
    }
    if (page >= meta.totalPages) return rows;
  }
}
