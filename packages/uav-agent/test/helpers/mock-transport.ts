import { mapHttpStatus, PlatformError } from "../../src/platform/errors.ts";
import type { HttpTransport, TransportRequestOptions } from "../../src/platform/transport.ts";

/** Scripted transport: queues responses in order; >=400 becomes a PlatformError. */
export class MockTransport implements HttpTransport {
	calls: TransportRequestOptions[] = [];
	responses: Array<{ status: number; body: unknown }> = [];

	async request<T>(options: TransportRequestOptions): Promise<T> {
		this.calls.push(options);
		const response = this.responses.shift();
		if (response === undefined) {
			throw new Error("No mock response queued");
		}
		if (response.status >= 400) {
			// Mirror the real transport's status mapping so tests can assert the
			// exact error category (403 -> PERMISSION_DENIED, 504 -> timeout...).
			const code = mapHttpStatus(response.status) ?? "UNKNOWN_ERROR";
			throw new PlatformError(
				{ code, message: `HTTP ${response.status}`, retryable: false },
				{ status: response.status },
			);
		}
		return response.body as T;
	}
}

/** Standard platform success envelope. */
export function envelope(data: unknown): unknown {
	return { code: 0, message: "success", data };
}

/** A paged list payload following the real platform contract. */
export function listPage(items: unknown[], page: number, pageSize: number, total: number): unknown {
	return envelope({ list: items, pagination: { page, page_size: pageSize, total } });
}
