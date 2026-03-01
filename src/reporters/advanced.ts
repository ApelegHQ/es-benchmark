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

import pc from 'picocolors';
import { mean, stdDev } from '../stats.js';
import type {
	IFunctionStatistics,
	IPairedComparison,
	ISuiteReport,
} from '../types.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const MEDALS = ['🥇', '🥈', '🥉'] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ANSI-safe string helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Strip ANSI escape codes to get the visible text. */
function strip(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Visible (non-ANSI) character count. */
function vl(s: string): number {
	return strip(s).length;
}

/** Right-pad to `w` visible columns (ANSI-safe). */
function rpad(s: string, w: number): string {
	const d = w - vl(s);
	return d > 0 ? s + ' '.repeat(d) : s;
}

/** Left-pad to `w` visible columns (ANSI-safe). */
function lpad(s: string, w: number): string {
	const d = w - vl(s);
	return d > 0 ? ' '.repeat(d) + s : s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Number / time formatters
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Format milliseconds with automatic unit selection (ns / µs / ms / s). */
function ft(ms: number): string {
	const a = Math.abs(ms);
	const sign = ms < 0 ? '−' : '';
	if (a === 0) return '0.00 ns';
	if (a < 0.000_000_000_001) return `${sign}${(a * 1e15).toFixed(3)} as`;
	if (a < 0.000_000_001) return `${sign}${(a * 1e12).toFixed(3)} fs`;
	if (a < 0.000_001) return `${sign}${(a * 1e9).toFixed(3)} ps`;
	if (a < 0.001) return `${sign}${(a * 1e6).toFixed(2)} ns`;
	if (a < 1) return `${sign}${(a * 1e3).toFixed(2)} µs`;
	if (a < 1000) return `${sign}${a.toFixed(3)} ms`;
	return `${sign}${(a / 1000).toFixed(3)} s`;
}

/** Format throughput as operations per second with SI suffix. */
function fops(ms: number): string {
	if (ms <= 0) return '∞ op/s';
	const ops = 1000 / ms;
	if (ops >= 1e18) return `${(ops / 1e18).toFixed(2)}E op/s`;
	if (ops >= 1e15) return `${(ops / 1e15).toFixed(2)}P op/s`;
	if (ops >= 1e12) return `${(ops / 1e12).toFixed(2)}T op/s`;
	if (ops >= 1e9) return `${(ops / 1e9).toFixed(2)}G op/s`;
	if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M op/s`;
	if (ops >= 1e3) return `${(ops / 1e3).toFixed(2)}K op/s`;
	return `${ops.toFixed(2)} op/s`;
}

/** Locale-formatted integer / number. */
function fn(n: number): string {
	return n.toLocaleString('en-US');
}

/** Speed multiplier: e.g. `1.23×`, `10.0×`, `256×`. */
function fmul(r: number): string {
	if (r >= 1000) return `${r.toFixed(0)}×`;
	if (r >= 100) return `${r.toFixed(0)}×`;
	if (r >= 10) return `${r.toFixed(1)}×`;
	return `${r.toFixed(2)}×`;
}

/** Display a p-value in human-readable form. */
function fpv(p: number): string {
	if (p < 0.001) return 'p < 0.001';
	if (p < 0.01) return `p = ${p.toFixed(3)}`;
	return `p = ${p.toFixed(4)}`;
}

/** Significance stars: `***`, `**`, `*`, or `n.s.`. */
function sig(p: number): '***' | '**' | '*' | 'n.s.' {
	if (p < 0.001) return '***';
	if (p < 0.01) return '**';
	if (p < 0.05) return '*';
	return 'n.s.';
}

/** Colored significance stars. */
function csig(p: number): string {
	const s = sig(p);
	return s === 'n.s.' ? pc.dim(s) : pc.yellow(s);
}

/** Coefficient of variation as a percentage. */
function cvPct(f: IFunctionStatistics): number {
	return f.mean > 0 ? (f.stdDev / f.mean) * 100 : 0;
}

/** Color-coded coefficient of variation. */
function fcv(pct: number): string {
	const s = `${pct.toFixed(1)}%`;
	if (pct < 2) return pc.green(s);
	if (pct < 5) return pc.cyan(s);
	if (pct < 10) return pc.yellow(s);
	return pc.red(s);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Visual components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Horizontal throughput bar — longer = faster. Colour varies by rank. */
function tpBar(ratio: number, w: number, rank: number): string {
	const filled = Math.max(0, Math.min(w, Math.round(ratio * w)));
	const empty = w - filled;
	const colorFn =
		rank === 0
			? pc.green
			: rank === 1
				? pc.cyan
				: rank === 2
					? pc.yellow
					: pc.magenta;
	return colorFn('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
}

/**
 * Mini sparkline histogram of the sample distribution.
 * Bins are rendered with Unicode block elements ▁–█.
 */
function sparkline(samples: number[], w: number = 18): string {
	if (samples.length < 2) return '';
	const sorted = [...samples].sort((a, b) => a - b);
	const min = sorted[0];
	const max = sorted[sorted.length - 1];
	const range = max - min;

	const nBins = Math.min(w, samples.length);
	const bins: number[] = new Array(nBins).fill(0);
	for (const v of sorted) {
		const i =
			range === 0
				? 0
				: Math.min(Math.floor(((v - min) / range) * nBins), nBins - 1);
		bins[i]++;
	}
	const peak = Math.max(...bins);
	return bins
		.map((c) => pc.cyan(SPARK[peak <= 0 ? 0 : Math.round((c / peak) * 7)]))
		.join('');
}

/**
 * Single-line box plot rendered in Unicode.
 *
 * ```
 *    ╷──────[██████│████████]──────╷
 *    p5     p25   med     p75     p95
 * ```
 *
 * - Whiskers: dim `─`  (p5→p25, p75→p95)
 * - IQR box left of median: {@link pc.cyan | cyan} `█`
 * - IQR box right of median: {@link pc.blue | blue} `█`
 * - Median: bold white `│`
 */
function miniBox(
	f: IFunctionStatistics,
	lo: number,
	hi: number,
	w: number = 32,
): string {
	const range = hi - lo;
	if (range <= 0)
		return pc.cyan('│') + pc.dim('─'.repeat(Math.max(0, w - 1)));

	const pos = (v: number) =>
		Math.max(0, Math.min(w - 1, Math.round(((v - lo) / range) * (w - 1))));

	const i5 = pos(f.p5);
	const i25 = pos(f.p25);
	const iM = pos(f.median);
	const i75 = pos(f.p75);
	const i95 = pos(f.p95);

	const chars: string[] = new Array(w).fill(' ');

	for (let i = 0; i < w; i++) {
		if (i < i5 || i > i95) {
			// Outside range — blank
			chars[i] = ' ';
		} else if (i >= i25 && i <= i75) {
			// Inside IQR box
			chars[i] = i < iM ? pc.cyan('█') : pc.blue('█');
		} else if (i === i5 || i === i95) {
			chars[i] = pc.dim('╷');
		} else {
			// Whisker
			chars[i] = pc.dim('─');
		}
	}

	// Median marker always on top
	chars[iM] = pc.bold(pc.white('│'));

	return chars.join('');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Section chrome
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Decorative section header line: `── Title ─────────────────` */
function secLine(label: string, totalW: number = 76): string {
	const dashes = totalW - label.length - 5;
	return (
		'\n  ' +
		pc.dim('──') +
		' ' +
		pc.bold(label) +
		' ' +
		pc.dim('─'.repeat(Math.max(1, dashes)))
	);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sections
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function renderHeader(suite: ISuiteReport): string[] {
	const L: string[] = [];
	const { config } = suite;

	const titleText = `🏁  ${suite.name}`;
	const cfgText =
		`${fn(config.trials)} trials  ·  ` +
		`${fn(config.iterationsPerTrial)} iter/trial  ·  ` +
		`${fn(config.warmupIterations)} warmup`;

	const inner = Math.max(titleText.length, cfgText.length) + 4;
	const bar = (ch: string) => pc.cyan(ch);

	L.push('');
	L.push('  ' + bar('┏' + '━'.repeat(inner) + '┓'));
	L.push('  ' + bar('┃') + ' '.repeat(inner) + bar('┃'));
	L.push(
		'  ' +
			bar('┃') +
			'  ' +
			pc.bold(titleText) +
			' '.repeat(Math.max(0, inner - 2 - titleText.length)) +
			bar('┃'),
	);
	L.push(
		'  ' +
			bar('┃') +
			'  ' +
			pc.dim(cfgText) +
			' '.repeat(Math.max(0, inner - 2 - cfgText.length)) +
			bar('┃'),
	);
	L.push('  ' + bar('┃') + ' '.repeat(inner) + bar('┃'));
	L.push('  ' + bar('┗' + '━'.repeat(inner) + '┛'));

	return L;
}

// ─── Winner announcement ─────────────────────────────────────────────────────

function renderWinner(
	fns: IFunctionStatistics[],
	comps: IPairedComparison[],
): string[] {
	if (fns.length < 2) return [];

	const L: string[] = [];
	const fastest = fns[0];
	const second = fns[1];
	const slowest = fns[fns.length - 1];

	const topComp = comps.find(
		(c) =>
			(c.a === fastest.name && c.b === second.name) ||
			(c.b === fastest.name && c.a === second.name),
	);

	L.push('');

	if (topComp && !topComp.significant) {
		L.push(
			'  ' +
				pc.yellow('≈') +
				'  ' +
				pc.bold(fastest.name) +
				' and ' +
				pc.bold(second.name) +
				' are ' +
				pc.bold(pc.yellow('statistically tied')) +
				'  ' +
				pc.dim(`(${fpv(topComp.pValue)})`),
		);
	} else {
		const ratio2 = second.mean / fastest.mean;
		const parts = [pc.dim(`${fmul(ratio2)} faster than ${second.name}`)];
		if (fns.length > 2) {
			parts.push(
				pc.dim(
					`${fmul(slowest.mean / fastest.mean)} vs ${slowest.name}`,
				),
			);
		}
		L.push(
			'  ' +
				pc.green('⚡') +
				'  ' +
				pc.bold(pc.green(fastest.name)) +
				' is the fastest' +
				'  ' +
				parts.join(pc.dim(', ')),
		);
	}

	return L;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

function renderLeaderboard(fns: IFunctionStatistics[]): string[] {
	const L: string[] = [];
	const fastest = fns[0];

	L.push(secLine('Leaderboard'));
	L.push('');

	const nw = Math.max(10, ...fns.map((f) => f.name.length));
	const tw = 12;
	const ow = 12;
	const bw = 24;

	// Column headers
	L.push(
		'    ' +
			rpad('', 4) +
			'  ' +
			rpad(pc.dim('Function'), nw) +
			'  ' +
			lpad(pc.dim('Mean'), tw) +
			'  ' +
			lpad(pc.dim('± MOE'), tw) +
			'  ' +
			lpad(pc.dim('ops/s'), ow) +
			'  ' +
			pc.dim('Relative'),
	);
	L.push(
		'    ' +
			pc.dim(
				'─'.repeat(4 + 2 + nw + 2 + tw + 2 + tw + 2 + ow + 2 + bw + 14),
			),
	);

	const maxOps = fastest.mean > 0 ? 1 / fastest.mean : 0;

	for (let i = 0; i < fns.length; i++) {
		const f = fns[i];
		const ops = f.mean > 0 ? 1 / f.mean : 0;
		const ratio = maxOps > 0 ? ops / maxOps : 0;

		const medal = i < 3 ? MEDALS[i] : pc.dim(`#${i + 1}`);
		const medalStr = rpad(medal, 4);

		const name =
			i === 0
				? pc.bold(pc.green(f.name))
				: i === 1
					? pc.bold(f.name)
					: f.name;

		const mean = ft(f.mean);
		const moe = `±${ft(f.marginOfError95)}`;
		const opsStr = fops(f.mean);

		let rel: string;
		if (i === 0) {
			rel = pc.green(' fastest');
		} else if (fastest.mean > 0) {
			const timesSlower = f.mean / fastest.mean;
			rel = pc.dim(` ${fmul(timesSlower)} slower`);
		} else {
			rel = '';
		}

		L.push(
			'    ' +
				medalStr +
				'  ' +
				rpad(name, nw) +
				'  ' +
				lpad(mean, tw) +
				'  ' +
				lpad(pc.dim(moe), tw) +
				'  ' +
				lpad(opsStr, ow) +
				'  ' +
				tpBar(ratio, bw, i) +
				rel,
		);
	}

	return L;
}

// ─── Distribution (box plots + sparklines) ───────────────────────────────────

function renderDistribution(fns: IFunctionStatistics[]): string[] {
	const L: string[] = [];

	L.push(secLine('Distribution'));
	L.push('');

	const nw = Math.max(10, ...fns.map((f) => f.name.length));
	const bw = 32;

	const gMin = Math.min(...fns.map((f) => f.p5));
	const gMax = Math.max(...fns.map((f) => f.p95));

	// Scale ruler
	L.push(
		'    ' +
			rpad('', nw) +
			'  ' +
			rpad(pc.dim(ft(gMin)), Math.floor(bw / 2)) +
			lpad(pc.dim(ft(gMax)), Math.ceil(bw / 2)),
	);
	L.push(
		'    ' +
			rpad('', nw) +
			'  ' +
			pc.dim('├' + '─'.repeat(Math.max(0, bw - 2)) + '┤'),
	);

	for (const f of fns) {
		const bp = miniBox(f, gMin, gMax, bw);
		const range =
			pc.dim(ft(f.p5) + ' → ') +
			pc.bold(ft(f.median)) +
			pc.dim(' → ' + ft(f.p95));
		const sp = sparkline(f.samples, 16);

		L.push(
			'    ' + rpad(f.name, nw) + '  ' + bp + '  ' + range + '  ' + sp,
		);
	}

	L.push('');
	L.push(
		'    ' +
			pc.dim('╷── whiskers p5/p95   ') +
			pc.cyan('█') +
			pc.blue('█') +
			pc.dim(' IQR (p25–p75)   ') +
			pc.bold(pc.white('│')) +
			pc.dim(' median   ') +
			pc.cyan('▁▃▅▇') +
			pc.dim(' density'),
	);

	return L;
}

// ─── Detailed statistics table ───────────────────────────────────────────────

function renderDetailedStats(fns: IFunctionStatistics[]): string[] {
	const L: string[] = [];

	L.push(secLine('Detailed Statistics'));
	L.push('');

	const heads = [
		'Function',
		'Mean',
		'Median',
		'Std Dev',
		'CV',
		'Min',
		'Max',
		'SEM',
	];

	const rows = fns.map((f) => [
		f.name,
		ft(f.mean),
		ft(f.median),
		ft(f.stdDev),
		fcv(cvPct(f)),
		ft(f.min),
		ft(f.max),
		ft(f.sem),
	]);

	const cw = heads.map((h, ci) =>
		Math.max(h.length, ...rows.map((r) => vl(r[ci]))),
	);

	// Header
	L.push('    ' + heads.map((h, i) => rpad(pc.dim(h), cw[i])).join('  '));
	L.push('    ' + cw.map((w) => pc.dim('─'.repeat(w))).join('  '));

	// Data rows
	for (const row of rows) {
		L.push(
			'    ' +
				row
					.map((cell, i) =>
						i === 0 ? rpad(cell, cw[i]) : lpad(cell, cw[i]),
					)
					.join('  '),
		);
	}

	return L;
}

// ─── Pairwise comparisons ────────────────────────────────────────────────────

function renderComparisons(
	fns: IFunctionStatistics[],
	comps: IPairedComparison[],
): string[] {
	if (comps.length === 0) return [];

	const L: string[] = [];
	const byName: Record<string, IFunctionStatistics> = {};
	for (const f of fns) byName[f.name] = f;

	L.push(secLine('Pairwise Comparisons (paired t-test)'));

	for (const c of comps) {
		const fA = byName[c.a];
		const fB = byName[c.b];
		if (!fA || !fB) continue;

		const aFaster = fA.mean <= fB.mean;
		const fasterName = aFaster ? c.a : c.b;
		const ratio = aFaster ? fB.mean / fA.mean : fA.mean / fB.mean;

		L.push('');
		L.push('    ' + pc.bold(c.a) + pc.dim(' vs ') + pc.bold(c.b));

		if (c.significant) {
			L.push(
				'      ' +
					pc.green('✓') +
					' ' +
					pc.bold(pc.green(fasterName)) +
					' is ' +
					pc.bold(pc.green(fmul(ratio))) +
					' faster  ' +
					pc.dim('(') +
					pc.dim(fpv(c.pValue)) +
					' ' +
					csig(c.pValue) +
					pc.dim(')'),
			);
		} else {
			L.push(
				'      ' +
					pc.yellow('≈') +
					' No significant difference  ' +
					pc.dim(`(${fpv(c.pValue)})`),
			);
		}

		L.push(
			'      ' +
				pc.dim('Δ = ') +
				ft(c.meanDifference) +
				'   ' +
				pc.dim('95% CI ') +
				pc.dim('[') +
				ft(c.confidenceInterval[0]) +
				pc.dim(', ') +
				ft(c.confidenceInterval[1]) +
				pc.dim(']'),
		);
		L.push(
			'      ' +
				pc.dim('t = ') +
				c.tStatistic.toFixed(3) +
				'   ' +
				pc.dim('df = ') +
				String(c.degreesOfFreedom) +
				'   ' +
				pc.dim('SE(Δ) = ') +
				ft(c.stdDevDifference / Math.sqrt(c.degreesOfFreedom + 1)),
		);
	}

	return L;
}

// ─── Speed matrix ────────────────────────────────────────────────────────────

function renderMatrix(
	fns: IFunctionStatistics[],
	comps: IPairedComparison[],
): string[] {
	// Only render for a reasonable number of functions
	if (fns.length < 3 || fns.length > 8) return [];

	const L: string[] = [];

	L.push('');
	L.push(secLine('Speed Matrix'));
	L.push(
		'    ' +
			pc.dim(
				'Cell = column time ÷ row time · ' +
					pc.green('green') +
					pc.dim(' > 1 (row is faster) · ') +
					pc.red('red') +
					pc.dim(' < 1 (row is slower) · ') +
					pc.yellow('*') +
					pc.dim(' sig.'),
			),
	);
	L.push('');

	const cw = Math.max(8, ...fns.map((f) => f.name.length));

	// Column headers
	L.push(
		'    ' +
			rpad('', cw) +
			'  ' +
			fns
				.map((f) => {
					const label =
						f.name.length > cw
							? f.name.slice(0, cw - 1) + '…'
							: f.name;
					return lpad(pc.dim(label), cw);
				})
				.join('  '),
	);
	L.push('    ' + pc.dim('─'.repeat(cw + 2 + fns.length * (cw + 2))));

	for (const rowF of fns) {
		const cells: string[] = [];

		for (const colF of fns) {
			if (rowF.name === colF.name) {
				cells.push(lpad(pc.dim('—'), cw));
				continue;
			}

			// ratio > 1 ⇒ row is faster
			const ratio = colF.mean / rowF.mean;

			const comp = comps.find(
				(cc) =>
					(cc.a === rowF.name && cc.b === colF.name) ||
					(cc.b === rowF.name && cc.a === colF.name),
			);
			const mark = comp?.significant ? pc.yellow('*') : ' ';

			let cell: string;
			if (ratio >= 1.005) {
				cell = pc.green(fmul(ratio)) + mark;
			} else if (ratio <= 0.995) {
				cell = pc.red(fmul(ratio)) + mark;
			} else {
				cell = pc.dim('1.00×') + ' ';
			}

			cells.push(lpad(cell, cw));
		}

		L.push('    ' + rpad(rowF.name, cw) + '  ' + cells.join('  '));
	}

	return L;
}

// ─── Measurement overhead / baseline ─────────────────────────────────────────

function renderBaseline(
	baseline: IFunctionStatistics | undefined,
	fastest: IFunctionStatistics,
): string[] {
	if (!baseline) return [];

	const L: string[] = [];

	const baseLineMean = mean(baseline.rawSamples);
	const baselineStdDev = stdDev(baseline.rawSamples);

	L.push(secLine('Measurement Overhead'));
	L.push('');
	L.push(
		'    ' +
			pc.dim('Baseline') +
			` (${pc.cyan(baseline.name)}): ` +
			pc.bold(ft(baseLineMean)) +
			pc.dim('/iter') +
			'   ' +
			pc.dim('σ = ' + ft(baselineStdDev)),
	);
	L.push(
		'    ' + pc.dim('All reported times have this overhead subtracted.'),
	);

	if (fastest.mean > 0) {
		const ratio = baseLineMean / fastest.mean;
		if (ratio > 0.1) {
			L.push('');
			L.push(
				'    ' +
					pc.yellow('⚠') +
					'  ' +
					pc.yellow(
						`Overhead is ${(ratio * 100).toFixed(1)}% of the fastest function.`,
					),
			);
			L.push(
				'    ' +
					pc.dim(
						'   Consider increasing work per iteration for more accurate results.',
					),
			);
		} else {
			L.push(
				'    ' +
					pc.dim(
						`Overhead is ${(ratio * 100).toFixed(2)}% of the fastest — `,
					) +
					pc.green('negligible'),
			);
		}
	}

	return L;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function renderFooter(): string[] {
	return [
		'',
		'  ' + pc.dim('━'.repeat(76)),
		'  ' +
			pc.dim('Significance: ') +
			pc.yellow('***') +
			pc.dim(' p<0.001   ') +
			pc.yellow('**') +
			pc.dim(' p<0.01   ') +
			pc.yellow('*') +
			pc.dim(' p<0.05   ') +
			pc.dim('ns not significant'),
		'  ' +
			pc.dim('Paired t-test on baseline-corrected per-iteration times.'),
		'',
	];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Format a complete {@link ISuiteReport} into a rich, coloured string
 * ready for terminal output.
 *
 * Sections rendered:
 *
 * | Section              | Audience              |
 * | -------------------- | --------------------- |
 * | Header box           | Everyone              |
 * | Winner announcement  | Casual users          |
 * | Leaderboard          | Developers            |
 * | Distribution         | Statisticians         |
 * | Detailed statistics  | Statisticians         |
 * | Pairwise comparisons | Statisticians         |
 * | Speed matrix         | Developers (3-8 fns)  |
 * | Measurement overhead | Advanced users        |
 */
export function formatReport(suite: ISuiteReport): string {
	// ── Separate baseline from benchmarks, sort fastest → slowest ──────
	const baseline = suite.functions.find((f) => f.name === suite.baselineName);
	const fns = suite.functions
		.filter((f) => f.name !== suite.baselineName)
		.sort((a, b) => a.mean - b.mean);

	if (fns.length === 0) {
		return (
			'\n  ' + pc.red('No benchmark functions found in the suite.') + '\n'
		);
	}

	// Non-baseline comparisons only
	const comps = suite.comparisons.filter(
		(c) => c.a !== suite.baselineName && c.b !== suite.baselineName,
	);

	return [
		...renderHeader(suite),
		...renderWinner(fns, comps),
		...renderLeaderboard(fns),
		...renderDistribution(fns),
		...renderDetailedStats(fns),
		...renderComparisons(fns, comps),
		...renderMatrix(fns, comps),
		...renderBaseline(baseline, fns[0]),
		...renderFooter(),
	].join('\n');
}

/** Convenience wrapper — format and print to `stdout`. */

/** Options for {@link printReport}. */
export interface IReporterOptions {
	/** Writable stream.  @default console.log */
	output?: (s: string) => void;
}

function printReport(suite: ISuiteReport, opts?: IReporterOptions): void {
	const out =
		opts?.output ??
		(console.log as Exclude<IReporterOptions['output'], undefined>);
	const ln = (s = '') => {
		out(s);
	};

	ln(formatReport(suite));
}

export default printReport;
