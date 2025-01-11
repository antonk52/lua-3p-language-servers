import * as lsp from 'vscode-languageserver/node';
import {textDocuments} from './textDocuments.js';
import cp from 'child_process';
import which from 'which';

function isLua(uri: string, langaugeId?: string | undefined): boolean {
  return langaugeId === 'lua' || uri.endsWith('.lua');
}

async function styluaFormat(bin: string, filepath: string, content: string, rangeStart?: number, rangeEnd?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--search-parent-directories', '--stdin-filepath', filepath];
    if (rangeStart != null && rangeEnd != null) {
      args.push('--range-start', rangeStart.toString(), '--range-end', rangeEnd.toString());
    }
    args.push('-');

    const child = cp.spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(`stylua exited with code ${code}`);
      }
    });

    child.stdin.write(content);
    child.stdin.end();
  });
}

export async function createConnection(): Promise<lsp.Connection> {
  const inferredBin = await which('stylua');
  const connection = lsp.createConnection(process.stdin, process.stdout);
  textDocuments.listen(connection);

  connection.onInitialize(() => {
    return {
			capabilities: {
				textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
			},
		}
  })

  connection.onDocumentFormatting(async (params) => {
    if (!isLua(params.textDocument.uri)) {
      return null;
    }

    const textDocument = textDocuments.get(params.textDocument.uri)
    if (!textDocument) {
      return null
    }

    const originalText = textDocument.getText()

    const start = { line: 0, character: 0 }
    const end = textDocument.positionAt(originalText.length)
    const range = lsp.Range.create(start, end)

    try {
      const formattedText = await styluaFormat(inferredBin, textDocument.uri, originalText)

      return [lsp.TextEdit.replace(range, formattedText)]
    } catch (e) {
      connection.console.error(`stylua format error: ${e}`)
      return null
    }
	})

  connection.onDocumentRangeFormatting(async (params) => {
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
      const formattedText = await styluaFormat(inferredBin, textDocument.uri, originalText, rangeStart, rangeEnd)

      const formattedTextRanged = formattedText.slice(
        rangeStart,
        rangeEnd + formattedText.length - originalText.length,
      )

      return [lsp.TextEdit.replace(params.range, formattedTextRanged)]
    } catch (e) {
      connection.console.error(`stylua format error: ${e}`)
      return null
    }
	})

  return connection;
}
