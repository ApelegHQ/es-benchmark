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

/**
 * Default terminal reporter for benchmark results.
 *
 * @example
 * ```ts
 * import { runSuite }  from './runner.js';
 * import { report }    from './reporter.js';
 *
 * const result = await runSuite({ name: 'demo', functions: [ … ] });
 * report(result);
 * ```
 *
 * @module
 */

import pc from 'picocolors';
import { mean } from '../stats.js';
import type {
	IFunctionStatistics,
	IPairedComparison,
	ISuiteReport,
} from '../types.js';
import { NULL_FUNCTION_NAME } from '../types.js';

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Options for {@link report}. */
export interface IReporterOptions {
	/** Writable stream.  @default console.log */
	output?: { columns?: number } & ((s: string) => void);
	/** Maximum line width.  @default terminal columns or 80 */
	width?: number;
}

/**
 * Pretty-print a {@link SuiteReport} to the terminal.
 *
 * - The null baseline (`@@null`) is hidden from the main listing;
 *   its raw overhead is shown as a footnote.
 * - User functions are sorted fastest → slowest.
 * - A bar chart and paired-comparison table are shown when there
 *   are two or more user functions.
 */
function report(
	suite: Readonly<ISuiteReport>,
	opts?: Readonly<IReporterOptions>,
): void {
	const out =
		opts?.output ??
		(console.log as Exclude<IReporterOptions['output'], undefined>);
	const W = Math.max(opts?.width ?? (out.columns || 80), 40);

	const ln = (() => {
		const lines = [] as string[];
		const internal = (s = '') => {
			lines.push(s);
		};
		internal.flush = () => {
			out(lines.splice(0).join('\n'));
		};

		return internal;
	})();

	/* ── Partition & sort ────────────────────────────────────────── */

	const fns = suite.functions
		.filter((f) => f.name !== NULL_FUNCTION_NAME)
		.sort((a, b) => a.mean - b.mean);

	const baseline = suite.functions.find((f) => f.name === NULL_FUNCTION_NAME);

	const comps = suite.comparisons.filter(
		(c) => c.a !== NULL_FUNCTION_NAME && c.b !== NULL_FUNCTION_NAME,
	);

	if (fns.length === 0) {
		ln();
		ln(pc.dim('  (no benchmark functions)'));
		ln();
		return;
	}

	const fastest = fns[0];
	const unit = pickUnit(fastest.mean);
	const multi = fns.length > 1;

	/* ── Header ──────────────────────────────────────────────────── */

	ln();
	emitHeader(ln, suite);

	/* ── Noise-floor guard ───────────────────────────────────────── */

	if (multi && fastest.mean <= 0) {
		ln(
			`  ${pc.yellow('⚠')}  ${pc.yellow('All functions are at or below the noise floor.')}`,
		);
		ln(
			`  ${pc.dim('   Increase iterationsPerTrial for meaningful results.')}`,
		);
		ln();
	}

	/* ── Results table ───────────────────────────────────────────── */

	emitTable(ln, fns, fastest, unit, multi);

	/* ── Bar chart ───────────────────────────────────────────────── */

	if (multi && fastest.mean > 0) {
		emitChart(ln, fns, fastest, unit, W);
	}

	/* ── Paired comparisons ──────────────────────────────────────── */

	if (comps.length > 0) {
		emitComparisons(ln, comps, fastest, unit, W);
	}

	/* ── Baseline footnote ───────────────────────────────────────── */

	if (baseline && baseline.rawSamples.length > 0) {
		emitBaseline(ln, baseline, unit);
	}

	ln.flush();
}

/* ================================================================== */
/*  Section renderers                                                  */
/* ================================================================== */

function emitHeader(
	ln: (s?: string) => void,
	suite: Readonly<ISuiteReport>,
): void {
	const { config: c } = suite;
	ln(`  ${pc.bold(pc.cyan(suite.name))}`);
	ln(
		`  ${pc.dim(
			`${fmtInt(c.trials)} trials · ` +
				`${fmtInt(c.iterationsPerTrial)} iter · ` +
				`${fmtInt(c.warmupIterations)} warmup`,
		)}`,
	);
	ln();
}

/* ── Table ──────────────────────────────────────────────────────── */

