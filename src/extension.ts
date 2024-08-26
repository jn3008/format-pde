import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "format-pde" is now active!');

	let disposable = vscode.commands.registerCommand('format-pde.format', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			const text = document.getText();

			// Call formatter
			const formattedText = formatProcessingCode(text);

			// Don't replace text if it's already formatted
			if (formattedText !== text) {
				editor.edit(editBuilder => {
					const firstLine = document.lineAt(0);
					const lastLine = document.lineAt(document.lineCount - 1);
					const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
					editBuilder.replace(fullRange, formattedText);
				});
			}
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }

class AutoFormat {
	private chars: string[] = [];
	private buf: string = '';
	private result: string = '';

	private indentValue: number = 2;

	private EOF: boolean = false;

	private inStatementFlag: boolean = false;
	private overflowFlag: boolean = false;
	private startFlag: boolean = true;
	private if_flg: boolean = false;
	private elseFlag: boolean = false;

	private arrayLevel: number = -1;
	private arrayIndent: number = 0;

	private conditionalLevel: number = 0;

	private sp_flg: number[][];
	private s_ind: boolean[][];
	private if_lev: number = 0;

	private pos: number = -1;
	private level: number = 0;

	private curlyLvl: number = 0;

	private parenLevel: number = 0;

	private ind: boolean[];
	private p_flg: number[];
	private s_tabs: number[][];

	private doWhileFlags: boolean[] = [];
	private ifWhileForFlags: boolean[] = [];

	private jdoc_flag: boolean = false;

	private tabs: number = 0;

	private lastNonWhitespace: string = '';

	constructor() {
		this.sp_flg = Array.from({ length: 20 }, () => new Array(10).fill(0));
		this.s_ind = Array.from({ length: 20 }, () => new Array(10).fill(false));
		this.ind = new Array(10).fill(false);
		this.p_flg = new Array(10).fill(0);
		this.s_tabs = Array.from({ length: 20 }, () => new Array(10).fill(0));
	}

	private handleMultiLineComment(): void {
		const savedStartFlag = this.startFlag;
		this.buf += this.nextChar();

		for (let ch = this.nextChar(); !this.EOF; ch = this.nextChar()) {
			this.buf += ch;
			while (ch !== '/' && !this.EOF) {
				if (ch === '\n') {
					this.writeIndentedComment();
					this.startFlag = true;
				}
				this.buf += this.nextChar();
			}
			if (this.buf.length >= 2 && this.buf[this.buf.length - 2] === '*') {
				this.jdoc_flag = false;
				break;
			}
		}

		this.writeIndentedComment();
		this.startFlag = savedStartFlag;
		this.jdoc_flag = false;
	}

	private handleSingleLineComment(): void {
		let ch = this.nextChar();
		while (ch !== '\n' && !this.EOF) {
			this.buf += ch;
			ch = this.nextChar();
		}
		this.writeIndentedLine();
		this.startFlag = true;
	}

