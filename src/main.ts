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
		console.log("LLDBDebugger: setBreakpoint");
		return new Promise((resolve, reject) => {
			for (var idx in linenumbers) {
				this.lldb.stdin.write(`breakpoint set -f ${filename} -l ${linenumbers[idx]}\n`);
			}
			this.lldb.stdin.write("r\n");
			resolve(true);
		});
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
	private lldb: LLDBDebugger;
	private breakpoints: Map<string, DebugBreakpoint[]>;
	
	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this.lldb = new LLDBDebugger(this);
		this.breakpoints = new Map<string, DebugBreakpoint[]>();
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		this.sendResponse(response);
		this.sendEvent(new InitializedEvent());
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.lldb.connect(args.program)
			.then(() => {
				this.sendEvent(new OutputEvent("launched", 'stdout'));
				this.sendResponse(response);
			});
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		console.error("Not yet implemented: disconnectRequest");
		this.sendErrorResponse(response, 2000, "Disconnect is not yet supported");
	}
	
	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
		console.warn("[NOT YET IMPLEMENTED]: setExceptionBreakPointRequest");
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		if (!this.breakpoints.get(args.source.path)) {
			this.breakpoints.set(args.source.path, []);
		}
		
		var filename = args.source.path;
		var existing = this.breakpoints.get(filename);
		
		this.lldb.removeAllBreakpoints()
			.then(() => this.lldb.setBreakpoints(filename, args.lines))
			.then(() => this.sendResponse(response));
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		console.error("Not yet implemented: threadRequest");
		this.sendErrorResponse(response, 2000, "Threads is not yet supported");
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		console.error("Not yet implemented: stackTraceRequest");
		this.sendErrorResponse(response, 2000, "Stack Trace is not yet supported");
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		console.error("Not yet implemented: scopesRequest");
		this.sendErrorResponse(response, 2000, "Scopes is not yet supported");
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		console.error("Not yet implemented: variablesRequest");
		this.sendErrorResponse(response, 2000, "Variables is not yet supported");
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse): void {
		console.error("Not yet implemented: continueRequest");
		this.sendErrorResponse(response, 2000, "Continue is not yet supported");
	}

	protected nextRequest(response: DebugProtocol.NextResponse): void {
		console.error("Not yet implemented: nextRequest");
		this.sendErrorResponse(response, 2000, "Next is not yet supported");
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse): void {
		console.error("Not yet implemented: stepInRequest");
		this.sendErrorResponse(response, 2000, "Step In is not yet supported");
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
		console.error("Not yet implemented: stepOutRequest");
		this.sendErrorResponse(response, 2000, "Step out is not yet supported");
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse): void {
		console.error("Not yet implemented: pauseRequest");
		this.sendErrorResponse(response, 2000, "Pause is not yet supported");
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		this.lldb.evaluate(args.expression)
			.then(() => this.sendResponse(response));
	}
}

DebugSession.run(SwiftDebugSession);