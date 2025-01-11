import * as lsp from 'vscode-languageserver/node';
import {textDocuments} from './textDocuments.js';
import cp from 'child_process';
import which from 'which';
import { isExecutable, isLua } from '../common.js';

interface SeleneDiagnostic {
  type: string;
  severity: string;
  code: string;
  message: string;
  primary_label: {
    filename: string;
    span: {
      start: number,
      start_line: number,
      start_column: number,
      end: number,
      end_line: number,
      end_column: number
    },
    message: string
  },
  notes: unknown[],
  secondary_labels: unknown[]
}

function lint({
  bin,
  uri,
  content,
  connection,
}: {
  bin: string;
  uri: string;
  content: string;
  connection: lsp.Connection;
}): Promise<lsp.PublishDiagnosticsParams> {
  return new Promise<lsp.PublishDiagnosticsParams>((resolve) => {
    const args = ['--display-style=json2', '--no-summary', '-'];

    const child = cp.spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let out = '';
    child.stdout.on('data', (data) => {
      out += data;
    });

    child.stdin.write(content);
    child.stdin.end();

    child.on('exit', (code) => {
      if (code !== 0) {
        if (out) {
          try {
            // TODO validation
            const diagnostics: SeleneDiagnostic[] = out.trim().split('\n').map(x => {try {
              return JSON.parse(x) as SeleneDiagnostic;
            } catch (e) {
              // mark parse.debugs
              return null;
            }}).filter(x => x !== null)

            resolve({
              uri: uri,
              diagnostics: diagnostics.filter(
                (sd: SeleneDiagnostic) => sd.type === 'Diagnostic' && sd.severity in lsp.DiagnosticSeverity
              ).map((sd: SeleneDiagnostic) => {
                return {
                  severity: lsp.DiagnosticSeverity[
                    sd.severity as keyof typeof lsp.DiagnosticSeverity
                  ],
                  range: {
                    start: {
                      line: sd.primary_label.span.start_line,
                      character: sd.primary_label.span.start_column,
                    },
                    end: {
                      line: sd.primary_label.span.end_line,
                      character: sd.primary_label.span.end_column,
                    },
                  },
                  message: sd.message || sd.primary_label.message,
                  source: 'selene',
                  code: sd.code,
                };
              }),
            } satisfies lsp.PublishDiagnosticsParams);
          } catch (e) {
            if (`${e}`.includes('JSON')) {
              connection.console.debug(`selene JSON error caught: ${e}, json: ${out}`);
            } else {
              connection.console.debug(`selene error caught: ${e}`);
            }
            resolve({
              uri: uri,
              diagnostics: [],
            } satisfies lsp.PublishDiagnosticsParams);
          }
        }
        connection.console.debug(`selene exited with code ${code}, out: ${out}`);
      } else {
        connection.console.debug(`selene reset diagnostics ${uri}, code: ${code}`);
        // reset diagnostics
        resolve({
          uri: uri,
          diagnostics: [],
        } satisfies lsp.PublishDiagnosticsParams);
      }
    });
  });
}

const STATE = {
  cwd: process.cwd(),
  bin: null as string | null,
};

export async function createConnection(): Promise<lsp.Connection> {
  which('selene').then((bin) => {
    // only set bin if it's found and wasn't set by configuration
    if (bin && !STATE.bin) {
      STATE.bin = bin;
    }
  }).catch(() => {});

  const connection = lsp.createConnection(process.stdin, process.stdout);
  const debounceTimers = new Map();
  const debouncedLint = (uri: string, content: string) => {
    if (debounceTimers.has(uri)) {
      clearTimeout(debounceTimers.get(uri));
    }
    debounceTimers.set(uri, setTimeout(async () => {
      debounceTimers.delete(uri);
      connection.sendDiagnostics(
        await lint({
          uri,
          content,
          connection,
          bin: STATE.bin as string,
        })
      )
    }, 100));
  }

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
      },
    } satisfies lsp.InitializeResult;
  })

  textDocuments.onDidOpen(event => {
    connection.console.debug(`did open > ${event.document.uri}`);
    if (!STATE.bin) {
      return;
    }
    if (!isLua(event.document.uri, event.document.languageId)) {
      return;
    }
    debouncedLint(event.document.uri, event.document.getText());
  })

  textDocuments.onDidChangeContent(event => {
    connection.console.debug(`did change > ${event.document.uri}`);
    if (!STATE.bin) {
      return;
    }
    if (!isLua(event.document.uri, event.document.languageId)) {
      return;
    }
    debouncedLint(event.document.uri, event.document.getText());
  })

  textDocuments.onDidSave(event => {
    connection.console.debug(`did save > ${event.document.uri}`);
    if (!STATE.bin) {
      return;
    }
    if (!isLua(event.document.uri, event.document.languageId)) {
      return;
    }
    debouncedLint(event.document.uri, event.document.getText());
  })

  connection.onDidChangeConfiguration(async change => {
    const settings = change.settings;
    const seleneBinFilePath = settings?.seleneBinFilePath;

    if (typeof seleneBinFilePath === 'string' && await isExecutable(seleneBinFilePath)) {
      STATE.bin = settings.selene.bin;
    }
  })

  return connection;
}
