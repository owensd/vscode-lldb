/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

export function precondition(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}