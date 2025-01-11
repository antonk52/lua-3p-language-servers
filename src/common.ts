import fs from 'fs';

export function isExecutable(filepath: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access(filepath, fs.constants.X_OK, (err) => {
      resolve(!err);
    });
  });
}

export function isLua(uri: string, langaugeId?: string | undefined): boolean {
  return langaugeId === 'lua' || uri.endsWith('.lua');
}

