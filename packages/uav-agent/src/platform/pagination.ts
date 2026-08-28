/**
 * Paged list handling for platform list endpoints.
 *
 * The platform pages lists as { code, message, data: { list, pagination } }
 * with pagination: { page, page_size, total }. Continuation is decided from
 * the platform's own pagination numbers, never from "did the page look full".
 *
 * Any inconsistency - missing or illegal pagination, a page other than the
 * one requested, total contradicting the rows read, or a scan exceeding
 * MAX_PAGES - throws INVALID_RESPONSE, so a caller like the preflight check
 * fails closed instead of treating an incomplete scan as "nothing found".
 */

import { invalidResponse, requireArray, requireInteger, requireRecord } from "./validation.ts";

export interface PlatformPagination {
	/** 1-based page index, as echoed by the platform. */
	page: number;
	pageSize: number;
	total: number;
}

export interface PagedListPayload {
	items: unknown[];
	pagination: PlatformPagination;
}

/** Upper bound on pages per logical scan; a scan needing more is invalid. */
export const MAX_PAGES = 100;

/**
 * Validate one list-endpoint payload: data must be a record with a `list`
 * array and a `pagination` record carrying integer page (>= 1), page_size
 * (>= 1) and total (>= 0).
 */
export function requirePagedList(data: unknown, context: string): PagedListPayload {
	const record = requireRecord(data, `${context}.data`);
	const items = requireArray(record.list, `${context}.data.list`);
	const pagination = requireRecord(record.pagination, `${context}.data.pagination`);
	return {
		items,
		pagination: {
			page: requireInteger(pagination.page, `${context}.data.pagination.page`, 1),
			pageSize: requireInteger(pagination.page_size, `${context}.data.pagination.page_size`, 1),
			total: requireInteger(pagination.total, `${context}.data.pagination.total`, 0),
		},
	};
}

/**
 * Walk every page of a platform list. `visit` runs per item; return true to
 * stop early (match found). Resolves true when a visit stopped early; false
 * only after pagination confirmed the scan covered `total` items. Throws on
 * any page failure or pagination inconsistency - it never resolves false for
 * an incomplete scan.
 */
export async function iteratePagedList(
	context: string,
	loadPage: (page: number) => Promise<PagedListPayload>,
	visit: (item: unknown) => boolean,
): Promise<boolean> {
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { items, pagination } = await loadPage(page);
		if (pagination.page !== page) {
			throw invalidResponse(`${context}.data.pagination.page (got ${pagination.page}, requested ${page})`);
		}
		if (items.length > pagination.pageSize) {
			throw invalidResponse(`${context}.data.list (page ${page} returned more items than page_size)`);
		}
		// Every page before the last must be full and the last page must carry
		// the exact remainder; anything else means total contradicts the rows.
		const expected = Math.min(pagination.pageSize, Math.max(0, pagination.total - (page - 1) * pagination.pageSize));
		if (items.length !== expected) {
			throw invalidResponse(
				`${context}.data.list (total ${pagination.total} contradicts ${items.length} items on page ${page})`,
			);
		}
		for (const item of items) {
			if (visit(item)) return true;
		}
		if (page * pagination.pageSize >= pagination.total) return false;
	}
	throw invalidResponse(`${context}.data.pagination (exceeded ${MAX_PAGES} pages)`);
}

/** Collect every item of a paged list; throws on incomplete or inconsistent scans. */
export async function collectPagedList(
	context: string,
	loadPage: (page: number) => Promise<PagedListPayload>,
): Promise<unknown[]> {
	const items: unknown[] = [];
	await iteratePagedList(context, loadPage, (item) => {
		items.push(item);
		return false;
	});
	return items;
}
