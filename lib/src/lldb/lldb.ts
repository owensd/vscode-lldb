/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

import { precondition } from "../utils/assertion";
import fs = require("fs");
import { ChildProcess } from "child_process";
import process = require("child_process");

export class CommandResponse {
	output: string;
}

/**
 * A proxy used to control the interop with the debugger instance.
 */
export class Debugger {
	private _binaryPath: string;
	get binaryPath(): string { return this._binaryPath; }

	private _attached: boolean
	get isAttached(): boolean { return this._attached; }

	private _lldb: ChildProcess = null

	static get lldbPath(): string {
		// TODO(owensd): Perform this lookup in a more reliable way...
		return "/usr/bin/lldb";
	}

	/**
	 * Creates a new proxy to the debugger.
	 *
	 * @param path The path to the executable to attach to.
	 */
	constructor(path: string) {
		this._binaryPath = path;
		this._attached = false;
	}

	/**
	 * This will start the debugger and attempt to attach to the binary.
	 */
	attach(): Promise<CommandResponse> {
		precondition(!this.isAttached, "debugger.lldb.alreadyattached");

		let fullPath = fs.realpathSync(this.binaryPath);
		precondition(fs.existsSync(fullPath), "debugger.lldb.binarydoesnotexist");

		let self = this;
		return new Promise((resolve, reject) => {
			let lldb = process.spawn(Debugger.lldbPath, [self.binaryPath]);

			let output = lldb.stdout.read();


			let timer = null;
			let response = "";
			lldb.stdout.on("data", (bytes: Uint8Array) => {
				if (timer != null) { clearTimeout(timer); }

				let str = (bytes + "");
				response += str;

				// TODO(owensd): This seems incredibly hacky...
				timer = setTimeout(() => {
					resolve({ output: response });
				}, 250);
			});
		});
	}
}