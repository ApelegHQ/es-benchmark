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

import { generateReport } from './report.js';
import type {
	IBenchmarkFn,
	ISuiteConfig,
	ISuiteReport,
	ITrialMeasurement,
	ITrialResult,
} from './types.js';
import { NULL_FUNCTION_NAME } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle (returns a new array). */
function shuffled<T>(array: readonly T[]): T[] {
	const out = [...array];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Invoke an optional sync-or-async callback with a `this` context. */
async function invoke<TC extends object, TA extends unknown[] = never[]>(
	fn: ((this: TC, ...args: TA) => unknown | PromiseLike<unknown>) | undefined,
	ctx: TC,
	...args: TA
): Promise<void> {
	if (!fn) return;
	const result = fn.apply(ctx, args);
	if (
		result &&
		typeof result === 'object' &&
		typeof (result as PromiseLike<unknown>).then === 'function'
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
async function measureTime<TC extends object>(
	fn: (this: TC) => unknown | PromiseLike<unknown>,
	ctx: TC,
	warmup: number,
	iterations: number,
): Promise<number> {
	for (let i = 0; i < warmup; i++) {
		const r = fn.call(ctx);
		if (
			r &&
			typeof r === 'object' &&
			typeof (r as PromiseLike<unknown>).then === 'function'
		) {
			await r;
		}
	}

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		const r = fn.call(ctx);
		if (
			r &&
			typeof r === 'object' &&
			typeof (r as PromiseLike<unknown>).then === 'function'
		)
			await r;
	}
	return performance.now() - start;
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
export class Suite<TC extends object = Record<string, unknown>, TR = unknown> {
	private readonly _name: string;
	private readonly _warmup: number;
	private readonly _iterations: number;
	private readonly _trials: number;
	private readonly _suiteSetup?: ISuiteConfig<TC, TR>['setup'];
	private readonly _suiteTeardown?: ISuiteConfig<TC, TR>['teardown'];
	private readonly _suiteValidate?: ISuiteConfig<TC, TR>['validate'];
	private readonly _fns: IBenchmarkFn<TC, TR>[] = [];

	constructor(options: ISuiteConfig<TC, TR>) {
		this._name = options.name;
		this._warmup = options.warmupIterations ?? 10;
		this._iterations = options.iterationsPerTrial ?? 1000;
		this._trials = options.trials ?? 30;
		this._suiteSetup = options.setup;
		this._suiteTeardown = options.teardown;
		this._suiteValidate = options.validate;
	}

	/** Register a benchmark function.  Returns `this` for chaining. */
	add(fn: IBenchmarkFn<TC, TR>): this {
		if (this._fns.some((f) => f.name === fn.name)) {
			throw new Error(`Duplicate benchmark name: "${fn.name}"`);
		}
		this._fns.push(fn);
		return this;
	}

	/** Execute all trials and return a {@link ISuiteReport}. */
	async run(): Promise<ISuiteReport> {
		if (this._fns.length === 0) {
			throw new Error(
				'Suite has no benchmark functions — call .add() before .run()',
			);
		}

		// Inject the null baseline — an empty function that captures the
		// overhead of the measurement loop (call dispatch, thenable check,
		// loop counter).  It participates in shuffling like every other
		// function so it experiences the same ordering / cache conditions.
		const nullFn: IBenchmarkFn<TC> = {
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
				if (
					bench.name !== NULL_FUNCTION_NAME &&
					(this._suiteValidate || bench.setup)
				) {
					const validateCtx = {} as TC;
					await invoke(
						this._suiteValidate,
						validateCtx,
						bench.fn as IBenchmarkFn<TC, TR>['fn'],
					);
					await invoke(
						bench.validate,
						validateCtx,
						bench.fn as IBenchmarkFn<TC, TR>['fn'],
					);
				}

				const ctx = {} as TC;
				await invoke(this._suiteSetup, ctx);
				await invoke(bench.setup, ctx);

				const totalMs = await measureTime(
					bench.fn,
					ctx,
					this._warmup,
					this._iterations,
				);

				await invoke(bench.teardown, ctx);
				await invoke(this._suiteTeardown, ctx);

				executionOrder.push(bench.name);
				measurements[bench.name] = {
					name: bench.name,
					totalMs,
					iterations: this._iterations,
					perIterationMs: totalMs / this._iterations,
				};
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
>(
	config: ISuiteConfig<TC, TR> & { functions: IBenchmarkFn<TC, TR>[] },
): Promise<ISuiteReport> {
	const { functions, ...suiteConfig } = config;
	const suite = new Suite<TC, TR>(suiteConfig);
	for (const fn of functions) suite.add(fn);
	return suite.run();
}
