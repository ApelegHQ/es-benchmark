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

import type {
	IFunctionStatistics,
	IPairedComparison,
	ISuiteReport,
} from '../types.js';

const escapeXml = (s: string) => {
	return s
		.split('&')
		.join('&amp;')
		.split('"')
		.join('&quot;')
		.split("'")
		.join('&apos;')
		.split('<')
		.join('&lt;')
		.split('>')
		.join('&gt;');
};

const safeXml = (
	template: Readonly<TemplateStringsArray>,
	...substitutions: unknown[]
): string => {
	const escapedSubstitutions = substitutions.map((substitution) =>
		escapeXml(String(substitution)),
	);

	const arr = new Array(template.length + escapedSubstitutions.length);

	for (let i = 0; i < escapedSubstitutions.length; i++) {
		arr[i * 2] = template[i];
		arr[i * 2 + 1] = escapedSubstitutions[i];
	}

	arr[escapedSubstitutions.length * 2] =
		template[escapedSubstitutions.length];

	return arr.join('');
};

// ── Numeric formatting ──────────────────────────────────────────────────

/** Milliseconds → seconds with µs precision (for JUnit `time` attrs). */
const toSec = (ms: number): string => (ms / 1_000).toFixed(6);

/** Human-readable milliseconds for `<system-out>` text. */
const hms = (ms: number): string => ms.toFixed(4);

/** Human-readable p-value. */
const hpv = (p: number): string =>
	p < 1e-4 ? p.toExponential(2) : p.toFixed(4);

/** Explicit sign prefix ('+' for non-negative, '' for negative). */
const sign = (n: number): string => (n >= 0 ? '+' : '');

// ── <system-out> plain-text summaries ───────────────────────────────────

function fnSummaryText(f: Readonly<IFunctionStatistics>): string {
	return [
		safeXml`Benchmark: ${f.name}`,
		safeXml``,
		safeXml`  Mean:       ${hms(f.mean)} ms ± ${hms(f.marginOfError95)} ms (95% CI)`,
		safeXml`  Median:     ${hms(f.median)} ms`,
		safeXml`  Std Dev:    ${hms(f.stdDev)} ms  (SEM: ${hms(f.sem)} ms)`,
		safeXml`  Min:        ${hms(f.min)} ms`,
		safeXml`  Max:        ${hms(f.max)} ms`,
		safeXml`  P5:         ${hms(f.p5)} ms`,
		safeXml`  P25 (Q1):   ${hms(f.p25)} ms`,
		safeXml`  P75 (Q3):   ${hms(f.p75)} ms`,
		safeXml`  P95:        ${hms(f.p95)} ms`,
		safeXml`  Samples:    ${f.sampleSize}`,
	].join('\n');
}

function cmpSummaryText(c: Readonly<IPairedComparison>): string {
	const dir =
		c.meanDifference > 0
			? 'slower than'
			: c.meanDifference < 0
				? 'faster than'
				: 'equal to';
	const pct = (Math.abs(c.relativeDifference) * 100).toFixed(2);
	return [
		safeXml`Paired t-test: ${c.a} vs ${c.b}`,
		safeXml``,
		safeXml`  ${c.a} is ${pct}% ${dir} ${c.b}`,
		safeXml``,
		safeXml`  Mean diff (d):     ${sign(c.meanDifference)}${hms(c.meanDifference)} ms`,
		safeXml`  SD of diffs (sd):  ${hms(c.stdDevDifference)} ms`,
		safeXml`  Relative diff:     ${sign(c.relativeDifference)}${(c.relativeDifference * 100).toFixed(2)}%`,
		safeXml`  95% CI:            [${hms(c.confidenceInterval[0])}, ${hms(c.confidenceInterval[1])}] ms`,
		safeXml`  t(${c.degreesOfFreedom}) = ${c.tStatistic.toFixed(4)}, p = ${hpv(c.pValue)}`,
		safeXml`  Significant:       ${c.significant ? 'YES' : 'No'} (alpha = 0.05)`,
	].join('\n');
}

// ── <testcase> builders ─────────────────────────────────────────────────

/**
 * Render one function benchmark as a `<testcase>`.
 *
 * Standard attributes used:
 *  - `name`      → function name
 *  - `classname` → suite name (groups functions under the suite in UIs)
 *  - `time`      → mean per-iteration time **in seconds** (enables CI trending)
 *
 * Everything else lands in `vendor:benchmark.*` properties with full
 * numeric precision (JS default `toString`, lossless for IEEE-754 doubles).
 */