	private writeIndentedLine(): void {
		if (this.buf.length === 0) {
			if (this.startFlag) this.startFlag = this.elseFlag = false;
			return;
		}

		if (this.startFlag) {
			const indentMore = !/^[\s\]\}\)]+;$/.test(this.buf)
				&& (this.buf.charAt(0) !== '{' || this.arrayLevel >= 0)
				&& this.overflowFlag;

			if (indentMore) {
				this.tabs++;
				if (this.arrayIndent > 0) this.tabs += this.arrayIndent;
			}

			this.printIndentation();
			this.startFlag = false;

			if (indentMore) {
				this.tabs--;
				if (this.arrayIndent > 0) this.tabs -= this.arrayIndent;
			}
		}

		if (this.lastNonSpaceChar() === '}' && this.bufStarts("else")) {
			this.result += ' ';
		}

		if (this.elseFlag) {
			if (this.lastNonSpaceChar() === '}') {
				this.result = this.trimRight(this.result);
				this.result += ' ';
			}
			this.elseFlag = false;
		}

		this.overflowFlag = this.inStatementFlag;
		this.arrayIndent = this.arrayLevel;
		this.result += this.buf;

		this.buf = '';
	}

	private lastNonSpaceChar(): string {
		for (let i = this.result.length - 1; i >= 0; i--) {
			const chI = this.result.charAt(i);
			if (chI !== ' ' && chI !== '\n') return chI;
		}
		return '';
	}

	private writeIndentedComment(): void {
		if (this.buf.length === 0) return;

		let firstNonSpace = 0;
		while (this.buf.charAt(firstNonSpace) === ' ') firstNonSpace++;
		if (this.lookup_com("/**")) this.jdoc_flag = true;

		if (this.startFlag) this.printIndentation();

		if (this.buf.charAt(firstNonSpace) === '/' && this.buf.charAt(firstNonSpace + 1) === '*') {
			if (this.startFlag && this.lastNonWhitespace !== ';') {
				this.result += this.buf.substring(firstNonSpace);
			} else {
				this.result += this.buf;
			}
		} else {
			if (this.buf.charAt(firstNonSpace) === '*' || !this.jdoc_flag) {
				this.result += " " + this.buf.substring(firstNonSpace);
			} else {
				this.result += " * " + this.buf.substring(firstNonSpace);
			}
		}
		this.buf = '';
	}

	private printIndentation(): void {
		if (this.tabs <= 0) {
			this.tabs = 0;
			return;
		}
		const spaces = this.tabs * this.indentValue;
		this.result += ' '.repeat(spaces);
	}

	private peek(): string {
		return this.pos + 1 >= this.chars.length ? '' : this.chars[this.pos + 1];
	}

	private advanceToNonSpace(allWsp: boolean): void {
		if (this.EOF) return;

		if (allWsp) {
			do {
				this.pos++;
			} while (this.pos < this.chars.length && /\s/.test(this.chars[this.pos]));
		} else {
			do {
				this.pos++;
			} while (this.pos < this.chars.length && this.chars[this.pos] === ' ');
		}

		if (this.pos === this.chars.length - 1) {
			this.EOF = true;
		} else {
			this.pos--; // reset for nextChar()
		}
	}

	private nextChar(): string {
		if (this.EOF) return '';
		this.pos++;
		if (this.pos >= this.chars.length - 1) this.EOF = true;
		if (this.pos >= this.chars.length) return '';

		const retVal = this.chars[this.pos];
		if (!/\s/.test(retVal)) this.lastNonWhitespace = retVal;
		return retVal;
	}

	private gotElse(): void {
		this.tabs = this.s_tabs[this.curlyLvl][this.if_lev];
		this.p_flg[this.level] = this.sp_flg[this.curlyLvl][this.if_lev];
		this.ind[this.level] = this.s_ind[this.curlyLvl][this.if_lev];
		this.if_flg = true;
		this.inStatementFlag = false;
	}

	private readForNewLine(): boolean {
		const savedTabs = this.tabs;
		let c = this.peek();
		while (!this.EOF && (c === '\t' || c === ' ')) {
			this.buf += this.nextChar();
			c = this.peek();
		}

		if (c === '/') {
			this.buf += this.nextChar();
			c = this.peek();
			if (c === '*') {
				this.buf += this.nextChar();
				this.handleMultiLineComment();
			} else if (c === '/') {
				this.buf += this.nextChar();
				this.handleSingleLineComment();
				return true;
			}
		}

		c = this.peek();
		if (c === '\n') {
			this.nextChar();
			this.tabs = savedTabs;
			return true;
		}
		return false;
	}

	private prevNonWhitespace(): string {
		const tot = this.result + this.buf;
		for (let i = tot.length - 1; i >= 0; i--) {
			if (!/\s/.test(tot.charAt(i))) return tot.charAt(i);
		}
		return '';
	}

	private bufStarts(keyword: string): boolean {
		const regex = new RegExp(`^\\s*${keyword}(?![a-zA-Z0-9_&]).*$`);
		return regex.test(this.buf);
	}

	private bufEnds(keyword: string): boolean {
		const regex = new RegExp(`^.*(?<![a-zA-Z0-9_&])${keyword}\\s*$`);
		return regex.test(this.buf);
	}

	private if_levSafe(): void {
		if (this.s_tabs[0].length <= this.if_lev) {
			this.s_tabs.forEach((arr, i) => this.s_tabs[i] = [...arr, 0]);
		}
		if (this.sp_flg[0].length <= this.if_lev) {
			this.sp_flg.forEach((arr, i) => this.sp_flg[i] = [...arr, 0]);
		}
		if (this.s_ind[0].length <= this.if_lev) {
			this.s_ind.forEach((arr, i) => this.s_ind[i] = [...arr, false]);
		}
	}

	private lookup_com(keyword: string): boolean {
		const regex = new RegExp(`^\\s*${keyword.replace("*", "\\*")}.*$`);
		return regex.test(this.buf);
	}

	private trimRight(str: string): string {
		return str.replace(/\s+$/, '');
	}

	public format(source: string): string {
		let normalizedText = source.replace(/\r/g, '');
		let cleanText = normalizedText;
		if (!normalizedText.endsWith("\n")) {
			cleanText += "\n";
		}

		this.result = '';
		this.indentValue = 2; // or whatever value you need

		let forFlag = false;
		this.if_flg = false;
		this.startFlag = true;
		let forParenthLevel = 0;
		this.conditionalLevel = 0;
		this.parenLevel = 0;
		this.curlyLvl = 0;
		this.if_lev = 0;
		this.level = 0;
		this.tabs = 0;
		this.jdoc_flag = false;
		this.inStatementFlag = false;
		this.overflowFlag = false;
		this.pos = -1;
		this.arrayLevel = -1;

		let s_level = new Array(10).fill(0);
		this.sp_flg = Array.from({ length: 20 }, () => new Array(10).fill(0));
		this.s_ind = Array.from({ length: 20 }, () => new Array(10).fill(false));
		let s_if_lev = new Array(10).fill(0);
		let s_if_flg = new Array(10).fill(false);
		this.ind = new Array(10).fill(false);
		this.p_flg = new Array(10).fill(0);
		this.s_tabs = Array.from({ length: 20 }, () => new Array(10).fill(0));
		this.doWhileFlags = [];
		this.ifWhileForFlags = [];

		this.chars = cleanText.split('');

		this.EOF = false;

		while (!this.EOF) {
			let c = this.nextChar();

			switch (c) {
				default:
					this.inStatementFlag = true;
					this.buf += c;
					break;

				case ',':
					this.inStatementFlag = true;
					this.buf = this.trimRight(this.buf);
					this.buf += ", ";
					this.advanceToNonSpace(false);
					break;

				case ' ':
				case '\t':
					this.elseFlag = this.bufEnds("else");
					if (this.elseFlag) {
						this.gotElse();
						if (!this.startFlag || this.buf.length > 0) {
							this.buf += c;
						}

						this.writeIndentedLine();
						this.startFlag = false;
						break;
					}
					if (!this.startFlag || this.buf.length > 0) this.buf += c;
					break;

				case '\n':
					if (this.EOF) break;

					this.elseFlag = this.bufEnds("else");
					if (this.elseFlag) this.gotElse();

					if (this.lookup_com("//")) {
						if (this.buf.charAt(this.buf.length - 1) === '\n') {
							this.buf = this.buf.slice(0, -1);
						}
					}

					if (this.elseFlag) {
						this.writeIndentedLine();
						this.result += "\n";

						this.p_flg[this.level]++;
						this.tabs++;
					} else {
						this.writeIndentedLine();
						this.result += "\n";
					}
					this.startFlag = true;
					break;

				case '{':
					this.elseFlag = this.bufEnds("else");
					if (this.elseFlag) this.gotElse();

					this.doWhileFlags.push(this.bufEnds("do"));

					const prevChar = this.prevNonWhitespace();
					if (this.arrayLevel >= 0 || prevChar === '=' || prevChar === ']') {
						this.arrayLevel++;
						this.buf += c;
						break;
					}

					this.inStatementFlag = false;

					if (s_if_lev.length === this.curlyLvl) {
						s_if_lev = [...s_if_lev, 0];
						s_if_flg = [...s_if_flg, false];
					}
					s_if_lev[this.curlyLvl] = this.if_lev;
					s_if_flg[this.curlyLvl] = this.if_flg;
					this.if_lev = 0;
					this.if_flg = false;
					this.curlyLvl++;
					if (this.startFlag && this.p_flg[this.level] !== 0) {
						this.p_flg[this.level]--;
						this.tabs--;
					}

					this.buf = this.trimRight(this.buf);
					if (this.buf.length > 0 || (this.result.length > 0 &&
						!/\s/.test(this.result.charAt(this.result.length - 1)))) {
						this.buf += " ";
					}
					this.buf += c;
					this.writeIndentedLine();
					this.readForNewLine();
					this.writeIndentedLine();

					this.result += '\n';
					this.tabs++;
					this.startFlag = true;

					if (this.p_flg[this.level] > 0) {
						this.ind[this.level] = true;
						this.level++;
						s_level[this.level] = this.curlyLvl;
					}
					break;

				case '}':
					if (this.arrayLevel >= 0) {
						if (this.arrayLevel > 0) this.arrayLevel--;
						if (this.arrayIndent > this.arrayLevel) this.arrayIndent = this.arrayLevel;
						this.buf += c;
						break;
					}

					this.inStatementFlag = false;

					this.curlyLvl--;
					if (this.curlyLvl < 0) {
						this.curlyLvl = 0;
						this.buf += c;
						this.writeIndentedLine();
					} else {
						this.if_lev = s_if_lev[this.curlyLvl] - 1;
						if (this.if_lev < 0) this.if_lev = 0;
						this.if_levSafe();

						this.if_flg = s_if_flg[this.curlyLvl];
						this.buf = this.trimRight(this.buf);
						this.writeIndentedLine();
						this.tabs--;

						this.result = this.trimRight(this.result);
						this.result += '\n';
						this.overflowFlag = false;
						this.printIndentation();
						this.result += c;
						if (this.peek() === ';') this.result += this.nextChar();

						if (this.doWhileFlags.length === 0 || !this.doWhileFlags.pop()
							|| !this.chars.slice(this.pos + 1).join('').trim().startsWith("while")) {
							this.readForNewLine();
							this.writeIndentedLine();
							this.result += '\n';
							this.startFlag = true;
						} else {
							this.result += ' ';
							this.advanceToNonSpace(true);
							this.startFlag = false;
						}

						if (this.curlyLvl < s_level[this.level] && this.level > 0) this.level--;

						if (this.ind[this.level]) {
							this.tabs -= this.p_flg[this.level];
							this.p_flg[this.level] = 0;
							this.ind[this.level] = false;
						}
					}
					break;

				case '"':
				case '“':
				case '”':
				case '\'':
				case '‘':
				case '’':
					this.inStatementFlag = true;
					let realQuote = c;
					if (c === '“' || c === '”') realQuote = '"';
					if (c === '‘' || c === '’') realQuote = '\'';
					this.buf += realQuote;

					let otherQuote = c;
					if (c === '“') otherQuote = '”';
					if (c === '”') otherQuote = '“';
					if (c === '‘') otherQuote = '’';
					if (c === '’') otherQuote = '‘';

					let cc = this.nextChar();
					while (!this.EOF && cc !== otherQuote && cc !== realQuote && cc !== c) {
						this.buf += cc;
						if (cc === '\\') {
							this.buf += this.nextChar();
						}

						if (this.peek() === '\n') break;
						cc = this.nextChar();
					}
					if (cc === otherQuote || cc === realQuote || cc === c) {
						this.buf += realQuote;
						if (this.readForNewLine()) {
							this.chars[--this.pos] = '\n';
						}
					} else {
						this.inStatementFlag = false;
					}
					break;

				case ';':
					if (forFlag) {
						this.buf = this.trimRight(this.buf);
						this.buf += "; ";
						this.advanceToNonSpace(false);
						break;
					}
					this.buf += c;
					this.inStatementFlag = false;
					this.writeIndentedLine();
					if (this.p_flg[this.level] > 0 && !this.ind[this.level]) {
						this.tabs -= this.p_flg[this.level];
						this.p_flg[this.level] = 0;
					}
					this.readForNewLine();
					this.writeIndentedLine();
					this.result += "\n";
					this.startFlag = true;
					this.arrayLevel = -1;

					if (this.if_lev > 0) {
						if (this.if_flg) {
							this.if_lev--;
							this.if_flg = false;
						} else {
							this.if_lev = 0;
						}
					}
					break;

				case '\\':
					this.buf += c;
					this.buf += this.nextChar();
					break;

				case '?':
					this.conditionalLevel++;
					this.buf += c;
					break;

				case ':':
					if (this.peek() === ':') {
						this.buf += c + this.nextChar();
						break;
					}

					if (this.conditionalLevel > 0) {
						this.conditionalLevel--;
						this.buf += c;
						break;
					}

					if (forFlag) {
						this.buf = this.trimRight(this.buf);
						this.buf += " : ";
						this.advanceToNonSpace(false);
						break;
					}

					this.buf += c;
					this.inStatementFlag = false;
					this.arrayLevel = -1;

					if (this.tabs > 0) {
						this.tabs--;
						this.writeIndentedLine();
						this.tabs++;
					} else {
						this.writeIndentedLine();
					}

					this.readForNewLine();
					this.writeIndentedLine();
					this.result += '\n';
					this.startFlag = true;
					break;

				case '/':
					const next = this.peek();
					if (next === '/') {
						this.buf += c + this.nextChar();
						this.handleSingleLineComment();
						this.result += "\n";
					} else if (next === '*') {
						if (this.buf.length > 0) {
							this.writeIndentedLine();
						}
						this.buf += c + this.nextChar();
						this.handleMultiLineComment();
					} else {
						this.buf += c;
					}
					break;

				case ')':
					this.parenLevel--;

					if (forFlag && forParenthLevel > this.parenLevel) forFlag = false;

					if (this.parenLevel < 0) this.parenLevel = 0;
					this.buf += c;

					const wasIfEtc = !this.ifWhileForFlags.length ? false : this.ifWhileForFlags.pop();
					if (wasIfEtc) {
						this.inStatementFlag = false;
						this.arrayLevel = -1;
					}

					this.writeIndentedLine();
					if (wasIfEtc && this.readForNewLine()) {
						this.chars[--this.pos] = '\n';
						if (this.parenLevel === 0) {
							this.p_flg[this.level]++;
							this.tabs++;
							this.ind[this.level] = false;
						}
					}
					break;

				case '(':
					const isFor = this.bufEnds("for");
					const isIf = this.bufEnds("if");

					if (isFor || isIf || this.bufEnds("while")) {
						if (!/\s/.test(this.buf.charAt(this.buf.length - 1))) {
							this.buf += ' ';
						}
						this.ifWhileForFlags.push(true);
					} else {
						this.ifWhileForFlags.push(false);
					}

					this.buf += c;
					this.parenLevel++;

					if (isFor && !forFlag) {
						forParenthLevel = this.parenLevel;
						forFlag = true;
					} else if (isIf) {
						this.writeIndentedLine();
						this.s_tabs[this.curlyLvl][this.if_lev] = this.tabs;
						this.sp_flg[this.curlyLvl][this.if_lev] = this.p_flg[this.level];
						this.s_ind[this.curlyLvl][this.if_lev] = this.ind[this.level];
						this.if_lev++;
						this.if_levSafe();
						this.if_flg = true;
					}
					break;
			}
		}

		if (this.buf.length > 0) this.writeIndentedLine();

		const formatted = this.simpleRegexCleanup(this.result);
		return formatted === cleanText ? source : formatted;
	}

	private simpleRegexCleanup(result: string): string {
		// Remove trailing spaces before a newline
		result = result.replace(/([^ \n]+) +\n/g, "$1\n");

		// Remove extra spaces around operators like =, ==, >, <, >=, <=, !=, etc.
		// result = result.replace(/\s*([=><!+\-*/%&|^~?:]+)\s*/g, '$1');

		// Move misplaced { back to the end of the previous line
		result = result.replace(/\n\s*{\n/g, ' {\n');

		return result;
	}
}


function formatProcessingCode(text: string): string {
	let autoFormat = new AutoFormat();
	return autoFormat.format(text);
}
