/*---------------------------------------------------------
 * Copyright (C) David Owens II. All rights reserved.
 *--------------------------------------------------------*/

import {DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import {readFileSync} from 'fs';
import {basename} from 'path';


export interface LaunchRequestArguments {
	program: string;
	stopOnEntry?: boolean;
}

class MockDebugSession extends DebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	private __currentLine: number;
	private get _currentLine() : number {
        return this.__currentLine;
    }
	private set _currentLine(line: number) {
        this.__currentLine = line;
		this.sendEvent(new OutputEvent(`line: ${line}\n`));	// print current line on debug console
    }

	private _sourceFile: string;
	private _sourceLines: string[];
	private _breakPoints: any;
	private _variableHandles: Handles<string>;


	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this._sourceFile = null;
		this._sourceLines = [];
		this._currentLine = 0;
		this._breakPoints = {};
		this._variableHandles = new Handles<string>();
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		this.sendResponse(response);

		// now we are ready to accept breakpoints -> fire the initialized event to give UI a chance to set breakpoints
		this.sendEvent(new InitializedEvent());
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this._sourceFile = args.program;
		this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');

		if (args.stopOnEntry) {
			this._currentLine = 0;
			this.sendResponse(response);

			// we stop on the first line
			this.sendEvent(new StoppedEvent("entry", MockDebugSession.THREAD_ID));
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continueRequest(response, { threadId: MockDebugSession.THREAD_ID });
		}
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		var path = args.source.path;
		var clientLines = args.lines;

		// read file contents into array for direct access
		var lines = readFileSync(path).toString().split('\n');

		var newPositions = [clientLines.length];
		var breakpoints = [];

		// verify breakpoint locations
		for (var i = 0; i < clientLines.length; i++) {
			var l = this.convertClientLineToDebugger(clientLines[i]);
			var verified = false;
			if (l < lines.length) {
				// if a line starts with '+' we don't allow to set a breakpoint but move the breakpoint down
				if (lines[l].indexOf("+") == 0)
					l++;
				// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
				if (lines[l].indexOf("-") == 0)
					l--;
				verified = true;    // this breakpoint has been validated
			}
			newPositions[i] = l;
			breakpoints.push({ verified: verified, line: this.convertDebuggerLineToClient(l)});
		}
		this._breakPoints[path] = newPositions;

		// send back the actual breakpoints
		response.body = {
			breakpoints: breakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// return the default thread
		response.body = {
			threads: [
				new Thread(MockDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const frames = new Array<StackFrame>();
		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);
		// create three fake stack frames.
		for (let i= 0; i < 3; i++) {
			// use a word of the line as the stackframe name
			const name = words.length > i ? words[i] : "frame";
			frames.push(new StackFrame(i, `${name}(${i})`, new Source(basename(this._sourceFile), this.convertDebuggerPathToClient(this._sourceFile)), this.convertDebuggerLineToClient(this._currentLine), 0));
		}
		response.body = {
			stackFrames: frames
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
		scopes.push(new Scope("Closure", this._variableHandles.create("closure_" + frameReference), false));
		scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		const variables = [];
		const id = this._variableHandles.get(args.variablesReference);
		if (id != null) {
			variables.push({
				name: id + "_i",
				value: "123",
				variablesReference: 0
			});
			variables.push({
				name: id + "_f",
				value: "3.14",
				variablesReference: 0
			});
			variables.push({
				name: id + "_s",
				value: "hello world",
				variablesReference: 0
			});
			variables.push({
				name: id + "_o",
				value: "Object",
				variablesReference: this._variableHandles.create("object_")
			});
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {

		const lines = this._breakPoints[this._sourceFile];
		for (let ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
			// is breakpoint on this line?
			if (lines && lines.indexOf(ln) >= 0) {
				this._currentLine = ln;
				this.sendResponse(response);
				this.sendEvent(new StoppedEvent("step", MockDebugSession.THREAD_ID));
				return;
			}
			// if word 'exception' found in source -> throw exception
			if (this._sourceLines[ln].indexOf("exception") >= 0) {
				this._currentLine = ln;
				this.sendResponse(response);
				this.sendEvent(new StoppedEvent("exception", MockDebugSession.THREAD_ID));
				this.sendEvent(new OutputEvent(`exception in line: ${ln}\n`, 'stderr'));
				return;
			}
		}
		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {

		for (let ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
			if (this._sourceLines[ln].trim().length > 0) {   // find next non-empty line
				this._currentLine = ln;
				this.sendResponse(response);
				this.sendEvent(new StoppedEvent("step", MockDebugSession.THREAD_ID));
				return;
			}
		}
		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		response.body = {
			result: `evaluate(${args.expression})`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}
}

DebugSession.run(MockDebugSession);



//'use strict';

// import {DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles} from 'vscode-debugadapter';
// import {DebugProtocol} from 'vscode-debugprotocol';
// import {readFileSync} from 'fs';
// import {basename} from 'path';

// import { getToolPath } from './utils';

// require("console-stamp")(console);

// // This interface should always match the schema found in `package.json`.
// interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
// 	program: string;
// 	stopOnEntry?: boolean;
// 	args?: string[];
// 	cwd?: string;
// 	env?: { [key: string]: string; },
// 	mode?: string;
// 	buildFlags?: string;
// 	init?: string;
// }

// interface DebugBreakpoint {
// 	id: number;
// 	file: string;
// 	line: number;
// }

// class LLDB {
// 	debugger: ChildProcess;

// 	onstdout: (str: string) => void;
// 	onstderr: (str: string) => void;

// 	public constructor(
// 		onstdout: (str: string) => void,
// 		onstderr: (str: string) => void)
// 	{
// 		this.debugger = null;
// 		this.onstdout = onstdout;
// 		this.onstderr = onstderr;
// 	}

// 	public connect(program: string): Promise<boolean> {
// 		let self = this;

// 		return new Promise((resolve, reject) => {
// 			let toolpath = getToolPath("lldb")
// 			if (toolpath == null) {
// 				return reject("Cannot find LLDB debugger on the system PATH.");
// 			}
// 			console.log(`Using LLDB : ${toolpath}`)

// 			let lldb = spawn("lldb", [program]);

// 			lldb.stdout.on("data", (bytes: Uint8Array) => {
// 				let str = (bytes + "");
// 				console.log(str);

// 				str = str.replace(/^\(lldb\).*\n/g, "")
// 				if (self.onstdout) {
// 					self.onstdout(str);
// 				}
// 			});

// 			lldb.stderr.on("data", (bytes: Uint8Array) => {
// 				let str = (bytes + "");
// 				console.error(str);

// 				str = str.replace(/^\(lldb\).*\n/g, "")
// 				if (self.onstdout) {
// 					self.onstdout(str);
// 				}
// 			});

// 			lldb.on("close", (code: number) => {
// 				console.log(`"Process exiting with code: ${code}`);
// 				reject(code);
// 			});
// 			lldb.on("error", (err) => {
// 				console.log(err + "");
// 				reject(err);
// 			});

// 			self.debugger = lldb;
// 			resolve(true);
// 		});
// 	}

// 	public evaluate(expression: string): Promise<string> {
// 		return this.doCommand(expression);
// 	}

// 	private doCommand(command: string): Promise<string> {
// 		let self = this;
// 		return new Promise((resolve, reject) => {
// 			// HACK(owensd): In order to support multi-step commands, an "empty line" must be able
// 			// to be send. So if the user enters "\n", treat it as the empty line until VSCode supports
// 			// this type of interaction.
// 			if (command === "\\n") { command = ""; }
// 			self.debugger.stdin.write(`${command}\n`, () => resolve(""));
// 		});
// 	}
// }


// class SwiftDebugSession extends DebugSession {
// 	private static MAIN_THREAD_ID = 0;

// 	private lldb: LLDB;
// 	private breakpoints: Map<string, DebugProtocol.Breakpoint[]>;

// 	private program: string;
// 	private currentline: number;

// 	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
// 		super(debuggerLinesStartAt1, isServer);

// 		this.lldb = new LLDB(
// 			(str) => this.sendEvent(new OutputEvent(str)),
// 			(str) => this.sendEvent(new OutputEvent(str)));
// 		this.breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();
// 		this.program = null;
// 		this.currentline = 0;
// 	}

// 	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
// 		this.sendResponse(response);
// 		this.sendEvent(new InitializedEvent());
// 	}

// 	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
// 		this.program = args.program;

// 		this.lldb.connect(this.program)
// 			.then(() => {
// 				if (args.stopOnEntry) {
// 					this.currentline = 0;
// 					this.sendResponse(response);
// 					this.sendEvent(new StoppedEvent("entry", SwiftDebugSession.MAIN_THREAD_ID));
// 				}
// 				else {
// 					this.continueRequest(response, { threadId: SwiftDebugSession.MAIN_THREAD_ID });
// 				}
// 			});
// 	}

// 	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
// 		this.sendResponse(response);
// 		this.sendEvent(new TerminatedEvent());
// 	}

// 	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
// 		this.sendErrorResponse(response, 101, "Setting a breakpoint on exceptions is not yet supported.");
// 	}

// 	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
// 		if (!this.breakpoints.get(args.source.path)) {
// 			this.breakpoints.set(args.source.path, []);
// 		}

// 		var path = args.source.path;
// 		var clientLines = args.lines;

// 		var lines = readFileSync(path).toString().split('\n');

// 		var newPositions = [clientLines.length];
// 		var breakpoints = [];

// 		for (var i = 0; i < clientLines.length; i++) {
// 			var l = this.convertClientLineToDebugger(clientLines[i]);
// 			var verified = false;
// 			if (l < lines.length) {
// 				verified = true;
// 			}
// 			newPositions[i] = l;
// 			breakpoints.push({ verified: verified, line: this.convertDebuggerLineToClient(l)});
// 		}
// 		this.breakpoints.set(path, breakpoints);

// 		response.body = {
// 			breakpoints: breakpoints
// 		};
// 		this.sendResponse(response);
// 	}

// 	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
// 		response.body = {
// 			threads: [
// 				new Thread(SwiftDebugSession.MAIN_THREAD_ID, "thread 0")
// 			]
// 		};
// 		this.sendResponse(response);
// 	}

// 	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
// 		const frames = new Array<StackFrame>();

// 		response.body = {
// 			stackFrames: frames
// 		};
// 		this.sendResponse(response);
// 	}

// 	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
// 		const frameReference = args.frameId;
// 		const scopes = new Array<Scope>();

// 		response.body = {
// 			scopes: scopes
// 		};
// 		this.sendResponse(response);
// 	}

// 	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
// 		const variables = [];

// 		response.body = {
// 			variables: variables
// 		}
// 		this.sendResponse(response);
// 	}

// 	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
// 		this.sendResponse(response);
// 	}

// 	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
// 		this.sendErrorResponse(response, 104, "Next is not supported.");
// 	}

// 	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
// 		this.sendErrorResponse(response, 102, "Step In is not yet supported");
// 	}

// 	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
// 		console.error("Not yet implemented: stepOutRequest");
// 		this.sendErrorResponse(response, 103, "Step out is not yet supported");
// 	}

// 	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
// 		this.sendResponse(response);
// 		this.sendEvent(new StoppedEvent("pause", SwiftDebugSession.MAIN_THREAD_ID));
// 	}

// 	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
// 		this.lldb.evaluate(args.expression)
// 			.then((result) => {
// 				response.body = {
// 					result: result,
// 					variablesReference: 0
// 				};
// 				this.sendResponse(response);
// 			});
// 	}
// }

// DebugSession.run(SwiftDebugSession);