function buildFnCase(
	suite: string,
	f: Readonly<IFunctionStatistics>,
	wallClockMs: number,
): string {
	return [
		safeXml`    <testcase name="${f.name}" classname="${suite}" time="${f.mean}">`,
		safeXml`      <properties>`,
		// ── Core statistics
		safeXml`        <property name="vendor:benchmark.sampleSize" value="${f.sampleSize}" />`,
		safeXml`        <property name="vendor:benchmark.mean_ms" value="${f.mean}" />`,
		safeXml`        <property name="vendor:benchmark.median_ms" value="${f.median}" />`,
		safeXml`        <property name="vendor:benchmark.stdDev_ms" value="${f.stdDev}" />`,
		safeXml`        <property name="vendor:benchmark.sem_ms" value="${f.sem}" />`,
		safeXml`        <property name="vendor:benchmark.marginOfError95_ms" value="${f.marginOfError95}" />`,
		// ── Range & percentiles
		safeXml`        <property name="vendor:benchmark.min_ms" value="${f.min}" />`,
		safeXml`        <property name="vendor:benchmark.max_ms" value="${f.max}" />`,
		safeXml`        <property name="vendor:benchmark.p5_ms" value="${f.p5}" />`,
		safeXml`        <property name="vendor:benchmark.p25_ms" value="${f.p25}" />`,
		safeXml`        <property name="vendor:benchmark.p75_ms" value="${f.p75}" />`,
		safeXml`        <property name="vendor:benchmark.p95_ms" value="${f.p95}" />`,
		// ── Actual execution time (sum of totalMs across all trials)
		safeXml`        <property name="vendor:benchmark.wallClock_ms" value="${wallClockMs}" />`,
		// ── Per-trial data (JSON arrays — enables downstream re-analysis)
		safeXml`        <property name="vendor:benchmark.samples" value="${JSON.stringify(f.samples)}" />`,
		safeXml`        <property name="vendor:benchmark.rawSamples" value="${JSON.stringify(f.rawSamples)}" />`,
		safeXml`      </properties>`,
		safeXml`      <system-out>${fnSummaryText(f)}</system-out>`,
		safeXml`    </testcase>`,
	].join('\n');
}

/**
 * Render one paired comparison as a `<testcase>`.
 *
 * Standard attributes used:
 *  - `name`      → "A vs B"
 *  - `classname` → suite name + ".comparisons"
 *  - `time`      → 0 (comparisons are computed, not measured)
 *
 * All t-test fields land in `vendor:benchmark.*` with full precision.
 */
