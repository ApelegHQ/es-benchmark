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
 * A callback that receives benchmark context via `this`.
 */
export type ContextFn<
	TC extends object,
	TR = unknown,
	TA extends unknown[] = never[],
> = (this: TC, ...args: TA) => TR | PromiseLike<TR>;

/**
 * Reserved name for the automatically-injected no-op baseline function.
 * Its measurement captures pure loop + call overhead, which is subtracted
 * from every other function on a per-trial basis.
 */
export const NULL_FUNCTION_NAME = '@@null';

/**
 * A single benchmark function to be measured within a suite.
 */
export interface IBenchmarkFn<
	TC extends object = Record<string, unknown>,
	TR = unknown,
> {
	/** Display name for this benchmark. Must be unique within its suite. */
	name: string;
	/** The function to benchmark. Receives shared context via `this`. */
	fn: ContextFn<TC, TR>;
	/** Runs before warmup + measurement each trial (after suite setup). */
	setup?: ContextFn<TC, void>;
	/** Runs after measurement each trial (before suite teardown). */
	teardown?: ContextFn<TC, void>;
	/** Runs before setup + warmup + measurement each trial
	 *  (after suite validate). */
	validate?: ContextFn<TC, void, [ContextFn<TC, TR>]>;
}

/**
 * Configuration for a benchmark suite.
 */
export interface ISuiteConfig<
	TC extends object = Record<string, unknown>,
	TR = unknown,
> {
	/** Display name for the suite. */
	name: string;
	/** Warmup iterations before each measurement (default: 10). */
	warmupIterations?: number;
	/** Iterations per trial measurement (default: 1000). */
	iterationsPerTrial?: number;
	/** Number of independent trials to run (default: 30). */
	trials?: number;
	/**
	 * Suite-level setup — runs once per function per trial to populate a
	 * fresh context object before the function-level setup.
	 */
	setup?: ContextFn<TC, void>;
	/**
	 * Suite-level teardown — runs once per function per trial after the
	 * function-level teardown.
	 */
	teardown?: ContextFn<TC, void>;
	/**
	 * Suite-level validate — runs once per function per trial before any
	 * other callbacks (like setup). The context is discarded after execution.
	 */
	validate?: ContextFn<TC, void, [ContextFn<TC, TR>]>;
}

// ── Raw trial data ──────────────────────────────────────────────────────

/** A single function's measurement within one trial. */
export interface ITrialMeasurement {
	/** Function name. */
	name: string;
	/** Total wall-clock time for all iterations (ms). */
	totalMs: number;
	/** Number of iterations measured. */
	iterations: number;
	/** `totalMs / iterations` (ms). */
	perIterationMs: number;
}

/**
 * One complete trial, preserving execution order and pairing information.
 *
 * Because all functions are measured within the same trial, consumers can
 * correlate results: "in trial N, function A took X ms while function B
 * took Y ms."  This enables proper paired statistical tests.
 */
export interface ITrialResult {
	/** Zero-based trial index. */
	trialIndex: number;
	/** Function names in the (randomised) order they were executed. */
	executionOrder: string[];
	/** Measurements keyed by function name. */
	measurements: Record<string, ITrialMeasurement>;
}

// ── Aggregate statistics ────────────────────────────────────────────────

/** Descriptive statistics for one benchmark function across all trials. */
export interface IFunctionStatistics {
	name: string;
	/** Number of trials (sample size). */
	sampleSize: number;
	/** Arithmetic mean of per-iteration times (ms). */
	mean: number;
	/** Median of per-iteration times (ms). */
	median: number;
	/** Sample standard deviation (Bessel-corrected) (ms). */
	stdDev: number;
	/** Standard error of the mean (ms). */
	sem: number;
	min: number;
	max: number;
	/** 5th percentile (ms). */
	p5: number;
	/** 25th percentile (ms). */
	p25: number;
	/** 75th percentile (ms). */
	p75: number;
	/** 95th percentile (ms). */
	p95: number;
	/** Half-width of the 95 % confidence interval for the mean (ms). */
	marginOfError95: number;
	/**
	 * Baseline-corrected per-iteration times, one per trial (ms).
	 * All aggregate statistics above are computed from these values.
	 */
	samples: number[];

	/**
	 * Raw (uncorrected) per-iteration times, one per trial (ms).
	 * Provided so consumers can inspect or apply their own correction.
	 */
	rawSamples: number[];
}

// ── Pairwise comparison ─────────────────────────────────────────────────

/**
 * Paired t-test comparison between two functions.
 *
 * Because trial pairings are preserved, we use a *paired* (dependent)
 * t-test, which is more powerful than an independent-samples test:
 * shared sources of noise (GC pauses, thermal throttling, …) cancel out
 * in the per-trial differences $d_i = a_i - b_i$.
 */
export interface IPairedComparison {
	/** First function name.  */
	a: string;
	/** Second function name. */
	b: string;
	/** $\bar{d}$ — mean of the paired differences $a_i - b_i$ (ms). */
	meanDifference: number;
	/** $s_d$ — sample standard deviation of the paired differences (ms). */
	stdDevDifference: number;
	/**
	 * Relative difference $\bar{d} / \bar{b}$ expressed as a ratio.
	 * Positive → A is slower; negative → A is faster.
	 */
	relativeDifference: number;
	/** $t = \bar{d} / (s_d / \sqrt{n})$. */
	tStatistic: number;
	/** $n - 1$. */
	degreesOfFreedom: number;
	/** Two-tailed p-value from Student's t-distribution. */
	pValue: number;
	/** `pValue < 0.05`. */
	significant: boolean;
	/** 95 % CI for the true mean difference $[\bar{d} \pm t_{\alpha/2} \cdot SE_d]$ (ms). */
	confidenceInterval: [lower: number, upper: number];
}

// ── Suite report ────────────────────────────────────────────────────────

/** Complete, JSON-serialisable output of a suite run. */
export interface ISuiteReport {
	/** Suite name. */
	name: string;
	/** Effective configuration. */
	config: {
		warmupIterations: number;
		iterationsPerTrial: number;
		trials: number;
	};
	/** Every trial, with full pairing data and raw timings. */
	trials: ITrialResult[];
	/** Per-function aggregate statistics. */
	functions: IFunctionStatistics[];
	/** All $\binom{k}{2}$ pairwise paired-t comparisons. */
	comparisons: IPairedComparison[];
	/**
	 * Name of the null baseline function ({@link NULL_FUNCTION_NAME}).
	 * Look it up in `functions` to inspect measurement-infrastructure noise.
	 */
	baselineName: string;
}
