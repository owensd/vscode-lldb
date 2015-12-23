/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

import assert = require("assert");
import {Debugger} from "../../src/lldb/lldb";
import fs = require("fs");

describe("Debugger", () => {

	describe("lldbPath", () => {
		it("should exist on disk at the path given", () => {
			assert.ok(fs.existsSync(Debugger.lldbPath), `LLDB Path: ${Debugger.lldbPath}`);
		});
	});

	describe("attach", () => {
		it("should produce and error when the binary is not found", () => {
			let path = "noexist";
			let lldb = new Debugger(path);
			assert.throws(() => { lldb.attach() });
		});

		it("should attach when the binary exists", (done) => {
			let path = "./collateral/lldb/bin/hello";
			let lldb = new Debugger(path);
			lldb.attach()
				.then(res => {
					assert.strictEqual(res.output, "(lldb) target create \"./collateral/lldb/bin/hello\"\nCurrent executable set to \'./collateral/lldb/bin/hello\' (x86_64).\n");
					done();
				})
				.catch(error => {
					console.log(error);
					done();
				});
		});

	});
});