function buildCmpCase(suite: string, c: Readonly<IPairedComparison>): string {
	return [
		safeXml`    <testcase name="${c.a + ' vs ' + c.b}" classname="${suite + '.comparisons'}" time="0">`,
		safeXml`      <properties>`,
		safeXml`        <property name="vendor:benchmark.functionA" value="${c.a}" />`,
		safeXml`        <property name="vendor:benchmark.functionB" value="${c.b}" />`,
		safeXml`        <property name="vendor:benchmark.meanDifference_ms" value="${c.meanDifference}" />`,
		safeXml`        <property name="vendor:benchmark.stdDevDifference_ms" value="${c.stdDevDifference}" />`,
		safeXml`        <property name="vendor:benchmark.relativeDifference" value="${c.relativeDifference}" />`,
		safeXml`        <property name="vendor:benchmark.tStatistic" value="${c.tStatistic}" />`,
		safeXml`        <property name="vendor:benchmark.degreesOfFreedom" value="${c.degreesOfFreedom}" />`,
		safeXml`        <property name="vendor:benchmark.pValue" value="${c.pValue}" />`,
		safeXml`        <property name="vendor:benchmark.significant" value="${c.significant}" />`,
		safeXml`        <property name="vendor:benchmark.ci95Lower_ms" value="${c.confidenceInterval[0]}" />`,
		safeXml`        <property name="vendor:benchmark.ci95Upper_ms" value="${c.confidenceInterval[1]}" />`,
		safeXml`      </properties>`,
		safeXml`      <system-out>${cmpSummaryText(c)}</system-out>`,
		safeXml`    </testcase>`,
	].join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Render a complete benchmark suite report as a JUnit XML string.
 *
 * ```text
 * <testsuites>                                  ← ISuiteReport
 * ├─ <testsuite id="0">                         ← function benchmarks
 * │  ├─ <properties>                            ← suite config
 * │  ├─ <testcase time="{mean/iter sec}"> × N   ← IFunctionStatistics
 * │  │  ├─ <properties>                         ← all descriptive stats
 * │  │  └─ <system-out>                         ← human-readable summary
 * │  └─ <system-out>                            ← suite-level summary
 * └─ <testsuite id="1">                         ← pairwise comparisons
 *    ├─ <properties>                            ← significance overview
 *    ├─ <testcase> × C(N,2)                     ← IPairedComparison
 *    │  ├─ <properties>                         ← full t-test results
 *    │  └─ <system-out>                         ← human-readable summary
 *    └─ <system-out>                            ← comparison overview
 * ```
 *
 * The standard `time` attribute on each function `<testcase>` is the
 * **mean per-iteration time in seconds**, enabling CI tools to trend
 * performance over builds.  All benchmark-specific data lives in
 * `vendor:benchmark.*` `<property>` elements with full JS numeric
 * precision (lossless IEEE-754 round-trip via default `toString`).
 */
function formatJUnitXml(report: Readonly<ISuiteReport>): string {
	const timestamp = new Date().toISOString();

	// ── Pre-compute per-function wall-clock totals from trial data ──
	const wallByFn = new Map<string, number>();
	for (const trial of report.trials) {
		for (const [name, m] of Object.entries(trial.measurements)) {
			wallByFn.set(name, (wallByFn.get(name) ?? 0) + m.totalMs);
		}
	}
	const totalWallMs = [...wallByFn.values()].reduce((a, b) => a + b, 0);

	// ── Render individual test cases ────────────────────────────────
	const fnCases = report.functions.map((f) =>
		buildFnCase(report.name, f, wallByFn.get(f.name) ?? 0),
	);
	const cmpCases = report.comparisons.map((c) =>
		buildCmpCase(report.name, c),
	);

	// ── Aggregate counts ────────────────────────────────────────────
	const fnN = report.functions.length;
	const cmpN = report.comparisons.length;
	const sigN = report.comparisons.filter((c) => c.significant).length;

	// Sum of mean per-iteration times — consistent with per-testcase `time`.
	const suiteTimeMs = report.functions.reduce((sum, f) => sum + f.mean, 0);

	// ── Assemble the document ───────────────────────────────────────
	const xml: string[] = [
		safeXml`<?xml version="1.0" encoding="UTF-8"?>`,
		safeXml`<testsuites name="${report.name}" tests="${fnN + cmpN}" failures="0" errors="0" time="${toSec(suiteTimeMs)}" xmlns:vendor="urn:uuid:e28effc0-506d-4903-956b-5ce8727788e0">`,

		// ── Functions testsuite ──────────────────────────────────────
		safeXml`  <testsuite name="${report.name}" id="0" tests="${fnN}" failures="0" errors="0" skipped="0" time="${toSec(suiteTimeMs)}" timestamp="${timestamp}">`,
		safeXml`    <properties>`,
		safeXml`      <property name="vendor:benchmark.warmupIterations" value="${report.config.warmupIterations}" />`,
		safeXml`      <property name="vendor:benchmark.iterationsPerTrial" value="${report.config.iterationsPerTrial}" />`,
		safeXml`      <property name="vendor:benchmark.trials" value="${report.config.trials}" />`,
		safeXml`      <property name="vendor:benchmark.baselineName" value="${report.baselineName}" />`,
		safeXml`      <property name="vendor:benchmark.totalWallClock_ms" value="${totalWallMs}" />`,
		safeXml`    </properties>`,
		...fnCases,
		safeXml`    <system-out>${[
			safeXml`Suite: ${report.name}`,
			safeXml`Warmup: ${report.config.warmupIterations} iterations`,
			safeXml`Measurement: ${report.config.iterationsPerTrial} iterations/trial x ${report.config.trials} trials`,
			safeXml`Baseline: ${report.baselineName}`,
			safeXml`Total wall-clock time: ${hms(totalWallMs)} ms`,
		].join('\n')}</system-out>`,
		safeXml`  </testsuite>`,
	];

	// ── Comparisons testsuite (omitted when there are no pairs) ───
	if (cmpN > 0) {
		xml.push(
			safeXml`  <testsuite name="${report.name + ' - Comparisons'}" id="1" tests="${cmpN}" failures="0" errors="0" skipped="0" time="0" timestamp="${timestamp}">`,
			safeXml`    <properties>`,
			safeXml`      <property name="vendor:benchmark.significantCount" value="${sigN}" />`,
			safeXml`      <property name="vendor:benchmark.totalComparisons" value="${cmpN}" />`,
			safeXml`      <property name="vendor:benchmark.significanceLevel" value="0.05" />`,
			safeXml`    </properties>`,
			...cmpCases,
			safeXml`    <system-out>${safeXml`${sigN} of ${cmpN} pairwise comparisons are statistically significant (alpha = 0.05)`}</system-out>`,
			safeXml`  </testsuite>`,
		);
	}

	xml.push(`</testsuites>`, ``);
	return xml.map((s) => s.trim()).join('');
}

export default formatJUnitXml;
