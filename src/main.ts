/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source } from "./common/debugSession";
import { spawn, ChildProcess } from "child_process";
import { readFileSync, existsSync, lstatSync } from 'fs';
import { getToolPath } from './utils';

require("console-stamp")(console);

// This interface should always match the schema found in `package.json`.
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	stopOnEntry?: boolean;
	args?: string[];
	cwd?: string;
	env?: { [key: string]: string; },
	mode?: string;
	buildFlags?: string;
	init?: string;
}

interface DebugBreakpoint {
	id: number;
	file: string;
	line: number;
}

class LLDB {
	debugger: ChildProcess;
	
	onstdout: (str: string) => void;
	onstderr: (str: string) => void;
	
	public constructor(
		onstdout: (str: string) => void,
		onstderr: (str: string) => void)
	{
		this.debugger = null;
		this.onstdout = onstdout;
		this.onstderr = onstderr;
	}
	
	public connect(program: string): Promise<boolean> {
		let self = this;

		return new Promise((resolve, reject) => {
			let toolpath = getToolPath("lldb")
			if (toolpath == null) {
				return reject("Cannot find LLDB debugger on the system PATH.");
			}
			console.log(`Using LLDB : ${toolpath}`)
			
			let lldb = spawn("lldb", [program]);

			lldb.stdout.on("data", (bytes: Uint8Array) => {
				let str = (bytes + "");
				console.log(str);
				
				str = str.replace(/^\(lldb\).*\n/g, "")
				if (self.onstdout) {
					self.onstdout(str);
				}
			});
			
			lldb.stderr.on("data", (bytes: Uint8Array) => {
				let str = (bytes + "");
				console.error(str);
				
				str = str.replace(/^\(lldb\).*\n/g, "")
				if (self.onstdout) {
					self.onstdout(str);
				}
			});
			
			lldb.on("close", (code: number) => {
				console.log(`"Process exiting with code: ${code}`);
				reject(code);
			});
			lldb.on("error", (err) => {
				console.log(err + "");
				reject(err);
			});
			
			self.debugger = lldb;
			resolve(true);
		});
	}

	public evaluate(expression: string): Promise<string> {
		return this.doCommand(expression);
	}

	private doCommand(command: string): Promise<string> {
		let self = this;
		return new Promise((resolve, reject) => {
			self.debugger.stdin.write(`${command}\n`, () => resolve(""));
		});
	}
}


class SwiftDebugSession extends DebugSession {
	private static MAIN_THREAD_ID = 0;
	
	private lldb: LLDB;
	private breakpoints: Map<string, DebugProtocol.Breakpoint[]>;
	
	private program: string;
	private currentline: number;
	
	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		
		this.lldb = new LLDB(
			(str) => this.sendEvent(new OutputEvent(str)),
			(str) => this.sendEvent(new OutputEvent(str)));
		this.breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();
		this.program = null;
		this.currentline = 0;
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		this.sendResponse(response);
		this.sendEvent(new InitializedEvent());
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.program = args.program;
		
		this.lldb.connect(this.program)
			.then(() => {
				if (args.stopOnEntry) {
					this.currentline = 0;
					this.sendResponse(response);
					this.sendEvent(new StoppedEvent("entry", SwiftDebugSession.MAIN_THREAD_ID));
				}
				else {
					this.continueRequest(response, { threadId: SwiftDebugSession.MAIN_THREAD_ID });
				}
			});
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this.sendResponse(response);
		this.sendEvent(new TerminatedEvent());
	}
	
	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
		this.sendErrorResponse(response, 101, "Setting a breakpoint on exceptions is not yet supported.");
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		if (!this.breakpoints.get(args.source.path)) {
			this.breakpoints.set(args.source.path, []);
		}
		
		var path = args.source.path;
		var clientLines = args.lines;

		var lines = readFileSync(path).toString().split('\n');

		var newPositions = [clientLines.length];
		var breakpoints = [];

		for (var i = 0; i < clientLines.length; i++) {
			var l = this.convertClientLineToDebugger(clientLines[i]);
			var verified = false;
			if (l < lines.length) {
				verified = true;
			}
			newPositions[i] = l;
			breakpoints.push({ verified: verified, line: this.convertDebuggerLineToClient(l)});
		}
		this.breakpoints.set(path, breakpoints);

		response.body = {
			breakpoints: breakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(SwiftDebugSession.MAIN_THREAD_ID, "thread 0")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const frames = new Array<StackFrame>();

		response.body = {
			stackFrames: frames
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const frameReference = args.frameId;
		const scopes = new Array<Scope>();

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const variables = [];
		
		response.body = {
			variables: variables
		}
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.sendErrorResponse(response, 104, "Next is not supported.");
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this.sendErrorResponse(response, 102, "Step In is not yet supported");
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		console.error("Not yet implemented: stepOutRequest");
		this.sendErrorResponse(response, 103, "Step out is not yet supported");
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		this.sendResponse(response);
		this.sendEvent(new StoppedEvent("pause", SwiftDebugSession.MAIN_THREAD_ID));
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		this.lldb.evaluate(args.expression)
			.then((result) => {
				response.body = {
					result: result,
					variablesReference: 0
				};
				this.sendResponse(response);
			});
	}
}

DebugSession.run(SwiftDebugSession);