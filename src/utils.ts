/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import fs = require('fs');
import path = require('path');
import os = require('os');

export function getToolPath(toolname: string): string {
	if (process.env["PATH"]) {
		let parts = process.env["PATH"].split(path.delimiter);
		for (var idx in parts) {
			let toolpath = path.join(parts[idx], toolname);
			if (fs.existsSync(toolpath)) {
				return toolpath;
			}
		}
	}
	
	return null;
}
