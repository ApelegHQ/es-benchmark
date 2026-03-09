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

// ── Descriptive statistics ──────────────────────────────────────────────

export function mean(values: readonly number[]): number {
	if (values.length === 0) return NaN;
	return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: readonly number[]): number {
	if (values.length === 0) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0
		? sorted[mid]
		: (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample variance (Bessel-corrected, $n - 1$ denominator). */
export function variance(values: readonly number[]): number {
	if (values.length < 2) return NaN;
	const avg = mean(values);
	return values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
}

/** Sample standard deviation ($\sqrt{\text{variance}}$). */
export function stdDev(values: readonly number[]): number {
	return Math.sqrt(variance(values));
}

/** Standard error of the mean: $s / \sqrt{n}$. */
export function sem(values: readonly number[]): number {
	if (values.length < 2) return NaN;
	return stdDev(values) / Math.sqrt(values.length);
}

export function min(values: readonly number[]): number {
	if (values.length === 0) return NaN;
	return values.reduce((a, b) => Math.min(a, b), Infinity);
}

export function max(values: readonly number[]): number {
	if (values.length === 0) return NaN;
	return values.reduce((a, b) => Math.max(a, b), -Infinity);
}

/**
 * Linear-interpolation percentile (same algorithm as NumPy's default).
 * @param p Percentile in `[0, 100]`.
 */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	if (p <= 0) return sorted[0];
	if (p >= 100) return sorted[sorted.length - 1];
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	const frac = idx - lo;
	return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Trimmed mean — discards the bottom and top `fraction` of sorted values.
 * @param fraction Fraction to remove from *each* end (`0`–`0.5`). Default `0.1`.
 */
export function trimmedMean(values: number[], fraction: number = 0.1): number {
	if (values.length === 0) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const n = Math.floor(sorted.length * fraction);
	const trimmed = sorted.slice(n, sorted.length - n || undefined);
	return mean(trimmed);
}

// ── Student's t-distribution ────────────────────────────────────────────

/**
 * Two-tailed p-value: $P(|T| > |t|)$ for $\nu$ degrees of freedom.
 *
 * Uses the identity
 * $$p = I_x\!\bigl(\tfrac{\nu}{2},\,\tfrac{1}{2}\bigr),
 * \qquad x = \frac{\nu}{\nu + t^2}$$
 * where $I_x(a,b)$ is the regularised incomplete beta function, computed
 * via Lentz's continued-fraction algorithm.
 */
export function tDistPValue(t: number, df: number): number {
	if (df <= 0) return NaN;
	if (t === 0) return 1;
	const x = df / (df + t * t);
	return regularisedIncompleteBeta(x, df / 2, 0.5);
}

/**
 * Inverse of Student's t CDF (quantile function).
 * Uses a simple bisection for the 0.975 quantile (two-tailed α=0.05).
 */
export function tQuantile975(df: number): number {
	// Bisect to find t such that P(T ≤ t) = 0.975
	let lo = 0;
	let hi = 20;
	for (let i = 0; i < 100; i++) {
		const mid = (lo + hi) / 2;
		// P(|T| > mid) = beta regularised value
		const pTwoTail = tDistPValue(mid, df);
		if (pTwoTail < 0.05) {
			hi = mid;
		} else {
			lo = mid;
		}
	}
	return (lo + hi) / 2;
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Lanczos approximation of $\ln\Gamma(z)$, $g = 7$. */
function lnGamma(z: number): number {
	const c = [
		0.99999999999980993, 676.5203681218851, -1259.1392167224028,
		771.32342877765313, -176.61502916214059, 12.507343278686905,
		-0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
	];

	if (z < 0.5) {
		return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
	}

	z -= 1;
	let x = c[0];
	for (let i = 1; i < 9; i++) x += c[i] / (z + i);
	const t = z + 7.5;
	return (
		0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
	);
}

/**
 * Regularised incomplete beta function $I_x(a, b)$ via Lentz's
 * continued-fraction method.
 */
export function regularisedIncompleteBeta(
	x: number,
	a: number,
	b: number,
): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;

	// Flip for faster convergence when x is large
	if (x > (a + 1) / (a + b + 2)) {
		return 1 - regularisedIncompleteBeta(1 - x, b, a);
	}

	const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
	const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

	const EPS = 1e-10;
	const TINY = 1e-30;

	let c = 1;
	let d = 1 - ((a + b) * x) / (a + 1);
	if (Math.abs(d) < TINY) d = TINY;
	d = 1 / d;
	let f = d;

	for (let m = 1; m <= 200; m++) {
		// Even step
		let num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
		d = 1 + num * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + num / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		f *= c * d;

		// Odd step
		num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
		d = 1 + num * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + num / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		const delta = c * d;
		f *= delta;

		if (Math.abs(delta - 1) < EPS) break;
	}

	return front * f;
}
