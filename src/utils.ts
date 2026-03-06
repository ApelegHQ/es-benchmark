/* Copyright © 2026 Apeleg Limited. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License") with LLVM
 * exceptions; you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 * http://llvm.org/foundation/relicensing/LICENSE.txt
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Return a random number `n` such that: min <= n <= max
export function randIntInRange(min: number, max: number): number {
	if (min > max) {
		throw new RangeError('min must be <= max');
	}

	const range = max - min + 1;
	if (range <= 0) {
		// range too large to handle safely (shouldn't happen for typical JS ints)
		throw new RangeError('range is too large');
	}

	// Prefer crypto
	if (
		typeof crypto === 'object' &&
		typeof crypto.getRandomValues === 'function'
	) {
		// Determine number of bytes needed to cover the range
		const bitsNeeded = Math.ceil(Math.log2(range));
		const bytesNeeded = Math.ceil(bitsNeeded / 8);
		const maxPossible = 2 ** (bytesNeeded * 8);
		// rejection limit
		const limit = maxPossible - (maxPossible % range);

		const buf = new Uint8Array(bytesNeeded);
		// The counter is to prevent an infinite loop.
		// It's exceedingly unlikely that so many iterations will be needed.
		for (let r = 0; r < 256; r++) {
			crypto.getRandomValues(buf);
			// convert bytes to integer (big-endian)
			let val = 0;
			for (let i = 0; i < bytesNeeded; i++) {
				val = (val << 8) + buf[i];
			}
			if (val < limit) {
				// This weird form makes it easier to mock random values in tests
				return min + (range - 1 - (val % range));
			}
			// otherwise retry (rejection sampling)
		}
	}

	// Fallback to Math.random
	// (less secure, still unbiased if used with rejection)
	// The counter is to prevent an infinite loop.
	// It's exceedingly unlikely that so many iterations will be needed.
	for (let r = 0; r < 512; r++) {
		// produce a 53-bit integer from Math.random
		const val = Math.floor(Math.random() * 0x20000000000000); // 2^53
		const limit = Math.floor(0x20000000000000 / range) * range;
		if (val < limit) {
			return min + (range - 1 - (val % range));
		}
	}

	// Fallback to simple multiplcation. This means that random number
	// generation is broken or that we were extremely unlikely.
	// Since this function isn't used for cryptography, it's fine to return
	// output that might be slightly biased.
	return range - 1 - Math.floor(Math.random() * range) + min;
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffled<T>(array: readonly T[]): T[] {
	const out = [...array];
	for (let i = out.length - 1; i > 0; i--) {
		const j = randIntInRange(0, i);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
