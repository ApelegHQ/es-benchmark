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

import { deepEqual, notEqual } from 'node:assert/strict';
import { runSuite } from '../src/index.js';
import advancedReport from '../src/reporters/advanced.js';
import simpleReport from '../src/reporters/simple.js';

type Ctx = {
	array: unknown[];
};

const result = await runSuite<Ctx, Ctx['array']>({
	name: 'Array shallow copying',
	setup() {
		this.array = [1, 2, 3];
	},
	validate(fn) {
		this.array = [6, 7, 8];
		const result = fn.call(this);
		notEqual(result, this.array);
		deepEqual(result, this.array);
	},
	functions: [
		{
			name: 'Array.from',
			fn() {
				return Array.from(this.array);
			},
		},
		{
			name: '[].concat()',
			fn() {
				return ([] as unknown[]).concat(this.array);
			},
		},
		{
			name: 'Spread operator',
			fn() {
				return [...this.array];
			},
		},
		{
			name: 'for-loop',
			fn() {
				const len = this.array.length;
				const copy = new Array<unknown>(len);
				for (let i = 0; i < len; i++) copy[i] = this.array[i];

				return copy;
			},
		},
	],
});

console.log('=== START SIMPLE REPORT ===');
simpleReport(result);
console.log('=== END SIMPLE REPORT ===');

console.log('');

console.log('=== START ADVANCED REPORT ===');
advancedReport(result);
console.log('=== END ADVANCED REPORT ===');
