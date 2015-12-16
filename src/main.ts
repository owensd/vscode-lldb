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

class LLDBDebugger {
	debugger: Promise<ChildProcess>;
	lldb: ChildProcess;
	session: SwiftDebugSession;
	
	onstdout: (str: string) => void;
	onstderr: (str: string) => void;
	
	public constructor(session: SwiftDebugSession) {
		this.debugger = null;
		this.session = session;
	}
	
	public connect(program: string): Promise<ChildProcess> {
		console.log("LLDBDebugger: connect");
		let self = this;
		this.debugger = new Promise((resolve, reject) => {
			let toolpath = getToolPath("lldb")
			if (toolpath == null) {
				return reject("Cannot find LLDB debugger.");
			}
			console.log(`Using LLDB : ${toolpath}`)
			
			let lldb = spawn("lldb", [program]);

			lldb.stdout.on("data", (str: string) => {
				console.log("stdout: " + str);
				self.session.sendEvent(new OutputEvent(str + "", 'stdout'));
			});
			lldb.stderr.on("data", (str: string) => {
				console.error("stderr: " + str);
				self.session.sendEvent(new OutputEvent(str + "", 'stdout'));
			});
			lldb.on("close", (code: number) => {
				console.error("Process exiting with code: " + code);
				reject(code);
			});
			lldb.on("error", (err) => {
				console.error("error: " + err);
				self.session.sendEvent(new OutputEvent(err + "", 'stdout'));
				reject(err);
			});
			
			// this is pretty hacky...
			this.lldb = lldb;
			resolve(lldb);
		});
		
		return this.debugger;
	}
	
	public setBreakpoint(filename: string, linenumber: number): Promise<boolean> {
		console.log("LLDBDebugger: setBreakpoint");
		return new Promise((resolve, reject) => {
			resolve(true);
		});
	}
	
	public setBreakpoints(filename: string, linenumbers: number[]): Promise<boolean> {
		// console.log("LLDBDebugger: setBreakpoint");
		// return new Promise((resolve, reject) => {
		// 	for (var idx in linenumbers) {
		// 		this.lldb.stdin.write(`breakpoint set -f ${filename} -l ${linenumbers[idx]}\n`);
		// 	}
		// 	this.lldb.stdin.write("r\n");
		// 	resolve(true);
		// });
	}


	public removeBreakpoint(id: number): Promise<boolean> {
		console.log("LLDBDebugger: removeBreakpoint");
		return new Promise((resolve, reject) => {
			resolve(false);
		});
	}
	
	public removeAllBreakpoints(): Promise<boolean> {
		console.log("LLDBDebugger: removeAllBreakpoints");
		return new Promise((resolve, reject) => {
			resolve(false);
		});
	}
	
	public evaluate(expression: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			this.lldb.stdin.write(`${expression}\n`);
			resolve(true);
		});
	}

}


class SwiftDebugSession extends DebugSession {
	private static MAIN_THREAD_ID = 0;
	
	private lldb: LLDBDebugger;
	private breakpoints: Map<string, DebugProtocol.Breakpoint[]>;
	
	private program: string;
	private currentline: number;
	
	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this.lldb = new LLDBDebugger(this);
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
		
		if (args.stopOnEntry) {
			this.currentline = 0;
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent("entry", SwiftDebugSession.MAIN_THREAD_ID));
		}
		else {
			this.continueRequest(response, { threadId: SwiftDebugSession.MAIN_THREAD_ID });
		}
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
		response.body = {
			result: `evaluate(${args.expression})`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}
}

DebugSession.run(SwiftDebugSession);