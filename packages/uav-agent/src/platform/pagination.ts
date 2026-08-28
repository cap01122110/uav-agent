/**
 * Paged list handling for platform list endpoints.
 *
 * The platform pages lists as { code, message, data: { list, pagination } }
 * with pagination: { page, page_size, total }. Continuation is decided from
 * the platform's own pagination numbers, never from "did the page look full".
 *
 * Consistency is anchored to the first page: pageSize and total captured at
 * page 1 become the baseline for the whole logical scan, and every later
 * page must echo them exactly. A page whose pageSize or total differs, a
 * response pageSize that differs from the one requested, a page other than
 * the one requested, or a scan exceeding MAX_PAGES all throw
 * INVALID_RESPONSE, so a caller like the preflight check fails closed
 * instead of treating an incomplete or shifting scan as "nothing found".
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
 * (>= 1) and total (>= 0). `expectedPageSize` is the page size this client
 * requested; a platform echoing a different span is a contract violation.
 */
export function validatePagedList(data: unknown, context: string, expectedPageSize: number): PagedListPayload {
	const record = requireRecord(data, `${context}.data`);
	const items = requireArray(record.list, `${context}.data.list`);
	const pagination = requireRecord(record.pagination, `${context}.data.pagination`);
	const pageSize = requireInteger(pagination.page_size, `${context}.data.pagination.page_size`, 1);
	if (pageSize !== expectedPageSize) {
		throw invalidResponse(`${context}.data.pagination.page_size (got ${pageSize}, requested ${expectedPageSize})`);
	}
	return {
		items,
		pagination: {
			page: requireInteger(pagination.page, `${context}.data.pagination.page`, 1),
			pageSize,
			total: requireInteger(pagination.total, `${context}.data.pagination.total`, 0),
		},
	};
}

/**
 * Walk every page of a platform list. `expectedPageSize` is the size this
 * caller requested on every page. Returns true when `visit` stopped early
 * (match found) and false only after pagination confirmed the scan covered
 * `total` items under a stable pageSize/total baseline. Throws on any page
 * failure or pagination inconsistency - it never resolves false for an
 * incomplete or shifting scan.
 */
export async function iteratePagedList(
	context: string,
	expectedPageSize: number,
	loadPage: (page: number) => Promise<PagedListPayload>,
	visit: (item: unknown) => boolean,
): Promise<boolean> {
	let baselinePageSize: number | undefined;
	let baselineTotal: number | undefined;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { items, pagination } = await loadPage(page);
		if (pagination.page !== page) {
			throw invalidResponse(`${context}.data.pagination.page (got ${pagination.page}, requested ${page})`);
		}
		// The server must echo the requested span; a different page_size is a
		// contract violation and a different complete scan than the request.
		if (pagination.pageSize !== expectedPageSize) {
			throw invalidResponse(
				`${context}.data.pagination.page_size (got ${pagination.pageSize}, requested ${expectedPageSize})`,
			);
		}
		// The scan must not drift: page 1 fixes pageSize/total, later pages
		// must echo them exactly. A shifting data set cannot be proven complete.
		if (baselinePageSize === undefined) {
			baselinePageSize = pagination.pageSize;
			baselineTotal = pagination.total;
		} else {
			if (pagination.pageSize !== baselinePageSize) {
				throw invalidResponse(
					`${context}.data.pagination.page_size changed (page ${page}: ${pagination.pageSize}, baseline ${baselinePageSize})`,
				);
			}
			if (pagination.total !== baselineTotal) {
				throw invalidResponse(
					`${context}.data.pagination.total changed (page ${page}: ${pagination.total}, baseline ${baselineTotal})`,
				);
			}
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
	expectedPageSize: number,
	loadPage: (page: number) => Promise<PagedListPayload>,
): Promise<unknown[]> {
	const items: unknown[] = [];
	await iteratePagedList(context, expectedPageSize, loadPage, (item) => {
		items.push(item);
		return false;
	});
	return items;
}
