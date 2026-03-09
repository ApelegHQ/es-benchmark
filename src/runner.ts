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

import {
	BenchmarkAbortedError,
	BenchmarkDuplicateNameError,
	BenchmarkEmptyError,
	BenchmarkRunnerError,
} from './errors.js';
import { generateReport } from './report.js';
import type {
	ContextFn,
	IBenchmarkFn,
	ISuiteConfig,
	ISuiteReport,
	ITrialMeasurement,
	ITrialResult,
	SuiteConfig,
} from './types.js';
import { IRunProgress, NULL_FUNCTION_NAME } from './types.js';
import { shuffled } from './utils.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Invoke an optional sync-or-async callback with a `this` context. */
async function invoke<
	TC extends object,
	TA extends unknown[] = never[],
	TR = unknown,
>(
	signal: AbortSignal | undefined,
	fn: ((this: TC, ...args: TA) => TR | PromiseLike<TR>) | undefined,
	ctx: TC,
	args: (readonly never[] extends TA ? TA | undefined : TA) | undefined,
): Promise<void> {
	if (signal?.aborted) {
		throw new BenchmarkAbortedError('Aborted');
	}
	if (!fn) return;
	const result = args ? fn.apply(ctx, args) : fn.apply(ctx);
	if (
		result &&
		typeof result === 'object' &&
		typeof (result as PromiseLike<TR>).then === 'function'
	) {
		await result;
	}
}

/**
 * Time `iterations` invocations of `fn` (after `warmup` throwaway calls).
 * Returns total wall-clock time in milliseconds.
 *
 * Sync functions are never unnecessarily awaited, keeping microtask
 * overhead out of the measurement loop.
 */
async function measureTime<
	TC extends object,
	TA extends unknown[] = never[],
	TR = unknown,
>(
	signal: AbortSignal | undefined,
	fn: (this: TC, ...args: TA) => TR | PromiseLike<TR>,
	ctx: TC,
	warmup: number,
	iterations: number,
	args: (readonly never[] extends TA ? TA | undefined : TA) | undefined,
): Promise<number> {
	if (signal?.aborted) {
		throw new BenchmarkAbortedError('Aborted');
	}

	for (let i = 0; i < warmup; i++) {
		const r = args ? fn.apply(ctx, args) : fn.apply(ctx);
		if (
			r &&
			typeof r === 'object' &&
			typeof (r as PromiseLike<TR>).then === 'function'
		) {
			await r;
		}
	}

	if (signal?.aborted) {
		throw new BenchmarkAbortedError('Aborted');
	}

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		const r = args ? fn.apply(ctx, args) : fn.apply(ctx);
		if (
			r &&
			typeof r === 'object' &&
			typeof (r as PromiseLike<TR>).then === 'function'
		)
			await r;
	}
	const end = performance.now();

	return end - start;
}

// ── Suite ───────────────────────────────────────────────────────────────

/**
 * A benchmark suite.
 *
 * ```ts
 * const report = await new Suite<{ data: number[] }>({
 *   name: 'sorting',
 *   trials: 50,
 *   iterationsPerTrial: 500,
 *   setup() { this.data = Array.from({ length: 1000 }, () => Math.random()); },
 * })
 *   .add({ name: 'Array#sort',    fn() { [...this.data].sort(); } })
 *   .add({ name: 'Float64+sort',  fn() { Float64Array.from(this.data).sort(); } })
 *   .run();
 * ```
 *
 * **Lifecycle per function per trial:**
 *
 * 1. A *fresh* context object `{}` is created.
 * 2. Suite `setup` is called (`this` = context).
 * 3. Function `setup` is called (`this` = context).
 * 4. Warmup iterations run (`this` = context) — not timed.
 * 5. Measured iterations run (`this` = context) — timed.
 * 6. Function `teardown` is called (`this` = context).
 * 7. Suite `teardown` is called (`this` = context).
 *
 * Each function gets its own context; measurements within the same trial
 * are paired for downstream statistical tests.
 */
export class Suite<
	TC extends object = Record<string, unknown>,
	TR = unknown,
	TA extends unknown[] = never[],