function emitTable(
	ln: (s?: string) => void,
	fns: readonly Readonly<IFunctionStatistics>[],
	fastest: Readonly<IFunctionStatistics>,
	unit: Readonly<Unit>,
	showRel: boolean,
): void {
	const nameW = Math.max(...fns.map((f) => f.name.length));

	const rows = fns.map((f) => {
		const isBest = f === fastest;
		return {
			f,
			mean: fmtT(f.mean, unit),
			moe: fmtT(f.marginOfError95, unit),
			rel: isBest
				? 'fastest'
				: fastest.mean > 0
					? fmtRatio(f.mean / fastest.mean) + ' slower'
					: '—',
		};
	});

	const mW = Math.max(...rows.map((r) => r.mean.length));
	const eW = Math.max(...rows.map((r) => r.moe.length));
	const rW = Math.max(...rows.map((r) => r.rel.length));

	for (const { f, mean, moe, rel } of rows) {
		const best = f === fastest;

		const nameStr = best
			? pc.green(pc.bold(rpad(f.name, nameW)))
			: rpad(f.name, nameW);

		const stats = `${lpad(mean, mW)} ${pc.dim('±')} ${lpad(moe, eW)} ${pc.dim(unit)}`;

		if (showRel) {
			const relStr = best
				? lpad(pc.green(pc.bold(rel)), rW)
				: lpad(pc.yellow(rel), rW);
			ln(`  ${nameStr}  ${stats}  ${relStr}`);
		} else {
			ln(`  ${nameStr}  ${stats}`);
		}
	}

	ln();
}

/* ── Bar chart ──────────────────────────────────────────────────── */

function emitChart(
	ln: (s?: string) => void,
	fns: readonly Readonly<IFunctionStatistics>[],
	fastest: Readonly<IFunctionStatistics>,
	unit: Readonly<Unit>,
	W: number,
): void {
	const nameW = Math.max(...fns.map((f) => f.name.length));
	const labels = fns.map((f) => `${fmtT(f.mean, unit)} ${unit}`);
	const lblW = Math.max(...labels.map((l) => l.length));
	const barArea = W - 2 - nameW - 2 - 1 - lblW; // indent+name+gap+bar+gap+label

	if (barArea < 8) return; // terminal too narrow for a meaningful chart

	for (let i = 0; i < fns.length; i++) {
		const len = Math.max(
			1,
			Math.round(barArea * (fastest.mean / fns[i].mean)),
		);
		const bar = pc.cyan('█'.repeat(len)) + ' '.repeat(barArea - len);

		ln(
			`  ${rpad(fns[i].name, nameW)}  ` +
				`${bar} ${pc.dim(lpad(labels[i], lblW))}`,
		);
	}

	ln();
}

/* ── Paired comparisons ─────────────────────────────────────────── */

function emitComparisons(
	ln: (s?: string) => void,
	comps: readonly Readonly<IPairedComparison>[],
	fastest: Readonly<IFunctionStatistics>,
	unit: Readonly<Unit>,
	W: number,
): void {
	ln(`  ${pc.bold('Comparisons')} ${pc.dim('(paired t-test, α = 0.05)')}`);
	ln(`  ${pc.dim('─'.repeat(W - 4))}`);

	// Fastest-involving pairs first, then by |diff| descending
	const sorted = [...comps].sort((a, b) => {
		const af = +(a.a === fastest.name || a.b === fastest.name);
		const bf = +(b.a === fastest.name || b.b === fastest.name);
		if (af !== bf) return bf - af;
		return Math.abs(b.meanDifference) - Math.abs(a.meanDifference);
	});

	// Pre-format for column alignment
	const lbls = sorted.map((c) => `${c.a} vs ${c.b}`);
	const diffs = sorted.map((c) => {
		const sign = c.meanDifference > 0 ? '+' : '';
		return `${sign}${fmtT(c.meanDifference, unit)}`;
	});
	const pcts = sorted.map((c) => `(${fmtPct(c.relativeDifference)})`);
	const pVals = sorted.map((c) => fmtP(c.pValue));

	const lW = Math.max(...lbls.map((s) => s.length));
	const dW = Math.max(...diffs.map((s) => s.length));
	const pW = Math.max(...pcts.map((s) => s.length));
	const vW = Math.max(...pVals.map((s) => s.length));

	for (let i = 0; i < sorted.length; i++) {
		const sig = sorted[i].significant
			? pc.green('✓ sig')
			: pc.yellow('✗ n.s.');

		ln(
			`  ${rpad(lbls[i], lW)}  ` +
				`${lpad(diffs[i], dW)} ${pc.dim(unit)} ` +
				`${pc.dim(rpad(pcts[i], pW))}  ` +
				`${pc.dim(rpad(pVals[i], vW))}  ` +
				sig,
		);
	}

	ln();
}

