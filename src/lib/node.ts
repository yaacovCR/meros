import type { Readable } from 'stream';
import type { Arrayable, Options, Part } from './types';

const separator = '\r\n\r\n';

export async function* generate<T>(
	stream: Readable,
	boundary: string,
	options?: Options,
): AsyncGenerator<Arrayable<Part<T, Buffer>>> {
	const is_eager = !options || !options.multiple;


	let len_boundary = Buffer.byteLength(boundary),
		buffer = Buffer.alloc(0),
		is_preamble = true,
		payloads = [];

	outer: for await (const chunk of stream) {
		let idx_boundary = buffer.byteLength;
		buffer = Buffer.concat([buffer, chunk]);
		const idx_chunk = (chunk as Buffer).indexOf(boundary);

		if (!!~idx_chunk) {
			// chunk itself had `boundary` marker
			idx_boundary += idx_chunk;
		} else {
			// search combined (boundary can be across chunks)
			idx_boundary = buffer.indexOf(boundary);
		}

		payloads = [];
		while (!!~idx_boundary) {
			const current = buffer.slice(0, idx_boundary);
			const next = buffer.slice(idx_boundary + len_boundary);

			if (is_preamble) {
				is_preamble = false;
				boundary = '\r\n' + boundary;
				len_boundary += 2;
			} else {
				const headers: Record<string, string> = {};
				const idx_headers = current.indexOf(separator);
				const arr_headers = buffer.slice(0, idx_headers).toString().trim().split(/\r\n/);

				// parse headers
				let tmp;
				while (tmp = arr_headers.shift()) {
					tmp = tmp.split(': ');
					headers[tmp.shift()!.toLowerCase()] = tmp.join(': ');
				}

				const last_idx = current.lastIndexOf('\r\n', idx_headers + separator.length);

				let body: T | Buffer = current.slice(idx_headers + separator.length, last_idx > -1 ? undefined : last_idx);
				let is_json = false;

				tmp = headers['content-type'];
				if (tmp && !!~tmp.indexOf('application/json')) {
					try {
						body = JSON.parse(body.toString()) as T;
						is_json = true;
					} catch (_) {
					}
				}

				tmp = { headers, body, json: is_json } as Part<T, Buffer>;
				is_eager ? yield tmp : payloads.push(tmp);

				// hit a tail boundary, break
				if (next.slice(0, 2).toString() === '--') break outer;
			}

			buffer = next;
			idx_boundary = buffer.indexOf(boundary);
		}

		if (payloads.length) yield payloads;
	}

	if (payloads.length) yield payloads;
}
