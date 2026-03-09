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

type Ctx = {
	array: unknown[];
};

const result = await runSuite<Ctx, Ctx['array'], [dep1: number, dep2: string]>({
	name: 'Array shallow copying',
	args: [1, 'a'],
	setup() {
		this.array = [1, 2, 3];
	},
	validate(fn) {
		this.array = [6, 7, 8];
		const result = fn.call(this, 1, 'a');
		notEqual(result, this.array);
		deepEqual(result, this.array);
	},
	functions: [
		{
			name: 'Array.from',
			fn(dep1, dep2) {
				dep1.toExponential(1);
				dep2.toLowerCase();
				return Array.from(this.array);
			},
		},
	],
});

console.log(result);
