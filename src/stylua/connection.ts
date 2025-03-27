import * as lsp from 'vscode-languageserver/node';
import { textDocuments } from './textDocuments.js';
import cp from 'child_process';
import which from 'which';
import { isExecutable, isLua } from '../common.js';

interface StyluaOutput {
  file: "stdin",
  mismatches: Diff[],
}

interface Diff {
  expected: string,
  expected_end_line: number,
  expected_start_line: number,
  original: string,
  original_end_line: number,
  original_start_line: number,
}

function diff_to_text_edit(diff: Diff): lsp.TextEdit {
  if (diff.original == '') {
    return lsp.TextEdit.insert(lsp.Position.create(diff.expected_start_line, 0), diff.expected)
  }

  const start = lsp.Position.create(diff.original_start_line, 0)
  // NOTE: `lsp.Range` end is exclusive, `original_end_line` inclusive
  const endExclusive = lsp.Position.create(diff.original_end_line + 1, 0)
  const range = lsp.Range.create(start, endExclusive)

  if (diff.expected == '') {
    return lsp.TextEdit.del(range)
  } else {
    return lsp.TextEdit.replace(
      range,
      diff.expected
    )
  }
}

function outputToTextEdits(styluaOutput: string): lsp.TextEdit[] {
  let out: StyluaOutput = JSON.parse(styluaOutput);
  return out.mismatches.map(diff_to_text_edit)
}

async function styluaFormat(cwd: string, bin: string, filepath: string, content: string, rangeStart?: number, rangeEnd?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--search-parent-directories', '--check', '--output-format=JSON', '--stdin-filepath', filepath];
    if (rangeStart != null && rangeEnd != null) {
      args.push('--range-start', rangeStart.toString(), '--range-end', rangeEnd.toString());
    }
    args.push('-');

    const child = cp.spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd,
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('exit', (code) => {
      switch (code) {
        case 0:
          resolve(JSON.stringify([]))
          break
        case 1:
          resolve(output)
          break
        default:
          reject(`stylua exited with code ${code}`);
      }
    });

    child.stdin.write(content);
    child.stdin.end();
  });
}

const STATE = {
  cwd: process.cwd(),
  bin: null as string | null,
};

export async function createConnection(): Promise<lsp.Connection> {
  which('stylua').then((bin) => {
    // only set bin if it's found and wasn't set by configuration
    if (bin && !STATE.bin) {
      STATE.bin = bin;
    }
  }).catch(() => { });

  const connection = lsp.createConnection(process.stdin, process.stdout);
  textDocuments.listen(connection);

  connection.onInitialize((params) => {
    if (params.workspaceFolders?.[0]) {
      const workspaceFolder = params.workspaceFolders[0];
      const filePath = workspaceFolder.uri.replace('file://', '');
      STATE.cwd = filePath;
    }
    return {
      capabilities: {
        textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
      },
    }
  })

  connection.onDocumentFormatting(async (params) => {
    if (!STATE.bin) {
      return null;
    }
    if (!isLua(params.textDocument.uri)) {
      return null;
    }

    const textDocument = textDocuments.get(params.textDocument.uri)
    if (!textDocument) {
      return null
    }

    const originalText = textDocument.getText()

    try {
      const output = await styluaFormat(STATE.cwd, STATE.bin, textDocument.uri, originalText)

      return outputToTextEdits(output)
    } catch (e) {
      connection.console.error(`stylua format error: ${e}`)
      return null
    }
  })

  connection.onDocumentRangeFormatting(async (params) => {
    if (!STATE.bin) {
      return null;
    }
    if (!isLua(params.textDocument.uri)) {
      return null;
    }

    const textDocument = textDocuments.get(params.textDocument.uri)
    if (!textDocument) {
      return null
    }

    const originalText = textDocument.getText()

    const rangeStart = textDocument.offsetAt(params.range.start)
    const rangeEnd = textDocument.offsetAt(params.range.end)

    try {
      const output = await styluaFormat(STATE.cwd, STATE.bin, textDocument.uri, originalText, rangeStart, rangeEnd)
      return outputToTextEdits(output)
    } catch (e) {
      connection.console.error(`stylua format error: ${e}`)
      return null
    }
  })

  connection.onDidChangeConfiguration(async change => {
    const settings = change.settings;
    const styluaBinFilePath = settings?.seleneBinFilePath;

    if (typeof styluaBinFilePath === 'string' && await isExecutable(styluaBinFilePath)) {
      STATE.bin = settings.selene.bin;
    }
  })

  return connection;
}