/* ── Baseline footnote ──────────────────────────────────────────── */

function emitBaseline(
	ln: (s?: string) => void,
	baseline: Readonly<IFunctionStatistics>,
	unit: Readonly<Unit>,
): void {
	const raw = baseline.rawSamples;
	const avg = mean(raw);

	ln(
		`  ${pc.dim(
			`Baseline (${NULL_FUNCTION_NAME}): ` +
				`${fmtT(avg, unit)} ${unit}/iter overhead (subtracted)`,
		)}`,
	);
	ln();
}

/* ================================================================== */
/*  Formatting utilities                                               */
/* ================================================================== */

type Unit = 'as' | 'fs' | 'ps' | 'ns' | 'µs' | 'ms' | 's';

/** Choose a display unit based on absolute magnitude (in ms). */
function pickUnit(ms: number): Unit {
	const a = Math.abs(ms);
	if (a === 0) return 'ns';
	if (a >= 1_000) return 's';
	if (a >= 1) return 'ms';
	if (a >= 0.001) return 'µs';
	if (a >= 0.000_001) return 'ns';
	if (a >= 0.000_000_001) return 'ps';
	if (a >= 0.000_000_000_001) return 'fs';
	return 'as';
}

/** Convert milliseconds → target display unit. */
function toUnit(ms: number, u: Unit): number {
	switch (u) {
		case 's':
			return ms / 1_000;
		case 'ms':
			return ms;
		case 'µs':
			return ms * 1_000;
		case 'ns':
			return ms * 1_000_000;
		case 'ps':
			return ms * 1_000_000_000;
		case 'fs':
			return ms * 1_000_000_000_000;
		case 'as':
			return ms * 1_000_000_000_000_000;
	}
}

/** Adaptive decimal places: ≥ 1 000 → 0 dp, ≥ 100 → 1, ≥ 10 → 2, else 3. */
function fmtNum(v: number): string {
	const a = Math.abs(v);
	if (a === 0) return '0.00';
	if (a >= 1_000) return v.toFixed(0);
	if (a >= 100) return v.toFixed(1);
	if (a >= 10) return v.toFixed(2);
	return v.toFixed(3);
}

/** Format a time (given in ms) in the chosen display unit. */
function fmtT(ms: number, u: Unit): string {
	return fmtNum(toUnit(ms, u));
}

/** Format a fraction as a signed percentage. */
function fmtPct(frac: number): string {
	const p = frac * 100;
	return `${p > 0 ? '+' : ''}${fmtNum(p)}%`;
}

/** Format a p-value compactly. */
function fmtP(p: number): string {
	return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

/** Format a speed ratio like "1.90×". */
function fmtRatio(r: number): string {
	if (r >= 100) return `${r.toFixed(0)}×`;
	if (r >= 10) return `${r.toFixed(1)}×`;
	return `${r.toFixed(2)}×`;
}

/** Integer with comma separators (en-US). */
function fmtInt(n: number): string {
	return n.toLocaleString('en-US');
}

/* ── ANSI-aware string padding ──────────────────────────────────── */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible character count (ignoring ANSI escape sequences). */
function vlen(s: string): number {
	return s.replace(ANSI_RE, '').length;
}

/** Right-pad to `w` *visible* characters. */
function rpad(s: string, w: number): string {
	return s + ' '.repeat(Math.max(0, w - vlen(s)));
}

/** Left-pad to `w` *visible* characters. */
function lpad(s: string, w: number): string {
	return ' '.repeat(Math.max(0, w - vlen(s))) + s;
}

export default report;