> {
	private readonly _name: ISuiteConfig<TC, TA, TA>['name'];
	private readonly _warmup: number;
	private readonly _iterations: number;
	private readonly _trials: number;
	private readonly _args: SuiteConfig<TC, TR, TA>['args'];
	private readonly _suiteSetup?: ISuiteConfig<TC, TR, TA>['setup'];
	private readonly _suiteTeardown?: ISuiteConfig<TC, TR, TA>['teardown'];
	private readonly _suiteValidate?: ISuiteConfig<TC, TR, TA>['validate'];
	private readonly _fns: IBenchmarkFn<TC, TR, TA>[] = [];

	constructor(options: Readonly<SuiteConfig<TC, TR, TA>>) {
		this._name = options.name;
		this._warmup = options.warmupIterations ?? 10;
		this._iterations = options.iterationsPerTrial ?? 1000;
		this._trials = options.trials ?? 30;
		this._args = options.args;
		this._suiteSetup = options.setup;
		this._suiteTeardown = options.teardown;
		this._suiteValidate = options.validate;
	}

	/** Register a benchmark function.  Returns `this` for chaining. */
	add(fn: IBenchmarkFn<TC, TR, TA>): this {
		if (this._fns.some((f) => f.name === fn.name)) {
			throw new BenchmarkDuplicateNameError(
				`Duplicate benchmark name: "${fn.name}"`,
			);
		}
		this._fns.push(fn);
		return this;
	}

	/** Execute all trials and return a {@link ISuiteReport}. */
	async run(opts?: {
		eventTarget?: EventTarget;
		signal?: AbortSignal;
	}): Promise<ISuiteReport> {
		if (this._fns.length === 0) {
			throw new BenchmarkEmptyError(
				'Suite has no benchmark functions — call .add() before .run()',
			);
		}

		const eventTarget = opts?.eventTarget;
		const signal = opts?.signal;

		for (const bench of this._fns.filter(
			(fn) => fn.name !== NULL_FUNCTION_NAME,
		)) {
			const validateCtx = Object.create(null) as TC;

			const args = [bench.fn, ...(this._args ? this._args : [])] as [
				ContextFn<TC, TR, TA>,
				...Exclude<ISuiteConfig<TC, TR, TA>['args'], undefined>,
			];

			await invoke(signal, this._suiteValidate, validateCtx, args);
			await invoke(signal, bench.validate, validateCtx, args);
		}

		// Inject the null baseline — an empty function that captures the
		// overhead of the measurement loop (call dispatch, thenable check,
		// loop counter).  It participates in shuffling like every other
		// function so it experiences the same ordering / cache conditions.
		const nullFn: IBenchmarkFn<TC, void, TA> = {
			name: NULL_FUNCTION_NAME,
			fn() {},
		};
		const allFns = this._fns.some((fn) => fn.name === NULL_FUNCTION_NAME)
			? [...this._fns]
			: [nullFn, ...this._fns];

		const trials: ITrialResult[] = [];

		for (let t = 0; t < this._trials; t++) {
			const order = shuffled(allFns);
			const executionOrder: string[] = [];
			const measurements: Record<string, ITrialMeasurement> = {};

			for (const bench of order) {
				try {
					if (eventTarget) {
						eventTarget.dispatchEvent(
							new CustomEvent<IRunProgress>('progress', {
								detail: {
									trial: t + 1,
									totalTrials: this._trials,
									currentFunction: bench.name,
								},
							}),
						);
						// Allow event to propagate
						await new Promise((resolve) => setTimeout(resolve, 0));
					}

					const ctx = Object.create(null) as TC;
					await invoke(signal, this._suiteSetup, ctx, this._args);
					await invoke(signal, bench.setup, ctx, this._args);

					const totalMs = await measureTime(
						signal,
						bench.fn as IBenchmarkFn<TC, unknown, TA>['fn'],
						ctx,
						this._warmup,
						this._iterations,
						this._args,
					);

					await invoke(signal, bench.teardown, ctx, this._args);
					await invoke(signal, this._suiteTeardown, ctx, this._args);

					executionOrder.push(bench.name);
					measurements[bench.name] = {
						name: bench.name,
						totalMs,
						iterations: this._iterations,
						perIterationMs: totalMs / this._iterations,
					};
				} catch (e) {
					throw new BenchmarkRunnerError(
						`Error in ${bench.name}`,
						e,
						bench.name,
						t,
					);
				}
			}

			trials.push({ trialIndex: t, executionOrder, measurements });
		}

		return generateReport(
			this._name,
			{
				warmupIterations: this._warmup,
				iterationsPerTrial: this._iterations,
				trials: this._trials,
			},
			trials,
			allFns.map((f) => f.name),
			NULL_FUNCTION_NAME,
		);
	}
}

// ── Convenience functional API ──────────────────────────────────────────

/**
 * One-shot functional API — builds a {@link Suite}, adds every function,
 * and runs immediately.
 */
export async function runSuite<
	TC extends object = Record<string, unknown>,
	TR = unknown,
	TA extends unknown[] = never[],
>(
	config: Readonly<
		SuiteConfig<TC, TR, TA> & {
			functions: IBenchmarkFn<TC, TR, TA>[];
			eventTarget?: EventTarget;
			signal?: AbortSignal;
		}
	>,
): Promise<ISuiteReport> {
	const { functions, eventTarget, signal, ...suiteConfig } = config;
	const suite = new Suite<TC, TR, TA>(
		suiteConfig as Readonly<SuiteConfig<TC, TR, TA>>,
	);
	for (const fn of functions) {
		suite.add(fn);
	}
	return suite.run({ eventTarget, signal });
}
