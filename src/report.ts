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

import * as stats from './stats.js';
import type {
	IFunctionStatistics,
	IPairedComparison,
	ISuiteReport,
	ITrialResult,
} from './types.js';

// ── Baseline extraction ─────────────────────────────────────────────────

/**
 * Extract per-trial baseline (null-function) timings.
 * These represent the overhead of the measurement loop itself.
 */
function getBaselineSamples(
	baselineName: string,
	trials: ITrialResult[],
): number[] {
	return trials.map((t) => t.measurements[baselineName].perIterationMs);
}

// ── Per-function statistics ─────────────────────────────────────────────

function computeFunctionStats(
	name: string,
	trials: ITrialResult[],
	baselineSamples: number[],
): IFunctionStatistics {
	const rawSamples = trials.map((t) => t.measurements[name].perIterationMs);
	// Subtract the null-function time measured in the *same* trial
	const samples = rawSamples.map((v, i) => v - baselineSamples[i]);

	const n = samples.length;
	const sd = stats.stdDev(samples);
	const se = stats.sem(samples);
	const tCrit = stats.tCritical005TwoTailed(Math.max(n - 1, 1));

	return {
		name,
		sampleSize: n,
		mean: stats.mean(samples),
		median: stats.median(samples),
		stdDev: sd,
		sem: se,
		min: stats.min(samples),
		max: stats.max(samples),
		p5: stats.percentile(samples, 5),
		p25: stats.percentile(samples, 25),
		p75: stats.percentile(samples, 75),
		p95: stats.percentile(samples, 95),
		marginOfError95: tCrit * se,
		samples,
		rawSamples,
	};
}

// ── Pairwise comparisons ────────────────────────────────────────────────

function computePairedComparison(
	nameA: string,
	nameB: string,
	trials: ITrialResult[],
	baselineSamples: number[],
): IPairedComparison {
	// Use baseline-corrected values so that relativeDifference reflects
	// actual computation time, not measurement overhead.
	const adjA = trials.map(
		(t, i) => t.measurements[nameA].perIterationMs - baselineSamples[i],
	);
	const adjB = trials.map(
		(t, i) => t.measurements[nameB].perIterationMs - baselineSamples[i],
	);

	// Paired differences (note: null cancels, so d_i is identical to raw)
	const diffs = adjA.map((a, i) => a - adjB[i]);

	const n = diffs.length;
	const meanD = stats.mean(diffs);
	const sdD = stats.stdDev(diffs);
	const seD = n > 1 ? sdD / Math.sqrt(n) : NaN;
	const df = Math.max(n - 1, 1);

	const tStat = seD > 0 ? meanD / seD : 0;
	const pValue = seD > 0 ? stats.tDistPValue(tStat, df) : 1;
	const tCrit = stats.tCritical005TwoTailed(df);

	const meanBadj = stats.mean(adjB);

	return {
		a: nameA,
		b: nameB,
		meanDifference: meanD,
		stdDevDifference: sdD,
		relativeDifference: meanBadj !== 0 ? meanD / meanBadj : 0,
		tStatistic: tStat,
		degreesOfFreedom: df,
		pValue,
		significant: pValue < 0.05,
		confidenceInterval: [meanD - tCrit * seD, meanD + tCrit * seD],
	};
}

// ── Report assembly ─────────────────────────────────────────────────────

export function generateReport(
	name: string,
	config: ISuiteReport['config'],
	trials: ITrialResult[],
	functionNames: string[],
	baselineName: string,
): ISuiteReport {
	const baselineSamples = getBaselineSamples(baselineName, trials);

	const functions = functionNames.map((fn) =>
		computeFunctionStats(fn, trials, baselineSamples),
	);

	const comparisons: IPairedComparison[] = [];
	for (let i = 0; i < functionNames.length; i++) {
		for (let j = i + 1; j < functionNames.length; j++) {
			comparisons.push(
				computePairedComparison(
					functionNames[i],
					functionNames[j],
					trials,
					baselineSamples,
				),
			);
		}
	}

	return { name, config, trials, functions, comparisons, baselineName };
}
