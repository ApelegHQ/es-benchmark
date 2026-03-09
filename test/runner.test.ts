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

import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { runSuite, Suite } from '../src/runner.js';
import { NULL_FUNCTION_NAME } from '../src/types.js';

const setupRandomnessMocks = (t: TestContext) => {
	t.mock.method(
		crypto,
		'getRandomValues',
		(b: ArrayBufferView<ArrayBufferLike>) => {
			const u8 = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
			for (let i = 0; i < u8.byteLength; i++) {
				u8[i] = 0;
			}
		},
	);
	t.mock.method(Math, 'random', () => 0);
};

describe('Suite', () => {
	// ── add() ─────────────────────────────────────────────────────────

	describe('add()', () => {
		it('rejects duplicate names', () => {
			const s = new Suite({ name: 'x' });
			s.add({ name: 'a', fn() {} });
			assert.throws(() => s.add({ name: 'a', fn() {} }), /Duplicate/);
		});

		it('returns the suite for chaining', () => {
			const s = new Suite({ name: 'x' });
			assert.equal(s.add({ name: 'a', fn() {} }), s);
		});
	});

	// ── run() ─────────────────────────────────────────────────────────

	describe('run()', () => {
		it('rejects when no functions have been added', async () => {
			await assert.rejects(
				() => new Suite({ name: 'empty' }).run(),
				/no benchmark functions/,
			);
		});

		it('returns a correctly shaped report', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'shape',
				trials: 4,
				warmupIterations: 1,
				iterationsPerTrial: 5,
			})
				.add({
					name: 'a',
					fn() {
						time += 3;
					},
				})
				.run();

			assert.equal(report.name, 'shape');
			assert.deepEqual(report.config, {
				warmupIterations: 1,
				iterationsPerTrial: 5,
				trials: 4,
			});
			assert.equal(report.baselineName, NULL_FUNCTION_NAME);
			assert.equal(report.trials.length, 4);
			assert.equal(report.functions.length, 2); // null + a
			assert.equal(report.comparisons.length, 1); // C(2,2)
		});

		it('measures deterministic timings with a mocked clock', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'timings',
				trials: 3,
				warmupIterations: 2,
				iterationsPerTrial: 10,
			})
				.add({
					name: 'fn5',
					fn() {
						time += 5;
					},
				})
				.add({
					name: 'fn20',
					fn() {
						time += 20;
					},
				})
				.run();

			const fn5 = report.functions.find((f) => f.name === 'fn5')!;
			const fn20 = report.functions.find((f) => f.name === 'fn20')!;
			const nul = report.functions.find(
				(f) => f.name === NULL_FUNCTION_NAME,
			)!;

			// null no-op → 0 per iter, all adjusted values identical to raw
			assert.equal(nul.mean, 0);
			assert.equal(fn5.mean, 5);
			assert.deepEqual(fn5.samples, [5, 5, 5]);
			assert.equal(fn20.mean, 20);
			assert.deepEqual(fn20.samples, [20, 20, 20]);
		});

		it('warmup iterations are excluded from the measurement', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'warmup',
				trials: 1,
				warmupIterations: 100, // large warmup…
				iterationsPerTrial: 5, // …small measurement
			})
				.add({
					name: 'fn',
					fn() {
						time += 4;
					},
				})
				.run();

			const fn = report.functions.find((f) => f.name === 'fn')!;
			// perIter = (4 × 5) / 5 = 4, regardless of warmup count
			assert.equal(fn.mean, 4);
		});

		// ── Pairings ──────────────────────────────────────────────────

		it('every trial contains every function', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'pairs',
				trials: 5,
				warmupIterations: 0,
				iterationsPerTrial: 1,
			})
				.add({
					name: 'a',
					fn() {
						time += 1;
					},
				})
				.add({
					name: 'b',
					fn() {
						time += 2;
					},
				})
				.run();

			for (const trial of report.trials) {
				assert.ok(NULL_FUNCTION_NAME in trial.measurements);
				assert.ok('a' in trial.measurements);
				assert.ok('b' in trial.measurements);
				assert.equal(trial.executionOrder.length, 3);
			}
		});

		it('records execution order per trial', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'order',
				trials: 1,
				warmupIterations: 0,
				iterationsPerTrial: 1,
			})
				.add({
					name: 'a',
					fn() {
						time += 1;
					},
				})
				.add({
					name: 'b',
					fn() {
						time += 2;
					},
				})
				.run();

			// identity shuffle preserves insertion order: [null, a, b]
			assert.deepEqual(report.trials[0].executionOrder, [
				NULL_FUNCTION_NAME,
				'a',
				'b',
			]);
		});

		// ── Lifecycle ─────────────────────────────────────────────────

		it('calls setup → fn → teardown in the right order', async (t) => {
			const time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const log: string[] = [];

			await new Suite<{ v: number }>({
				name: 'lifecycle',
				trials: 2,
				warmupIterations: 0,
				iterationsPerTrial: 1,
				setup() {
					log.push('suite-setup');
					this.v = 1;
				},
				teardown() {
					log.push('suite-teardown');
				},
				validate() {
					log.push('suite-validate');
				},
			})
				.add({
					name: 'fn',
					setup() {
						log.push('fn-setup');
						assert.equal(this.v, 1);
					},
					fn() {
						log.push('fn-run');
					},
					teardown() {
						log.push('fn-teardown');
					},
					validate() {
						log.push('fn-validate');
					},
				})
				.run();

			// identity shuffle → null first, then fn
			assert.deepEqual(log, [
				'suite-validate', // fn
				'fn-validate', // fn
				'suite-setup', // @@null
				'suite-teardown', // @@null
				'suite-setup', // fn
				'fn-setup', // fn
				'fn-run', // fn
				'fn-teardown', // fn
				'suite-teardown', // fn
				'suite-setup', // @@null
				'suite-teardown', // @@null
				'suite-setup', // fn
				'fn-setup', // fn
				'fn-run', // fn
				'fn-teardown', // fn
				'suite-teardown', // fn
			]);
		});

		it('creates a fresh context per function × trial', async (t) => {
			const time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const seen: object[] = [];

			await new Suite({
				name: 'ctx',
				trials: 2,
				warmupIterations: 0,
				iterationsPerTrial: 1,
				setup() {
					seen.push(this);
				},
			})
				.add({ name: 'a', fn() {} })
				.add({ name: 'b', fn() {} })
				.run();

			// 2 trials × 3 fns = 6 distinct context objects
			assert.equal(seen.length, 6);
			assert.equal(new Set(seen).size, 6);
		});

		it('context set in suite setup is visible to fn setup', async (t) => {
			const time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			await new Suite<{ seed: number }>({
				name: 'ctx-flow',
				trials: 1,
				warmupIterations: 0,
				iterationsPerTrial: 1,
				setup() {
					this.seed = 99;
				},
			})
				.add({
					name: 'fn',
					setup() {
						assert.equal(this.seed, 99);
						this.seed += 1;
					},
					fn() {
						assert.equal(this.seed, 100);
					},
				})
				.run();
		});

		// ── Async support ─────────────────────────────────────────────

		it('handles async benchmark functions', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'async-fn',
				trials: 2,
				warmupIterations: 0,
				iterationsPerTrial: 1,
			})
				.add({
					name: 'asyncFn',
					async fn() {
						time += 7;
						await Promise.resolve();
					},
				})
				.run();

			const fn = report.functions.find((f) => f.name === 'asyncFn')!;
			assert.equal(fn.mean, 7);
		});

		it('handles async setup and teardown', async (t) => {
			const time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			let tornDown = false;

			await new Suite<{ ready: boolean }>({
				name: 'async-hooks',
				trials: 1,
				warmupIterations: 0,
				iterationsPerTrial: 1,
				async setup() {
					await Promise.resolve();
					this.ready = true;
				},
				async teardown() {
					await Promise.resolve();
					tornDown = true;
				},
			})
				.add({
					name: 'fn',
					fn() {
						assert.equal(this.ready, true);
					},
				})
				.run();

			assert.ok(tornDown);
		});

		// ── Multiple iterations per trial ─────────────────────────────

		it('divides total time by iterations for per-iteration average', async (t) => {
			let time = 0;
			t.mock.method(performance, 'now', () => time);
			setupRandomnessMocks(t);

			const report = await new Suite({
				name: 'avg',
				trials: 1,
				warmupIterations: 0,
				iterationsPerTrial: 4,
			})
				.add({
					name: 'fn',
					fn() {
						time += 10;
					},
				})
				.run();

			const trial = report.trials[0];
			// 4 iters × 10 ms = 40 ms total
			assert.equal(trial.measurements.fn.totalMs, 40);
			assert.equal(trial.measurements.fn.perIterationMs, 10);
		});
	});
});

// ── runSuite convenience ────────────────────────────────────────────────

describe('runSuite', () => {
	it('is equivalent to building a Suite manually', async (t) => {
		let time = 0;
		t.mock.method(performance, 'now', () => time);
		setupRandomnessMocks(t);

		const report = await runSuite({
			name: 'convenience',
			trials: 2,
			warmupIterations: 0,
			iterationsPerTrial: 1,
			functions: [
				{
					name: 'fn',
					fn() {
						time += 9;
					},
				},
			],
		});

		assert.equal(report.name, 'convenience');
		assert.equal(report.functions.find((f) => f.name === 'fn')!.mean, 9);
	});
});
