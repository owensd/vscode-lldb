/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

/**
 * A proxy used to control the interop with the debugger instance.
 */
export class Debugger {
	private _binaryPath: string;
	get binaryPath(): string { return this._binaryPath; }

	/**
	 * Creates a new proxy to the debugger.
	 *
	 * @param path The path to the executable to attach to.
	 */
	constructor(path: string) {
		this._binaryPath = path;
	}

	/**
	 * This will start the debugger and attempt to attach to the binary.
	 */
	attach(): Promise<Debugger> {
		return new Promise(null);
	}
}